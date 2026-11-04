# Media retention and intentional deletion

Status: Phase 8B.2 implemented and tested locally on 2026-11-05. This slice adds institution-admin retention holds and intentional deletion of a lecture's original and data-saver derivative. It preserves lecture and capture metadata, revokes ordinary media access transactionally, and completes deletion only after every linked media intent is recorded as deleted.

This is local PostgreSQL/filesystem evidence. It is not a production legal-retention policy, provider-inventory scanner, CDN-invalidation guarantee, backup-erasure mechanism, or live Cloudinary deletion certification.

## Authorization and visibility

Only a user with a fresh, active `institution_admin` role in the same active institution may use these endpoints. Lecturer or student rights alone are insufficient. Cross-tenant identifiers fail closed.

Administration responses contain workflow and evidence metadata only. They do not contain storage keys, local paths, signed URLs, or playback/download URLs. Institution-admin rights alone still do not grant audio access.

The ordinary course response exposes only:

```json
{
  "mediaDeletion": {
    "requestedAt": "2026-11-04T22:51:05.158Z",
    "completedAt": "2026-11-04T22:51:13.491Z"
  }
}
```

The deletion reason, original metadata snapshot, and hold reasons remain in the tenant-admin view. A deleted-media course item has no recorder, upload picker, publish control, player, or download link. The lecture title, date, description, and academic history remain.

## Admin workflow

Open **Administration → Course offerings → Media retention** for an offering.

1. **Place a retention hold** with a specific reason when intentional deletion must wait for review. Only one active hold is allowed per lecture; released holds remain as history.
2. **Release the hold** with a separate reason before deletion can proceed.
3. Open **Delete original and derivatives**, enter a reason, and type the exact confirmation `DELETE MEDIA`.
4. Read the resulting state carefully:
   - **Deletion in progress** means course access has been revoked, but at least one linked object has not completed reconciliation.
   - **Media deleted** means every intent linked to that deletion request has a deletion timestamp.

The HTTP request does not synchronously claim that a provider or filesystem object is gone. Pending states poll for worker confirmation. The worker's ordinary interval defaults to 15 minutes; intentional-deletion intents bypass the normal age grace period but wait for the next scheduled reconciliation run.

## API

All routes are below `/api/institutions/:institutionId/admin` and require the current session plus fresh tenant-admin authorization.

| Method | Path                                     | Purpose                                                                         |
| ------ | ---------------------------------------- | ------------------------------------------------------------------------------- |
| `GET`  | `/offerings/:offeringId/media-retention` | List lectures in the offering with an original, active hold, or deletion record |
| `POST` | `/lectures/:lectureId/media-hold`        | Place one active hold; body: `{ "reason": "…" }`                                |
| `POST` | `/media-holds/:holdId/release`           | Release an active hold with `{ "reason": "…" }`                                 |
| `POST` | `/lectures/:lectureId/media-deletion`    | Request deletion with `{ "reason": "…", "confirmation": "DELETE MEDIA" }`       |

Reasons are trimmed, non-empty, and at most 500 characters. Repeating the same deletion request is idempotent: it returns the original deletion record with `created: false`; it does not create another request or relink later objects. Replacement media is rejected, so a completed deletion cannot be silently undone through the ordinary upload flow.

## Transactional deletion semantics

The deletion request uses one PostgreSQL transaction and locks the tenant-matched lecture row. Under that lock it:

1. Requires an original audio row and rejects an active hold or an existing deletion request.
2. Snapshots the original filename, media type, byte size, and SHA-256 into `lecture_media_deletions`, together with tenant, lecture, requesting membership, reason, and request time.
3. Marks every non-deleted original/derivative media intent for the lecture as `deleting` and links it with `deletion_request_id`.
4. Expires active resumable-upload sessions.
5. Deletes derivative and original reference rows, immediately ending ordinary lecturer/student playback and download access.
6. Leaves the lecture, capture provenance, hold history, original metadata snapshot, and media-intent history in place.

The lecture-row lock is also used by original attachment, resumable-upload session creation, and new media-intent creation. Those paths re-check the deletion record after acquiring the lock. This prevents a late upload or derivative write from committing a new reference after deletion.

An in-flight derivative may finish its local FFmpeg work after revocation, but it cannot attach a new ready reference after the deletion transaction. Its unique intent remains eligible for deletion reconciliation. A queued derivative claim whose source disappeared because of a recorded intentional deletion finishes quietly instead of becoming a perpetual retry.

## Holds and release history

`lecture_media_holds` has a partial unique index on `(lecture_id) WHERE released_at IS NULL`. A release must record its timestamp, releasing membership, and trimmed reason together; the database rejects incomplete release provenance.

Holds block the intentional-deletion command. They do not delete media, grant access, or change playback by themselves. Ordinary lifecycle reconciliation still preserves any referenced original; a hold is not presented as a general legal-hold or provider-backup guarantee.

## Object reconciliation and completion

Intentional deletion reuses the durable lifecycle ledger rather than introducing a second, untracked delete path:

- `deleting` and `deleted` intentional intents may retain `attached_at`; this preserves proof that the object was attached before its deletion.
- A candidate linked to a deletion request is eligible immediately, without waiting for the ordinary reconciliation grace age.
- Physical deletion is idempotent. A failed or lost delete remains `deleting` and is retried.
- `markMediaObjectDeleted` records completion on `lecture_media_deletions` only when no intent linked to that request remains in a non-`deleted` state. Concurrent finishers serialize their final checks on the deletion-request row, preventing two transactions from each missing the other's uncommitted deletion.
- If reconciliation unexpectedly finds a current original/derivative reference, the fail-safe remains preserve-and-mark-attached. The object is not deleted and the deletion request remains incomplete for investigation.

Configure `MEDIA_RECONCILIATION_ENABLED` and `MEDIA_RECONCILE_INTERVAL_MS` in the worker. An intent for a provider different from the configured worker is skipped, not falsely marked deleted. Multi-provider historical inventories therefore require an explicit provider-specific operating design.

## Evidence preservation

Capture provenance now belongs to the tenant-matched lecture rather than depending on the continued existence of `lecture_audio`. This allows the original reference to be removed without erasing capture evidence.

The tenant-admin capture CSV includes two additional columns:

- `media_deletion_requested_at`
- `media_deletion_completed_at`

After deletion, original/derivative fields that came from the removed media rows are blank. Capture identifiers, timeline, consent attestation, upload measurements, lecture metadata, and deletion timestamps remain. The deletion record separately preserves the original metadata snapshot in the admin retention view.

This is a specific retention/deletion history, not the dedicated cross-feature administrative audit ledger that remains outside the current slices.

## Backup and restore interaction

Backups remain point-in-time snapshots:

- The database dump contains deletion, hold, and intent ledger rows present at snapshot time.
- Attached original/ready-derivative objects are copied according to the existing manifest rules.
- `pending`, `deleting`, and `deleted` intents remain database evidence; their objects are not copied merely because an intent exists.

Restoring an older bundle can therefore restore media that was intentionally deleted after that snapshot. A recovery operator must review deletion records and approved institutional actions taken after the snapshot and must not treat an old restore as proof that later deletion obligations disappeared. Conversely, requesting deletion in a live database does not erase older backups, offline exports, provider backups, or CDN caches.

The guarded local restore drill does not automate this review or propagate deletions. See `docs/backup-restore.md`.

## Verification

The executable coverage includes:

- a database invariant test for one active hold and complete release provenance;
- real HTTP tests for fresh admin authorization, tenant isolation, hold/release behavior, exact confirmation, idempotent requests, immediate playback revocation, upload rejection, preserved lecture/capture rows, and deletion-aware CSV output;
- real PostgreSQL/filesystem reconciliation of an original plus derivative, including immediate candidacy, derivative-ready/deletion conflict, one failed physical delete, retry, attachment-history preservation, race-safe exact completion, and rejection of a later write intent;
- a production Chromium journey through upload, publication, ready derivative creation, hold, release, confirmed deletion, and lecturer/student deleted-media states.

Run the complete repository gate after changes:

```sh
pnpm check
pnpm db:check
pnpm test:integration
pnpm test:e2e
pnpm audit --prod
git diff --check
```

## Remaining limits and follow-up work

- No live Cloudinary deletion, CDN disappearance/invalidation timing, provider-backup erasure, or multi-provider deletion result is claimed.
- No pre-ledger/provider-inventory discovery, automatic missing-original repair, bulk deletion, retention-schedule engine, or general administrative audit ledger is included.
- No deletion propagation into historical backups or external exports is implemented.
- Local filesystem deletion and a local restore drill do not establish production disaster recovery, RPO/RTO, failover, or legal compliance.
- Institutions still need qualified privacy/legal owners to approve notices, lawful basis, retention periods, hold authority, deletion approval, processor terms, and breach/records procedures. The software does not make that determination.
