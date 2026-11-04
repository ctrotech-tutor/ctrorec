# Self-service account recovery

Phase 6C implements recovery for the **global account owner**, separately from institution invitations. It does not give institution administrators a password-reset capability: one global account can hold memberships in several institutions, so an administrator in one tenant must not change credentials used in another.

There is still no public registration. Recovery changes an existing active account's password only after a valid owner-email link is presented.

## Delivered workflow

1. The account owner opens `/recover` and enters an email address.
2. `POST /api/recovery/request` returns the same `202` response for known, unknown, and inactive addresses. It stores a normalized-email request and transactionally enqueues only its UUID.
3. The worker resolves the current active user, generates a fresh 32-byte random token, stores only its SHA-256 hash, and sends a plain-text email through configured SMTP.
4. The email contains `/reset-password#token=…`. The browser removes the fragment before token inspection; the token is then sent only in same-origin JSON bodies.
5. A valid link expires 15 minutes after the request and can be used once. The reset form requires a password of 12–128 characters and confirmation.
6. `POST /api/recovery/reset` consumes the link, changes the password, revokes existing sessions and other outstanding recovery requests, and returns without creating a session. The owner signs in with the new password.

Email verification, display name, memberships, roles, enrollments, and lecturer assignments do not change. Recovery neither verifies an unverified email nor proves an institution's approval.

## Request and token controls

- Request responses do not reveal account existence, user ID, request ID, institution, delivery state, or whether a message was sent.
- The public request route uses account-plus-IP and IP throttling. A PostgreSQL-backed per-email cooldown of 60 seconds and cap of five stored requests per rolling hour still apply across API restarts and replicas. Requests suppressed by that persistent limit receive the same generic response; edge throttling can return `429` equally for known and unknown addresses.
- PostgreSQL and pg-boss contain no raw recovery token or reset URL. The queue payload is exactly `{ "requestId": "…" }`.
- Raw tokens exist only in worker memory and the delivered email. PostgreSQL stores a unique lowercase SHA-256 hash, and only after the worker finds an active account.
- Inspection and reset responses use `Cache-Control: no-store`. Tokens are not put in TanStack Query keys or persistent browser storage.
- Inspection returns only `{ valid: true, expiresAt }`; it does not return the account email. Invalid, expired, consumed, replaced, revoked, suspended-account, and not-yet-delivered tokens receive the same `400` error.
- Password reset never emits a session cookie.

A recovery link remains a bearer credential until it expires or is consumed. Email account security, TLS, provider access control, and institutional device policy remain necessary.

## Worker delivery and retry semantics

The worker uses the `account-recovery-email` pg-boss queue with bounded retries, exponential delay, expiration, and heartbeat settings. Each attempt follows this sequence:

1. Lock the request and normalized-email namespace, recheck lifecycle and expiry, and resolve the active user by the request email.
2. Generate a new raw token and atomically replace any prior attempt's hash with the new hash in `delivering` state.
3. Send a plain-text message with Nodemailer. File and URL access are disabled in the transport.
4. Change `delivering` to `delivered` only after SMTP accepts the message, using a guarded update for the same request and token hash.

A failed handoff marks that attempt `failed`; a retry rotates both raw token and hash. Replacement, reset, revocation, or suspension can make the guarded transition fail rather than revive a link.

SMTP is at-least-once from the application's perspective. If a server accepts a message but the database acknowledgement fails, the retry sends a new token and the earlier token remains unusable. Users should open the latest email. Exactly-once email delivery is not claimed.

### Lifecycle states

| State        | Meaning                                                              |
| ------------ | -------------------------------------------------------------------- |
| `pending`    | Stored and queued; no user association or token hash yet             |
| `delivering` | An attempt hash is current, but SMTP has not been acknowledged       |
| `delivered`  | SMTP accepted the current token; expiry and single-use checks apply  |
| `failed`     | The latest delivery attempt failed; its token is not usable          |
| `discarded`  | No active account was found, or delivery was disabled; no email sent |
| `expired`    | The worker found an undelivered request past expiry                  |
| `consumed`   | The successful password reset used this request                      |
| `revoked`    | A replacement or successful reset closed this request                |

The API always checks `expiresAt` when inspecting or resetting, even if an old delivered row has not been transitioned to `expired`. There is no retention or cleanup job in this slice.

## Transactional reset and sign-in races

Reset performs these operations in one PostgreSQL transaction:

1. Resolve the token hash and lock the normalized recovery-email namespace.
2. Lock and recheck the recovery row, then lock the user row and require an active user whose current email still matches.
3. Consume only a `delivered`, unexpired, unconsumed, unrevoked row; the guarded update also checks the database clock.
4. Update the password hash and increment `users.credentials_version`.
5. Delete all existing sessions for that user.
6. Revoke every other outstanding request for the same normalized email, including pending requests that have no user association yet.

Concurrent use of one token can succeed only once. Replacement and reset serialize on the same email advisory lock.

Password sign-ins store their verified `credentials_version` snapshot in session metadata. Session authentication compares it with the current user on every request. Therefore, if an old-password verification races reset and inserts a session after the reset transaction's delete, that session still has the old snapshot and is rejected. Existing sessions from before migration `0007` have no snapshot and are treated as version zero, matching the additive default until the first reset.

A normal password rehash keeps the same credential version and does not sign anyone out, but its update must match the version originally verified. Existing-account invitation acceptance locks the user row before password verification so a stale rehash cannot overwrite a concurrent reset.

## SMTP configuration

| Variable                              | Default                 | Purpose                                                                   |
| ------------------------------------- | ----------------------- | ------------------------------------------------------------------------- |
| `RECOVERY_EMAIL_ENABLED`              | `false`                 | Explicitly enables worker delivery                                        |
| `RECOVERY_SMTP_URL`                   | none                    | Required when enabled; `smtp://` or `smtps://` URL, including credentials |
| `RECOVERY_EMAIL_FROM`                 | `no-reply@localhost`    | Message sender; configure an authorized production sender                 |
| `RECOVERY_WEB_ORIGIN`                 | `http://localhost:3000` | Public web origin used to construct the fragment reset link               |
| `RECOVERY_SMTP_CONNECTION_TIMEOUT_MS` | `10000`                 | SMTP connection timeout                                                   |
| `RECOVERY_SMTP_GREETING_TIMEOUT_MS`   | `10000`                 | SMTP greeting timeout                                                     |
| `RECOVERY_SMTP_SOCKET_TIMEOUT_MS`     | `30000`                 | SMTP socket timeout                                                       |
| `RECOVERY_SMTP_IGNORE_TLS`            | `false`                 | Test-only opportunistic-TLS override; do not disable TLS in production    |

`RECOVERY_WEB_ORIGIN` must be the actual public web origin and should agree with the API's `WEB_ORIGIN`. Keep SMTP credentials in the worker's secret store only. Never commit the URL or expose it through browser environment variables.

When delivery is disabled, the API still gives its generic response and persists/enqueues the request. The worker marks it `discarded` without generating token material or sending email, and logs only the request UUID. Self-service recovery is therefore unavailable in that configuration. Discarded requests are not automatically requeued after SMTP is enabled; the owner must submit a new request.

## HTTP API

| Method | Route                   | Access            | Result                                                             |
| ------ | ----------------------- | ----------------- | ------------------------------------------------------------------ |
| `POST` | `/api/recovery/request` | Public, throttled | `202`; generic acceptance, request ledger, transactional queue job |
| `POST` | `/api/recovery/inspect` | Public, throttled | `200` validity/expiry or generic `400`                             |
| `POST` | `/api/recovery/reset`   | Public, throttled | `200` password reset or generic `400`; no automatic session        |

The routes remain subject to the API's validation, Fetch Metadata/Origin, body-size, and security-boundary behavior. There is no institution-admin recovery endpoint.

## Persistence

- Migration `0006` adds `account_recovery_requests`: normalized email, optional current user association, optional unique token hash, lifecycle, expiry, delivery/consumption/revocation timestamps, and revocation reason. It deliberately has no institution ID.
- Migration `0007` adds nonnegative `users.credentials_version` with default zero for stale-session rejection.
- Request email history is retained in this slice; source IP and raw tokens are not persisted. A reviewed retention/deletion schedule is still required before production use.

Guarded test resets include the recovery ledger. Queue jobs are removed with the test pg-boss schema so test delivery cannot leak between fixtures.

## Verification and evidence boundary

```sh
export TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/ctrorec_test'
pnpm test:integration
pnpm test:e2e
```

Coverage includes generic known/unknown responses, normalized storage, ID-only queue payloads, persistent cooldowns, replacement, expiry, hash-only tokens, suspended accounts, concurrent single-use reset, preservation of account metadata, session and other-link revocation, stale sign-in snapshots, worker retry rotation, and disabled delivery.

The production Playwright journey starts a real local `smtp-server` catcher on loopback. The built worker connects through Nodemailer SMTP; the test decodes the captured MIME message and follows the actual emailed link through fragment scrubbing, confirmation, reset, old-session denial, reused-link denial, and new-password sign-in. This proves local SMTP handoff only.

No external mailbox, provider credentials, Internet deliverability, SPF/DKIM/DMARC alignment, bounce/complaint handling, provider outage behavior, or production email cost has been verified. Those remain deployment gates.

## Deliberate limitations

- Invitation delivery remains manual copyable-link delivery; recovery SMTP does not send invitations.
- There is no admin-assisted global reset, public registration, email-change flow, MFA flow, or additional verified-channel notification.
- The per-email persistent cap is shared through PostgreSQL; IP/account counters from Nest's current throttler remain process-local unless a shared throttler store is introduced.
- There is no automated recovery-ledger retention purge, dedicated administrative audit ledger, or user-facing delivery-status endpoint.
- External SMTP delivery and production email operations remain unclaimed until configured and verified separately.
