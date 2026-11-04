import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import type { Server } from 'node:http'
import { dirname, join } from 'node:path'
import {
  attachMediaObjectIntent,
  createDatabase,
  createMediaObjectIntent,
  newMediaObjectIntentId,
  seedDevelopment,
  type Database,
  type DatabasePool,
  type MediaObjectIntent,
} from '@ctrorec/database'
import {
  institutions,
  lectureAudio,
  lectureAudioCaptures,
  lectureAudioDerivatives,
  lectures,
  mediaObjectIntents,
  membershipRoles,
} from '@ctrorec/database/schema'
import { LocalAudioStorage } from '@ctrorec/media'
import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { and, eq } from 'drizzle-orm'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest'
import { AppModule } from '../src/app.module.js'
import { configureApi } from '../src/configure-api.js'
import { requireTestDatabaseUrl, resetDatabase } from './test-database.js'

const adminCredentials = {
  email: 'lecturer@ctrorec.test',
  password: 'Lecturer-Dev-2026!',
}
const studentCredentials = {
  email: 'student@ctrorec.test',
  password: 'Student-Dev-2026!',
}
const INSTITUTION_ID = '019a1000-0000-7000-8000-000000000001'
const LECTURER_MEMBERSHIP_ID = '019a1000-0000-7000-8000-000000000004'
const OFFERING_ID = '019a1000-0000-7000-8000-000000000009'
const wavPath = new URL('./fixtures/lecture.wav', import.meta.url)
const storageRoot = process.env.AUDIO_STORAGE_ROOT
if (!storageRoot) {
  throw new Error('Integration-test audio storage must be configured.')
}
const temporaryRoot = dirname(storageRoot)
const storage = new LocalAudioStorage(storageRoot)

let db: Database
let pool: DatabasePool
let app: NestExpressApplication
let baseUrl: string

beforeAll(() => {
  ;({ db, pool } = createDatabase(requireTestDatabaseUrl(), {
    applicationName: 'ctrorec-media-retention-http-tests',
    maxConnections: 3,
  }))
})

beforeEach(async () => {
  await rm(temporaryRoot, { recursive: true, force: true })
  await resetDatabase(db)
  await seedDevelopment(db)
  app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: false,
  })
  configureApi(app, { shutdownHooks: false })
  await app.listen(0, '127.0.0.1')
  const server = app.getHttpServer() as Server
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Expected the test API to listen on a TCP port.')
  }
  baseUrl = `http://127.0.0.1:${address.port}`
})

afterEach(async () => {
  await app.close()
  await rm(temporaryRoot, { recursive: true, force: true })
})

afterAll(async () => {
  await rm(temporaryRoot, { recursive: true, force: true })
  await pool.end()
})

describe('institution media retention and intentional deletion', () => {
  it('holds, releases, revokes access, and preserves non-audio evidence', async () => {
    const admin = cookieFrom(await signIn(adminCredentials))
    const student = cookieFrom(await signIn(studentCredentials))
    const fixture = await createMediaFixture()
    const root = `/api/institutions/${INSTITUTION_ID}/admin`
    const deletionPath = `${root}/lectures/${fixture.lecture.id}/media-deletion`

    const initial = await api(
      `${root}/offerings/${OFFERING_ID}/media-retention`,
      { cookie: admin },
    )
    expect(initial.status).toBe(200)
    const initialBody = await json<RetentionList>(initial)
    expect(initialBody.lectures).toHaveLength(1)
    expect(initialBody.lectures[0]?.audio?.sha256).toBe(fixture.original.sha256)
    expect(JSON.stringify(initialBody)).not.toContain('storageKey')
    expect(
      (
        await api(`/api/lectures/${fixture.lecture.id}/audio`, {
          cookie: student,
        })
      ).status,
    ).toBe(200)
    expect(
      (
        await api(deletionPath, {
          method: 'POST',
          cookie: student,
          body: {
            reason: 'Student cannot delete',
            confirmation: 'DELETE MEDIA',
          },
        })
      ).status,
    ).toBe(404)
    expect(
      (
        await api(deletionPath, {
          method: 'POST',
          cookie: admin,
          body: { reason: 'Wrong confirmation', confirmation: 'DELETE' },
        })
      ).status,
    ).toBe(400)

    const hold = await api(
      `${root}/lectures/${fixture.lecture.id}/media-hold`,
      {
        method: 'POST',
        cookie: admin,
        body: { reason: 'Await institutional retention review' },
      },
    )
    expect(hold.status).toBe(201)
    const holdBody = await json<HoldView>(hold)
    expect(holdBody.releasedAt).toBeNull()
    expect(
      (
        await api(`${root}/lectures/${fixture.lecture.id}/media-hold`, {
          method: 'POST',
          cookie: admin,
          body: { reason: 'Duplicate active hold' },
        })
      ).status,
    ).toBe(409)
    expect(
      (
        await api(deletionPath, {
          method: 'POST',
          cookie: admin,
          body: { reason: 'Blocked by hold', confirmation: 'DELETE MEDIA' },
        })
      ).status,
    ).toBe(409)
    expect(
      (
        await api(`/api/lectures/${fixture.lecture.id}/audio`, {
          cookie: student,
        })
      ).status,
    ).toBe(200)

    const released = await api(`${root}/media-holds/${holdBody.id}/release`, {
      method: 'POST',
      cookie: admin,
      body: { reason: 'Retention owner approved deletion' },
    })
    expect(released.status).toBe(200)
    expect((await json<HoldView>(released)).releasedAt).not.toBeNull()
    expect(
      (
        await api(`${root}/media-holds/${holdBody.id}/release`, {
          method: 'POST',
          cookie: admin,
          body: { reason: 'Duplicate release' },
        })
      ).status,
    ).toBe(409)

    const deleted = await api(deletionPath, {
      method: 'POST',
      cookie: admin,
      body: {
        reason: 'Approved removal of the synthetic lecture recording',
        confirmation: 'DELETE MEDIA',
      },
    })
    expect(deleted.status).toBe(200)
    const deletedBody = await json<DeletionResponse>(deleted)
    expect(deletedBody.created).toBe(true)
    expect(deletedBody.deletion.completedAt).toBeNull()
    expect(deletedBody.deletion.originalSha256).toBe(fixture.original.sha256)
    expect(JSON.stringify(deletedBody)).not.toContain('storageKey')

    const repeated = await api(deletionPath, {
      method: 'POST',
      cookie: admin,
      body: {
        reason: 'Retry after a lost response',
        confirmation: 'DELETE MEDIA',
      },
    })
    expect(repeated.status).toBe(200)
    expect(await json<DeletionResponse>(repeated)).toMatchObject({
      created: false,
      deletion: { id: deletedBody.deletion.id },
    })
    expect(
      (
        await api(`/api/lectures/${fixture.lecture.id}/audio`, {
          cookie: student,
        })
      ).status,
    ).toBe(404)
    expect(
      (
        await api(`/api/lectures/${fixture.lecture.id}/audio/uploads`, {
          method: 'POST',
          cookie: admin,
          body: {
            fileName: 'replacement.wav',
            byteSize: 20_000,
            sha256: 'f'.repeat(64),
          },
        })
      ).status,
    ).toBe(409)
    expect(
      (
        await api(`${root}/lectures/${fixture.lecture.id}/media-hold`, {
          method: 'POST',
          cookie: admin,
          body: { reason: 'Cannot hold deleted media' },
        })
      ).status,
    ).toBe(409)

    const lecturesAfter = await api(
      `/api/course-offerings/${OFFERING_ID}/lectures`,
      { cookie: student },
    )
    expect(lecturesAfter.status).toBe(200)
    const lectureList = await json<
      Array<{
        id: string
        audio: unknown
        mediaDeletion: { requestedAt: string; completedAt: string | null }
      }>
    >(lecturesAfter)
    expect(lectureList).toHaveLength(1)
    expect(lectureList).toMatchObject([
      {
        id: fixture.lecture.id,
        audio: null,
        mediaDeletion: {
          requestedAt: deletedBody.deletion.requestedAt,
          completedAt: null,
        },
      },
    ])

    expect(await db.select().from(lectures)).toHaveLength(1)
    expect(await db.select().from(lectureAudio)).toHaveLength(0)
    expect(await db.select().from(lectureAudioDerivatives)).toHaveLength(0)
    expect(await db.select().from(lectureAudioCaptures)).toHaveLength(1)
    const intents = await db.select().from(mediaObjectIntents)
    expect(intents).toHaveLength(2)
    expect(
      intents.every(
        (intent) =>
          intent.status === 'deleting' &&
          intent.deletionRequestId === deletedBody.deletion.id &&
          intent.attachedAt !== null,
      ),
    ).toBe(true)
    expect(
      (await stat(join(storageRoot, fixture.original.storageKey))).isFile(),
    ).toBe(true)

    const csvResponse = await api(`${root}/capture-evidence.csv`, {
      cookie: admin,
    })
    expect(csvResponse.status).toBe(200)
    const records = (await csvResponse.text()).trimEnd().split('\r\n')
    const header = parseCsvRecord(records[0] ?? '')
    const row = parseCsvRecord(records[1] ?? '')
    expect(row[header.indexOf('capture_reference')]).toBe(
      fixture.captureReference,
    )
    expect(row[header.indexOf('original_media_type')]).toBe('')
    expect(row[header.indexOf('original_byte_size')]).toBe('')
    expect(row[header.indexOf('original_sha256')]).toBe('')
    expect(row[header.indexOf('derivative_status')]).toBe('')
    expect(row[header.indexOf('media_deletion_requested_at')]).not.toBe('')
    expect(row[header.indexOf('media_deletion_completed_at')]).toBe('')
  })

  it('requires current admin rights and a tenant-matched lecture', async () => {
    const admin = cookieFrom(await signIn(adminCredentials))
    const student = cookieFrom(await signIn(studentCredentials))
    const fixture = await createMediaFixture()
    const otherInstitution = required(
      (
        await db
          .insert(institutions)
          .values({ name: 'Other University', slug: 'other-university' })
          .returning()
      )[0],
    )
    const deletion = (institutionId: string) =>
      api(
        `/api/institutions/${institutionId}/admin/lectures/${fixture.lecture.id}/media-deletion`,
        {
          method: 'POST',
          cookie: admin,
          body: {
            reason: 'Cross-tenant attempt',
            confirmation: 'DELETE MEDIA',
          },
        },
      )

    expect((await deletion(otherInstitution.id)).status).toBe(404)
    await db
      .delete(membershipRoles)
      .where(
        and(
          eq(membershipRoles.membershipId, LECTURER_MEMBERSHIP_ID),
          eq(membershipRoles.role, 'institution_admin'),
        ),
      )
    expect((await deletion(INSTITUTION_ID)).status).toBe(404)
    expect(await db.select().from(lectureAudio)).toHaveLength(1)
    expect(
      (
        await api(`/api/lectures/${fixture.lecture.id}/audio`, {
          cookie: student,
        })
      ).status,
    ).toBe(200)
  })
})

interface RetentionList {
  lectures: Array<{
    id: string
    audio: { sha256: string } | null
    activeHold: HoldView | null
    deletion: DeletionView | null
  }>
}
interface HoldView {
  id: string
  releasedAt: string | null
}
interface DeletionView {
  id: string
  requestedAt: string
  completedAt: string | null
  originalSha256: string
}
interface DeletionResponse {
  created: boolean
  deletion: DeletionView
}

async function createMediaFixture(): Promise<{
  lecture: typeof lectures.$inferSelect
  original: MediaObjectIntent
  derivative: MediaObjectIntent
  captureReference: string
}> {
  const lecture = required((await db.select().from(lectures).limit(1))[0])
  const now = new Date()
  await db
    .update(lectures)
    .set({ status: 'published', publishedAt: now })
    .where(eq(lectures.id, lecture.id))
  const wav = await readFile(wavPath)
  const original = await createIntent('original', '.wav', wav)
  const derivativeBytes = Buffer.from('synthetic data-saver derivative')
  const derivative = await createIntent('data_saver', '.m4a', derivativeBytes)
  const captureReference = randomUUID()

  await db.transaction(async (transaction) => {
    await transaction.insert(lectureAudio).values({
      lectureId: lecture.id,
      institutionId: lecture.institutionId,
      uploadedByMembershipId: LECTURER_MEMBERSHIP_ID,
      storageProvider: original.storageProvider,
      storageKey: original.storageKey,
      originalFileName: 'original.wav',
      mediaType: 'audio/wav',
      byteSize: original.byteSize,
      sha256: original.sha256,
    })
    await transaction.insert(lectureAudioDerivatives).values({
      lectureId: lecture.id,
      institutionId: lecture.institutionId,
      status: 'ready',
      sourceSha256: original.sha256,
      storageProvider: derivative.storageProvider,
      storageKey: derivative.storageKey,
      byteSize: derivative.byteSize,
      sha256: derivative.sha256,
      completedAt: now,
    })
    await transaction.insert(lectureAudioCaptures).values({
      lectureId: lecture.id,
      institutionId: lecture.institutionId,
      clientCaptureId: captureReference,
      recorderMimeType: 'audio/wav',
      consentAttestedAt: new Date(now.getTime() - 2_000),
      startedAt: new Date(now.getTime() - 1_000),
      stoppedAt: now,
      durationMs: 1_000,
      chunkCount: 1,
      persistentStorageGranted: false,
      stopReason: 'stopped',
      hashingDurationMs: 10,
      uploadDurationMs: 20,
      uploadRetryCount: 0,
    })
    await attachMediaObjectIntent(transaction, original.id, {
      kind: 'original',
      storageProvider: original.storageProvider,
      storageKey: original.storageKey,
      byteSize: original.byteSize,
      sha256: original.sha256,
    })
    await attachMediaObjectIntent(transaction, derivative.id, {
      kind: 'data_saver',
      storageProvider: derivative.storageProvider,
      storageKey: derivative.storageKey,
      byteSize: derivative.byteSize,
      sha256: derivative.sha256,
    })
  })
  return { lecture, original, derivative, captureReference }
}

async function createIntent(
  kind: 'original' | 'data_saver',
  extension: string,
  contents: Buffer,
): Promise<MediaObjectIntent> {
  const lecture = required((await db.select().from(lectures).limit(1))[0])
  const id = await newMediaObjectIntentId(db)
  const intent = await createMediaObjectIntent(db, {
    id,
    institutionId: lecture.institutionId,
    lectureId: lecture.id,
    kind,
    storageProvider: storage.provider,
    storageKey: `${lecture.institutionId}/${lecture.id}/${id}${extension}`,
    byteSize: contents.length,
    sha256: createHash('sha256').update(contents).digest('hex'),
  })
  await storage.save(intent.storageKey, await fixturePath(id, contents))
  return intent
}

async function fixturePath(id: string, contents: Buffer): Promise<string> {
  const path = join(temporaryRoot, `${id}.fixture`)
  await mkdir(temporaryRoot, { recursive: true })
  await writeFile(path, contents, { flag: 'wx' })
  return path
}

async function signIn(credentials: {
  email: string
  password: string
}): Promise<Response> {
  return api('/api/auth/sign-in', { method: 'POST', body: credentials })
}

async function api(
  path: string,
  options: { method?: string; cookie?: string; body?: unknown } = {},
): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      Accept: 'application/json',
      ...(options.body === undefined
        ? {}
        : { 'Content-Type': 'application/json' }),
      ...(options.cookie ? { Cookie: options.cookie } : {}),
    },
    ...(options.body === undefined
      ? {}
      : { body: JSON.stringify(options.body) }),
  })
}

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T
}

function cookieFrom(response: Response): string {
  const setCookie = response.headers.get('set-cookie')
  if (!setCookie) {
    throw new Error(`Expected a session cookie; received ${response.status}.`)
  }
  const [cookie] = setCookie.split(';')
  if (!cookie) {
    throw new Error('Expected a non-empty session cookie.')
  }
  return cookie
}

function required<T>(value: T | undefined): T {
  if (value === undefined) {
    throw new Error('Expected a database row.')
  }
  return value
}

function parseCsvRecord(record: string): string[] {
  const cells: string[] = []
  let cell = ''
  let quoted = false
  for (let index = 0; index < record.length; index += 1) {
    const character = record[index]
    if (character === '"') {
      if (quoted && record[index + 1] === '"') {
        cell += '"'
        index += 1
      } else {
        quoted = !quoted
      }
    } else if (character === ',' && !quoted) {
      cells.push(cell)
      cell = ''
    } else {
      cell += character
    }
  }
  cells.push(cell)
  return cells
}
