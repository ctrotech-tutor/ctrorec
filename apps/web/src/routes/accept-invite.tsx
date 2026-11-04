import { Link, createFileRoute } from '@tanstack/react-router'
import { useEffect, useState, type FormEvent } from 'react'
import {
  acceptInvitation,
  inspectInvitation,
  type AcceptedInvitation,
  type InvitationPreview,
} from '../lib/invitations'

export const Route = createFileRoute('/accept-invite')({
  head: () => ({ meta: [{ title: 'Accept invitation · ctrorec' }] }),
  component: AcceptInvitationPage,
})

function AcceptInvitationPage() {
  const [token, setToken] = useState<string | null>(null)
  const [preview, setPreview] = useState<InvitationPreview | null>(null)
  const [accepted, setAccepted] = useState<AcceptedInvitation | null>(null)
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const parameters = new URLSearchParams(window.location.hash.slice(1))
    const invitationToken = parameters.get('token')
    window.history.replaceState(
      window.history.state,
      '',
      `${window.location.pathname}${window.location.search}`,
    )
    if (!invitationToken) {
      setError('This invitation link is incomplete. Ask for a new link.')
      setLoading(false)
      return
    }

    const controller = new AbortController()
    setToken(invitationToken)
    inspectInvitation(invitationToken, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) {
          setPreview(result)
        }
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setError(errorMessage(reason))
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false)
        }
      })
    return () => controller.abort()
  }, [])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!token || !preview || pending) {
      return
    }
    const data = new FormData(event.currentTarget)
    const password = String(data.get('password') ?? '')
    const confirmation = String(data.get('confirmation') ?? '')
    if (!preview.accountExists && password !== confirmation) {
      setError('The password confirmation does not match.')
      return
    }

    setPending(true)
    setError(null)
    try {
      const result = await acceptInvitation({
        token,
        email: preview.email,
        password,
      })
      setAccepted(result)
      setPreview(null)
      setToken(null)
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setPending(false)
    }
  }

  return (
    <main className="foundation-shell">
      <section
        className="foundation invitation-acceptance"
        aria-labelledby="invitation-title"
      >
        <img
          alt="ctrorec"
          className="brand-logo"
          height="520"
          src="/brand/ctrorec-logo.svg"
          width="1690"
        />
        <p className="eyebrow">Institution-controlled access</p>
        <h1 id="invitation-title">Accept your invitation.</h1>

        {accepted ? (
          <section
            className="invitation-success"
            aria-labelledby="accepted-title"
          >
            <p className="eyebrow">Membership active</p>
            <h2 id="accepted-title">You can now sign in.</h2>
            <p>
              {accepted.displayName}, your {accepted.institution.name}{' '}
              membership is ready. Use {accepted.email} and your password.
            </p>
            <Link className="primary-button invitation-sign-in" to="/">
              Continue to sign in
            </Link>
          </section>
        ) : loading ? (
          <p className="session-state" role="status">
            Checking your invitation…
          </p>
        ) : preview ? (
          <section
            className="invitation-details"
            aria-labelledby="invitation-details-title"
          >
            <div>
              <p className="eyebrow">{preview.institution.name}</p>
              <h2 id="invitation-details-title">
                Welcome, {preview.displayName}.
              </h2>
              <p>
                Roles: {preview.roles.map(formatRole).join(' · ')}. This
                invitation expires{' '}
                {new Date(preview.expiresAt).toLocaleString()}.
              </p>
            </div>
            <form className="sign-in-form" onSubmit={submit}>
              <label>
                Invitation email
                <input readOnly type="email" value={preview.email} />
              </label>
              <label>
                {preview.accountExists
                  ? 'Current password'
                  : 'Choose a password'}
                <input
                  autoComplete={
                    preview.accountExists ? 'current-password' : 'new-password'
                  }
                  maxLength={128}
                  minLength={preview.accountExists ? undefined : 12}
                  name="password"
                  required
                  type="password"
                />
              </label>
              {!preview.accountExists ? (
                <label>
                  Confirm password
                  <input
                    autoComplete="new-password"
                    maxLength={128}
                    minLength={12}
                    name="confirmation"
                    required
                    type="password"
                  />
                </label>
              ) : null}
              <p className="auth-note">
                {preview.accountExists
                  ? 'Confirm your existing account password to add this institution membership. Your name and password will not change.'
                  : 'Create a password of at least 12 characters. Acceptance does not sign you in automatically.'}
              </p>
              {error ? (
                <p className="form-error" role="alert">
                  {error}
                </p>
              ) : null}
              <button
                className="primary-button"
                disabled={pending}
                type="submit"
              >
                {pending ? 'Accepting…' : 'Accept invitation'}
              </button>
            </form>
          </section>
        ) : (
          <section className="invitation-details">
            <p className="form-error" role="alert">
              {error ?? 'This invitation is not available.'}
            </p>
            <Link className="secondary-button invitation-sign-in" to="/">
              Return to sign in
            </Link>
          </section>
        )}
      </section>
    </main>
  )
}

function formatRole(role: string): string {
  return role
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error
    ? reason.message
    : 'The invitation could not be processed. Try again.'
}
