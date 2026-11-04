# Lecture creation and resumable upload protocol

Status: implemented and tested locally through Phase 8A.2 on 2026-11-04. Resumable staging has scheduled reconciliation and a tested shared-local-filesystem instance-replacement path; original/derivative writes have durable lifecycle intents and worker reconciliation. This is not production shared-filesystem, abrupt-crash, backup/restore, or durable-object-storage certification; see `docs/upload-durability.md`.

## Lecturer workflow

A currently assigned lecturer for an active offering can:

- Create a draft lecture with a title, optional description, and teaching date/time.
- Correct draft or published lecture metadata. Publication state and the original recording are not edited through the metadata endpoint.
- Upload one original MP3, WAV, M4A, WebM, or Ogg recording and publish it. Audio-only MP4-family browser captures are also accepted after FFprobe inspection.
- Record a browser capture and hand its preserved original to this same resumable protocol; see `docs/lecture-capture.md`.
- Resume or cancel an incomplete upload. Original-audio replacement/versioning is not implemented.

Every request reloads application authentication and rechecks the current institution, membership, academic-staff role, offering assignment, and offering state. A student or lecturer from another course receives the same not-found response as for an absent resource. Archived offerings remain historical and are not writable through this workflow.

## HTTP contract

All routes are beneath `/api` and require the application session cookie and normal trusted-origin/CSRF checks for writes.

| Operation                           | Route                                                        |
| ----------------------------------- | ------------------------------------------------------------ |
| Create lecture                      | `POST /course-offerings/:offeringId/lectures`                |
| Read managed lecture                | `GET /lectures/:lectureId`                                   |
| Edit lecture metadata               | `PATCH /lectures/:lectureId`                                 |
| Create or recover same-file session | `POST /lectures/:lectureId/audio/uploads`                    |
| Discover active session             | `GET /lectures/:lectureId/audio/uploads/active`              |
| Cancel active session               | `DELETE /lectures/:lectureId/audio/uploads/active`           |
| Read session                        | `GET /lectures/:lectureId/audio/uploads/:uploadId`           |
| Append chunk                        | `PATCH /lectures/:lectureId/audio/uploads/:uploadId`         |
| Complete                            | `POST /lectures/:lectureId/audio/uploads/:uploadId/complete` |
| Cancel specific session             | `DELETE /lectures/:lectureId/audio/uploads/:uploadId`        |

Session creation accepts `fileName`, `byteSize`, and lowercase `sha256`. The browser computes SHA-256 incrementally with `@noble/hashes`; it does not load the entire recording into memory for hashing. Repeating creation for the same active file returns the existing session. A different active file produces `409` and must be resumed or cancelled explicitly.

Completion accepts an optional `capture` object for recordings created by ctrorec's browser capture. It contains a client capture UUID, recorder MIME, consent-attestation/capture timestamps, independently measured duration, committed chunk count, persistence-request result, stop reason, hashing/upload durations, and failed chunk-attempt count. The API validates its shape, basic timeline, UUID, measurement bounds, and agreement with the inspected media type. It does not expose this operational record in ordinary lecture responses. The fields are lecturer-client attestations, not cryptographic proof of consent, capture integrity, or network bytes. See `docs/field-pilot.md` for timing/retry semantics and the separate admin export.

Chunk requests use `Content-Type: application/offset+octet-stream` and an integer `Upload-Offset`. The response contains the new `receivedBytes`. The default chunk size is 4 MiB and default session lifetime is 24 hours; both are server configuration, not client choices. A stale offset produces `409`, after which the client reads the current session instead of appending guessed bytes.

Session responses contain identifiers, filenames, sizes, checksum, status, and expiry. They never contain filesystem paths, storage keys, provider URLs, or credentials.

## Completion and crash behavior

1. Each incoming chunk is written to a unique temporary file with a hard byte limit.
2. PostgreSQL locks the session row while the small chunk is staged and its offset is advanced. A second request cannot commit the same offset.
3. If a previous attempt left a part file without committing its offset, an identical retry reuses it; different content replaces that uncommitted orphan. A committed offset is never overwritten through the protocol.
4. Completion requires `receivedBytes == byteSize`, reads every expected part in order, and rejects missing or truncated parts.
5. The assembled file must match the declared SHA-256 and pass media inspection. WAV/M4A/MP3 use signatures; EBML/Ogg/MP4-family input also requires FFprobe to find audio and reject video. Inspection is not malware scanning or full stream decode validation.
6. The audio finalizer creates a unique `pending` original-write intent, saves and verifies the object, then commits intent attachment, original metadata, optional capture provenance, derivative state, pg-boss job, and session completion in one transaction.
7. Failure changes the intent to `deleting` before idempotent storage compensation. Lost provider responses and process-left pending/deleting states are retried through worker reconciliation; unique keys prevent one completion attempt from deleting another attempt's object.
8. Repeating completion is safe: a completed session returns the attached lecture only when its original checksum matches. Checksum/signature failures and conflicting completion cancel the incomplete session rather than leaving an unusable active upload.

Original publication and playback remain independent of the derivative worker. The older single-request multipart endpoint remains for compatibility and integration coverage; the current browser uses resumable sessions.

## Current limits and production gates

- **Shared staging requirement:** chunk parts live under `AUDIO_UPLOAD_TEMP_DIR`. Multiple API instances must mount the same POSIX-compatible shared filesystem with atomic rename and coherent metadata, backed by the same PostgreSQL database. Separate instance-local directories and sticky routing alone do not provide recovery. The Cloudinary object adapter does not distribute these upload sessions. The local two-instance test does not certify NFS/EFS or abrupt crash/failover behavior.
- **Reconciliation:** API startup and 15-minute scheduled runs expire rows in bounded `SKIP LOCKED` batches, retain active sessions, quarantine terminal paths after five minutes, and clean stale unknown/orphan paths after 24 hours. Worker media reconciliation processes stale pending/deleting intents after a 30-minute default grace with reference checks and idempotent deletion. See `docs/upload-durability.md` for exact decisions and limits.
- **Rate budget:** the 256 MiB default maximum requires at most 64 chunks at 4 MiB, plus hashing, status, completion, and other API requests. Review the default throttler and shared-NAT behavior before large real uploads; do not simply disable rate limiting.
- **Durability:** a completed original is only as durable as the selected `AudioStorage`. The local adapter is development/test-only.
- **Scope:** browser `MediaRecorder` capture and recoverable local drafts are implemented in Phase 7A. Background capture, an offline upload queue, original replacement, and offline playback are not implemented or claimed. Local draft recovery is best-effort and does not guarantee recovery after browser/OS termination; see `docs/lecture-capture.md`.
- **Provider lifecycle:** durable intents cover new original/derivative writes and backfilled database references. The reconciler does not list provider inventories, discover pre-ledger orphans, restore missing referenced media, or prove deletion from backups/CDN caches. Live provider behavior and intentional retention/deletion remain evidence gates.

## Executable evidence

- Real PostgreSQL/HTTP tests cover lecture creation/editing, same-file idempotent creation, cross-course denial, multi-chunk upload, stale offsets, session recovery, cancellation, checksum cleanup, repeated completion, and byte-identical playback.
- Filesystem unit tests cover orphan-chunk reconciliation, incomplete assembly cleanup, and atomic concurrent quarantine.
- Real PostgreSQL/HTTP tests replace the API instance between chunks and resume through a second instance sharing the database/staging root. Another test retains active data while reconciling expired, unknown, stale multipart, and interrupted-quarantine paths.
- Real PostgreSQL/filesystem media tests cover grace retention, orphan and partial-write deletion, referenced-object preservation, provider mismatch, delete retry, and a reconciliation race that rolls back the competing reference transaction. A disposable-database check verifies attached-intent backfill for pre-migration media rows.
- Production Chromium creates and edits a lecture, aborts a later chunk request once, recovers automatically, publishes, and decodes/seeks/plays original and data-saver audio through the real worker. The same journey uses real `MediaRecorder` with deterministic fake audio, pause/resume, local review, reload recovery, resumable WebM handoff, and a smaller worker-produced derivative.
- Real carrier interruptions, full-length recordings, low-storage phones, abrupt process/host crashes, production shared-filesystem behavior, and storage failover remain field/infrastructure tests.
