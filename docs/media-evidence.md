# Media and field evidence plan

Assessment date: 2026-11-01. This document separates executable engineering checks from evidence that requires real people, devices, halls, networks, and provider accounts.

## What is verified in the repository

- An uploaded original, its pending data-saver row, and its pg-boss job commit in one PostgreSQL transaction. The job ID is the derivative's UUIDv7.
- The worker, not an HTTP request, downloads and re-hashes the original before processing it.
- FFmpeg produces a mono AAC/M4A derivative, removes metadata and non-audio streams, and moves the MP4 index to the beginning for progressive playback. Ordinary originals use 48 kbit/s; compressed WebM/Ogg and captures at or below 64 kbit/s use 32 kbit/s to avoid a routine larger-than-original result.
- A derivative is exposed only after its staged object is stored and verified. If it is not smaller than the original, it is marked failed rather than presented as a saving.
- Retry claims carry a processing-attempt token. A late attempt cannot mark a newer attempt ready/failed or issue its compensating object delete; an already completed job is not reprocessed.
- Pending, processing, or failed processing does not prevent original publication or playback.
- Original and ready derivative delivery use fresh Nest authorization, single byte ranges, strong SHA-256 entity tags, and `If-Range` handling. A mismatched validator returns the complete current representation instead of splicing two objects.
- Production Chromium tests create/edit a lecture, abort a later upload chunk, recover the session, publish, wait for the real worker, and decode/seek/play both copies. They also use real `MediaRecorder` with deterministic fake audio, pause/resume, IndexedDB-backed local review, reload recovery, and resumable original WebM handoff.

These tests use short synthetic PCM input and a browser fake-audio device. They do **not** establish physical-microphone or lecture-hall intelligibility, long-file reliability, iOS Safari compatibility, low-end Android performance, Nigerian network behavior, durable storage, background capture, browser/OS termination recovery, or production unit economics.

## Field pilot questions

Phase 7B provides the visible capture reference, client handoff metrics, tenant-admin CSV export, blank field sheet, and step-by-step runbook in `docs/field-pilot.md`. Use that correlation process rather than matching sessions by approximate time or title.

1. Can a lecturer capture understandable speech from normal teaching positions without changing how they teach?
2. Can an enrolled student understand the original and data-saver copy on the phone and listening environment they actually use?
3. How much data do complete plays, partial plays, seeks, retries, and failed uploads consume?
4. What happens during screen locking, interruptions, weak connectivity, low storage, and a full-length lecture?
5. Can the institution explain and govern recording, access, retention, deletion, and cross-border processing?

Do not start with real student recordings. Begin with scripted, consented speech in the actual hall. Move to a real lecture only after the institution has approved the purpose, notice, lawful basis, access, retention, and deletion process.

## Capture matrix

Record the same consented script before comparing files. Include a full-length session after the short matrix passes.

| Variable        | Required coverage                                                                                                     |
| --------------- | --------------------------------------------------------------------------------------------------------------------- |
| Capture device  | The intended low/mid-range Android phone; one current iPhone if supported; the lecturer's actual phone                |
| Position        | Lecturer's podium or normal standing position; front, middle, and back of the hall                                    |
| Teaching action | Stationary speech; walking; turning to the board; reading; question-and-answer exchange                               |
| Hall condition  | Empty; occupied; fans or generators running; corridor or outdoor noise typical of the venue                           |
| Duration        | Five-minute scripted checks, then at least one complete representative lecture                                        |
| Device pressure | Normal battery; low battery; low free storage; incoming call; screen lock; app/background transition where applicable |

For every file, record a session ID, device/model, OS/browser or recorder version, microphone, position, hall condition, duration, capture app, and observed interruptions. Do not put student names or private lecture content in the measurement sheet.

Browser `MediaRecorder` is implemented for an active foreground tab with explicit permission/consent and recoverable local drafts. Physical-device capture testing must still distinguish actual product behavior from synthetic Chromium evidence. Do not infer background recording, offline upload, or guaranteed recovery after browser/OS termination. See `docs/lecture-capture.md`.

## Technical inspection

Keep the original untouched. Run inspection on copies with no personal metadata in filenames or command logs.

```sh
ffprobe -v error \
  -show_entries stream=codec_name,codec_type,sample_rate,channels,bit_rate:format=duration,size,bit_rate \
  -of json original.m4a

ffmpeg -hide_banner -nostats -i original.m4a \
  -filter_complex ebur128=peak=true -f null -

ffmpeg -hide_banner -nostats -i original.m4a \
  -af astats=metadata=1:reset=0 -f null -
```

Capture decode failures, duration, actual bit rate, channel count, long silence, clipping, and loudness statistics. These are diagnostic signals, not a pass mark for teaching quality. A technically clean file can still contain unintelligible distant speech.

Verify that the derivative is smaller, starts without waiting for the entire object, seeks correctly, and contains no copied metadata. The current implementation checks size, checksum, container signature, browser decode, and ranges; long-form and metadata inspections remain field/provider checks.

## Listening protocol

Use listeners who did not write the script. Include students familiar with the course's accent and terminology.

1. Prepare neutral scripted sentences plus course-specific terms with no private information.
2. Present original and derivative samples in randomized order. Do not label the codec or bit rate during scoring.
3. Test the intended phone speaker and a typical earpiece, at a realistic volume.
4. Ask listeners to write what they hear, mark words or terms they missed, and rate listening effort from 1 (effortless) to 5 (could not follow).
5. Record dropouts separately from misunderstanding caused by the room or speaker.
6. Repeat with the intended lecturer's full-session recording after consent and governance are approved.

The pilot owner must set acceptance thresholds before seeing preference results. Record word/term accuracy, listening effort, dropouts, device, position, and listener count. Do not replace this with an automatic loudness score or an AI transcript score; speech recognition can hide errors that a student would notice.

## Connectivity and interruption protocol

Use real carriers and devices where possible. Browser throttling is useful for reproducibility but is not evidence of radio conditions.

| Scenario                             | Measurement                                                                      |
| ------------------------------------ | -------------------------------------------------------------------------------- |
| Slow, stable connection              | Time to first audio, startup data, rebuffer count, total bytes                   |
| Latency and jitter                   | Seek delay, playback stalls, failed requests                                     |
| Brief disconnection during playback  | Recovery behavior and repeated bytes                                             |
| Disconnection during download        | Resume status, validator behavior, final SHA-256                                 |
| Disconnection during lecturer upload | Error state, temporary-file cleanup, data consumed on retry                      |
| Repeated short seeks                 | Delivered bytes versus full-file size                                            |
| Screen lock/background               | Whether capture continues, pauses, ends, or loses audio; no continuity guarantee |

Current lecturer upload uses authorized sessions, fixed chunks, client SHA-256, and offset recovery. Local HTTP and production Chromium tests prove recovery from a deliberately aborted later chunk on one API instance; they do not prove real-carrier recovery, full-length phone uploads, process-crash recovery, or multi-instance staging. See `docs/lecture-uploads.md`.

Current range/ETag support provides the server protocol needed for safe resumed downloads; it does not prove that every browser or download manager will resume on a real network. Offline playback and an offline upload queue are not implemented or claimed.

For a resumed download, save the strong entity tag and partial byte count. Send `Range: bytes=<next-byte>-` and `If-Range: "<etag>"`. Accept `206` only with the expected `Content-Range`; if the response is `200`, restart from byte zero rather than appending. Verify the final file against its expected SHA-256.

## Measure unit economics

Use decimal units consistently and measure actual files rather than assuming encoder settings equal delivered bit rate.

```text
approximate media bytes per hour = bit rate (bit/s) × 3600 ÷ 8
32 kbit/s before container overhead ≈ 14.4 MB/hour
48 kbit/s before container overhead ≈ 21.6 MB/hour
128 kbit/s before container overhead ≈ 57.6 MB/hour

monthly media pressure = retained original GB
                       + retained derivative GB
                       + delivered original/derivative GB
                       + failed and restarted transfer GB
                       + provider processing/transformation charges
```

Track lecture duration, original/derivative sizes, ready/failed processing, plays, completion, seeks, rebuffering, upload retries, and repeat views. Separate media bytes from API/HTML traffic. Include provider plan features, token/CNAME requirements, taxes, backup, deletion, support, and overage terms before purchase.

## Provider evidence gate

Cloudinary remains a candidate, not an adopted provider. An opt-in adapter and isolated synthetic live-evidence runner exist, but no real-account result has been recorded. A production spike must use synthetic or explicitly consented audio and prove:

1. `resource_type=video` for audio and `type=authenticated` for originals and derivatives.
2. Unsigned access fails for both copies. Ordinary signed URLs are not treated as revocable course authorization.
3. Nest authorizes every request for a short-lived delivery capability. Token expiry, sharing, logout, enrollment end, and institutional disablement are tested on the intended plan and hostname.
4. Full, bounded, open, and suffix ranges return correct bytes for originals and derivatives, including first requests and real browser seeks.
5. Interrupted upload/download behavior is measured. Chunked upload is not confused with offline playback or student download resumption.
6. Original and derivative deletion, CDN invalidation, backup/restore, audit export, and database/provider reconciliation have explicit meanings and evidence.
7. Measured workload costs include the actual plan's token, CNAME, processing, bandwidth, storage, and overage terms.

If token delivery requires Cloudinary's Advanced plan or per-environment enablement, that is a procurement and architecture input—not a detail to discover after migration. Do not put long-lived signed URLs in lecture JSON or browser storage.

## Privacy and institutional governance

The institution and its qualified legal/privacy owners must determine the lawful basis, notices, retention, access procedure, deletion requests, cross-border safeguards, processor terms, and breach response. ctrorec does not make that legal determination.

Use the official [Nigeria Data Protection Act 2023](https://ndpc.gov.ng/wp-content/uploads/2024/03/Nigeria_Data_Protection_Act_2023.pdf) and [NDPC General Application and Implementation Directive 2025](https://ndpc.gov.ng/wp-content/uploads/2025/07/NDP-ACT-GAID-2025-MARCH-20TH.pdf) as primary references. Recording consent does not authorize external-model training, unapproved analysis, or secondary AI use.

## Evidence sources

- [pg-boss ORM transaction adapters](https://pgboss.io/api/adapters), [jobs](https://pgboss.io/api/jobs), and [workers](https://pgboss.io/api/workers): transactional enqueueing, at-least-once delivery, retries, heartbeats, and cancellation.
- [FFmpeg muxer documentation](https://ffmpeg.org/ffmpeg-formats.html) and [command documentation](https://ffmpeg.org/ffmpeg.html): `faststart`, stream mapping, and audio encoding options.
- [MDN `ETag`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/ETag) and [`If-Range`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/If-Range): strong validators and safe conditional range requests.
- [Cloudinary media access control](https://cloudinary.com/documentation/control_access_to_media) and [upload parameters](https://cloudinary.com/documentation/upload_parameters): authenticated delivery and token/cookie constraints.
- [MDN MediaStream Recording API](https://developer.mozilla.org/en-US/docs/Web/API/MediaStream_Recording_API): chunked browser recording behavior; chunks are not necessarily independently playable and must be reassembled.

## Advance only when

- The pilot owner signs the capture and listening results, including failures.
- Intended devices and real networks meet the agreed playback and recovery thresholds.
- The institution signs its privacy, retention, and deletion operating procedure.
- A provider passes authorization, range, revocation, lifecycle, and measured-cost tests.
- Production backup/restore and reconciliation are demonstrated.

Until then, keep the local adapter development/test-only and do not describe the local implementation as production-media certification.
