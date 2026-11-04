import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  attachMediaObjectIntent,
  createDatabase,
  MediaObjectStateChangedError,
  requestLectureMediaDeletion,
  seedDevelopment,
  type Database,
  type DatabasePool,
  type MediaObjectIntent,
} from '@ctrorec/database'
import {
  lectureAudio,
  lectureAudioDerivatives,
  lectureMediaDeletions,
  lectures,
  mediaObjectIntents,
  memberships,
} from '@ctrorec/database/schema'
import { LocalAudioStorage, type AudioStorage } from '@ctrorec/media'
import type { ConfigService } from '@nestjs/config'
import { eq, sql } from 'drizzle-orm'
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { DataSaverRepository } from '../src/media/data-saver.repository.js'
import { MediaReconciliationService } from '../src/media/media-reconciliation.service.js'
import { requireTestDatabaseUrl, resetDatabase } from './test-database.js'

let db: Database
let pool: DatabasePool
let repository: DataSaverRepository
let service: MediaReconciliationService
let storage: LocalAudioStorage
let directory: string
let audioRoot: string
let sourcePath: string
let lecture: typeof lectures.$inferSelect
let membership: typeof memberships.$inferSelect

beforeEach(async () => {
  if (!db) {
    ;({ db, pool } = createDatabase(requireTestDatabaseUrl(), {
      applicationName: 'ctrorec-media-reconciliation-tests',
      maxConnections: 4,
    }))
  }
  await resetDatabase(db)
  await seedDevelopment(db)
  lecture = exactlyOne(await db.select().from(lectures).limit(1))
  membership = exactlyOne(await db.select().from(memberships).limit(1))
  directory = await mkdtemp(join(tmpdir(), 'ctrorec-media-reconciliation-'))
  audioRoot = join(directory, 'audio')
  sourcePath = join(directory, 'source.wav')
  storage = new LocalAudioStorage(audioRoot)
  repository = new DataSaverRepository(db)
  service = createService(repository, storage)
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

afterAll(async () => {
  await pool?.end()
})

describe('media lifecycle reconciliation', () => {
  it('deletes an unreferenced crash-left object and its partial local write', async () => {
    const intent = await createPendingOriginal('orphaned original')
    const idVersion = await db.execute<{ version: number }>(
      sql`SELECT uuid_extract_version(${intent.id}::uuid) AS version`,
    )
    expect(idVersion.rows[0]?.version).toBe(7)
    const destination = join(audioRoot, intent.storageKey)
    await writeFile(`${destination}.upload`, 'partial local write')

    expect(await service.reconcile()).toMatchObject({
      claimed: 0,
      deleted: 0,
      failures: 0,
    })
    await expect(
      readFile(join(audioRoot, intent.storageKey), 'utf8'),
    ).resolves.toBe('orphaned original')

    const result = await service.reconcile(inGracePeriod())

    expect(result).toMatchObject({ claimed: 1, deleted: 1, failures: 0 })
    expect(await findIntent(intent.id)).toMatchObject({
      status: 'deleted',
      reconciliationAttempts: 1,
    })
    await expect(stat(destination)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(stat(`${destination}.upload`)).rejects.toMatchObject({
      code: 'ENOENT',
    })
    expect(await service.reconcile(inGracePeriod())).toMatchObject({
      claimed: 0,
      deleted: 0,
      failures: 0,
    })
  })

  it('preserves a referenced object and repairs its intent to attached', async () => {
    const intent = await createPendingOriginal('referenced original')
    await insertOriginalReference(intent)

    const result = await service.reconcile(inGracePeriod())

    expect(result).toMatchObject({ claimed: 1, attached: 1, deleted: 0 })
    expect(await findIntent(intent.id)).toMatchObject({ status: 'attached' })
    await expect(
      readFile(join(audioRoot, intent.storageKey), 'utf8'),
    ).resolves.toBe('referenced original')
  })

  it('does not delete through a differently configured storage provider', async () => {
    const intent = await createPendingOriginal('provider-specific original')
    await db
      .update(mediaObjectIntents)
      .set({ storageProvider: 'cloudinary' })
      .where(eq(mediaObjectIntents.id, intent.id))

    const result = await service.reconcile(inGracePeriod())

    expect(result).toMatchObject({
      claimed: 0,
      skippedProviders: 1,
      failures: 0,
    })
    expect(await findIntent(intent.id)).toMatchObject({ status: 'pending' })
    await expect(
      readFile(join(audioRoot, intent.storageKey), 'utf8'),
    ).resolves.toBe('provider-specific original')
  })

  it('keeps a failed delete in deleting and retries it idempotently', async () => {
    const intent = await createPendingOriginal('retry original')
    const deleteObject = vi
      .fn<AudioStorage['delete']>()
      .mockRejectedValueOnce(new Error('Storage temporarily unavailable'))
      .mockImplementation((key) => storage.delete(key))
    const flakyStorage: AudioStorage = {
      provider: storage.provider,
      save: (key, path) => storage.save(key, path),
      verify: (key, size) => storage.verify(key, size),
      open: (key, size, start, end) => storage.open(key, size, start, end),
      delete: deleteObject,
    }
    service = createService(repository, flakyStorage)

    expect(await service.reconcile(inGracePeriod())).toMatchObject({
      claimed: 1,
      deleted: 0,
      failures: 1,
    })
    expect(await findIntent(intent.id)).toMatchObject({ status: 'deleting' })
    await expect(
      readFile(join(audioRoot, intent.storageKey), 'utf8'),
    ).resolves.toBe('retry original')

    expect(
      await service.reconcile(new Date(Date.now() + 601_000)),
    ).toMatchObject({ claimed: 1, deleted: 1, failures: 0 })
    expect(await findIntent(intent.id)).toMatchObject({
      status: 'deleted',
      reconciliationAttempts: 2,
    })
    expect(deleteObject).toHaveBeenCalledTimes(2)
  })

  it('rolls back a competing reference commit when reconciliation claims first', async () => {
    const intent = await createPendingOriginal('racing original')
    const inserted = deferred()
    const release = deferred()
    const completion = db.transaction(async (transaction) => {
      await transaction.insert(lectureAudio).values(originalReference(intent))
      inserted.resolve()
      await release.promise
      await attachMediaObjectIntent(transaction, intent.id, {
        kind: 'original',
        storageProvider: intent.storageProvider,
        storageKey: intent.storageKey,
        byteSize: intent.byteSize,
        sha256: intent.sha256,
      })
    })
    await inserted.promise

    let result
    try {
      result = await service.reconcile(inGracePeriod())
    } finally {
      release.resolve()
    }

    expect(result).toMatchObject({ claimed: 1, deleted: 1, failures: 0 })
    await expect(completion).rejects.toBeInstanceOf(
      MediaObjectStateChangedError,
    )
    expect(
      await db
        .select({ lectureId: lectureAudio.lectureId })
        .from(lectureAudio)
        .where(eq(lectureAudio.storageKey, intent.storageKey)),
    ).toHaveLength(0)
    expect(await findIntent(intent.id)).toMatchObject({ status: 'deleted' })
    await expect(
      stat(join(audioRoot, intent.storageKey)),
    ).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('does not resurrect a derivative when ready attachment races intentional deletion', async () => {
    const original = await createPendingOriginal('deletion race original')
    await insertOriginalReference(original)
    await attachMediaObjectIntent(db, original.id, {
      kind: 'original',
      storageProvider: original.storageProvider,
      storageKey: original.storageKey,
      byteSize: original.byteSize,
      sha256: original.sha256,
    })
    const processingStartedAt = new Date()
    const derivativeRow = exactlyOne(
      await db
        .insert(lectureAudioDerivatives)
        .values({
          lectureId: lecture.id,
          institutionId: lecture.institutionId,
          status: 'processing',
          sourceSha256: original.sha256,
          processingStartedAt,
          attempts: 1,
        })
        .returning(),
    )
    const derivativeId = await repository.newMediaObjectIntentId()
    const derivative = await repository.createMediaObjectIntent({
      id: derivativeId,
      institutionId: lecture.institutionId,
      lectureId: lecture.id,
      kind: 'data_saver',
      storageProvider: storage.provider,
      storageKey: `${lecture.institutionId}/${lecture.id}/${derivativeId}.m4a`,
      byteSize: Buffer.byteLength('deletion race derivative'),
      sha256: 'd'.repeat(64),
    })
    await writeFile(sourcePath, 'deletion race derivative')
    await storage.save(derivative.storageKey, sourcePath)
    service = createService(repository, storage)

    const [markedReady, requested] = await Promise.all([
      repository.markReady(
        derivativeRow.id,
        processingStartedAt,
        {
          storageProvider: derivative.storageProvider,
          storageKey: derivative.storageKey,
          byteSize: derivative.byteSize,
          sha256: derivative.sha256,
        },
        derivative.id,
      ),
      requestLectureMediaDeletion(db, {
        institutionId: lecture.institutionId,
        lectureId: lecture.id,
        requestedByMembershipId: membership.id,
        reason: 'Deletion racing derivative attachment',
      }),
    ])
    expect(typeof markedReady).toBe('boolean')
    expect(requested.created).toBe(true)
    expect(
      await db
        .select({ id: lectureAudioDerivatives.id })
        .from(lectureAudioDerivatives)
        .where(eq(lectureAudioDerivatives.lectureId, lecture.id)),
    ).toHaveLength(0)
    const linked = await db
      .select()
      .from(mediaObjectIntents)
      .where(eq(mediaObjectIntents.deletionRequestId, requested.deletion.id))
    expect(linked).toHaveLength(2)
    expect(linked.every((intent) => intent.status === 'deleting')).toBe(true)
    expect((await findIntent(derivative.id)).attachedAt !== null).toBe(
      markedReady,
    )

    expect(await service.reconcile(new Date())).toMatchObject({
      claimed: 2,
      deleted: 2,
      attached: 0,
      failures: 0,
    })
    expect(
      (await findDeletion(requested.deletion.id)).completedAt,
    ).toBeInstanceOf(Date)
    for (const intent of [original, derivative]) {
      expect((await findIntent(intent.id)).status).toBe('deleted')
      await expect(
        stat(join(audioRoot, intent.storageKey)),
      ).rejects.toMatchObject({ code: 'ENOENT' })
    }
  })

  it('reconciles intentional original and derivative deletion before completing it', async () => {
    const original = await createPendingOriginal('intentional original')
    await insertOriginalReference(original)
    await attachMediaObjectIntent(db, original.id, {
      kind: 'original',
      storageProvider: original.storageProvider,
      storageKey: original.storageKey,
      byteSize: original.byteSize,
      sha256: original.sha256,
    })
    const derivativeId = await repository.newMediaObjectIntentId()
    const derivative = await repository.createMediaObjectIntent({
      id: derivativeId,
      institutionId: lecture.institutionId,
      lectureId: lecture.id,
      kind: 'data_saver',
      storageProvider: storage.provider,
      storageKey: `${lecture.institutionId}/${lecture.id}/${derivativeId}.m4a`,
      byteSize: Buffer.byteLength('intentional derivative'),
      sha256: 'b'.repeat(64),
    })
    await writeFile(sourcePath, 'intentional derivative')
    await storage.save(derivative.storageKey, sourcePath)
    await db.insert(lectureAudioDerivatives).values({
      lectureId: lecture.id,
      institutionId: lecture.institutionId,
      status: 'ready',
      sourceSha256: original.sha256,
      storageProvider: derivative.storageProvider,
      storageKey: derivative.storageKey,
      byteSize: derivative.byteSize,
      sha256: derivative.sha256,
      completedAt: new Date(),
    })
    await attachMediaObjectIntent(db, derivative.id, {
      kind: 'data_saver',
      storageProvider: derivative.storageProvider,
      storageKey: derivative.storageKey,
      byteSize: derivative.byteSize,
      sha256: derivative.sha256,
    })

    const requested = await requestLectureMediaDeletion(db, {
      institutionId: lecture.institutionId,
      lectureId: lecture.id,
      requestedByMembershipId: membership.id,
      reason: 'Institution-approved test deletion',
    })
    expect(requested.created).toBe(true)
    expect(requested.deletion.completedAt).toBeNull()
    expect(
      await db
        .select({ lectureId: lectureAudio.lectureId })
        .from(lectureAudio)
        .where(eq(lectureAudio.lectureId, lecture.id)),
    ).toHaveLength(0)
    expect(
      await db
        .select({ id: lectureAudioDerivatives.id })
        .from(lectureAudioDerivatives)
        .where(eq(lectureAudioDerivatives.lectureId, lecture.id)),
    ).toHaveLength(0)
    const linked = await db
      .select()
      .from(mediaObjectIntents)
      .where(eq(mediaObjectIntents.deletionRequestId, requested.deletion.id))
    expect(linked).toHaveLength(2)
    expect(linked.every((intent) => intent.status === 'deleting')).toBe(true)
    expect(linked.every((intent) => intent.attachedAt !== null)).toBe(true)

    const deleteObject = vi
      .fn<AudioStorage['delete']>()
      .mockRejectedValueOnce(new Error('Intentional delete needs retry'))
      .mockImplementation((key) => storage.delete(key))
    service = createService(repository, {
      provider: storage.provider,
      save: (key, path) => storage.save(key, path),
      verify: (key, size) => storage.verify(key, size),
      open: (key, size, start, end) => storage.open(key, size, start, end),
      delete: deleteObject,
    })

    expect(await service.reconcile(new Date())).toMatchObject({
      claimed: 2,
      deleted: 1,
      failures: 1,
    })
    expect(await findDeletion(requested.deletion.id)).toMatchObject({
      completedAt: null,
    })
    expect(await service.reconcile(new Date())).toMatchObject({
      claimed: 1,
      deleted: 1,
      failures: 0,
    })
    const completed = await findDeletion(requested.deletion.id)
    expect(completed.completedAt).toBeInstanceOf(Date)
    for (const intent of [original, derivative]) {
      expect(await findIntent(intent.id)).toMatchObject({
        status: 'deleted',
        deletionRequestId: requested.deletion.id,
      })
      expect((await findIntent(intent.id)).attachedAt).toBeInstanceOf(Date)
      await expect(
        stat(join(audioRoot, intent.storageKey)),
      ).rejects.toMatchObject({ code: 'ENOENT' })
    }

    const blockedId = await repository.newMediaObjectIntentId()
    await expect(
      repository.createMediaObjectIntent({
        id: blockedId,
        institutionId: lecture.institutionId,
        lectureId: lecture.id,
        kind: 'original',
        storageProvider: storage.provider,
        storageKey: `${lecture.institutionId}/${lecture.id}/${blockedId}.wav`,
        byteSize: 10,
        sha256: 'c'.repeat(64),
      }),
    ).rejects.toMatchObject({ code: 'media-deleted' })
  })
})

async function createPendingOriginal(
  contents: string,
): Promise<MediaObjectIntent> {
  const id = await repository.newMediaObjectIntentId()
  const intent = await repository.createMediaObjectIntent({
    id,
    institutionId: lecture.institutionId,
    lectureId: lecture.id,
    kind: 'original',
    storageProvider: storage.provider,
    storageKey: `${lecture.institutionId}/${lecture.id}/${id}.wav`,
    byteSize: Buffer.byteLength(contents),
    sha256: 'a'.repeat(64),
  })
  await writeFile(sourcePath, contents)
  await storage.save(intent.storageKey, sourcePath)
  return intent
}

function originalReference(
  intent: MediaObjectIntent,
): typeof lectureAudio.$inferInsert {
  return {
    lectureId: lecture.id,
    institutionId: lecture.institutionId,
    uploadedByMembershipId: membership.id,
    storageProvider: intent.storageProvider,
    storageKey: intent.storageKey,
    originalFileName: 'original.wav',
    mediaType: 'audio/wav',
    byteSize: intent.byteSize,
    sha256: intent.sha256,
  }
}

async function insertOriginalReference(
  intent: MediaObjectIntent,
): Promise<void> {
  await db.insert(lectureAudio).values(originalReference(intent))
}

async function findDeletion(
  id: string,
): Promise<typeof lectureMediaDeletions.$inferSelect> {
  return exactlyOne(
    await db
      .select()
      .from(lectureMediaDeletions)
      .where(eq(lectureMediaDeletions.id, id))
      .limit(1),
  )
}

async function findIntent(id: string): Promise<MediaObjectIntent> {
  return exactlyOne(
    await db
      .select()
      .from(mediaObjectIntents)
      .where(eq(mediaObjectIntents.id, id))
      .limit(1),
  )
}

function createService(
  mediaRepository: DataSaverRepository,
  audioStorage: AudioStorage,
): MediaReconciliationService {
  const configuration: Record<string, boolean | number> = {
    MEDIA_RECONCILIATION_ENABLED: false,
    MEDIA_RECONCILE_INTERVAL_MS: 900_000,
    MEDIA_RECONCILE_GRACE_MS: 300_000,
  }
  return new MediaReconciliationService(mediaRepository, audioStorage, {
    getOrThrow: (key: string) => configuration[key],
  } as unknown as ConfigService)
}

function inGracePeriod(): Date {
  return new Date(Date.now() + 301_000)
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
