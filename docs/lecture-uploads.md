# Lecture creation and resumable upload protocol

Status: implemented and tested locally on 2026-11-01. This document describes the current single-instance staging design, not a multi-instance production certification.

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
6. The existing audio finalizer stores the original, then commits original metadata, optional capture provenance, derivative state, pg-boss job, and session completion in one transaction. Failure invokes the existing storage compensation path.
7. Repeating completion is safe: a completed session returns the attached lecture only when its original checksum matches. Checksum/signature failures and conflicting completion cancel the incomplete session rather than leaving an unusable active upload.

Original publication and playback remain independent of the derivative worker. The older single-request multipart endpoint remains for compatibility and integration coverage; the current browser uses resumable sessions.

## Current limits and production gates

- **Single-instance staging:** chunk parts live under `AUDIO_UPLOAD_TEMP_DIR`. Multiple API instances require shared transactional staging or strictly sticky routing plus a failure/recovery design. The Cloudinary object adapter does not distribute these local upload sessions.
- **Lazy expiry:** expired sessions are marked and cleaned when session activity occurs. There is no independent janitor for every abandoned directory yet. Add scheduled reconciliation before production rather than assuming expiry is a storage guarantee.
- **Rate budget:** the 256 MiB default maximum requires at most 64 chunks at 4 MiB, plus hashing, status, completion, and other API requests. Review the default throttler and shared-NAT behavior before large real uploads; do not simply disable rate limiting.
- **Durability:** a completed original is only as durable as the selected `AudioStorage`. The local adapter is development/test-only.
- **Scope:** browser `MediaRecorder` capture and recoverable local drafts are implemented in Phase 7A. Background capture, an offline upload queue, original replacement, and offline playback are not implemented or claimed. Local draft recovery is best-effort and does not guarantee recovery after browser/OS termination; see `docs/lecture-capture.md`.
- **Provider lifecycle:** lost provider responses and abandoned provider objects require reconciliation evidence. An upload API response alone does not prove every remote object or backup was deleted.

## Executable evidence

- Real PostgreSQL/HTTP tests cover lecture creation/editing, same-file idempotent creation, cross-course denial, multi-chunk upload, stale offsets, session recovery, cancellation, checksum cleanup, repeated completion, and byte-identical playback.
- Filesystem unit tests cover orphan-chunk reconciliation and incomplete assembly cleanup.
- Production Chromium creates and edits a lecture, aborts a later chunk request once, recovers automatically, publishes, and decodes/seeks/plays original and data-saver audio through the real worker. The same journey uses real `MediaRecorder` with deterministic fake audio, pause/resume, local review, reload recovery, resumable WebM handoff, and a smaller worker-produced derivative.
- Real carrier interruptions, full-length recordings, low-storage phones, process crashes, shared hosting, and multi-instance recovery remain field/infrastructure tests.
