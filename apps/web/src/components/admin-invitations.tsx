import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { adminKeys } from '../lib/admin'
import {
  adminInvitationsOptions,
  createInvitation,
  revokeInvitation,
  type CreatedInvitation,
  type InvitationView,
} from '../lib/invitations'

export function AdminInvitations({
  institutionId,
}: Readonly<{ institutionId: string }>) {
  const queryClient = useQueryClient()
  const invitations = useQuery(adminInvitationsOptions(institutionId))
  const [formKey, setFormKey] = useState(0)
  const [createdLink, setCreatedLink] = useState<{
    email: string
    url: string
  } | null>(null)

  async function refresh() {
    await queryClient.invalidateQueries({
      queryKey: adminKeys.invitations(institutionId),
    })
  }

  const create = useMutation({
    mutationFn: createInvitation,
    onSuccess: async (result) => {
      setCreatedLink({
        email: result.invitation.email,
        url: invitationUrl(result),
      })
      setFormKey((value) => value + 1)
      await refresh()
    },
  })

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (create.isPending) {
      return
    }
    const data = new FormData(event.currentTarget)
    create.mutate({
      institutionId,
      email: String(data.get('email') ?? ''),
      displayName: String(data.get('displayName') ?? ''),
      roles: data.getAll('roles').map(String),
      expiresInDays: Number(data.get('expiresInDays') ?? 7),
    })
  }

  return (
    <section
      className="admin-section invitations-section"
      aria-labelledby="invitations-title"
    >
      <div className="admin-section-heading">
        <h3 id="invitations-title">Invitations</h3>
        <span>{invitations.data?.length ?? 0}</span>
      </div>
      <p className="admin-hint">
        Invite a person without opening public registration. Copy the link and
        send it through an approved institution channel; no email is sent by
        ctrorec.
      </p>

      <details className="admin-create">
        <summary>Invite a person</summary>
        <form className="admin-form" key={formKey} onSubmit={submit}>
          <label>
            Email address
            <input
              autoComplete="off"
              inputMode="email"
              maxLength={254}
              name="email"
              required
              type="email"
            />
          </label>
          <label>
            Full name
            <input
              autoComplete="off"
              maxLength={120}
              name="displayName"
              required
            />
          </label>
          <fieldset className="invitation-roles">
            <legend>Membership roles</legend>
            <label>
              <input
                name="roles"
                type="checkbox"
                value="student"
                defaultChecked
              />
              Student
            </label>
            <label>
              <input name="roles" type="checkbox" value="academic_staff" />
              Academic staff
            </label>
            <label>
              <input name="roles" type="checkbox" value="institution_admin" />
              Institution admin
            </label>
          </fieldset>
          <label>
            Valid for
            <select defaultValue="7" name="expiresInDays">
              <option value="3">3 days</option>
              <option value="7">7 days</option>
              <option value="14">14 days</option>
            </select>
          </label>
          <button
            className="primary-button"
            disabled={create.isPending}
            type="submit"
          >
            {create.isPending ? 'Creating…' : 'Create invitation'}
          </button>
          <MutationError error={create.error?.message} />
        </form>
      </details>

      {createdLink ? (
        <CreatedInvitationLink
          key={createdLink.url}
          email={createdLink.email}
          url={createdLink.url}
        />
      ) : null}

      {invitations.isPending ? (
        <p className="workspace-state" role="status">
          Loading invitations…
        </p>
      ) : invitations.isError ? (
        <p className="form-error" role="alert">
          {invitations.error.message}
        </p>
      ) : invitations.data.length === 0 ? (
        <p className="admin-hint">No invitations have been created.</p>
      ) : (
        <div className="invitation-list">
          {invitations.data.map((invitation) => (
            <InvitationItem
              key={invitation.id}
              institutionId={institutionId}
              invitation={invitation}
              onRevoked={refresh}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function CreatedInvitationLink({
  email,
  url,
}: Readonly<{ email: string; url: string }>) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>(
    'idle',
  )

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopyState('copied')
    } catch {
      setCopyState('failed')
    }
  }

  return (
    <section
      className="invitation-link"
      aria-labelledby="invitation-link-title"
    >
      <div>
        <h4 id="invitation-link-title">Invitation ready for {email}</h4>
        <p>
          This is the only time the link is shown. Creating a replacement
          invalidates earlier open links for this person.
        </p>
      </div>
      <label>
        Single-use invitation link
        <input
          readOnly
          value={url}
          onFocus={(event) => event.target.select()}
        />
      </label>
      <button className="secondary-button" onClick={copy} type="button">
        Copy invitation link
      </button>
      {copyState === 'copied' ? (
        <p role="status">Invitation link copied.</p>
      ) : copyState === 'failed' ? (
        <p className="form-error" role="alert">
          Copy failed. Select the link and copy it manually.
        </p>
      ) : null}
    </section>
  )
}

function InvitationItem({
  institutionId,
  invitation,
  onRevoked,
}: Readonly<{
  institutionId: string
  invitation: InvitationView
  onRevoked: () => Promise<void>
}>) {
  const revoke = useMutation({
    mutationFn: () =>
      revokeInvitation({ institutionId, invitationId: invitation.id }),
    onSuccess: onRevoked,
  })
  return (
    <article className="invitation-record" data-status={invitation.status}>
      <div className="invitation-record-main">
        <div>
          <strong>{invitation.displayName}</strong>
          <span>{invitation.email}</span>
        </div>
        <span className="invitation-status">{invitation.status}</span>
      </div>
      <small>
        {invitation.roles.map(formatRole).join(' · ')} · Expires{' '}
        {formatDate(invitation.expiresAt)}
      </small>
      <small>
        Issued by {invitation.invitedBy.displayName} ·{' '}
        {formatDate(invitation.createdAt)}
      </small>
      {invitation.status === 'pending' ? (
        <button
          className="button-link"
          disabled={revoke.isPending}
          onClick={() => revoke.mutate()}
          type="button"
        >
          {revoke.isPending ? 'Revoking…' : 'Revoke invitation'}
        </button>
      ) : null}
      <MutationError error={revoke.error?.message} />
    </article>
  )
}

function invitationUrl(result: CreatedInvitation): string {
  const url = new URL('/accept-invite', window.location.origin)
  url.hash = `token=${encodeURIComponent(result.token)}`
  return url.toString()
}

function formatRole(role: string): string {
  return role
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString()
}

function MutationError({ error }: Readonly<{ error: string | undefined }>) {
  return error ? (
    <p className="form-error" role="alert">
      {error}
    </p>
  ) : null
}
