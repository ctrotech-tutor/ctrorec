import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { chmod, mkdir, rename, rm, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createDatabase } from '@ctrorec/database'
import type { AudioStorage } from '@ctrorec/media'
import {
  BACKUP_DATABASE_FILE,
  assertFileDigest,
  backupObjectPath,
  hashFile,
  readVerifiedManifest,
  writeCompleteManifest,
  type BackupMediaObject,
  type MediaBackupManifest,
} from './backup-manifest.js'
import {
  assertRestoreDatabaseUrl,
  databaseNameFromUrl,
  postgresToolEnvironment,
  runPostgresTool,
} from './postgres-tools.js'

const COPY_CONCURRENCY = 2
const MEDIA_QUERY = `
  SELECT
    id::text, institution_id::text, lecture_id::text, kind,
    storage_provider, storage_key, byte_size::text, sha256
  FROM media_object_intents
  WHERE status = 'attached'
  ORDER BY id
`
const MIGRATIONS_QUERY =
  'SELECT hash FROM drizzle.__drizzle_migrations ORDER BY id'

interface MediaRow {
  id: string
  institution_id: string
  lecture_id: string
  kind: 'original' | 'data_saver'
  storage_provider: string
  storage_key: string
  byte_size: string
  sha256: string
}

export interface CreateMediaBackupOptions {
  sourceDatabaseUrl: string
  storage: AudioStorage
  backupRoot: string
  queueSchema?: string
  pgDumpPath?: string
}

export interface MediaBackupResult {
  backupId: string
  directory: string
  mediaObjects: number
  mediaBytes: number
  manifest: MediaBackupManifest
}

export interface RestoreMediaBackupOptions {
  backupDirectory: string
  targetDatabaseUrl: string
  targetStorage: AudioStorage
  pgRestorePath?: string
}

export interface MediaRestoreResult {
  backupId: string
  mediaObjects: number
  mediaBytes: number
}

export async function createMediaBackup(
  options: CreateMediaBackupOptions,
): Promise<MediaBackupResult> {
  const backupRoot = resolve(options.backupRoot)
  const queueSchema = options.queueSchema ?? 'pgboss'
  if (!/^[a-z_][a-z0-9_]*$/.test(queueSchema)) {
    throw new Error('The backup queue schema name is invalid.')
  }
  const { pool } = createDatabase(options.sourceDatabaseUrl, {
    applicationName: 'ctrorec-backup-snapshot',
    maxConnections: 1,
  })
  let transactionOpen = false
  let partialDirectory: string | undefined
  let complete = false

  try {
    const client = await pool.connect()
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
      transactionOpen = true
      const snapshot = await client.query<{
        backup_id: string
        snapshot_id: string
        created_at: Date
      }>(`SELECT uuidv7() AS backup_id, pg_export_snapshot() AS snapshot_id,
       now() AS created_at`)
      const snapshotRow = requiredRow(snapshot.rows, 'backup snapshot')
      const backupId = snapshotRow.backup_id
      partialDirectory = resolve(backupRoot, `.partial-${backupId}`)
      const finalDirectory = resolve(backupRoot, backupId)
      await mkdir(backupRoot, { recursive: true, mode: 0o700 })
      await mkdir(partialDirectory, { recursive: false, mode: 0o700 })
      await mkdir(resolve(partialDirectory, 'objects'), {
        recursive: false,
        mode: 0o700,
      })

      const [media, migrations] = await Promise.all([
        client.query<MediaRow>(MEDIA_QUERY),
        client.query<{ hash: string }>(MIGRATIONS_QUERY),
      ])
      const objects = media.rows.map(mapMediaRow)
      const migrationsSha256 = migrationDigest(
        migrations.rows.map((row) => row.hash),
      )
      const dumpPath = resolve(partialDirectory, BACKUP_DATABASE_FILE)
      await runPostgresTool(
        options.pgDumpPath ?? 'pg_dump',
        [
          '--format=custom',
          '--no-owner',
          '--no-privileges',
          `--exclude-schema=${queueSchema}`,
          '--exclude-table-data=public.lecture_audio_uploads',
          `--snapshot=${snapshotRow.snapshot_id}`,
          `--file=${dumpPath}`,
        ],
        postgresToolEnvironment(options.sourceDatabaseUrl, 'ctrorec-pg-dump'),
      )
      await chmod(dumpPath, 0o600)
      await client.query('COMMIT')
      transactionOpen = false

      await mapBounded(objects, async (object) => {
        await copyStorageObject(
          options.storage,
          object,
          backupObjectPath(partialDirectory!, object.id),
        )
      })
      const dumpDetails = await stat(dumpPath)
      const manifest: MediaBackupManifest = {
        formatVersion: 1,
        backupId,
        createdAt: snapshotRow.created_at.toISOString(),
        database: {
          dumpFile: BACKUP_DATABASE_FILE,
          dumpByteSize: dumpDetails.size,
          dumpSha256: await hashFile(dumpPath),
          migrationCount: migrations.rows.length,
          migrationsSha256,
          excludedSchemas: [queueSchema],
          excludedTableData: ['public.lecture_audio_uploads'],
        },
        objects,
      }
      await writeCompleteManifest(partialDirectory, manifest)
      await rename(partialDirectory, finalDirectory)
      complete = true

      return {
        backupId,
        directory: finalDirectory,
        mediaObjects: objects.length,
        mediaBytes: totalBytes(objects),
        manifest,
      }
    } finally {
      if (transactionOpen) {
        await client.query('ROLLBACK').catch(() => undefined)
      }
      client.release()
    }
  } finally {
    await pool.end()
    if (partialDirectory && !complete) {
      await rm(partialDirectory, { recursive: true, force: true })
    }
  }
}

export async function restoreMediaBackup(
  options: RestoreMediaBackupOptions,
): Promise<MediaRestoreResult> {
  assertRestoreDatabaseUrl(options.targetDatabaseUrl)
  const backupDirectory = resolve(options.backupDirectory)
  const manifest = await readVerifiedManifest(backupDirectory)
  const dumpPath = resolve(backupDirectory, manifest.database.dumpFile)
  await assertFileDigest(
    dumpPath,
    manifest.database.dumpByteSize,
    manifest.database.dumpSha256,
  )
  for (const object of manifest.objects) {
    if (object.storageProvider !== options.targetStorage.provider) {
      throw new Error(
        `Backup intent ${object.id} requires provider ${object.storageProvider}; target provider is ${options.targetStorage.provider}.`,
      )
    }
  }

  const { pool } = createDatabase(options.targetDatabaseUrl, {
    applicationName: 'ctrorec-restore-drill',
    maxConnections: 1,
  })
  try {
    const existingTables = await pool.query<{ count: number }>(`
      SELECT count(*)::int AS count
      FROM pg_catalog.pg_class relation
      JOIN pg_catalog.pg_namespace namespace
        ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname NOT IN ('pg_catalog', 'information_schema')
        AND namespace.nspname NOT LIKE 'pg_toast%'
        AND namespace.nspname NOT LIKE 'pg_temp%'
        AND relation.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
    `)
    if (requiredRow(existingTables.rows, 'target table check').count !== 0) {
      throw new Error('The restore target database must be empty.')
    }

    // Detect bundle corruption before creating any target database objects.
    await mapBounded(manifest.objects, async (object) => {
      await assertFileDigest(
        backupObjectPath(backupDirectory, object.id),
        object.byteSize,
        object.sha256,
      )
    })
    await runPostgresTool(
      options.pgRestorePath ?? 'pg_restore',
      [
        '--format=custom',
        '--single-transaction',
        '--exit-on-error',
        '--no-owner',
        '--no-privileges',
        `--dbname=${databaseNameFromUrl(options.targetDatabaseUrl)}`,
        dumpPath,
      ],
      postgresToolEnvironment(options.targetDatabaseUrl, 'ctrorec-pg-restore'),
    )

    const restoredMedia = await pool.query<MediaRow>(MEDIA_QUERY)
    assertSameMedia(manifest.objects, restoredMedia.rows.map(mapMediaRow))
    const restoredMigrations = await pool.query<{ hash: string }>(
      MIGRATIONS_QUERY,
    )
    if (
      restoredMigrations.rows.length !== manifest.database.migrationCount ||
      migrationDigest(restoredMigrations.rows.map((row) => row.hash)) !==
        manifest.database.migrationsSha256
    ) {
      throw new Error(
        'The restored migration journal does not match the backup.',
      )
    }

    const restoredUploads = await pool.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM lecture_audio_uploads',
    )
    if (
      requiredRow(restoredUploads.rows, 'upload exclusion check').count !== 0
    ) {
      throw new Error(
        'Transient upload-session data was restored unexpectedly.',
      )
    }

    await assertRestoredReferences(pool, manifest.objects)
    await mapBounded(manifest.objects, async (object) => {
      await options.targetStorage.save(
        object.storageKey,
        backupObjectPath(backupDirectory, object.id),
      )
      await verifyStoredObject(options.targetStorage, object)
    })

    return {
      backupId: manifest.backupId,
      mediaObjects: manifest.objects.length,
      mediaBytes: totalBytes(manifest.objects),
    }
  } finally {
    await pool.end()
  }
}

async function copyStorageObject(
  storage: AudioStorage,
  object: BackupMediaObject,
  destination: string,
): Promise<void> {
  const source = await storage.open(object.storageKey, object.byteSize)
  const hash = createHash('sha256')
  let byteSize = 0
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      const bytes = Buffer.from(chunk)
      byteSize += bytes.length
      hash.update(bytes)
      callback(null, bytes)
    },
  })
  await pipeline(
    source,
    meter,
    createWriteStream(destination, { flags: 'wx', mode: 0o600 }),
  )
  if (byteSize !== object.byteSize || hash.digest('hex') !== object.sha256) {
    throw new Error(`Stored media does not match intent ${object.id}.`)
  }
}

async function verifyStoredObject(
  storage: AudioStorage,
  object: BackupMediaObject,
): Promise<void> {
  const source = await storage.open(object.storageKey, object.byteSize)
  const hash = createHash('sha256')
  let byteSize = 0
  for await (const chunk of source) {
    const bytes = Buffer.from(chunk as Buffer)
    byteSize += bytes.length
    hash.update(bytes)
  }
  if (byteSize !== object.byteSize || hash.digest('hex') !== object.sha256) {
    throw new Error(`Restored media does not match intent ${object.id}.`)
  }
}

function mapMediaRow(row: MediaRow): BackupMediaObject {
  const byteSize = Number(row.byte_size)
  if (!Number.isSafeInteger(byteSize) || byteSize <= 0) {
    throw new Error(`Media intent ${row.id} has an invalid byte size.`)
  }
  return {
    id: row.id,
    institutionId: row.institution_id,
    lectureId: row.lecture_id,
    kind: row.kind,
    storageProvider: row.storage_provider,
    storageKey: row.storage_key,
    byteSize,
    sha256: row.sha256,
  }
}

function assertSameMedia(
  expected: readonly BackupMediaObject[],
  actual: readonly BackupMediaObject[],
): void {
  const normalize = (objects: readonly BackupMediaObject[]) =>
    objects
      .map((object) => [
        object.id,
        object.institutionId,
        object.lectureId,
        object.kind,
        object.storageProvider,
        object.storageKey,
        object.byteSize,
        object.sha256,
      ])
      .sort((left, right) => String(left[0]).localeCompare(String(right[0])))
  if (
    JSON.stringify(normalize(expected)) !== JSON.stringify(normalize(actual))
  ) {
    throw new Error(
      'The restored attached-media ledger does not match the backup.',
    )
  }
}

async function assertRestoredReferences(
  pool: ReturnType<typeof createDatabase>['pool'],
  objects: readonly BackupMediaObject[],
): Promise<void> {
  const expectedOriginals = objects.filter(
    (object) => object.kind === 'original',
  ).length
  const expectedDerivatives = objects.length - expectedOriginals
  const counts = await pool.query<{
    originals: number
    derivatives: number
  }>(`
    SELECT
      (SELECT count(*)::int FROM lecture_audio) AS originals,
      (SELECT count(*)::int FROM lecture_audio_derivatives WHERE status = 'ready') AS derivatives
  `)
  const count = requiredRow(counts.rows, 'restored media counts')
  if (
    count.originals !== expectedOriginals ||
    count.derivatives !== expectedDerivatives
  ) {
    throw new Error('Restored media reference counts do not match the backup.')
  }

  const missing = await pool.query<{ key: string }>(`
    SELECT reference.storage_key AS key FROM (
      SELECT a.storage_provider, a.storage_key, a.institution_id, a.lecture_id,
        a.byte_size, a.sha256, 'original' AS kind
      FROM lecture_audio a
      UNION ALL
      SELECT d.storage_provider, d.storage_key, d.institution_id, d.lecture_id,
        d.byte_size, d.sha256, 'data_saver' AS kind
      FROM lecture_audio_derivatives d WHERE d.status = 'ready'
    ) reference
    LEFT JOIN media_object_intents intent
      ON intent.storage_provider = reference.storage_provider
      AND intent.storage_key = reference.storage_key
      AND intent.institution_id = reference.institution_id
      AND intent.lecture_id = reference.lecture_id
      AND intent.byte_size = reference.byte_size
      AND intent.sha256 = reference.sha256
      AND intent.kind = reference.kind
      AND intent.status = 'attached'
    WHERE intent.id IS NULL
    LIMIT 1
  `)
  if (missing.rows.length > 0) {
    throw new Error(
      'A restored media reference has no matching attached intent.',
    )
  }
}

function migrationDigest(hashes: readonly string[]): string {
  const digest = createHash('sha256')
  for (const hash of hashes) {
    digest.update(`${hash}\n`)
  }
  return digest.digest('hex')
}

function totalBytes(objects: readonly BackupMediaObject[]): number {
  return objects.reduce((total, object) => total + object.byteSize, 0)
}

function requiredRow<T>(rows: readonly T[], description: string): T {
  const row = rows[0]
  if (!row) {
    throw new Error(`PostgreSQL returned no ${description}.`)
  }
  return row
}

async function mapBounded<T>(
  items: readonly T[],
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0
  const outcomes = await Promise.allSettled(
    Array.from(
      { length: Math.min(COPY_CONCURRENCY, items.length) },
      async () => {
        while (next < items.length) {
          const index = next
          next += 1
          const item = items[index]
          if (item !== undefined) {
            await worker(item)
          }
        }
      },
    ),
  )
  const failure = outcomes.find((outcome) => outcome.status === 'rejected')
  if (failure?.status === 'rejected') {
    throw failure.reason
  }
}
