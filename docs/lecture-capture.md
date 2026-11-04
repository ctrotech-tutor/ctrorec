# Lecturer browser capture

Status: Phase 7A implemented and tested locally on 2026-11-04. This is an active-foreground-tab capture workflow, not a background recorder, offline upload system, or physical-device certification.

## Lecturer flow

A currently assigned lecturer can open a draft lecture without an original and:

1. Attest that they have permission to record and will follow the institution's consent and retention rules.
2. Authorize microphone access in a secure browser context.
3. Record audio, pause/resume, and see independently measured active duration plus committed byte/segment counts.
4. Stop and review the original browser draft locally.
5. Upload the original through the existing authorized resumable protocol, or explicitly delete the local draft.

After a successful protected upload, the browser deletes its local draft and refreshes the lecture. The server original, optional capture-provenance row, derivative row, and pg-boss job commit in one PostgreSQL transaction. Publication and student access continue to use the existing Nest authorization boundary.

Only audio is requested. There is no camera, face capture, screen capture, custom hardware, or student upload path.

## Format and original preservation

The browser feature-detects WebM/Opus, MP4/AAC, and Ogg/Opus candidates instead of assuming one container works everywhere. It requests 48 kbit/s and a mono channel, but browser encoder settings are requests rather than guaranteed output. The actual recorder MIME and container extension are retained.

Committed `MediaRecorder` chunks are joined in sequence without transcoding. The resulting original is hashed incrementally and uploaded unchanged. The API uses FFprobe for EBML/Ogg/MP4-family input to require an audio stream and reject video; FFprobe inspection is not malware scanning or a full decode/quality certification.

The data-saver remains a separate derivative. Ordinary originals use the 48 kbit/s mono AAC/M4A candidate. Compressed WebM/Ogg and captures whose declared duration implies an original bitrate of at most 64 kbit/s use 32 kbit/s. The worker still rejects any derivative that is not smaller than its original. A missing or failed derivative never blocks original-audio publication or playback.

## Local draft model

IndexedDB contains two object stores in the current web origin and browser profile:

- `captures`: owner/lecture-scoped metadata, status, active duration, byte/chunk counts, consent attestation, stop reason, and persistence-request result.
- `chunks`: ordered Blob segments keyed by capture UUID and sequence, with recorder timecodes.

Each chunk and its updated metadata commit in one IndexedDB transaction. Assembly verifies sequence continuity, nonzero chunks, expected count, and total bytes before review or upload. `navigator.storage.persist()` is requested, but a grant is not guaranteed and does not make the draft institution storage.

An owner/lecture index prevents two draft records for the same lecture in one browser profile. It does not coordinate recording across tabs or devices. The recovery UI therefore tells the lecturer to recover only when no other tab is still recording that lecture.

Local drafts are not application-layer encrypted and are not governed by server retention/deletion jobs. Device disk encryption, browser profile controls, site-data deletion, shared-device policy, and institutional retention procedures remain operational responsibilities. Do not test with real student speech before approval.

## Recovery semantics

- A normal stop requests the final recorder segment, waits for queued IndexedDB writes, releases microphone tracks, and marks the draft `stopped`.
- Reloading after that stop finds the owner/lecture draft and reconstructs the local preview.
- If a draft remains `recording` or `paused` after the capture engine is gone, the UI labels it unfinished. **Recover saved chunks** marks it stopped with stop reason `interrupted`; it never claims to restore segments the browser did not deliver.
- Storage failure or exceeding the 256 MiB capture ceiling produces an incomplete draft that cannot be uploaded.
- `pagehide` makes a best-effort `requestData()` flush and `beforeunload` warns during active capture. Neither API guarantees that the last segment will arrive or that recording continues in the background.

Ordinary reload recovery is covered by production-build Chromium. Recovery across browser/OS termination, process crashes, private-mode eviction, storage pressure, screen lock, calls, and device restart is **not** guaranteed and requires explicit device evidence. There is no offline upload queue; connectivity is required for the protected handoff.

## Provenance and governance

The optional server record contains:

- a client-generated capture UUID;
- actual declared recorder MIME;
- consent-attestation, start, and stop timestamps;
- active duration measured independently of recorder chunk timing;
- committed chunk count and persistent-storage request result;
- `stopped`, `interrupted`, `track-ended`, `recorder-error`, or `size-limit` stop reason; and
- monotonic hashing/upload timing and failed chunk-attempt count measured during the protected handoff.

The API validates the UUID, timeline, supported media agreement, and field bounds. These are lecturer-client attestations and operational diagnostics, not cryptographic proof of consent, identity of speakers, actual elapsed teaching time, network bytes, or recording quality. Ordinary lecture JSON does not expose the record. Phase 7B adds a separately authorized institution-admin CSV export; it does not grant audio access or expose storage keys. See `docs/field-pilot.md` for exact timing semantics and correlation.

Recording consent does not authorize external-model training or unrelated secondary use. The institution remains responsible for its lawful basis, notice, retention, deletion, access, and breach procedures with qualified privacy/legal owners.

## Executable evidence

Current automated evidence includes:

- format selection and container mapping unit tests;
- real FFmpeg conversion of WebM, Ogg, and MP4-family audio fixtures;
- FFprobe rejection of video-bearing EBML/Ogg input;
- IndexedDB sequence, incomplete-draft, and preservation unit tests using a browser-compatible IndexedDB implementation;
- API validation of capture provenance and tenant-owned database constraints;
- a production-build Playwright journey using Chromium's real `MediaRecorder` with deterministic fake audio: explicit attestation, recording, pause/resume, local playback, reload recovery, resumable original upload with a forced recovered chunk failure, original playback, a smaller playable data-saver derivative, and a downloaded admin evidence row correlated by the visible capture UUID.

This is not evidence from a physical microphone, real hall, low-end phone, iOS Safari, Nigerian carrier, full-length lecture, or production storage. Follow `docs/media-evidence.md` for the consented field matrix and do not convert synthetic test success into a pilot outcome.

## Current operational limits

- Keep the tab active and upload soon; background capture is not guaranteed.
- One original per lecture; no capture replacement/versioning.
- Local IndexedDB and local API staging are not durable production backups.
- Local shared-staging instance replacement, abandoned-upload cleanup, ledger-based original/derivative write reconciliation, intentional deletion, and guarded backup/restore drills have executable coverage; see `docs/upload-durability.md`, `docs/media-retention.md`, and `docs/backup-restore.md`. Production shared-filesystem/failover behavior, abrupt infrastructure crashes, pre-ledger orphan discovery, durable object storage, live-provider deletion/recovery, off-site recovery, and deletion propagation into historical backups remain production gates.
- Full-length storage/battery behavior and real-network upload consumption remain field measurements.
- No transcript or generated resource is required for capture, recovery, upload, or playback.
