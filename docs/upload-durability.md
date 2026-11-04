# Upload staging and media lifecycle durability

Status: Phases 8A.1 and 8A.2 implemented and tested locally on 2026-11-04. These slices harden resumable-upload staging and add durable original/derivative write intents with reconciliation. They do not make the local audio adapter durable production storage or discover every legacy provider orphan. Phase 8B.1 separately adds a snapshot-consistent local backup/restore drill; Phase 8B.2 adds admin-held, intentional deletion on top of this intent ledger. See `docs/backup-restore.md` and `docs/media-retention.md`.

## Delivered boundary

The API now has an independent staging reconciler in addition to the existing lazy cleanup during upload activity. It:

- expires overdue active sessions in bounded PostgreSQL batches;
- uses short transactions and `FOR UPDATE SKIP LOCKED` so replicas do not expire the same rows;
- retains active, unexpired session directories regardless of age;
- removes terminal session directories after a five-minute grace period;
- removes unknown UUID-named session directories and legacy multipart temporary files only after a 24-hour orphan grace period;
- quarantines each eligible path with an atomic rename inside the staging root before recursive removal;
- cleans interrupted quarantine directories on a later run; and
- bounds in-flight filesystem work and prevents overlapping scheduled runs in one process.

Every API replica may run the reconciler. Concurrent cleanup is safe because terminal states do not return to active, unknown-directory creation follows the database row, and only one atomic rename can win. Cleanup does not hold a database transaction open while performing filesystem I/O.

## Configuration

| Variable                              | Default               | Meaning                                                                                           |
| ------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------- |
| `AUDIO_UPLOAD_TEMP_DIR`               | `../../.data/uploads` | Chunk/session staging root; see the shared-filesystem contract below                              |
| `AUDIO_UPLOAD_SESSION_TTL_MS`         | `86400000`            | Active session lifetime; 24 hours by default                                                      |
| `AUDIO_UPLOAD_RECONCILIATION_ENABLED` | `true`                | Enables startup and interval scheduling; manual service reconciliation remains available in tests |
| `AUDIO_UPLOAD_RECONCILE_INTERVAL_MS`  | `900000`              | Delay between scheduled runs; 15 minutes by default                                               |

Each scheduled run expires at most four batches of 250 sessions per replica. Remaining expired rows are handled by later runs. Filesystem operations use four workers. The five-minute terminal and 24-hour orphan grace periods are deliberate implementation constants, not retention policy for lecture media.

Disabling reconciliation does not disable upload expiry checks during session activity. Leave it enabled unless an equivalent, separately verified reconciler owns the same staging contract.

## Media object lifecycle

Phase 8A.2 adds the tenant-scoped `media_object_intents` table for original and data-saver writes. Every new write attempt allocates an opaque PostgreSQL UUIDv7 intent ID and uses that ID in its storage key. Derivative attempts no longer reuse a derivative-ID key or delete a previous attempt's key before saving.

The write sequence is:

1. Insert a `pending` intent containing institution, lecture, kind, storage provider/key, byte size, and SHA-256 **before** attempting that storage write.
2. Save and verify the object. A thrown save/verify response does not prove that the provider created nothing.
3. Insert/update the original or derivative reference and change its intent from `pending` to `attached` in the same PostgreSQL transaction. The attachment also checks the expected kind, provider, key, size, and checksum.
4. On failure, durably change the intent to `deleting` before attempting idempotent storage deletion, then mark it `deleted`. Cleanup failure leaves a reconcilable state rather than being forgotten.

| Intent state | Meaning                                                                             |
| ------------ | ----------------------------------------------------------------------------------- |
| `pending`    | A write is intended or may have completed; no committed media reference owns it yet |
| `attached`   | The matching original/ready-derivative reference and intent committed together      |
| `deleting`   | Deletion is authorized and safe to retry; normal attachment can no longer commit    |
| `deleted`    | Idempotent deletion completed; the ledger row remains as lifecycle evidence         |

The worker reconciles up to 100 stale `pending`/`deleting` intents per run with four concurrent workers. It atomically claims each candidate, checks both media-reference tables immediately before deletion, preserves and marks a referenced object `attached`, or deletes an unreferenced object and marks it `deleted`. Provider mismatches are logged and skipped. A failed delete remains `deleting` for a later idempotent retry.

Normal attachment only succeeds while an intent is `pending`. If normal attachment commits first, reconciliation no longer sees a candidate. If reconciliation claims first, the competing reference transaction fails and rolls back. The integration suite executes this race against real PostgreSQL; it does not merely assert a mocked call order.

For local storage, the final object and its deterministic `.upload` partial-write path share the intent key, and deletion removes both. Older random local temp names and provider objects with no intent are not discoverable by this ledger-only reconciler.

Migration `0010_reflective_kitty_pryde.sql` backfills `attached` intents for originals and ready derivatives already referenced in the database. It cannot reconstruct objects that were already orphaned before the ledger existed.

### Media reconciliation configuration

| Variable                       | Default   | Meaning                                                                    |
| ------------------------------ | --------- | -------------------------------------------------------------------------- |
| `MEDIA_RECONCILIATION_ENABLED` | `true`    | Enables worker startup and interval scheduling                             |
| `MEDIA_RECONCILE_INTERVAL_MS`  | `900000`  | Delay between scheduled runs; 15 minutes by default                        |
| `MEDIA_RECONCILE_GRACE_MS`     | `1800000` | Minimum age of a pending/deleting intent before reconciliation; 30 minutes |

Keep the grace period above the slowest expected storage write/verify/commit interval. Exceeding it can waste a valid write, but the state transition still prevents a committed reference to an object deleted by reconciliation. Multiple workers can reconcile the same provider because claims are atomic. A worker only deletes through its configured provider; resolve or explicitly migrate pending intents before changing providers.

This is lifecycle reconciliation, not a provider inventory scanner, backup, or deletion guarantee for CDN copies/backups. `deleted` ledger rows currently have no retention-cleanup job.

## Shared-staging contract for API replicas

The database was already the authority for upload status and confirmed offsets. Chunk append holds a row lock while staging the current part and advancing the offset. Unique incoming filenames prevent two requests from writing to the same temporary file.

Two or more API instances can resume one another's uploads **only** when all of the following are true:

1. They use the same PostgreSQL database and consistent schema.
2. `AUDIO_UPLOAD_TEMP_DIR` resolves to the same shared filesystem content on every instance.
3. The filesystem provides POSIX-compatible file operations, atomic rename within the staging root, and coherent reads/writes/metadata across instances.
4. The deployment keeps that filesystem available and applies its own backup, capacity, and failure-recovery procedures.

A local directory on each API host does **not** satisfy this contract. Sticky routing alone does not provide failover. The Cloudinary original-audio adapter does not distribute upload chunks and does not change this requirement.

The repository test starts one real Nest HTTP application, creates a session and appends its first chunk, closes that application, starts a second application against the same database and staging root, retrieves the confirmed offset, appends the remaining chunks, completes the original, and verifies byte-identical playback. This proves instance replacement on a local shared filesystem. It is not certification of NFS, EFS, another network filesystem, abrupt process termination, host power loss, or storage failover.

## Reconciliation decision table

| Staging/database state                                                    | Reconciler action                          | Reason                                                                                                          |
| ------------------------------------------------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| Active and not expired                                                    | Retain                                     | Age alone is not evidence of abandonment                                                                        |
| Active and expired                                                        | Mark expired in a bounded row-locked batch | Database status changes before terminal cleanup                                                                 |
| Completed, cancelled, or expired within five minutes                      | Retain for the grace period                | Avoid racing the final request and ordinary cleanup                                                             |
| Completed, cancelled, or expired beyond five minutes                      | Quarantine and remove                      | Terminal sessions cannot become active again                                                                    |
| UUID session directory with no database row, newer than 24 hours          | Retain                                     | Conservative protection against a recent or inconsistent view                                                   |
| UUID session directory with no database row, older than 24 hours          | Quarantine and remove                      | Reclaim abandoned staging                                                                                       |
| UUID-named legacy multipart file in the staging root, older than 24 hours | Quarantine and remove                      | Cover process termination outside resumable sessions                                                            |
| Non-UUID name, symlink, or unrecognized entry in the session/root scans   | Retain                                     | Automatic cleanup must not follow or invent ownership of unexpected paths outside the dedicated trash directory |
| Path under `trash`                                                        | Remove on a later run                      | A completed quarantine rename has already removed the live path                                                 |

A filesystem error is logged and left for a later run. Reconciliation does not delete a database row, alter a lecture, or authorize access to audio.

## Failure model and remaining gaps

| Failure                                                                            | Current result                                                                                                                                        |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Retry after a chunk file was written but its offset was not committed              | Existing logic reuses an identical orphan part or replaces a different uncommitted part                                                               |
| Two instances append the same expected offset                                      | The upload row lock permits one offset advance; the other request must retrieve current state                                                         |
| API instance is replaced between chunks                                            | Another instance resumes when the shared-staging contract is satisfied; covered by the local two-instance test                                        |
| Process stops after session activity but before ordinary directory cleanup         | Scheduled terminal/orphan reconciliation reclaims eligible paths                                                                                      |
| Process stops between quarantine rename and recursive removal                      | The live name is already gone; the next run removes the quarantined path                                                                              |
| Process stops after original-object save but before the audio database commit      | The stale pending intent is claimed after grace; an unreferenced object is deleted and marked deleted                                                 |
| Storage save succeeds remotely but its response is lost                            | Compensation requests durable deletion even though save threw; failure remains pending/deleting for reconciliation                                    |
| Storage delete succeeds remotely but its response is lost                          | The intent remains deleting and a later idempotent delete retries; absence is not inferred from an error                                              |
| Concurrent original/derivative completion attempts                                 | Unique attempt keys prevent cross-deletion; one reference can commit and losing intents are compensated/reconciled                                    |
| Reconciliation and reference completion race                                       | Atomic state transitions permit one outcome; a losing reference transaction rolls back                                                                |
| Reconciler finds a matching original/derivative reference                          | Preserve the object and repair the intent to attached                                                                                                 |
| Object has no intent because it predates Phase 8A.2 or was written outside the app | **Not discovered.** No storage-listing scanner is implemented                                                                                         |
| Database media reference exists but its object is missing/unreadable               | **Not automatically repaired.** Phase 8B.1 can restore a consistent bundle into a separate guarded target, not heal one object in place               |
| Shared filesystem becomes unavailable or loses acknowledged files                  | **Not solved by these slices.** Deployment/storage evidence and an approved production recovery plan are required                                     |
| Institution intentionally deletes retained lecture media                           | Phase 8B.2 transactionally revokes references and links known intents to retryable deletion; completion is separate and provider/backup limits remain |
| Lecturer replaces or versions an original after upload                             | **Not implemented.** Ordinary upload replacement remains rejected; intentional deletion is not a replacement/versioning workflow                      |

## Operations

Before using multiple API instances:

- Prove the shared-filesystem semantics with the intended infrastructure, including rename, visibility, disconnect, remount, and failure recovery.
- Give every API instance the same staging root and PostgreSQL database; do not mistake a shared original-audio bucket for shared upload staging.
- Monitor free space, expired-session counts, cleanup failures, and upload latency. The current implementation emits structured reconciliation log summaries but does not add a dedicated metrics or administrative audit system.
- Include staging directories in an explicit backup/deletion decision. Upload parts are not lecture originals and must not be treated as the only copy of a completed recording.
- Test abrupt process kill and host/storage failover in the actual deployment before claiming crash durability.

For media lifecycle operations:

- Give API and worker consistent provider configuration and, for local development, the same audio filesystem. Monitor stale `pending`/`deleting` intents, reconciliation failures, and provider-mismatch warnings.
- Treat an attached intent as referenced media, not cleanup candidates. Do not manually change it to `deleted` merely because a provider response was ambiguous.
- Preserve the intent ledger in database backups and define its retention separately from media retention. Deleting ledger evidence does not delete provider objects.
- Keep the grace period conservative and test provider deletion semantics with the actual credentials/provider before relying on cleanup.
- Use the Phase 8B.2 admin workflow for intentional deletion; do not manually delete reference rows or mark intents deleted without object evidence. See `docs/media-retention.md`.
- Do not claim automatic recovery of a missing referenced original. Reconciliation removes unreferenced writes; the separate Phase 8B.1 drill restores a complete bundle into an isolated target and does not heal a live object in place.

## Executable evidence

Phase 8A.1 adds:

- a filesystem unit test in which two concurrent quarantine attempts have exactly one winner and leave no live or trash payload;
- a real PostgreSQL/HTTP two-instance replacement and byte-identical completion test; and
- a real reconciliation test proving active-session retention, delayed terminal cleanup, expiry, old unknown-directory removal, old multipart-file removal, and interrupted-quarantine cleanup.

Phase 8A.2 adds:

- unit coverage proving derivative intent creation precedes storage save and a lost save response still follows durable compensation;
- local-storage coverage for non-overwriting saves and deletion of final plus partial-write paths;
- real PostgreSQL/filesystem tests for grace retention, orphan deletion, partial-write cleanup, referenced-object preservation, provider-mismatch skip, failed-delete retry, and the reconciliation-versus-reference-commit race;
- API integration assertions that a successful original and its attached intent agree on provider, key, size, and checksum; and
- a disposable-database migration check with one pre-migration original and one ready derivative, producing exactly two attached backfill intents.

The full repository gate remains required. These tests reconstruct failure states; they do not establish abrupt real-process/host crashes, real-carrier behavior, full-length phone uploads, shared-network-filesystem behavior, live provider deletion, durable production original storage, off-site/live-provider recovery, or production disaster recovery. The separate local backup/restore evidence and its limits are in `docs/backup-restore.md`.

## Next slices

1. Select and prove a production object-storage/delivery design, including ranges, revocation, measured cost, live deletion/backup/restore, and any needed legacy provider-inventory scanner.
2. Test the intended shared staging or replace it with an object-native multipart design if infrastructure evidence does not support the filesystem contract.
3. Run abrupt process/host/storage failure and isolated full-application recovery tests before real institutional recordings are accepted as durable.
