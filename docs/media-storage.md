# Media storage and Cloudinary assessment

Assessment date: 2026-11-01. This is a documentation review and implementation boundary, not a successful Cloudinary account test or a purchase recommendation.

## Current storage boundary

The API owns lecture authorization and metadata. The shared `@ctrorec/media` boundary exposes only `save`, `verify`, `open`, and idempotent `delete` operations. The development/test implementation stores files outside the web root, verifies byte size before publication/playback, and supports one HTTP byte range for seeking. Originals and derivatives have strong SHA-256 entity tags and `If-Range` handling for safe conditional resume.

Phase 4 adds a worker-generated data-saver derivative. The original metadata, derivative state, and pg-boss job commit atomically. Original publication/playback does not wait for FFmpeg or a derivative. See `docs/media-evidence.md` for the real-hall, connectivity, and cost evidence still required.

The local adapter is **not production storage**. It provides no replication, automated/off-site backup, multi-instance shared filesystem, CDN, offline support, or guaranteed disaster recovery. Resumable lecturer upload sessions use separate chunk staging with scheduled reconciliation and a tested local two-instance replacement path. Multiple API replicas still require one shared POSIX-compatible staging filesystem; the local audio adapter itself does not provide it. API responses expose neither local paths nor storage keys. No lecturer/student/public delete-or-replace endpoint exists; intentional deletion is a separate fresh-admin workflow. See `docs/upload-durability.md` and `docs/media-retention.md`.

Phase 8A.2 adds durable write intents for originals and derivatives. New attempts use unique keys; reference rows and attached intents commit atomically; stale pending/deleting intents are reconciled with reference checks and idempotent deletion. Local deletion covers the final object and deterministic partial-write path. This reduces crash/lost-response orphan windows but does not list provider inventories, discover pre-ledger orphans, restore missing referenced media, or prove backup/CDN deletion. See `docs/upload-durability.md` for states, races, configuration, and executable evidence.

Phase 8B.1 adds an explicit snapshot-consistent PostgreSQL/attached-media bundle and guarded local restore drill. It verifies original/derivative bytes and rejects incomplete or corrupt bundles, but does not schedule or replicate backups, discover provider orphans, restore into a live provider, or provide production failover. See `docs/backup-restore.md`.

Phase 8B.2 adds fresh-admin retention holds and intentional deletion of ledger-known original/data-saver objects. Access revocation is transactional; physical completion is separate and retryable. Lecture/capture evidence remains, while upload/derivative resurrection is blocked. This does not discover unknown provider objects, erase backups, or prove live CDN/provider deletion. See `docs/media-retention.md`.

A production provider must pass the same authorization, publication, integrity, range, and cleanup contract tests. Provider-specific SDK types must not leak into lecture controllers or the browser.

Phase 5 adds an **opt-in Cloudinary candidate** behind this boundary. It uses `resource_type=video`, `type=authenticated`, non-overwriting `upload_large`, discarded provider-side original filenames, short-lived server-side `private_download_url` values, strict range/status validation, and explicit deletion with CDN invalidation. API and worker must select the same provider and isolated folder. The browser still receives only same-origin ctrorec URLs; it never receives the Cloudinary credential or signed provider URL.

Only mocked contract tests have run. No live Cloudinary upload, range, deletion, large-file, revocation, backup/restore, real-device, or cost result exists yet. Local resumable staging is not a distributed provider upload protocol.

## Cloudinary findings

| Question                                   | Finding                                                                                                                                                                                                                                                                        | Consequence for ctrorec                                                                                                                                                                                                                     |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| How is audio represented?                  | Cloudinary uses `resource_type=video` for audio assets such as MP3.                                                                                                                                                                                                            | An adapter must make this mapping explicit; it must not assume `resource_type=audio`.                                                                                                                                                       |
| Which delivery type fits private lectures? | `authenticated` protects originals and derivatives. `private` protects originals but can leave derivatives public.                                                                                                                                                             | Start any spike with `authenticated`; do not use the default public `upload` type for lecture recordings.                                                                                                                                   |
| Is a signed URL enough authorization?      | No. Cloudinary explicitly warns that signed URLs can be shared. A normal delivery signature is not a ctrorec session, course membership check, or revocation mechanism.                                                                                                        | Nest must authorize before issuing any delivery capability. Do not put long-lived signed URLs in lecture JSON or browser storage.                                                                                                           |
| Can access expire or be session-like?      | Token- and cookie-based access support expiry and other rules, but are Advanced-plan-or-higher features enabled per product environment. Cookie-based access also requires a custom delivery hostname (CNAME) at additional cost.                                              | Confirm plan, enablement, key custody, expiry, and CNAME costs before choosing this route. A basic signed URL is not an acceptable substitute for short-lived access.                                                                       |
| Can Nest proxy the bytes instead?          | Technically possible, but it adds API bandwidth, memory/backpressure work, latency, and an extra delivery hop.                                                                                                                                                                 | Do not hide a permanent public URL behind a proxy and call it private. Compare proxying with short-lived signed delivery using measured cost and performance.                                                                               |
| Does seeking work?                         | Cloudinary documentation for generated video shows `Accept-Ranges: bytes` after generation. Its first on-the-fly transformed response can lack byte ranges and report the wrong duration. This does not prove every authenticated original/audio derivative behaves correctly. | Test `206`, `Content-Range`, suffix/open ranges, and real browser seeking for every chosen format and delivery mode. Pre-generate required derivatives if their first-play behavior fails. Original audio access must not wait for AI work. |
| Can large uploads resume?                  | Cloudinary documents signed uploads and chunked upload flows for large files. This is upload chunking, not proof of resumable student downloads or offline playback.                                                                                                           | Test interruption/retry on real Nigerian mobile networks. Keep resumable downloads and offline support as separate, unclaimed features.                                                                                                     |

Primary references: [media access control](https://cloudinary.com/documentation/control_access_to_media), [upload parameters](https://cloudinary.com/documentation/upload_parameters), [Upload API reference](https://cloudinary.com/documentation/image_upload_api_reference), [Admin API reference](https://cloudinary.com/documentation/admin_api), and [asset deletion](https://cloudinary.com/documentation/delete_assets).

## Unit economics

Cloudinary's current pricing describes shared credits consumed by managed storage, viewing bandwidth, transformations, and processing. Its comparison page describes one credit as 1 GB of managed storage **or** 1 GB of viewing bandwidth **or** the stated processing/transformation quantities. Plan pricing, boosts, overage terms, and audio/video classification must be rechecked before purchase; do not treat this document as a quote.

Use measured values:

```text
monthly credit pressure ≈ retained original GB
                        + retained derivative GB
                        + delivered GB
                        + processing/transformation credits
```

Illustration only: 500 one-hour recordings at 128 kbit/s are about 28.8 GB of original storage. 10,000 complete plays at that bitrate are about 576 GB of delivery, before rebuffering, retries, derivatives, or processing. Speech at 64 kbit/s would roughly halve those media bytes, but only a real-hall intelligibility test can decide whether it is acceptable. Bandwidth and repeat viewing can dominate storage; enrolled-student counts alone are not a useful cost model.

Measure at least: recording duration, original bitrate, derivative bitrate, storage retention, plays per lecture, completion/partial-play behavior, repeated seeks, failed uploads, rebuffering, and delivery by actual network. Include institutional taxes, support, CNAME, backup, and overage terms in the eventual decision.

## Privacy, retention, and governance

- Keep institution/course authorization in Nest. Cloudinary public IDs, folders, tags, and ACL patterns are not tenant authorization.
- Use opaque keys containing institution/offering/lecture identifiers only as organizational metadata; never rely on their secrecy. Record provider, asset ID/public ID, version, checksum, byte size, and lifecycle state in PostgreSQL.
- Phase 8B.2 implements reasoned holds and admin-confirmed deletion for ledger-known originals/derivatives, with preserved capture/deletion evidence. Institutions must still define schedules and procedures for temporary uploads, orphaned objects, CDN copies, backups, exports, and audit records. Cloudinary deletion APIs distinguish original/derived resources; CDN invalidation is separate and can take time. Provider-specific backup deletion/restore behavior still needs live testing; the local workflow/drill does not settle CDN or provider-backup semantics.
- Reconcile known media intents with PostgreSQL references before making deletion claims, and add a provider-inventory process if legacy/unknown objects must be discovered. An API success response or `deleted` intent does not prove every derived, cached, or backed-up copy is gone.
- Review Nigerian Data Protection Act obligations, institutional contracts, consent notices, cross-border processing/subprocessors, access audits, retention periods, and deletion requests with qualified institutional/legal owners. This repository does not provide a legal determination.
- Disable unapproved analysis/auto-tagging/add-ons for private recordings. No external-model training or secondary AI use is authorized by storage consent.
- Separate production product environments/credentials from development. Keep API secrets and any token-encryption keys server-side, rotate them, and restrict operational access. Platform super administrators do not gain automatic private-content access.

## Synthetic live evidence runner

`packages/media/scripts/cloudinary-evidence.ts` performs a small real-account check with generated WAV/M4A only. It requires an isolated folder beginning `ctrorec-evidence-` and an explicit deletion acknowledgement. It uploads original and derivative objects, checks metadata and byte-identical full/range delivery, verifies unsigned delivery fails, deletes both objects, and checks provider metadata no longer resolves.

```sh
CLOUDINARY_URL='cloudinary://…' \
CLOUDINARY_EVIDENCE_FOLDER='ctrorec-evidence-your-environment' \
CLOUDINARY_EVIDENCE_ACK='DELETE-SYNTHETIC-EVIDENCE-OBJECTS' \
pnpm --filter @ctrorec/media evidence:cloudinary
```

This can incur usage charges and deletes the synthetic objects it creates. Use a restricted development product environment, not production credentials or real lectures. Preserve the JSON result with the date, account/plan, folder, and operator in the evidence record; do not preserve credential or signed URLs. The runner does not test Nest authorization/revocation, real phones/networks, large uploads, backup/restore, CDN disappearance timing, or cost.

## Required provider spike before adoption

Use synthetic or explicitly consented recordings, not real student lectures:

1. Upload MP3, WAV, and phone-recorded M4A as `authenticated` using a backend-authorized signed flow. Verify checksums and interruption behavior above the single-request size limit.
2. Verify that unsigned/unauthenticated requests fail for originals **and** derivatives; test URL sharing, expiry, revocation after enrollment ends, and cookie behavior on the intended hostname/plan.
3. Test full and partial range responses, suffix/open ranges, invalid ranges, first-play latency, seeking, and codec support on low-end Android Chrome and iOS Safari. Include high latency, packet loss, and limited data.
4. Test original and low-data derivative behavior independently. Never let derivative generation, transcription, or AI processing block access to a verified original.
5. Exercise deletion, derived cleanup, CDN invalidation, backup/restore, audit export, and provider/database reconciliation. Document exactly what “deleted” means and when.
6. Price the measured workload, including repeat plays and failed/restarted uploads. Confirm token/cookie features, CNAME, backup, overage, and support terms on the actual plan.
7. Keep the provider behind `AudioStorage`; rerun the existing contract/denial tests and complete the live provider-specific integration evidence rather than accepting mocked tests as certification.

**Current decision:** Cloudinary is a plausible candidate with an opt-in adapter, not approved production storage. Its authenticated asset type and CDN are promising, but ordinary signed URLs alone do not satisfy revocable institution-controlled delivery. Proceed only after the range, expiry/revocation, privacy/deletion, real-hall quality, connectivity, and unit-economics gates have evidence.
