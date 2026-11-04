import { Link, useLocation } from '@tanstack/react-router'

export function NotFoundPage() {
  const pathname = useLocation({ select: (location) => location.pathname })

  return (
    <main className="foundation-shell">
      <section
        className="foundation not-found"
        aria-labelledby="not-found-title"
      >
        <img
          alt="ctrorec"
          className="brand-logo"
          height="520"
          src="/brand/ctrorec-logo.svg"
          width="1690"
        />
        <p className="eyebrow">404 · Page not found</p>
        <h1 id="not-found-title">This address isn’t in the lecture archive.</h1>
        <p className="intro">
          Check the link for a typing error, or return to your courses. Nothing
          has been changed in your account.
        </p>
        <p className="not-found-address">
          <span>Requested address</span>
          <code data-testid="not-found-path">{pathname}</code>
        </p>
        <Link className="primary-button not-found-action" to="/">
          Return to ctrorec <span aria-hidden="true">→</span>
        </Link>
      </section>
    </main>
  )
}
