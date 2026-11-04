import { createHash } from 'node:crypto'
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  attachMediaObjectIntent,
  createDatabase,
  seedDevelopment,
  type Database,
  type DatabasePool,
  type MediaObjectIntent,
} from '@ctrorec/database'
import {
  lectureAudio,
  lectureAudioDerivatives,
  lectureAudioUploads,
  lectures,
  mediaObjectIntents,
  memberships,
} from '@ctrorec/database/schema'
import { LocalAudioStorage, type AudioStorage } from '@ctrorec/media'
import { sql } from 'drizzle-orm'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest'
import {
  createMediaBackup,
  restoreMediaBackup,
} from '../src/backup/media-backup.js'
import { DataSaverRepository } from '../src/media/data-saver.repository.js'
import { requireTestDatabaseUrl, resetDatabase } from './test-database.js'

const TARGET_DATABASE = 'ctrorec_backup_restore_test'

let db: Database
let pool: DatabasePool
let adminPool: DatabasePool
let repository: DataSaverRepository
let storage: LocalAudioStorage
let directory: string
let backupRoot: string
let targetRoot: string
let lecture: typeof lectures.$inferSelect
let membership: typeof memberships.$inferSelect

beforeAll(() => {
  adminPool = createDatabase(adminDatabaseUrl(), {
    applicationName: 'ctrorec-backup-test-admin',
    maxConnections: 1,
  }).pool
})

beforeEach(async () => {
  if (!db) {
    ;({ db, pool } = createDatabase(requireTestDatabaseUrl(), {
      applicationName: 'ctrorec-backup-tests',
      maxConnections: 4,
    }))
  }
  await resetDatabase(db)
  await seedDevelopment(db)
  lecture = exactlyOne(await db.select().from(lectures).limit(1))
  membership = exactlyOne(await db.select().from(memberships).limit(1))
  directory = await mkdtemp(join(tmpdir(), 'ctrorec-media-backup-'))
  backupRoot = join(directory, 'backups')
  targetRoot = join(directory, 'restored-audio')
  storage = new LocalAudioStorage(join(directory, 'source-audio'))
  repository = new DataSaverRepository(db)
  await recreateTargetDatabase()
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
  await adminPool.query(`DROP DATABASE IF EXISTS ${TARGET_DATABASE}`)
})

afterAll(async () => {
  await pool?.end()
  await adminPool.end()
})

describe('snapshot-consistent media backup and guarded restore', () => {
  it('keeps concurrent commits out of both dump and manifest and restores exact media', async () => {
    const original = await createOriginal(lecture.id, 'original teaching bytes')
    const derivative = await createDerivative(
      lecture.id,
      original,
      'data-saver bytes',
    )
    const interruptedLecture = exactlyOne(
      await db
        .insert(lectures)
        .values({
          institutionId: lecture.institutionId,
          courseOfferingId: lecture.courseOfferingId,
          createdByMembershipId: membership.id,
          title: 'Interrupted upload before the backup snapshot',
          occurredAt: new Date('2026-11-04T11:00:00.000Z'),
        })
        .returning(),
    )
    await db.insert(lectureAudioUploads).values({
      lectureId: interruptedLecture.id,
      institutionId: interruptedLecture.institutionId,
      createdByMembershipId: membership.id,
      originalFileName: 'interrupted.wav',
      byteSize: 32_768,
      receivedBytes: 16_384,
      sha256: digest('incomplete staged upload'),
      chunkSize: 16_384,
      expiresAt: new Date('2026-11-05T12:00:00.000Z'),
    })
    await db.execute(sql`CREATE SCHEMA IF NOT EXISTS pgboss`)
    await db.execute(
      sql`CREATE TABLE IF NOT EXISTS pgboss.backup_probe (id integer)`,
    )

    const opened = deferred()
    const release = deferred()
    let paused = false
    const pausingStorage: AudioStorage = {
      provider: storage.provider,
      save: (key, path) => storage.save(key, path),
      verify: (key, size) => storage.verify(key, size),
      open: async (key, size, start, end) => {
        const stream = await storage.open(key, size, start, end)
        if (!paused) {
          paused = true
          opened.resolve()
          await release.promise
        }
        return stream
      },
      delete: (key) => storage.delete(key),
    }
    const backupPromise = createMediaBackup({
      sourceDatabaseUrl: requireTestDatabaseUrl(),
      storage: pausingStorage,
      backupRoot,
    })
    await opened.promise

    const concurrentLecture = exactlyOne(
      await db
        .insert(lectures)
        .values({
          institutionId: lecture.institutionId,
          courseOfferingId: lecture.courseOfferingId,
          createdByMembershipId: membership.id,
          title: 'Committed after the backup snapshot',
          occurredAt: new Date('2026-11-04T12:00:00.000Z'),
        })
        .returning(),
    )
    const concurrent = await createOriginal(
      concurrentLecture.id,
      'must not be in this backup',
    )
    release.resolve()
    const backup = await backupPromise

    expect(backup.mediaObjects).toBe(2)
    expect(backup.manifest.objects.map((object) => object.id)).not.toContain(
      concurrent.id,
    )
    const restore = await restoreMediaBackup({
      backupDirectory: backup.directory,
      targetDatabaseUrl: targetDatabaseUrl(),
      targetStorage: new LocalAudioStorage(targetRoot),
    })
    expect(restore).toEqual({
      backupId: backup.backupId,
      mediaObjects: 2,
      mediaBytes: original.byteSize + derivative.byteSize,
    })

    const target = createDatabase(targetDatabaseUrl(), {
      applicationName: 'ctrorec-backup-test-assertions',
      maxConnections: 1,
    })
    try {
      expect(await target.db.select().from(lectures)).toHaveLength(2)
      expect(await target.db.select().from(lectureAudioUploads)).toHaveLength(0)
      expect(await target.db.select().from(lectureAudio)).toHaveLength(1)
      expect(await target.db.select().from(mediaObjectIntents)).toHaveLength(2)
      expect(
        await target.db.select().from(lectureAudioDerivatives),
      ).toHaveLength(1)
      const queueProbe = await target.db.execute<{ present: string | null }>(
        sql`SELECT to_regclass('pgboss.backup_probe')::text AS present`,
      )
      expect(queueProbe.rows[0]?.present).toBeNull()
    } finally {
      await target.pool.end()
    }
    await expect(
      readFile(join(targetRoot, original.storageKey), 'utf8'),
    ).resolves.toBe('original teaching bytes')
    await expect(
      readFile(join(targetRoot, derivative.storageKey), 'utf8'),
    ).resolves.toBe('data-saver bytes')
    await expect(
      stat(join(targetRoot, concurrent.storageKey)),
    ).rejects.toMatchObject({ code: 'ENOENT' })

    await expect(
      restoreMediaBackup({
        backupDirectory: backup.directory,
        targetDatabaseUrl: targetDatabaseUrl(),
        targetStorage: new LocalAudioStorage(targetRoot),
      }),
    ).rejects.toThrow('The restore target database must be empty.')
  })

  it('rejects a corrupted backup object before restoring the database', async () => {
    const original = await createOriginal(lecture.id, 'uncorrupted original')
    const backup = await createMediaBackup({
      sourceDatabaseUrl: requireTestDatabaseUrl(),
      storage,
      backupRoot,
    })
    await writeFile(
      join(backup.directory, 'objects', original.id),
      'corrupted backup bytes',
    )

    await expect(
      restoreMediaBackup({
        backupDirectory: backup.directory,
        targetDatabaseUrl: targetDatabaseUrl(),
        targetStorage: new LocalAudioStorage(targetRoot),
      }),
    ).rejects.toThrow('unexpected')

    const target = createDatabase(targetDatabaseUrl(), {
      applicationName: 'ctrorec-backup-corruption-check',
      maxConnections: 1,
    })
    try {
      const tables = await target.db.execute<{ count: number }>(sql`
        SELECT count(*)::int AS count FROM pg_catalog.pg_tables
        WHERE schemaname IN ('public', 'drizzle', 'pgboss')
      `)
      expect(tables.rows[0]?.count).toBe(0)
    } finally {
      await target.pool.end()
    }
    await expect(stat(targetRoot)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('refuses a target containing relations outside the application schemas', async () => {
    const backup = await createMediaBackup({
      sourceDatabaseUrl: requireTestDatabaseUrl(),
      storage,
      backupRoot,
    })
    const target = createDatabase(targetDatabaseUrl(), {
      applicationName: 'ctrorec-backup-nonempty-check',
      maxConnections: 1,
    })
    try {
      await target.db.execute(sql`CREATE SCHEMA unexpected`)
      await target.db.execute(
        sql`CREATE TABLE unexpected.existing_relation (id integer)`,
      )
    } finally {
      await target.pool.end()
    }

    await expect(
      restoreMediaBackup({
        backupDirectory: backup.directory,
        targetDatabaseUrl: targetDatabaseUrl(),
        targetStorage: new LocalAudioStorage(targetRoot),
      }),
    ).rejects.toThrow('The restore target database must be empty.')
    await expect(stat(targetRoot)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('never publishes a complete backup after a media read failure', async () => {
    await createOriginal(lecture.id, 'unreadable source')
    const failingStorage: AudioStorage = {
      provider: storage.provider,
      save: (key, path) => storage.save(key, path),
      verify: (key, size) => storage.verify(key, size),
      open: async () => {
        throw new Error('Source media became unavailable')
      },
      delete: (key) => storage.delete(key),
    }

    await expect(
      createMediaBackup({
        sourceDatabaseUrl: requireTestDatabaseUrl(),
        storage: failingStorage,
        backupRoot,
      }),
    ).rejects.toThrow('Source media became unavailable')
    expect(await readdir(backupRoot)).toEqual([])
  })
})

async function createOriginal(
  lectureId: string,
  contents: string,
): Promise<MediaObjectIntent> {
  const id = await repository.newMediaObjectIntentId()
  const sha256 = digest(contents)
  const intent = await repository.createMediaObjectIntent({
    id,
    institutionId: lecture.institutionId,
    lectureId,
    kind: 'original',
    storageProvider: storage.provider,
    storageKey: `${lecture.institutionId}/${lectureId}/${id}.wav`,
    byteSize: Buffer.byteLength(contents),
    sha256,
  })
  await writeFixture(intent.id, contents)
  await storage.save(intent.storageKey, fixturePath(intent.id))
  await db.transaction(async (transaction) => {
    await transaction.insert(lectureAudio).values({
      lectureId,
      institutionId: lecture.institutionId,
      uploadedByMembershipId: membership.id,
      storageProvider: intent.storageProvider,
      storageKey: intent.storageKey,
      originalFileName: 'original.wav',
      mediaType: 'audio/wav',
      byteSize: intent.byteSize,
      sha256,
    })
    await attachMediaObjectIntent(transaction, intent.id, {
      kind: 'original',
      storageProvider: intent.storageProvider,
      storageKey: intent.storageKey,
      byteSize: intent.byteSize,
      sha256,
    })
  })
  return intent
}

async function createDerivative(
  lectureId: string,
  original: MediaObjectIntent,
  contents: string,
): Promise<MediaObjectIntent> {
  const id = await repository.newMediaObjectIntentId()
  const sha256 = digest(contents)
  const intent = await repository.createMediaObjectIntent({
    id,
    institutionId: lecture.institutionId,
    lectureId,
    kind: 'data_saver',
    storageProvider: storage.provider,
    storageKey: `${lecture.institutionId}/${lectureId}/${id}.m4a`,
    byteSize: Buffer.byteLength(contents),
    sha256,
  })
  await writeFixture(intent.id, contents)
  await storage.save(intent.storageKey, fixturePath(intent.id))
  await db.transaction(async (transaction) => {
    await transaction.insert(lectureAudioDerivatives).values({
      lectureId,
      institutionId: lecture.institutionId,
      sourceSha256: original.sha256,
      status: 'ready',
      storageProvider: intent.storageProvider,
      storageKey: intent.storageKey,
      mediaType: 'audio/mp4',
      byteSize: intent.byteSize,
      sha256,
      completedAt: new Date(),
    })
    await attachMediaObjectIntent(transaction, intent.id, {
      kind: 'data_saver',
      storageProvider: intent.storageProvider,
      storageKey: intent.storageKey,
      byteSize: intent.byteSize,
      sha256,
    })
  })
  return intent
}

async function writeFixture(id: string, contents: string): Promise<void> {
  await writeFile(fixturePath(id), contents, { flag: 'wx' })
}

function fixturePath(id: string): string {
  return join(directory, `${id}.fixture`)
}

function digest(contents: string): string {
  return createHash('sha256').update(contents).digest('hex')
}

async function recreateTargetDatabase(): Promise<void> {
  await adminPool.query(`DROP DATABASE IF EXISTS ${TARGET_DATABASE}`)
  await adminPool.query(`CREATE DATABASE ${TARGET_DATABASE}`)
}

function targetDatabaseUrl(): string {
  const url = new URL(requireTestDatabaseUrl())
  url.pathname = `/${TARGET_DATABASE}`
  return url.toString()
}

function adminDatabaseUrl(): string {
  const url = new URL(requireTestDatabaseUrl())
  url.pathname = '/postgres'
  return url.toString()
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((accept) => {
    resolve = accept
  })
  return { promise, resolve }
}

function exactlyOne<T>(rows: T[]): T {
  if (rows.length !== 1 || rows[0] === undefined) {
    throw new Error(`Expected exactly one row, received ${rows.length}.`)
  }
  return rows[0]
}
