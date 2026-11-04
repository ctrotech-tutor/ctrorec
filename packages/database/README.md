# @ctrorec/database

Academic persistence, authentication-session storage, and original/derivative audio metadata for `ctrorec`. This package owns the Drizzle schema, PostgreSQL connection factory, reviewed migrations, development seed, and real-database integration tests. NestJS owns credential verification, session lifecycle rules, media bytes, and request authorization.

## Model

- **Institutions, users, memberships, membership roles:** users are global identities; a membership attaches one user to one institution. Roles are separate rows, so a membership can hold more than one role without duplicating identity. Users optionally carry an application-owned password hash and email-verification timestamp; there is no public registration flow. A nonnegative `credentials_version` snapshots password resets so stale sessions cannot survive a reset/sign-in race.
- **Authentication sessions:** `auth_sessions` stores hashed session identifiers, user ownership, creation/expiry/activity timestamps, optional MFA state, and request metadata. Password sessions carry the verified credential-version snapshot in metadata. The API, not the table alone, enforces absolute/idle expiration and snapshot freshness. Owner-scoped revocation and expired-row pruning are exercised against PostgreSQL.
- **Account recovery:** `account_recovery_requests` is deliberately global rather than tenant-owned. It stores normalized email, optional user association, optional unique SHA-256 token hash, 15-minute expiry, delivery/consumption/revocation state, and timestamps. Raw tokens and reset URLs are never persisted. The API transactionally enqueues only the request UUID; reset increments the credential version, deletes sessions, and closes other outstanding requests. See `docs/account-recovery.md`.
- **Institution invitations:** `institution_invitations` stores only a SHA-256 token hash with issuer, intended identity, expiry, revocation/replacement, and accepted-user/membership provenance. `institution_invitation_roles` preserves intended roles through a composite tenant foreign key. A partial unique index allows one open invitation per email and institution; acceptance and revocation never require deleting history. See `docs/invitations.md` at the repository root.
- **Academic units and terms:** institution-owned, flexible unit hierarchy and dated academic periods.
- **Courses and course offerings:** a course is the stable academic subject; an offering places it in a term and section.
- **Lecturer assignments and enrollments:** dated history. Ending an active row preserves it and permits a later active row. Partial unique indexes prevent duplicate active rows for the same person and offering.
- **Lectures:** course-offering-centred teaching metadata with draft/published/archived state and publication timestamps.
- **Original lecture audio:** `lecture_audio` has a one-to-one lecture key and immutable provider/key, original filename, media type, byte size, SHA-256, uploader, and creation metadata. Audio bytes are not stored in PostgreSQL. The current API permits one original and no replacement; transcripts and generated academic resources remain future linked records.
- **Resumable audio uploads:** `lecture_audio_uploads` links a session to its lecture, institution, creator, expected byte size, and client SHA-256. One active session per lecture is allowed. Offset and chunk bounds are checked in PostgreSQL; completed sessions require all bytes and a completion timestamp. Upload chunks remain filesystem objects, not PostgreSQL blobs.
- **Browser-capture provenance:** `lecture_audio_captures` optionally links one client capture UUID to its original and institution. It preserves the declared recorder MIME, consent-attestation time, capture timeline/duration, saved chunk count, persistence request result, stop reason, and client-measured hash/upload/retry handoff metrics. The three handoff metrics are either all present or all absent for pre-instrumentation rows. This is lecturer-supplied operational provenance, not proof of consent, network bytes, or recording quality. The original remains the media source of truth.
- **Audio derivatives:** `lecture_audio_derivatives` links one data-saver row to its original and institution, records the source SHA-256, attempts, processing state, and ready-object metadata. Pending/processing/failed rows cannot contain ready storage metadata; ready rows require provider, key, positive size, checksum, and completion time. Derivative failure does not alter the original.

## Integrity decisions

- PostgreSQL **18+ is required**. Primary keys use native, time-ordered `uuidv7()`; there is no UUIDv4 or application-generated fallback.
- All timestamps use `timestamptz`. Persist and exchange them in UTC.
- Tenant-owned relationships carry `institution_id` and use composite foreign keys. A course, membership, offering, unit parent, invitation issuer/role/accepted membership, lecture creator, audio lecture, audio uploader, upload session, or derivative original from another institution cannot satisfy the reference. Recovery requests intentionally omit `institution_id` because global credentials can span institutions; no tenant administrator can reset them.
- Academic foreign keys use `ON DELETE RESTRICT`, including original-audio, upload-session, and derivative metadata. Do not replace these with cascading deletion of lecture, audio, or enrollment history. Membership roles may cascade only with their owning membership. Authentication sessions cascade only when their owning user is deleted; this is credential cleanup, not academic-history deletion.
- `updated_at` is maintained by Drizzle's `$onUpdate` behavior. Application writes must use this package; administrative SQL must set `updated_at` explicitly. The initial migration deliberately does not pretend the ORM hook is a database trigger.
- Indexes target tenant/scoped lookups, foreign-key paths, current assignments/enrollments, and course lecture chronology. Add further indexes from measured query plans, not speculation.

These constraints provide **data integrity, not request authorization**. NestJS must still authenticate the actor and scope every protected query by institution, course, current role, and enrollment/assignment state. There is no platform-wide private-content bypass and no claim that row-level security is implemented.

## Local workflow

Use the root `.env` and PostgreSQL 18 service:

```sh
docker compose up -d --wait postgres
pnpm db:migrate
pnpm db:seed
```

The development seed is transactional and idempotent. It creates one fictional institution, two `.test` users with development-only scrypt credential hashes, memberships/roles, one active course offering, assignment/enrollment history, and one draft lecture. It refuses `NODE_ENV=production`, contains no real people or recordings, and never overwrites an existing password hash during its compatibility backfill. The known local passwords are documented only in the root README.

## Verification

The integration suite requires a separate database whose name ends in `_test`:

```sh
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ctrorec_test \
  pnpm test:integration
```

Global setup applies the reviewed migrations. Each test resets only that guarded test database. This package's suite checks UUIDv7 generation, invitation uniqueness and acceptance provenance, cross-tenant rejection, multiple lecturers, reassignment and enrollment history, publication/date checks, restrictive deletion, and seed idempotence.

The root `pnpm test:integration` command also runs `apps/api` session-store, real-HTTP authentication/recovery, and lecture-audio suites against the same guarded database. They cover cookie attributes, credential failures and version snapshots, membership responses, revocation and ownership, suspension, CSRF, throttling, session activity, pruning, generic recovery requests, single-use reset, stale-session denial, multipart and resumable upload, offset recovery, cancellation and checksum cleanup, atomic derivative queueing, publication despite derivative failure, storage verification, byte ranges, strong entity tags, conditional resume, size limits, ended enrollments, and cross-course/cross-institution denial. Production browser tests also start the real worker and a loopback SMTP catcher, play original and data-saver copies, and follow an actual captured recovery email. CI runs all of these suites on PostgreSQL 18.6.

## Changing the schema

1. Edit `src/schema/` using the installed Drizzle APIs.
2. Run `pnpm db:generate` and read the emitted SQL and snapshot.
3. Run `pnpm db:check`, apply the migration to a disposable PostgreSQL 18 database, and run integration tests.
4. Document new invariants and authorization assumptions.
5. Once a migration is shared, add a forward migration rather than rewriting applied history.
