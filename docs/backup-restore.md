# PostgreSQL and media backup/restore

Status: Phase 8B.1 implemented and tested locally on 2026-11-04. The repository now has a snapshot-consistent PostgreSQL/media bundle command and a deliberately guarded restore drill. This is local consistency evidence, **not** a production disaster-recovery service, off-site backup policy, point-in-time recovery system, or live storage-provider certification.

## Delivered boundary

`pnpm backup:create` produces one immutable-by-convention bundle containing:

- a custom-format PostgreSQL dump;
- `manifest.json`, recording the backup UUIDv7, snapshot time, dump size/SHA-256, migration-journal digest, explicit exclusions, and every attached media object's tenant/lecture/kind/provider/key/size/SHA-256;
- one file per attached original or ready data-saver object under `objects/<intent-id>`; and
- `COMPLETE`, containing the manifest digest and written only after the dump and every media copy have passed verification.

`pnpm backup:restore-drill <bundle-directory>` verifies the complete bundle before restoration, restores PostgreSQL in one transaction, compares the restored media ledger/references/migration journal with the manifest, writes media without overwriting existing objects, and reads every restored object back for an independent size/SHA-256 check.

The built CLI was also exercised against the development database and a fresh guarded target. That smoke check contained no media; the real integration test supplies the original/derivative byte-restoration evidence.

## Consistency contract

Creation uses one source connection and a `REPEATABLE READ READ ONLY` transaction:

1. Export a PostgreSQL snapshot and allocate the backup ID in that transaction.
2. Read attached media intents and the Drizzle migration journal through the same snapshot.
3. Run `pg_dump --snapshot=<exported-snapshot>` against that exact database snapshot.
4. Commit the source transaction, then copy each media object named by the snapshot's attached intents.
5. Verify source bytes while copying, hash the dump, write the manifest and completion marker, and atomically rename the partial bundle directory to its final UUID name.

A lecture or media reference committed after the exported snapshot is absent from **both** the dump and media manifest. The integration suite holds a media copy open, commits a concurrent lecture/original, then proves that the later commit appears in neither side of the restored bundle.

Attached media keys are unique write attempts and are not intentionally overwritten by the application. A missing, unreadable, resized, or modified source object fails creation; it is not silently skipped. Ordinary caught failures remove the partial bundle. An abrupt process/host stop can leave a `.partial-<uuid>` directory, which has no valid completion marker and is never accepted as a restorable bundle.

Checksums detect accidental corruption. `COMPLETE` is not a signature or authentication mechanism; an attacker who can alter the whole bundle can recompute unkeyed hashes. Protect backup storage with separate access controls and add authenticated encryption/signing where the threat model requires them.

## Intentional deletion and later restoration

Phase 8B.2 deletion records, holds, and linked media-intent history are included in the database snapshot. The bundle still copies only objects attached at that snapshot; it does not copy an object merely because a pending/deleting/deleted intent exists.

A bundle created before an intentional deletion can restore the then-attached original and derivative without containing the later deletion decision. Before exposing a restored environment, the operator must review approved deletion/hold actions and institutional obligations after the snapshot, then deliberately reconcile or re-apply them. The drill does not automate that review. A live deletion request likewise does not erase older bundles, external exports, provider backups, or CDN caches. See `docs/media-retention.md` for the deletion state machine and completion meaning.

## Included and excluded state

| State                                                                                                                                                                 | Backup behavior                                                   | Operational consequence                                                                                               |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| PostgreSQL academic, identity, membership, lecture, original/derivative, consent/provenance, invitation, recovery, session, retention/deletion, and media-intent data | Included at the exported snapshot                                 | Restoring to an earlier point can restore state that has since changed; apply a deliberate cutover/security review    |
| Drizzle schema and migration journal                                                                                                                                  | Included and checked after restoration                            | Do not pre-migrate the drill target; it must be empty                                                                 |
| Attached original and ready data-saver objects                                                                                                                        | Copied and verified by intent ID                                  | These are the teaching media this slice can restore                                                                   |
| Pending/deleting/deleted media-intent ledger rows                                                                                                                     | Included in PostgreSQL; their objects are not copied              | Preserves lifecycle evidence without treating unreferenced objects as authoritative teaching                          |
| Configured `QUEUE_SCHEMA` (normally `pgboss`)                                                                                                                         | Schema excluded from the dump                                     | Queued derivative and recovery work is not replayed                                                                   |
| `public.lecture_audio_uploads` table data                                                                                                                             | Table schema retained; all row data excluded                      | Staged chunks are not backed up, so interrupted uploads must be started again rather than restored with false offsets |
| `AUDIO_UPLOAD_TEMP_DIR`, processing temp directories, quarantine, and partial backup directories                                                                      | Excluded                                                          | Transient files are not an alternative original-audio backup                                                          |
| Objects with no attached intent, including unknown pre-ledger/provider orphans                                                                                        | Not discoverable by this bundle                                   | A provider-inventory/legacy reconciliation process remains separate                                                   |
| Non-ready derivative generation work                                                                                                                                  | Database state may be restored, but its excluded queue job is not | A deliberate requeue/reconciliation workflow is still required before production cutover                              |

A real recovery must also review restored sessions, unused invitations, and recovery links. Point-in-time restoration can make a previously valid credential valid again. Revoke/rotate them as appropriate before exposing a recovered environment; the local drill does not perform production cutover or credential rotation.

## Prerequisites and configuration

Use PostgreSQL 18 server and matching PostgreSQL 18 `pg_dump`/`pg_restore` client tools. The database role needs sufficient read/snapshot privileges on the source and schema/object-creation privileges on the disposable restore target. Keep credentials in connection URLs/environment, never in command arguments or the manifest.

| Variable                               | Default               | Meaning                                                                                           |
| -------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                         | required              | Source PostgreSQL URL for creation                                                                |
| `AUDIO_STORAGE_PROVIDER`               | `local`               | Source media adapter for creation; API/worker/backup configuration must agree                     |
| `AUDIO_STORAGE_ROOT`                   | `../../.data/audio`   | Source root when the local adapter is selected                                                    |
| `CLOUDINARY_URL` / `CLOUDINARY_FOLDER` | provider-specific     | Source credentials/namespace only when Cloudinary is selected; live backup evidence is still open |
| `QUEUE_SCHEMA`                         | `pgboss`              | Queue schema excluded from the dump; must match the actual API/worker queue schema                |
| `BACKUP_ROOT`                          | `../../.data/backups` | Destination parent for completed and partial bundles                                              |
| `PG_DUMP_BIN`                          | `pg_dump`             | Optional explicit PostgreSQL 18 dump executable                                                   |
| `PG_RESTORE_BIN`                       | `pg_restore`          | Optional explicit PostgreSQL 18 restore executable                                                |
| `BACKUP_RESTORE_DATABASE_URL`          | none                  | Drill-only target; database name must end in `_restore_test`                                      |
| `BACKUP_RESTORE_STORAGE_ROOT`          | none                  | Drill-only empty/nonexistent local media destination                                              |
| `BACKUP_RESTORE_ACK`                   | none                  | Must exactly equal `RESTORE-INTO-EMPTY-LOCAL-TARGET`                                              |

The restore CLI deliberately supports an empty **local** storage target only. It does not restore into a live Cloudinary account, overwrite an existing media root, create/drop a database, or accept a production-looking target name. The underlying storage boundary remains provider-neutral, but no live-provider restore result is claimed.

Keep `BACKUP_ROOT` outside public assets and separate from the source media/staging roots. Bundle directories and files are created with owner-only permissions where the platform supports them; existing parent-directory permissions, mount encryption, backups of the backups, and operating-system access remain operator responsibilities. A database dump contains sensitive institutional and authentication data even when it has no lecture media.

## Create a bundle

Run from the repository root with the intended source environment loaded:

```sh
export DATABASE_URL='postgresql://…'
export AUDIO_STORAGE_PROVIDER=local
export AUDIO_STORAGE_ROOT="$PWD/.data/audio"
export BACKUP_ROOT="$PWD/.data/backups"
export QUEUE_SCHEMA=pgboss
pnpm backup:create
```

The final stdout line is JSON containing `backupId`, absolute `directory`, `mediaObjects`, and `mediaBytes`. Record that result without recording credentials. Do not treat a `.partial-*` directory as a backup.

Creation reads all attached objects and can consume substantial source bandwidth, destination capacity, and time. Two media copies run concurrently; this is a correctness-first implementation, not a tuned high-throughput production backup scheduler. Run it initially with synthetic or explicitly consented development data.

## Run the guarded restore drill

1. Create a **new empty** PostgreSQL database whose name ends in `_restore_test`. Do not run application migrations in it.
2. Choose a new or empty local directory that is not `AUDIO_STORAGE_ROOT`.
3. Set `BACKUP_DIRECTORY` to the absolute completed bundle directory returned by creation.
4. Run:

```sh
export BACKUP_DIRECTORY='/absolute/path/to/.data/backups/<backup-id>'
export BACKUP_RESTORE_DATABASE_URL='postgresql://…/ctrorec_restore_test'
export BACKUP_RESTORE_STORAGE_ROOT="$PWD/.data/restore-drill"
export BACKUP_RESTORE_ACK=RESTORE-INTO-EMPTY-LOCAL-TARGET
pnpm backup:restore-drill "$BACKUP_DIRECTORY"
```

Success returns the same backup ID and verified media counts/bytes. Preserve that output with the date, source environment, tool versions, operator, and target identity in the operational evidence record.

The drill refuses to proceed when:

- the target URL is not PostgreSQL or its database name lacks `_restore_test`;
- the target contains any user table, view, sequence, or other counted relation—even outside the normal application schemas;
- the local target directory is non-empty or equals the configured source audio root;
- the manifest/completion marker is absent, malformed, or inconsistent;
- any dump/media size or SHA-256 differs from the manifest; or
- an object provider differs from the target provider.

`pg_restore --single-transaction --exit-on-error` makes the PostgreSQL portion all-or-nothing. Media restoration happens afterward and cannot participate in that database transaction. If any later verification/copy fails, regard the entire target as a failed drill: retain logs for diagnosis and use another fresh database and storage directory for the next attempt. Do not point an application at the partial target or manually delete a few objects to make it look successful.

The drill does not start the web/API/worker against the target, expose it publicly, test DNS/TLS failover, or measure production recovery time. Those require a separately approved isolated recovery exercise.

## Production requirements still open

Before real institutional recordings depend on this mechanism:

1. Define institutional RPO/RTO, retention, legal holds, deletion propagation, regional/cross-border requirements, and restore authorization with the appropriate owners.
2. Schedule backups, monitor failures and capacity, encrypt them in transit/at rest, restrict and audit access, and replicate them to an independent failure domain. Test restoration of the replicated copy, not only the local original.
3. Decide whether logical snapshots are sufficient or whether managed snapshots/WAL archiving/PITR are required. This implementation has no WAL archive, continuous replication, automatic failover, or point-in-time recovery.
4. Add and test recovery handling for pending derivative jobs, restored credentials/links, migrations newer than the backup, intentional-deletion holds, and application cutover.
5. Prove the selected live media provider's backup/export/restore semantics, range delivery, revocation, cost, and recovery ordering with synthetic data. The current guarded CLI drill is local-to-local.
6. Exercise full application restoration and authorized original playback in an isolated environment, then measure actual RPO/RTO. A matching hash is necessary evidence but not a complete service-recovery test.
7. Add bundle retention/deletion automation only after institutional policy is approved. At present, completed and interrupted bundle cleanup is manual and deliberate.

No production provider has been selected by this slice.

## Executable evidence

`apps/worker/test/media-backup.integration.test.ts` uses real PostgreSQL 18 tools and local files to prove:

- one snapshot across dump and media during a concurrent commit;
- exact original and derivative restoration with byte re-reads;
- queue-schema exclusion and transient upload-row exclusion;
- restored reference/intent/migration-journal agreement;
- rejection of corrupt media before database objects are created;
- refusal of a target containing a relation in an unexpected schema; and
- no completed bundle when source media cannot be read.

`apps/worker/test/backup.spec.ts` covers URL/environment credential handling, executable argument boundaries, and unsafe restore-target rejection. The complete repository gate remains required after changes.

These tests do not establish abrupt host-crash durability, off-site recovery, live-provider behavior, full application failover, intentional media deletion, production RPO/RTO, or legal/institutional approval.
