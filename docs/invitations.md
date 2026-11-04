# Institution invitations

Phase 6B implements invite-only onboarding for new and existing ctrorec accounts. It preserves application-owned authentication and institutional membership boundaries. There is still no public registration.

## Delivered workflow

1. An active institution administrator opens **Administration → Invitations**.
2. The administrator enters the person's email and display name, chooses one or more membership roles, and selects a lifetime of 3, 7, or 14 days. The API default is 7 days and the accepted range is 1–14 days.
3. ctrorec returns a single-use link once. The administrator copies it and sends it through an approved institutional channel.
4. The invitee opens `/accept-invite#token=…`. The browser removes the fragment from the address bar and sends the token only in same-origin JSON requests.
5. A new account chooses a password of at least 12 characters. An existing account confirms its current password.
6. Acceptance activates the institution membership but does not create a session. The person then signs in normally.

**Invitations still use manual delivery.** The copyable link is the delivery mechanism. Phase 6C's owner-recovery SMTP worker does not send invitations. Do not represent manual delivery as verified email delivery, and do not connect invitation email without a separate security, deliverability, and cost review.

## Authorization and membership rules

- Creating, listing, and revoking invitations requires a fresh active `institution_admin` membership in the active tenant. The browser tab is only a UX gate.
- Administrators can assign `student`, `academic_staff`, and `institution_admin` roles. Assigning an administrative role still does not grant lecturer or student audio access.
- Invitations are for people who do not already have a membership in that institution. They do not modify roles, reactivate a suspended membership, or merge duplicate memberships.
- An existing global account can join another institution. Its current password, display name, and existing memberships remain unchanged.
- A new global account is created only during valid acceptance and uses the normalized invitation email and invited display name.
- New accounts have `emailVerifiedAt = null`. Possession of a manually forwarded bearer link is not recorded as email verification.
- Suspended institutions, suspended users, consumed links, revoked or replaced links, expired links, and invitations without roles cannot be accepted.
- Acceptance does not sign the person in automatically and does not create a course assignment or enrollment. Roster administration remains separate.

Pending invitations are institution-issued capabilities, not sessions belonging to the issuer. The current implementation does not automatically revoke them if the issuer later loses administrative rights. Offboarding procedures must review and explicitly revoke outstanding links; issuer identity is retained in the invitation list.

## Token and transport controls

- Raw tokens contain 32 cryptographically random bytes, encoded with URL-safe Base64.
- PostgreSQL stores only a lowercase SHA-256 token hash. Token hashes are unique; list and inspection responses never return them.
- Only the creation response contains the raw token. It is not recoverable from the administration list after navigation or reload.
- The token travels in a URL fragment, not a query parameter, so it is not sent in the initial HTTP request or included in routine request-target logs. The acceptance page removes it with `history.replaceState` before inspection.
- Inspection and acceptance use JSON bodies and `Cache-Control: no-store`. Administration responses use `private, no-store`.
- Public inspection and acceptance are throttled. Acceptance also participates in the account-plus-IP throttler through the invited email.
- Passwords and tokens are not written to application logs, TanStack Query keys, or persistent browser storage.

A link is a bearer credential. Anyone who obtains a valid pending link can inspect its invited email and institution and attempt acceptance. Send it only through an approved channel, use the shortest practical lifetime, and revoke it when delivery or intent is uncertain.

## Lifecycle and concurrency

An invitation can appear as:

| Status     | Meaning                                                                          |
| ---------- | -------------------------------------------------------------------------------- |
| `pending`  | Open and before expiry                                                           |
| `accepted` | Consumed by one successful acceptance                                            |
| `expired`  | Still open in storage but past its valid lifetime                                |
| `revoked`  | Explicitly closed by an administrator                                            |
| `replaced` | Closed because a newer invitation was created for the same email and institution |

A partial unique index permits one open invitation per normalized email and institution. Creating a replacement marks earlier open rows `replaced`; expired rows can therefore be replaced without deleting history.

Acceptance runs in one PostgreSQL transaction:

1. Lock the invitation row and recheck its status, expiry, roles, and institution.
2. Take a transaction-scoped advisory lock for the normalized email, serializing invitation-based account creation across institutions. Lock an existing user row before credential verification so a password reset cannot race a stale rehash.
3. Verify the existing account's password or hash the new account's password with the same application-owned password hasher used by authentication.
4. Recheck membership uniqueness, then create the membership and all role rows.
5. Record acceptance time, accepted user, and accepted membership before committing.

A wrong password, short new password, duplicate membership, constraint failure, or competing acceptance rolls back the transaction. Concurrent acceptance of one token can succeed only once. Acceptance racing replacement has two valid outcomes: acceptance wins and replacement conflicts, or replacement wins and the old token fails. A member cannot be left with another open invitation from that race.

Revocation locks the same row, is idempotent for an already revoked invitation, and cannot rewrite an accepted invitation.

## Persistence

Migration `0005` adds:

- `institution_invitations`: normalized email, display name, issuer, institution, token hash, expiry, acceptance provenance, revocation reason, and timestamps.
- `institution_invitation_roles`: normalized role rows protected by a composite tenant foreign key.

Foreign keys use restrictive deletion for invitation provenance. Database checks require complete acceptance and revocation fields, valid hashes, normalized email, and expiry after creation. The API's administration list returns the latest 100 invitations; it does not yet provide pagination or retention purging.

Invitation email and display-name history is retained for provenance after acceptance. No automated retention/deletion policy is implemented in this slice; institutions need a reviewed retention schedule before production use.

## HTTP API

| Method | Route                                                                     | Access                    | Purpose                                                                                 |
| ------ | ------------------------------------------------------------------------- | ------------------------- | --------------------------------------------------------------------------------------- |
| `GET`  | `/api/institutions/:institutionId/admin/invitations`                      | Current institution admin | List latest invitations and lifecycle state                                             |
| `POST` | `/api/institutions/:institutionId/admin/invitations`                      | Current institution admin | Create and return a raw token once                                                      |
| `POST` | `/api/institutions/:institutionId/admin/invitations/:invitationId/revoke` | Current institution admin | Revoke an unaccepted invitation                                                         |
| `POST` | `/api/invitations/inspect`                                                | Public, throttled         | Inspect a valid token's institution, invited identity, roles, expiry, and account state |
| `POST` | `/api/invitations/accept`                                                 | Public, throttled         | Verify credentials or create an account, activate membership, and consume the token     |

The public routes do not accept an arbitrary email for registration. The account email and role set always come from the valid stored invitation.

## Verification

```sh
export TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/ctrorec_test'
pnpm test:integration
pnpm test:e2e
```

Coverage includes token-hash storage and response hygiene, role normalization, replacement, revocation, expiry, suspended institutions, existing-membership rejection, new-account acceptance, wrong existing passwords, identity preservation, single-use concurrency, accept-versus-replacement concurrency, and schema-level uniqueness/provenance checks.

The production browser journey uses a clean browser context to accept an invitation without an existing session, choose a password, sign in, verify membership and absence of admin/course privileges, and confirm that the administration history shows `accepted` without redisplaying the raw token.

## Separate work

Email verification, invitation email delivery, bulk invitation imports, membership-role editing, issuer-offboarding automation, invitation pagination, and retention jobs are not part of Phase 6B. Phase 6C subsequently implemented account recovery with separate token, session-revocation, throttling, and user-enumeration rules; see `account-recovery.md`. Invitation semantics and manual delivery remain unchanged.
