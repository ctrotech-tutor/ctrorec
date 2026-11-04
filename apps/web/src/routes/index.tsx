import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'
import { AdminWorkspace } from '../components/admin-workspace'
import { CourseWorkspace } from '../components/course-workspace'
import { adminKeys } from '../lib/admin'
import { apiHealthOptions } from '../lib/api'
import {
  authKeys,
  authMeOptions,
  signIn,
  signOut,
  type AuthMe,
  type SignInInput,
} from '../lib/auth'
import { courseKeys } from '../lib/lectures'

export const Route = createFileRoute('/')({ component: HomePage })

function HomePage() {
  const queryClient = useQueryClient()
  const [workspace, setWorkspace] = useState<'lectures' | 'admin'>('lectures')
  const health = useQuery(apiHealthOptions)
  const auth = useQuery(authMeOptions)
  const signInMutation = useMutation({
    mutationFn: signIn,
    onSuccess: async () => {
      queryClient.removeQueries({ queryKey: courseKeys.all })
      queryClient.removeQueries({ queryKey: adminKeys.all })
      await queryClient.invalidateQueries({ queryKey: authKeys.me })
    },
  })
  const signOutMutation = useMutation({
    mutationFn: signOut,
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: courseKeys.all })
      queryClient.removeQueries({ queryKey: adminKeys.all })
      queryClient.setQueryData(authKeys.me, null)
    },
  })
  const status = health.isPending
    ? 'Checking API'
    : health.isError
      ? 'API unavailable'
      : 'API connected'
  const canAdmin =
    auth.data?.memberships.some(
      (membership) =>
        membership.status === 'active' &&
        membership.institution.status === 'active' &&
        membership.roles.includes('institution_admin'),
    ) ?? false

  function submitSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (signInMutation.isPending) {
      return
    }
    const data = new FormData(event.currentTarget)
    const input: SignInInput = {
      email: String(data.get('email') ?? ''),
      password: String(data.get('password') ?? ''),
    }
    signInMutation.mutate(input)
  }

  return (
    <main className="foundation-shell">
      <section className="foundation" aria-labelledby="foundation-title">
        <img
          alt="ctrorec"
          className="brand-logo"
          height="520"
          src="/brand/ctrorec-logo.svg"
          width="1690"
        />
        <p className="eyebrow">Institution-controlled lecture access</p>
        <h1 id="foundation-title">
          Lecture access, built around the teaching.
        </h1>
        <p className="intro">
          Use the account your institution assigned. Your course
          responsibilities determine which recordings you can publish or replay.
        </p>

        {auth.isPending ? (
          <p className="session-state" role="status">
            Checking your session…
          </p>
        ) : auth.data ? (
          <>
            <AccountPanel
              account={auth.data}
              error={signOutMutation.error?.message}
              pending={signOutMutation.isPending}
              onSignOut={() => signOutMutation.mutate()}
            />
            {canAdmin ? (
              <nav className="workspace-tabs" aria-label="Workspace views">
                <button
                  aria-pressed={workspace === 'lectures'}
                  onClick={() => setWorkspace('lectures')}
                  type="button"
                >
                  Course lectures
                </button>
                <button
                  aria-pressed={workspace === 'admin'}
                  onClick={() => setWorkspace('admin')}
                  type="button"
                >
                  Administration
                </button>
              </nav>
            ) : null}
            {canAdmin && workspace === 'admin' ? (
              <AdminWorkspace memberships={auth.data.memberships} />
            ) : (
              <CourseWorkspace ownerId={auth.data.user.id} />
            )}
          </>
        ) : (
          <section className="auth-panel" aria-labelledby="sign-in-title">
            <div>
              <p className="eyebrow">Your account</p>
              <h2 id="sign-in-title">Sign in to continue</h2>
            </div>
            {auth.isError ? (
              <p className="form-error" role="alert">
                Your session could not be checked. You can still try signing in.
              </p>
            ) : null}
            <form className="sign-in-form" onSubmit={submitSignIn}>
              <label>
                Email address
                <input
                  autoComplete="username"
                  inputMode="email"
                  name="email"
                  required
                  type="email"
                />
              </label>
              <label>
                Password
                <input
                  autoComplete="current-password"
                  name="password"
                  required
                  type="password"
                />
              </label>
              {signInMutation.error ? (
                <p className="form-error" role="alert">
                  {signInMutation.error.message}
                </p>
              ) : null}
              <button
                className="primary-button"
                disabled={signInMutation.isPending}
                type="submit"
              >
                {signInMutation.isPending ? 'Signing in…' : 'Sign in'}
              </button>
            </form>
            <Link className="text-link recovery-link" to="/recover">
              Forgot your password?
            </Link>
            <p className="auth-note">
              No public registration. Your institution controls membership and
              course access.
            </p>
          </section>
        )}

        <div className="system-row" aria-label="Workspace systems">
          <span>Application-owned auth</span>
          <span>PostgreSQL sessions</span>
          <span>NestJS security boundary</span>
        </div>
        <p
          className="api-status"
          data-testid="api-status"
          data-state={
            health.isPending ? 'pending' : health.isError ? 'error' : 'ready'
          }
          role="status"
        >
          <span className="status-mark" aria-hidden="true" />
          {status}
        </p>
      </section>
    </main>
  )
}

function AccountPanel({
  account,
  error,
  pending,
  onSignOut,
}: Readonly<{
  account: AuthMe
  error: string | undefined
  pending: boolean
  onSignOut: () => void
}>) {
  return (
    <section className="account-panel" aria-labelledby="account-title">
      <div className="account-heading">
        <div>
          <p className="eyebrow">Signed in</p>
          <h2 id="account-title">{account.user.displayName}</h2>
          <p className="account-email">{account.user.email}</p>
        </div>
        <button
          className="secondary-button"
          disabled={pending}
          onClick={onSignOut}
          type="button"
        >
          {pending ? 'Signing out…' : 'Sign out'}
        </button>
      </div>
      {account.memberships.length > 0 ? (
        <ul className="membership-list">
          {account.memberships.map((membership) => (
            <li key={membership.id}>
              <strong>{membership.institution.name}</strong>
              <span>
                {membership.roles.map(formatRole).join(' · ') ||
                  'No assigned role'}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="auth-note">
          No institution membership has been assigned to this account.
        </p>
      )}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  )
}

function formatRole(role: string): string {
  return role
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}
