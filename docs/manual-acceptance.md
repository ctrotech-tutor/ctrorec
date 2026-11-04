# Manual acceptance checklist

Use this guide to verify the ctrorec foundation from your own machine. It covers the application through Phase 8B.1 and the custom browser 404 page. It is an acceptance aid, not a production-certification claim.

## 1. Record the test run

| Field                    | Value to record                                  |
| ------------------------ | ------------------------------------------------ |
| Commit                   | `git rev-parse HEAD`                             |
| Date and tester          | Your name and test date                          |
| Machine and OS           | For example, Windows 11 or macOS 15              |
| Browser                  | Include the exact browser and version            |
| Environment              | Local development or local production build      |
| Node / pnpm / PostgreSQL | Expected baseline: 26.13.0 / 12.16.1 / 18.6      |
| Result                   | Pass, fail, or blocked for each applicable check |

Priorities used below:

- **P0:** core journey; a failure blocks acceptance of the current foundation.
- **P1:** important lifecycle, administration, recovery, security, or responsive coverage.
- **Advanced:** requires an extra file, browser profile, SMTP catcher, or deliberate interruption.

Use fictional identities and non-private audio. Do not run these checks against real institutional data.

## 2. Prepare an isolated local environment

### Toolchain

1. Install Node.js **26.13.0**, pnpm **12.16.1**, PostgreSQL **18.6**, FFmpeg, and FFprobe. Docker Compose can provide PostgreSQL using the included `compose.yaml`.
2. From the repository root, verify:

   ```sh
   node --version
   pnpm --version
   ffmpeg -version
   ffprobe -version
   ```

3. Pull the reviewed branch without rewriting local history:

   ```sh
   git switch main
   git pull --ff-only origin main
   pnpm install --frozen-lockfile
   ```

### Configuration and database

1. Create the local environment file:

   ```sh
   cp .env.example .env
   ```

2. For ordinary local HTTP use, set `AUTH_COOKIE_SECURE=false` in `.env`. Keep `WEB_ORIGIN=http://localhost:3000` and use `localhost`, not a different loopback hostname, in the browser. Restore secure cookies for HTTPS deployments.
3. Start PostgreSQL. With Docker:

   ```sh
   docker compose up -d --wait postgres
   ```

   For an existing PostgreSQL installation, instead set `DATABASE_URL` and `TEST_DATABASE_URL` in `.env`. The test database name must end in `_test`.

4. Apply migrations and create the fictional development records:

   ```sh
   pnpm db:migrate
   pnpm db:seed
   ```

5. Start the web application, NestJS API, and worker together:

   ```sh
   pnpm dev
   ```

6. Open **http://localhost:3000**. Local API documentation is available at **http://localhost:3001/api/docs** when `API_DOCS_ENABLED=true`.

### Development accounts

| Access                       | Email                   | Password             |
| ---------------------------- | ----------------------- | -------------------- |
| Lecturer + institution admin | `lecturer@ctrorec.test` | `Lecturer-Dev-2026!` |
| Student                      | `student@ctrorec.test`  | `Student-Dev-2026!`  |

These are public development fixtures. Never reuse them for a real account. The lecturer's two roles are deliberate test-fixture convenience, not a production role template.

## 3. P0 smoke pass — approximately 20 minutes

Use a normal browser window for the lecturer and a private window or separate browser profile for the student.

- [ ] **S01 — Shell and same-origin API.** Open `/`. Expect the designed ctrorec logo, “Lecture access, built around the teaching,” and **API connected**. There should be no public registration link.
- [ ] **S02 — Custom not-found page.** Open `/missing/lecture-archive`. Expect the branded 404 page, the requested path, and **Return to ctrorec**. The link returns to `/`. In browser developer tools, the document response should be HTTP **404**, not a soft 200.
- [ ] **S03 — Invalid sign-in fails closed.** Submit an incorrect password once. Expect an error and no authenticated workspace. Do not repeatedly probe passwords; throttling is intentional.
- [ ] **S04 — Lecturer sign-in.** Sign in with the lecturer fixture. Expect **Development Lecturer**, **Asteria University**, and the Academic Staff membership. Sign out and confirm that the sign-in form returns.
- [ ] **S05 — Draft privacy.** As the lecturer, create a draft with a distinctive title. As the student in the second profile, confirm that the draft is not visible.
- [ ] **S06 — Original upload and publication.** As the lecturer, open the draft, choose **Upload audio**, and upload `apps/api/test/fixtures/lecture.wav` or another small valid audio file. Expect **Original recording**, then publish with **Publish to enrolled students**. As the student, reload and confirm that the published lecture appears and plays.
- [ ] **S07 — Playback quality.** Wait for the worker. If **Data saver** becomes available, select it, play, and seek. Confirm that the original remains selectable. A pending, failed, or unavailable derivative must not block original playback; very small or already-compressed sources may not produce a smaller derivative.
- [ ] **S08 — Student access is course-bound.** Confirm that the student cannot open **Administration** and cannot see lecturer draft/upload controls. Later, use **S13** to verify enrollment revocation.
- [ ] **S09 — Sign-out protects media.** While signed in, copy an original-audio URL from the player or download link. Sign out, then open that URL in a fresh private window. Expect an authorization error rather than playable audio.
- [ ] **S10 — Browser capture.** On a new lecturer draft, keep the default **Record lecture** source. Confirm that recording cannot start before the permission attestation. Attest, allow microphone access, record a few seconds, pause, resume, and choose **Stop and review**. Expect a local audio review and a visible **Evidence reference** UUID.
- [ ] **S11 — Protected capture handoff.** Upload the captured audio. Expect the original on the lecture and removal of the local draft after success. Publish it and verify student playback as in S06. Keep the tab foregrounded during capture.
- [ ] **S12 — Capture evidence correlation.** Copy the capture UUID before or during S10. As the institution administrator, open **Administration → Capture evidence**, download the CSV, and find exactly that UUID in `capture_reference`. Confirm the expected original metadata and any ready derivative outcome.
- [ ] **S13 — Immediate enrollment revocation.** In **Administration**, open the seeded offering's roster and use **End access** for the student with a valid end timestamp. Reload the student workspace: current course access should disappear. The closed enrollment should remain in administrator history. Re-enroll the student afterward if further student checks are needed.

If any P0 item fails, record the commit, exact action, visible result, browser-console error, and relevant API/worker log before continuing.

## 4. Full functional acceptance

### A. Academic structure, roles, and history

- [ ] **A01 — Create the academic hierarchy (P1).** As the lecturer/admin fixture, open **Administration**. Create a new academic unit, a dated term, a course in that unit, and an offering joining the course, term, and section. Expect each record to appear without a page reload and with normalized course/unit codes.
- [ ] **A02 — Assign and enroll (P1).** Open **Manage roster** on the new offering. Assign an active Academic Staff member and enroll an active Student. Expect current roster entries with start dates.
- [ ] **A03 — Course responsibility controls access (P0).** The assigned lecturer should see/manage the offering; the enrolled student should see published lectures only. An active account without the relevant assignment or enrollment should not receive that course's lectures.
- [ ] **A04 — Close access without deleting history (P1).** End the new assignment and enrollment. Expect closed roster records and immediate loss of current lecturer/student authorization. Historical preservation must not mean continued private-content access.
- [ ] **A05 — Archive an offering (P1).** Archive the test offering. Expect its academic history and lectures to remain, while new lecture writes and roster additions are refused. Do not treat archival as deletion.
- [ ] **A06 — Administration alone is not media access (P1, Advanced).** Invite a disposable account with only `institution_admin`, accept it, and sign in. Administration should be available, but that role alone should not reveal lecturer/student course workspaces or audio. Use separate accounts rather than the dual-role seed when testing this boundary.

### B. Institution invitations

- [ ] **B01 — Issue and copy once (P1).** In **Administration → Invitations**, invite a new disposable email with the Student role and a short practical lifetime. Expect a copyable link in the creation result. Reload: the raw link should not be recoverable from the invitation list.
- [ ] **B02 — Accept as a new account (P0).** Open the link in a clean private window. Expect the invited institution/email/roles, and expect the token fragment to disappear from the address bar. Choose a password of at least 12 characters. Acceptance should succeed without automatically signing the account in.
- [ ] **B03 — Sign in with the accepted account (P0).** Use the invited email and new password. Expect the invited membership only. There should be no course enrollment until an administrator separately adds one.
- [ ] **B04 — Single use (P1).** Reopen the consumed link. Expect a generic invalid/unavailable invitation state, not a second membership or account.
- [ ] **B05 — Revoke or replace (P1).** For another disposable invitation, revoke it before acceptance and confirm that its link fails. Separately, creating a replacement for the same open email should invalidate the earlier link. Use the newest link only.
- [ ] **B06 — Existing-account acceptance (Advanced).** This requires an existing account that is not already a member of the inviting institution. Confirm that acceptance requires its current password and preserves its display name, password, and existing memberships. If the one-institution seed cannot set this up cleanly, rely on the automated coverage rather than altering records directly.

Invitation links are manually delivered bearer credentials. No invitation email should be expected.

### C. Lecturer media workflows

- [ ] **C01 — Create and edit metadata (P0).** Create a draft with title, date/time, and description. Edit the details and save. Expect the same lecture entry with updated metadata, not a duplicate.
- [ ] **C02 — Reject a non-audio upload (P1).** Attempt to upload a renamed text or other invalid file. Expect rejection and no playable original. Container/signature inspection is not malware scanning.
- [ ] **C03 — Resume an interrupted upload (P1, Advanced).** Use a valid file larger than the configured 4 MiB chunk size—preferably over 8 MiB—and browser network throttling. Start upload, switch the browser offline after at least one chunk, and let the visible upload fail. Restore connectivity and submit the **same unchanged file** again. Expect the active session to resume from its confirmed offset and finish with one original. Do not choose **Clear interrupted upload** unless intentionally abandoning it.
- [ ] **C04 — Reject a different active file (P1).** While an upload is incomplete, try a different file for the same lecture. Expect a conflict explaining that the active file must be resumed or cleared. This prevents accidental mixing of upload sessions.
- [ ] **C05 — Original playback and download (P0).** Publish and verify play, pause, seek, and download for an enrolled student. Repeat after reload. Audio should load when requested rather than being presented as offline-available content.
- [ ] **C06 — Data-saver derivative (P1).** When ready, confirm that the derivative plays and seeks, is smaller than the original, and leaves the original available. A failed or non-saving derivative is an explicit unavailable state, not a reason to lose the original.
- [ ] **C07 — One original, no replacement (P1).** After successful upload, confirm that the ordinary upload/capture intake is gone. Original replacement/versioning is not implemented; this is a known boundary, not a failed test.

Browser offline/throttling simulation is reproducible software evidence, not proof of Nigerian-carrier behavior or multi-instance crash recovery.

### D. Browser recording and local drafts

Use scripted, consented speech only. Keep the tab active and do not clear site data during recovery checks.

- [ ] **D01 — Permission handling (P1).** Deny microphone permission once. Expect a visible error, no active recorder, and no server original. Re-enable permission before continuing.
- [ ] **D02 — Active capture measurements (P0).** During recording, expect active duration plus committed byte/segment counts. Pause should stop active-duration growth; resume should continue it. The displayed duration is measured independently of recorder chunk timing.
- [ ] **D03 — Stopped-draft reload recovery (P1).** Stop and review a capture, but reload before uploading. Expect the local draft and playable review to return from IndexedDB. Upload it and confirm that successful handoff removes the local copy.
- [ ] **D04 — Interrupted-draft recovery (Advanced).** Reload during an active recording after several segments have been saved. If an **Unfinished local draft** appears, choose **Recover saved chunks** only when no other tab is still recording that lecture. Expect a loss-aware recovered draft containing saved chunks only; do not expect missing or undelivered audio to return.
- [ ] **D05 — Explicit local deletion (P1).** For a disposable local draft, choose **Delete local draft** and confirm that it disappears. Server retention/deletion is a separate operational matter.
- [ ] **D06 — Original container preservation (P1).** After upload, the original remains the browser-produced WebM/Ogg/MP4-family audio rather than being silently replaced by the AAC data-saver. Confirm that both copies, when available, play independently.

No background-recording, offline-upload, or guaranteed browser/OS-termination recovery result should be inferred from these checks.

### E. Account recovery

The default `.env` has `RECOVERY_EMAIL_ENABLED=false`. In that mode, **a generic request response with no email is correct**, and self-service password reset is unavailable. Enabling delivery later does not revive discarded requests; submit a new request after enabling it.

- [ ] **E01 — Generic disabled-mode response (P1).** On `/recover`, submit a known address once and an unknown address once. Expect the same generic acceptance message and no account-existence disclosure. Do not wait for email while delivery is disabled.
- [ ] **E02 — Optional local SMTP setup (Advanced).** To exercise the full flow manually, stop `pnpm dev`, set the following in `.env`, and restart:

  ```dotenv
  RECOVERY_EMAIL_ENABLED=true
  RECOVERY_SMTP_URL=smtp://127.0.0.1:2525
  RECOVERY_EMAIL_FROM=no-reply@ctrorec.test
  RECOVERY_WEB_ORIGIN=http://localhost:3000
  RECOVERY_SMTP_IGNORE_TLS=true
  ```

  In a separate terminal, run the test-only catcher:

  ```sh
  node apps/web/tests/smtp-catcher.mjs
  ```

  Its captured messages are available at `http://127.0.0.1:2526/messages`. `RECOVERY_SMTP_IGNORE_TLS=true` is only for this loopback catcher, never production.

- [ ] **E03 — Reset a disposable account (P1, Advanced).** Use the account created through B01/B02, not a seed account. Request recovery, retrieve the latest captured message, and open its `/reset-password#token=…` link. Expect fragment removal and no account-email disclosure during inspection. Set and confirm a new 12–128-character password.
- [ ] **E04 — Reset side effects (P0, Advanced).** Expect no automatic sign-in. The old password should fail; the new password should succeed. Existing sessions should be invalid after reload, while memberships, roles, enrollments, assignments, display name, and email-verification state remain unchanged.
- [ ] **E05 — Link single use and replacement (P1, Advanced).** Reusing the consumed link should fail generically. If a newer recovery request replaces an older one, only the latest valid link should work. Links expire after 15 minutes; use automated coverage rather than waiting solely for a manual expiry check.

Local SMTP proves loopback handoff only. It does not establish external mailbox delivery, SPF/DKIM/DMARC, bounce handling, or production email cost.

### F. Capture evidence and operational boundaries

- [ ] **F01 — UUID correlation (P0).** Match the visible browser-capture UUID to one exported CSV row. Do not correlate by approximate time or lecture title.
- [ ] **F02 — Date filters (P1).** Export with UTC `from` and inclusive `to` dates containing the capture. Expect the row; use a range excluding it and expect its absence. Narrow the range if the 5,000-row bound is reached.
- [ ] **F03 — Field meanings (P1).** Check recorder MIME, consent/start/stop timestamps, active duration, chunk count, stop reason, hashing/upload timings, retry count, original SHA-256/size, and derivative status/size/timing where available. Blank handoff fields are valid for older captures; client timings are attestations, not trusted server measurements.
- [ ] **F04 — Export minimization (P1).** Confirm that the CSV contains no student roster, lecturer email, storage key, signed media URL, or audio content. Treat lecture/course metadata as institution-confidential.
- [ ] **F05 — Evidence limits (P1).** Do not expect automatic student-playback analytics, radio bytes, device fingerprints, battery use, listening quality, or monetary cost in this CSV. Record those separately using `docs/field-pilot.md` and `docs/media-evidence.md`.

### G. Responsive and accessible use

- [ ] **G01 — Narrow viewport (P1).** At approximately 360 × 800 CSS pixels, exercise sign-in, lecture creation, upload/capture, playback, administration, invitations, recovery, and the 404 page. Expect no horizontal page overflow, clipped controls, or unreadable requested paths.
- [ ] **G02 — Keyboard path (P1).** Navigate the core forms and audio controls by keyboard. Expect visible focus, associated labels, usable buttons, and no keyboard trap.
- [ ] **G03 — Errors and status (P1).** Confirm that validation errors, upload progress, recording state, and session state are visible without relying on color alone.
- [ ] **G04 — Real-device boundary.** Browser device emulation checks layout only. It is not evidence for a physical microphone, low-end Android performance, iOS Safari, screen lock, calls, storage pressure, or battery behavior.

### H. Retention holds and intentional deletion

Use only a disposable synthetic lecture with an uploaded original and, ideally, a ready data-saver derivative. Never use the only copy of real teaching. For a timely local run, set `MEDIA_RECONCILE_INTERVAL_MS=10000` before starting the worker; the production-style default is 15 minutes.

- [ ] **H01 — Place and release a hold (P1).** In **Administration → Course offerings → Media retention**, open the test offering. Place a hold with a reason. Expect **Retention hold active** and no deletion form until the hold is released with another reason. Ordinary playback should continue while the hold is active.
- [ ] **H02 — Require deliberate confirmation (P0).** After release, open **Delete original and derivatives**. Enter a specific reason. The destructive button must remain disabled until the confirmation is exactly `DELETE MEDIA`.
- [ ] **H03 — Separate revocation from object completion (P0).** Submit deletion. Expect course access to be revoked immediately and **Deletion in progress** until reconciliation finishes. Do not treat the request response alone as proof that physical objects are gone. After the worker runs, expect **Media deleted** and a completion timestamp.
- [ ] **H04 — Preserve academic history without media controls (P0).** In lecturer and student course views, expect the lecture record and deleted-media state, but no original/data-saver player, download, recorder, upload picker, or publish action. An ordinary replacement upload must not revive the lecture.
- [ ] **H05 — Preserve evidence (P1).** The admin retention view should retain the deletion reason, requester workflow timestamps, and original metadata snapshot. Export capture evidence for a deleted browser capture: capture/lecture fields and deletion timestamps remain, while original/derivative fields from the removed media rows are blank.
- [ ] **H06 — Repeat safely (P1).** Repeat the same deletion request only through the automated API test or a controlled request, not by altering the database. Expect the original deletion ID and `created: false`, with no duplicate request. Live-provider, CDN, backup, and external-export erasure are not part of this manual pass.

See `docs/media-retention.md` for the exact state machine and `docs/backup-restore.md` before restoring any snapshot that predates a deletion.

## 5. Run the executable gates yourself

Stop `pnpm dev` first so ports 3000, 3001, 2525, and 2526 are free. Install Chromium if needed:

```sh
pnpm --filter @ctrorec/web exec playwright install chromium
```

Then run:

```sh
pnpm check
pnpm db:check
pnpm test:integration
pnpm test:e2e
pnpm audit --prod
```

Expected scope at the time of this guide:

| Gate            | What it proves                                                                 |
| --------------- | ------------------------------------------------------------------------------ |
| `pnpm check`    | Formatting, lint, typechecks, 57 unit tests, and production builds             |
| `pnpm db:check` | Migration/schema consistency                                                   |
| Integration     | 69 real PostgreSQL/HTTP/filesystem tests across persistence, auth, and media   |
| Browser         | 9 production-build Chromium journeys, including deletion, capture, and SMTP    |
| Audit           | Dependency advisories for the current lockfile; review any future new findings |

The 69 integration checks comprise 17 database, 41 API, and 11 worker tests. Seven worker media-lifecycle tests use real PostgreSQL and local files to cover grace retention, orphan/partial-write deletion, referenced-object preservation, provider mismatch, delete retry, a reconciliation-versus-reference-commit race, derivative-ready versus intentional-deletion conflict, and intentional original/derivative deletion with failed-delete retry and race-safe exact completion. Two retention HTTP tests cover fresh-admin/tenant boundaries, holds, access revocation, anti-resurrection, and capture CSV preservation. Four backup/restore tests additionally execute real PostgreSQL 18 tools to cover snapshot-consistent concurrent writes, exact original/derivative restoration, corruption refusal, transient-state exclusions, non-empty targets, and interrupted backup publication. They reconstruct failure states; they are not abrupt process-kill, off-site recovery, or production-provider certification. See `docs/backup-restore.md` before running a manual drill.

The integration and browser suites reset only the guarded `TEST_DATABASE_URL` database and its test queue schema. They do not reset `DATABASE_URL`. Browser tests build and start production API, worker, and web processes and use a real loopback SMTP catcher. They do not use Vite development servers.

A green run is stronger than a manual screenshot for concurrency, tenant denial, single-use-token races, byte-range behavior, credential-version races, and recovery worker retry rotation. Keep the manual pass for usability and visible workflow acceptance.

## 6. What must remain open

Do not mark these as passed from local acceptance alone:

- Physical lecture-hall intelligibility, real microphones, full-length lectures, or real student listening outcomes.
- Nigerian-carrier performance, data consumption, low-end phones, iOS Safari, battery, storage pressure, calls, screen lock, or background capture.
- Guaranteed recovery after browser/OS termination; IndexedDB is best-effort and local drafts are not institution backups.
- Durable production object storage, production shared-filesystem/failover behavior, abrupt process/host-crash recovery, pre-ledger provider-orphan discovery, automatic in-place missing-original repair, live-provider/CDN/backup deletion, off-site/live-provider recovery, or production disaster recovery. Local two-instance staging replacement, scheduled upload cleanup, and ledger-based write reconciliation are covered in `docs/upload-durability.md`; intentional local deletion is covered in `docs/media-retention.md`; the guarded local bundle/drill and its production gaps are covered in `docs/backup-restore.md`.
- Live Cloudinary authorization/range/lifecycle/cost evidence; the provider remains optional and unadopted.
- External SMTP deliverability and production email operations; invitation delivery remains manual.
- Offline playback, an offline upload queue, original replacement/versioning, transcripts, or generated learning resources.
- Bulk imports, membership-role editing, automated issuer offboarding, invitation pagination/retention jobs, and a dedicated administrative audit ledger.
- Legal/privacy approval, institutional retention/deletion procedures, or production security certification.

## 7. Sign-off

Record one of **Pass**, **Fail**, **Blocked**, or **Not applicable** for every item. A release recommendation should include:

1. Commit hash and environment.
2. P0 result and unresolved P1 failures.
3. Automated gate totals and any failures.
4. Browser/device coverage actually used.
5. Issues with exact reproduction steps, expected/actual results, and logs without passwords, tokens, cookies, or private lecture content.
6. A separate list of open production and field-evidence gates from section 6.

For the consented physical pilot, continue with `docs/field-pilot.md`, the blank `docs/templates/field-session-sheet.csv`, and the neutral `docs/templates/pilot-script-v1.txt`; do not turn this local checklist into a claim that the field pilot has already run.
