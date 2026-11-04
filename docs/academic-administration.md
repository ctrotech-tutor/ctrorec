# Academic administration

Phase 6A implements institution-scoped academic structure and roster administration on the existing PostgreSQL model. It adds API and web workflows, not a parallel ownership or authorization system. No schema migration was required.

## Implemented boundary

An administrator can manage:

- nested academic units such as faculties, schools, departments, or other unit kinds;
- dated academic terms with `planned`, `active`, `completed`, or `archived` status;
- courses owned by an academic unit;
- course offerings joining a course, term, and section;
- lecturer assignments and student enrollments for an offering; and
- the end of a lecturer's or student's current roster participation.

The TanStack Start application exposes these workflows in **Administration** only when the signed-in account has an active `institution_admin` membership in an active institution. This is a navigation convenience, not the security boundary. NestJS reloads the membership and role from PostgreSQL for every administration request.

Administration does **not** grant lecturer or student access. Creating, uploading, publishing, and playing lectures still require the appropriate current assignment or enrollment. An `institution_admin` role alone does not authorize private audio access, and there is no platform-super-admin bypass. The Phase 7B capture-evidence CSV is a separate operational-metadata capability with the same fresh admin check; it excludes audio URLs, storage keys, and student rosters. See `field-pilot.md`.

## Stored invariants

### Academic structure

- Every read and write is scoped by the institution in the route and the administrator's current membership.
- Unit and course codes are trimmed and normalized to uppercase. Codes are unique within their institutional scope.
- A unit parent, course unit, offering course, and offering term must belong to the same institution.
- Unit parent updates reject self-parenting and cycles.
- Terms require real calendar dates, and the end date cannot precede the start date.
- An offering is unique by course, term, and section.
- Updates preserve record identity. Archiving an offering changes its status; it does not delete lectures, audio metadata, assignments, or enrollments.

### Rosters and history

- New assignments and enrollments accept only existing, active memberships whose users are active and whose roles match the operation (`academic_staff` or `student`).
- New roster entries are accepted only for planned or active offerings.
- PostgreSQL prevents duplicate open assignments or enrollments for the same membership and offering.
- Ending participation sets `endsAt`; it does not delete the row. End timestamps must be after the participation start, and a second close returns a conflict.
- Course and lecture guards evaluate current participation on every protected request. Ending an enrollment therefore removes current student access immediately, while the roster record remains available to authorized administrators as history.
- Historical preservation is not continued private-content access. A closed assignment or enrollment no longer authorizes lecture writes or playback.

These records support academic history, but Phase 6A does not add a separate administrator audit-event ledger with actor, before/after values, and reason codes.

## HTTP API

All routes below require an authenticated session and a fresh active `institution_admin` membership for `:institutionId`. Unauthorized or cross-tenant resource lookups deliberately use not-found responses where appropriate to avoid exposing another institution's records.

| Method           | Route                                                         | Purpose                                                      |
| ---------------- | ------------------------------------------------------------- | ------------------------------------------------------------ |
| `GET`            | `/api/institutions/:institutionId/admin/academic`             | Read institution units, terms, courses, and offerings        |
| `GET`            | `/api/institutions/:institutionId/admin/memberships`          | List people eligible for roster administration               |
| `GET`            | `/api/institutions/:institutionId/admin/capture-evidence.csv` | Export bounded operational capture evidence; no audio access |
| `POST` / `PATCH` | `/admin/units[/:unitId]`                                      | Create or edit an academic unit                              |
| `POST` / `PATCH` | `/admin/terms[/:termId]`                                      | Create or edit an academic term                              |
| `POST` / `PATCH` | `/admin/courses[/:courseId]`                                  | Create or edit a course                                      |
| `POST` / `PATCH` | `/admin/offerings[/:offeringId]`                              | Create, edit, or archive an offering                         |
| `GET`            | `/admin/offerings/:offeringId/roster`                         | Read current and historical roster entries                   |
| `POST`           | `/admin/offerings/:offeringId/lecturers`                      | Assign active academic staff                                 |
| `POST`           | `/admin/offerings/:offeringId/students`                       | Enroll an active student                                     |
| `PATCH`          | `/admin/lecturer-assignments/:assignmentId`                   | Close an assignment with `endsAt`                            |
| `PATCH`          | `/admin/enrollments/:enrollmentId`                            | Close an enrollment with `endsAt`                            |

Routes shown with `/admin/...` in the table are relative to `/api/institutions/:institutionId`. JSON writes use the same-origin browser client and remain subject to the API's existing session, origin/CSRF, validation, and throttling controls. Administration reads return `Cache-Control: private, no-store`.

## Web workflow

1. Sign in with an institution-admin account.
2. Open **Administration**.
3. Create units and terms before creating dependent courses and offerings.
4. Open **Manage roster** on an offering to assign staff or enroll students.
5. Use **End access** to close current participation. Closed entries remain visible with their dates.

Forms are text-first and responsive for constrained devices. They do not require lecturer-authored notes, student uploads, or any media processing. The client validates response shapes and removes administration query data on both sign-in and sign-out so cached records cannot be reused across accounts.

The idempotent development seed gives `lecturer@ctrorec.test` both `academic_staff` and `institution_admin` roles so one fictional account can exercise both workflows. This is development fixture data, not a production role template.

## Verification

Use a separate guarded test database whose name ends in `_test`:

```sh
export TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/ctrorec_test'
pnpm test:integration
pnpm test:e2e
```

The API integration suite covers fresh administrator authorization, student denial, cross-tenant references, cyclic hierarchies, validation and uniqueness conflicts, roster role checks, duplicate open participation, immediate access revocation, preserved history, and offering archival without lecture deletion.

The production Playwright journey creates a unit, term, course, and offering; assigns a lecturer; enrolls a student; verifies student course visibility; ends the enrollment; and verifies that visibility is revoked. It runs against built API, worker, and web processes, not Vite development servers.

Run the complete gate before publishing changes:

```sh
pnpm check
pnpm db:check
pnpm test:integration
pnpm test:e2e
pnpm audit --prod
```

## Deliberate next slices

Phase 6A does not implement account recovery, public registration, bulk CSV/SIS imports, delegated custom roles, a dedicated audit-event ledger, or automated term rollover. Institution invitations and owner-email account recovery were subsequently implemented as separate account-lifecycle slices; see `invitations.md` and `account-recovery.md`. Neither gives an institution administrator a global password-reset capability.

Media provider adoption, production shared-staging/failover evidence, real-hall/device/network evidence, offline support, recording replacement/versioning, pre-ledger media discovery, live-provider deletion/recovery, production backup/failover, and production certification remain separate evidence gates. Local intentional deletion and backup/restore workflows are documented in `media-retention.md` and `backup-restore.md`; also see `media-evidence.md`, `media-storage.md`, and `lecture-uploads.md`.
