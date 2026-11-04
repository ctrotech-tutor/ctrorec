import { Link, createFileRoute } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'
import { requestRecovery, type RecoveryRequestResult } from '../lib/recovery'

export const Route = createFileRoute('/recover')({
  head: () => ({ meta: [{ title: 'Recover your account · ctrorec' }] }),
  component: RecoverPage,
})

function RecoverPage() {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<RecoveryRequestResult | null>(null)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) {
      return
    }
    const email = String(new FormData(event.currentTarget).get('email') ?? '')
    setPending(true)
    setError(null)
    try {
      setResult(await requestRecovery(email))
    } catch (reason: unknown) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'The recovery request could not be sent.',
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <main className="foundation-shell">
      <section
        className="foundation invitation-acceptance recovery-panel"
        aria-labelledby="recovery-title"
      >
        <img
          alt="ctrorec"
          className="brand-logo"
          height="520"
          src="/brand/ctrorec-logo.svg"
          width="1690"
        />
        <p className="eyebrow">Account-owned recovery</p>
        <h1 id="recovery-title">Recover access to your account.</h1>

        {result ? (
          <section className="invitation-success" aria-labelledby="sent-title">
            <p className="eyebrow">Request received</p>
            <h2 id="sent-title">Check your email.</h2>
            <p>{result.message}</p>
            <p>
              The link is valid for 15 minutes and can be used once. Your
              password stays unchanged until you complete the reset.
            </p>
            <Link className="secondary-button invitation-sign-in" to="/">
              Return to sign in
            </Link>
          </section>
        ) : (
          <>
            <p className="intro">
              Enter the email address for your global ctrorec account. For your
              privacy, the response is the same whether or not an active account
              matches.
            </p>
            <form className="sign-in-form" onSubmit={submit}>
              <label>
                Email address
                <input
                  autoComplete="email"
                  inputMode="email"
                  maxLength={254}
                  name="email"
                  required
                  type="email"
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
                {pending ? 'Requesting…' : 'Request a recovery link'}
              </button>
            </form>
            <p className="auth-note">
              Institution administrators manage memberships, not your global
              password.
            </p>
            <Link className="text-link" to="/">
              Back to sign in
            </Link>
          </>
        )}
      </section>
    </main>
  )
}
