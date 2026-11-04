# Consented capture field pilot

Status: Phase 7B runbook and telemetry implemented locally on 2026-11-04. No physical hall, phone, carrier, listening, cost, or production-storage result has been recorded.

Use this with `media-evidence.md` and `lecture-capture.md`. Start with scripted, consented speech—not a real student lecture.

## 1. Approve before recording

The institution's pilot, academic, privacy, and technical owners must agree on:

- purpose, notice, lawful basis, participant consent, and the scripted content;
- who may record, listen, export operational evidence, and approve deletion;
- device/shared-profile rules, local-draft handling, retention, and incident response;
- the test halls, devices, carriers, dates, and stop conditions; and
- acceptance thresholds **before** listening preferences or outcome data are reviewed.

Do not put student names, private lecture content, access credentials, or recovery/invitation links in either evidence file. Recording consent does not authorize external-model training or unrelated secondary use.

| Decision                           | Agreed threshold or owner | Result (after the pilot) |
| ---------------------------------- | ------------------------- | ------------------------ |
| Scripted word/term accuracy        | To be set by pilot owner  | Not yet measured         |
| Listening effort                   | To be set by pilot owner  | Not yet measured         |
| Original playback/decode failures  | To be set by pilot owner  | Not yet measured         |
| Capture/upload recovery            | To be set by pilot owner  | Not yet measured         |
| Data-saver size/listening tradeoff | To be set by pilot owner  | Not yet measured         |
| Full-session battery/storage limit | To be set by pilot owner  | Not yet measured         |
| Privacy/deletion review            | Named institutional owner | Not yet completed        |

“Not yet measured” is a status placeholder, not a result.

## 2. Prepare comparable sessions

1. Use the same approved script and script version across the initial matrix.
2. Assign non-identifying device and hall labels. Record actual model, OS/browser, microphone, teaching position, noise, and teaching action in the field sheet.
3. Record the carrier and observed conditions separately. Browser estimates, if a coordinator chooses to note them, are not a substitute for radio/network measurement.
4. Charge and inspect the device, available storage, browser permission, and institutional notice. Do not clear site data during the recovery exercise.
5. Create a draft lecture for each planned capture. Keep the tab in the foreground.

Use `docs/templates/field-session-sheet.csv`. It is deliberately blank. One row corresponds to one capture reference; aggregate listener scores only after the listening protocol is complete.

## 3. Capture and correlate

For each session:

1. Complete the visible recording-permission attestation and grant microphone access.
2. Start recording and copy the **Evidence reference** UUID into `capture_reference` on the field sheet before uploading.
3. Run the scripted teaching action. Record screen lock, calls, movement, noise, or other interruptions as observed events; do not assume what the recorder retained.
4. Stop and listen locally before upload. Mark an incomplete draft as failed evidence rather than silently replacing it.
5. Upload over the identified connection. Record visible failures and the coordinator's network observations. A retry count is not the number of bytes retransmitted.
6. Verify original playback independently of the data-saver. When ready, compare the derivative using the listening protocol in `media-evidence.md`.
7. Preserve failures and interrupted sessions in the sheet. Do not keep only successful samples.

Run short stationary/noise/position comparisons before interruption scenarios, and complete those before any full-length session. Change one intended variable at a time where practical.

## 4. Export server evidence

An active institution administrator opens **Administration → Capture evidence**, optionally chooses UTC dates, and downloads the CSV. The `to` date is inclusive. Exports are limited to 5,000 captures; narrow the date range if the API asks.

Every request rechecks current admin membership. The route returns `private, no-store`; it does not grant lecturer/student audio access. The CSV omits student rosters, lecturer emails, storage keys, provider URLs, signed URLs, and audio content. Treat lecture titles and course metadata as institution-confidential operational data.

Join the field sheet and export on `capture_reference`. Investigate duplicates or missing references rather than matching by approximate time or lecture title.

### Automated export fields

| Field group                                                      | Meaning and limitation                                                                                                                                                                       |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `capture_reference`, `lecture_id`, course/offering fields        | Correlation keys and institutional metadata; not proof of speaker identity or consent.                                                                                                       |
| `recorder_mime_type`                                             | Browser-declared recorder container/codec string.                                                                                                                                            |
| Consent/start/stop timestamps and `capture_duration_ms`          | Client-reported provenance. Active duration excludes pause time and is independent of chunk timing; it is not an encoded-duration or intelligibility measurement.                            |
| `saved_chunk_count`, `persistent_storage_granted`, `stop_reason` | Local committed recorder segments, persistence-request result, and declared ending. These do not prove recovery after termination or background continuity.                                  |
| `hashing_duration_ms`                                            | Monotonic browser time spent hashing the assembled original before handoff.                                                                                                                  |
| `upload_duration_ms`                                             | Monotonic browser time from after hashing until just before the first completion request. It includes session/chunk/status recovery work and excludes completion plus derivative processing. |
| `upload_retry_count`                                             | Failed chunk PATCH attempts observed before the accepted completion. Completion retries and actual carrier retransmissions are excluded.                                                     |
| Original type, size, SHA-256, `server_recorded_at`               | Server-inspected original metadata and the transaction record time.                                                                                                                          |
| Derivative status, attempts, size, processing time               | Last recorded processing outcome and worker timing where available. A failed/pending derivative has blank ready-size ratios.                                                                 |
| Derivative ratio and bytes saved                                 | Derived only for a ready derivative from original/derivative byte sizes. Container overhead is included; delivered network bytes are not.                                                    |

Phase 7A capture rows created before handoff instrumentation may have blank hash/upload/retry fields. All three are either present together or absent together under the PostgreSQL constraint. Client timings and counts are operational attestations, not trusted server timestamps or security decisions.

### Field-sheet-only fields

Device/model, OS/browser, microphone, hall, teaching position/action, carrier, observed network conditions, battery/storage, interruption scenario, listener count, accuracy, listening effort, dropouts, and coordinator observations remain in the field sheet. ctrorec does not silently collect a user agent, device fingerprint, precise location, student identity, or carrier identifier.

The current export does not provide automatic student playback telemetry, total uploaded/retransmitted bytes, radio conditions, loudness, intelligibility, battery consumption, or monetary cost. Use the technical/listening/network protocols and actual bills/provider reports for those questions.

## 5. Review without overstating

- Compare like-for-like script, device, position, and condition groups; report sample counts and failures.
- Separate original-audio problems from derivative processing and listening problems.
- Check size ratio alongside listening accuracy/effort; a smaller file is not automatically a better lecture.
- Treat interrupted recovery as evidence only of saved chunks and observed behavior. Do not infer recovery across other termination modes.
- Use real carrier/router/browser measurements for bytes and stalls when required; the export does not measure them.
- Record negative and inconclusive outcomes. Do not backfill thresholds after seeing preferences.
- Complete retention/deletion review for local drafts, originals, exports, and field sheets.

Advance to a real lecture only after scripted sessions pass the agreed technical, listening, and governance thresholds. Advance to production only after durable storage, multi-instance staging/reconciliation, backup/restore, external delivery, and the other gates in `media-storage.md` also pass.

## Automated evidence versus field evidence

Repository tests prove the export contract, tenant admin boundary, CSV escaping, migration constraints, and a synthetic Chromium correlation flow. That flow forces one captured-chunk failure, recovers it, downloads the CSV, and verifies `upload_retry_count = 1` for the visible capture UUID. It does not prove a physical interruption, real carrier, microphone, hall, full-length session, or listening result.
