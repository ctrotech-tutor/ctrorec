import { Link, createFileRoute } from '@tanstack/react-router'
import { useEffect, useState, type FormEvent } from 'react'
import {
  inspectRecovery,
  resetPassword,
  type RecoveryPreview,
} from '../lib/recovery'

export const Route = createFileRoute('/reset-password')({
  head: () => ({ meta: [{ title: 'Reset your password · ctrorec' }] }),
  component: ResetPasswordPage,
})

function ResetPasswordPage() {
  const [token, setToken] = useState<string | null>(null)
  const [preview, setPreview] = useState<RecoveryPreview | null>(null)
  const [resetComplete, setResetComplete] = useState(false)
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const parameters = new URLSearchParams(window.location.hash.slice(1))
    const recoveryToken = parameters.get('token')
    window.history.replaceState(
      window.history.state,
      '',
      `${window.location.pathname}${window.location.search}`,
    )
    if (!recoveryToken) {
      setError('This recovery link is incomplete. Request a new link.')
      setLoading(false)
      return
    }

    const controller = new AbortController()
    setToken(recoveryToken)
    inspectRecovery(recoveryToken, controller.signal)
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
    if (password !== confirmation) {
      setError('The password confirmation does not match.')
      return
    }

    setPending(true)
    setError(null)
    try {
      await resetPassword({ token, password })
      setResetComplete(true)
      setPreview(null)
      setToken(null)
    } catch (reason: unknown) {
      setError(errorMessage(reason))
    } finally {
      setPending(false)
    }
  }

  return (
    <main className="foundation-shell">
      <section
        className="foundation invitation-acceptance recovery-panel"
        aria-labelledby="reset-title"
      >
        <img
          alt="ctrorec"
          className="brand-logo"
          height="520"
          src="/brand/ctrorec-logo.svg"
          width="1690"
        />
        <p className="eyebrow">One-time account recovery</p>
        <h1 id="reset-title">Choose a new password.</h1>

        {resetComplete ? (
          <section className="invitation-success" aria-labelledby="reset-done">
            <p className="eyebrow">Password updated</p>
            <h2 id="reset-done">Your password has been reset.</h2>
            <p>
              Existing sessions and other outstanding recovery links have been
              revoked. Sign in with your new password.
            </p>
            <Link className="primary-button invitation-sign-in" to="/">
              Continue to sign in
            </Link>
          </section>
        ) : loading ? (
          <p className="session-state" role="status">
            Checking this recovery link…
          </p>
        ) : preview ? (
          <>
            <p className="intro">
              Use at least 12 characters. This link expires{' '}
              {new Intl.DateTimeFormat('en', {
                dateStyle: 'medium',
                timeStyle: 'short',
              }).format(new Date(preview.expiresAt))}
              .
            </p>
            <form className="sign-in-form" onSubmit={submit}>
              <label>
                New password
                <input
                  autoComplete="new-password"
                  maxLength={128}
                  minLength={12}
                  name="password"
                  required
                  type="password"
                />
              </label>
              <label>
                Confirm new password
                <input
                  autoComplete="new-password"
                  maxLength={128}
                  minLength={12}
                  name="confirmation"
                  required
                  type="password"
                />
              </label>
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
                {pending ? 'Resetting…' : 'Reset password'}
              </button>
            </form>
          </>
        ) : (
          <section
            className="invitation-success"
            aria-labelledby="invalid-link"
          >
            <h2 id="invalid-link">This link cannot be used.</h2>
            <p className="form-error" role="alert">
              {error ?? 'This recovery link is no longer available.'}
            </p>
            <Link className="primary-button" to="/recover">
              Request a new recovery link
            </Link>
          </section>
        )}
      </section>
    </main>
  )
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error
    ? reason.message
    : 'The recovery request could not be completed.'
}
