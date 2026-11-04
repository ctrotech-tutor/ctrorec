import { createHash, randomUUID } from 'node:crypto'
import type { Server } from 'node:http'
import { dirname, join } from 'node:path'
import { readFile, readdir, rm } from 'node:fs/promises'
import {
  createDatabase,
  seedDevelopment,
  type Database,
  type DatabasePool,
} from '@ctrorec/database'
import {
  academicTerms,
  academicUnits,
  courseOfferings,
  courses,
  enrollments,
  institutions,
  lectureAudio,
  lectureAudioCaptures,
  lectureAudioDerivatives,
  lectures,
  memberships,
  users,
} from '@ctrorec/database/schema'
import { DATA_SAVER_JOB } from '@ctrorec/media'
import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { and, eq, sql } from 'drizzle-orm'
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

const lecturer = {
  email: 'lecturer@ctrorec.test',
  password: 'Lecturer-Dev-2026!',
}
const student = {
  email: 'student@ctrorec.test',
  password: 'Student-Dev-2026!',
}
const wavPath = new URL('./fixtures/lecture.wav', import.meta.url)
const storageRoot = process.env.AUDIO_STORAGE_ROOT
const uploadDirectory = process.env.AUDIO_UPLOAD_TEMP_DIR
if (!storageRoot || !uploadDirectory) {
  throw new Error('Integration-test audio storage paths must be configured.')
}
const temporaryRoot = dirname(storageRoot)

let db: Database
let pool: DatabasePool
let app: NestExpressApplication
let baseUrl: string

beforeAll(() => {
  ;({ db, pool } = createDatabase(requireTestDatabaseUrl(), {
    applicationName: 'ctrorec-lecture-http-tests',
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

describe('lecture audio walking skeleton', () => {
  it('uploads, publishes, and streams the original with byte ranges', async () => {
    const lecturerCookie = cookieFrom(await signIn(lecturer))
    const studentCookie = cookieFrom(await signIn(student))
    const lecture = await seededLecture()
    const wav = await readFile(wavPath)

    const offerings = await api('/api/course-offerings', {
      cookie: lecturerCookie,
    })
    const offeringBody = (await offerings.json()) as Array<{
      id: string
      access: { canManage: boolean; canStudy: boolean }
    }>
    expect(offerings.status).toBe(200)
    expect(offeringBody).toHaveLength(1)
    expect(offeringBody[0]?.access).toEqual({
      canManage: true,
      canStudy: false,
    })

    const earlyPublish = await api(`/api/lectures/${lecture.id}/publish`, {
      method: 'POST',
      cookie: lecturerCookie,
    })
    expect(earlyPublish.status).toBe(409)

    const upload = await uploadAudio(lecturerCookie, lecture.id, wav)
    const uploaded = (await upload.json()) as {
      status: string
      audio: {
        mediaType: string
        byteSize: number
        sha256: string
        url: string
        dataSaver: { status: string } | null
      } | null
    }
    expect(upload.status).toBe(201)
    expect(uploaded.status).toBe('draft')
    expect(uploaded.audio).toMatchObject({
      mediaType: 'audio/wav',
      byteSize: wav.length,
      url: `/api/lectures/${lecture.id}/audio`,
    })
    expect(uploaded.audio?.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.stringify(uploaded)).not.toContain('storageKey')
    expect(uploaded.audio?.dataSaver).toEqual({ status: 'pending' })
    const derivative = required(
      (
        await db
          .select()
          .from(lectureAudioDerivatives)
          .where(eq(lectureAudioDerivatives.lectureId, lecture.id))
      )[0],
    )
    expect(derivative.sourceSha256).toBe(uploaded.audio?.sha256)
    const queued = await db.execute<{ id: string }>(
      sql`SELECT id FROM pgboss.job WHERE name = ${DATA_SAVER_JOB} AND id = ${derivative.id}`,
    )
    expect(queued.rows).toHaveLength(1)

    const duplicate = await uploadAudio(lecturerCookie, lecture.id, wav)
    expect(duplicate.status).toBe(409)

    const draftList = await api(
      `/api/course-offerings/${lecture.courseOfferingId}/lectures`,
      { cookie: studentCookie },
    )
    expect(draftList.status).toBe(200)
    expect(await draftList.json()).toEqual([])
    expect(
      (
        await api(`/api/lectures/${lecture.id}/audio`, {
          cookie: studentCookie,
        })
      ).status,
    ).toBe(404)

    const lecturerRange = await api(`/api/lectures/${lecture.id}/audio`, {
      cookie: lecturerCookie,
      headers: { Range: 'bytes=0-43' },
    })
    expect(lecturerRange.status).toBe(206)
    expect(lecturerRange.headers.get('content-range')).toBe(
      `bytes 0-43/${wav.length}`,
    )
    expect(lecturerRange.headers.get('accept-ranges')).toBe('bytes')
    expect(Buffer.from(await lecturerRange.arrayBuffer())).toEqual(
      wav.subarray(0, 44),
    )

    const publish = await api(`/api/lectures/${lecture.id}/publish`, {
      method: 'POST',
      cookie: lecturerCookie,
    })
    expect(publish.status).toBe(200)
    expect(((await publish.json()) as { status: string }).status).toBe(
      'published',
    )

    const studentList = await api(
      `/api/course-offerings/${lecture.courseOfferingId}/lectures`,
      { cookie: studentCookie },
    )
    const studentLectures = (await studentList.json()) as Array<{
      id: string
      status: string
      audio: { url: string } | null
    }>
    expect(studentLectures).toHaveLength(1)
    expect(studentLectures[0]).toMatchObject({
      id: lecture.id,
      status: 'published',
      audio: { url: `/api/lectures/${lecture.id}/audio` },
    })

    const full = await api(`/api/lectures/${lecture.id}/audio`, {
      cookie: studentCookie,
    })
    expect(full.status).toBe(200)
    expect(full.headers.get('content-length')).toBe(String(wav.length))
    expect(full.headers.get('cache-control')).toBe('private, no-store')
    expect(Buffer.from(await full.arrayBuffer())).toEqual(wav)
    const etag = full.headers.get('etag')
    expect(etag).toBe(`"${uploaded.audio?.sha256}"`)

    const firstPart = await api(`/api/lectures/${lecture.id}/audio/download`, {
      cookie: studentCookie,
      headers: { Range: 'bytes=0-99' },
    })
    expect(firstPart.status).toBe(206)
    expect(firstPart.headers.get('content-disposition')).toContain(
      'attachment;',
    )
    expect(Buffer.from(await firstPart.arrayBuffer())).toEqual(
      wav.subarray(0, 100),
    )

    const resumed = await api(`/api/lectures/${lecture.id}/audio/download`, {
      cookie: studentCookie,
      headers: { Range: 'bytes=100-', ...(etag ? { 'If-Range': etag } : {}) },
    })
    expect(resumed.status).toBe(206)
    expect(resumed.headers.get('content-range')).toBe(
      `bytes 100-${wav.length - 1}/${wav.length}`,
    )
    expect(Buffer.from(await resumed.arrayBuffer())).toEqual(wav.subarray(100))

    const changed = await api(`/api/lectures/${lecture.id}/audio/download`, {
      cookie: studentCookie,
      headers: { Range: 'bytes=100-', 'If-Range': '"different-object"' },
    })
    expect(changed.status).toBe(200)
    expect(changed.headers.get('content-range')).toBeNull()
    expect(Buffer.from(await changed.arrayBuffer())).toEqual(wav)

    const suffix = await api(`/api/lectures/${lecture.id}/audio`, {
      cookie: studentCookie,
      headers: { Range: 'bytes=-44' },
    })
    expect(suffix.status).toBe(206)
    expect(suffix.headers.get('content-range')).toBe(
      `bytes ${wav.length - 44}-${wav.length - 1}/${wav.length}`,
    )
    expect(Buffer.from(await suffix.arrayBuffer())).toEqual(wav.subarray(-44))

    const invalid = await api(`/api/lectures/${lecture.id}/audio`, {
      cookie: studentCookie,
      headers: { Range: `bytes=${wav.length}-` },
    })
    expect(invalid.status).toBe(416)
    expect(invalid.headers.get('content-range')).toBe(`bytes */${wav.length}`)
  })

  it('rejects non-audio content and unauthorized uploads without retaining files', async () => {
    const cookie = cookieFrom(await signIn(lecturer))
    const studentCookie = cookieFrom(await signIn(student))
    const lecture = await seededLecture()
    const denied = await uploadAudio(
      studentCookie,
      lecture.id,
      await readFile(wavPath),
    )
    expect(denied.status).toBe(404)

    const response = await uploadAudio(
      cookie,
      lecture.id,
      Buffer.from('this is not audio'),
    )

    expect(response.status).toBe(415)
    const retainedUploads = await readdir(uploadDirectory).catch(
      (error: unknown) => {
        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          error.code === 'ENOENT'
        ) {
          return []
        }
        throw error
      },
    )
    expect(retainedUploads).toEqual([])
    expect(
      (
        await api(`/api/lectures/${lecture.id}/publish`, {
          method: 'POST',
          cookie,
        })
      ).status,
    ).toBe(409)
  })

  it('enforces the configured upload size limit', async () => {
    const cookie = cookieFrom(await signIn(lecturer))
    const lecture = await seededLecture()
    const response = await uploadAudio(
      cookie,
      lecture.id,
      Buffer.alloc(1_048_577),
    )
    expect(response.status).toBe(413)
  })

  it('keeps a lecture draft when its stored object is unavailable', async () => {
    const cookie = cookieFrom(await signIn(lecturer))
    const lecture = await seededLecture()
    expect(
      (await uploadAudio(cookie, lecture.id, await readFile(wavPath))).status,
    ).toBe(201)
    const audio = required(
      (
        await db
          .select()
          .from(lectureAudio)
          .where(eq(lectureAudio.lectureId, lecture.id))
      )[0],
    )
    const storageRoot = process.env.AUDIO_STORAGE_ROOT
    if (!storageRoot) {
      throw new Error('Expected a test audio storage root.')
    }
    await rm(join(storageRoot, audio.storageKey))

    expect(
      (
        await api(`/api/lectures/${lecture.id}/publish`, {
          method: 'POST',
          cookie,
        })
      ).status,
    ).toBe(503)
    expect(
      (await api(`/api/lectures/${lecture.id}/audio`, { cookie })).status,
    ).toBe(503)
    expect((await seededLecture()).status).toBe('draft')
  })

  it('publishes and plays the original when its derivative fails', async () => {
    const lecturerCookie = cookieFrom(await signIn(lecturer))
    const studentCookie = cookieFrom(await signIn(student))
    const lecture = await seededLecture()
    const wav = await readFile(wavPath)
    expect((await uploadAudio(lecturerCookie, lecture.id, wav)).status).toBe(
      201,
    )
    const derivative = required(
      (
        await db
          .select()
          .from(lectureAudioDerivatives)
          .where(eq(lectureAudioDerivatives.lectureId, lecture.id))
      )[0],
    )
    await db
      .update(lectureAudioDerivatives)
      .set({ status: 'failed' })
      .where(eq(lectureAudioDerivatives.id, derivative.id))

    const published = await api(`/api/lectures/${lecture.id}/publish`, {
      method: 'POST',
      cookie: lecturerCookie,
    })
    expect(published.status).toBe(200)
    expect(
      (
        (await published.json()) as {
          audio: { dataSaver: { status: string } | null } | null
        }
      ).audio?.dataSaver,
    ).toEqual({ status: 'failed' })

    const original = await api(`/api/lectures/${lecture.id}/audio`, {
      cookie: studentCookie,
    })
    expect(original.status).toBe(200)
    expect(Buffer.from(await original.arrayBuffer())).toEqual(wav)
    for (const cookie of [lecturerCookie, studentCookie]) {
      expect(
        (
          await api(`/api/lectures/${lecture.id}/audio/data-saver`, {
            cookie,
          })
        ).status,
      ).toBe(404)
    }
  })

  it('denies course and institution resources without current access', async () => {
    const lecturerCookie = cookieFrom(await signIn(lecturer))
    const studentCookie = cookieFrom(await signIn(student))
    const institution = required(
      (
        await db
          .select()
          .from(institutions)
          .where(eq(institutions.slug, 'asteria-university'))
          .limit(1)
      )[0],
    )
    const lecturerUser = required(
      (await db.select().from(users).where(eq(users.email, lecturer.email)))[0],
    )
    const lecturerMembership = required(
      (
        await db
          .select()
          .from(memberships)
          .where(
            and(
              eq(memberships.userId, lecturerUser.id),
              eq(memberships.institutionId, institution.id),
            ),
          )
      )[0],
    )
    const unit = required(
      (
        await db
          .select()
          .from(academicUnits)
          .where(eq(academicUnits.institutionId, institution.id))
      )[0],
    )
    const term = required(
      (
        await db
          .select()
          .from(academicTerms)
          .where(eq(academicTerms.institutionId, institution.id))
      )[0],
    )
    const secondCourse = required(
      (
        await db
          .insert(courses)
          .values({
            institutionId: institution.id,
            unitId: unit.id,
            code: 'CSC102',
            title: 'Data Structures',
          })
          .returning()
      )[0],
    )
    const secondOffering = required(
      (
        await db
          .insert(courseOfferings)
          .values({
            institutionId: institution.id,
            courseId: secondCourse.id,
            termId: term.id,
            section: 'B',
            status: 'active',
          })
          .returning()
      )[0],
    )
    const secondLecture = await insertPublishedLecture(
      institution.id,
      secondOffering.id,
      lecturerMembership.id,
      'Unassigned course lecture',
    )

    const otherInstitution = required(
      (
        await db
          .insert(institutions)
          .values({ slug: 'other-university', name: 'Other University' })
          .returning()
      )[0],
    )
    const otherUnit = required(
      (
        await db
          .insert(academicUnits)
          .values({
            institutionId: otherInstitution.id,
            kind: 'department',
            code: 'OTHER',
            name: 'Other Department',
          })
          .returning()
      )[0],
    )
    const otherTerm = required(
      (
        await db
          .insert(academicTerms)
          .values({
            institutionId: otherInstitution.id,
            code: '2026-OTHER',
            name: 'Other Term',
            startsOn: '2026-10-01',
            endsOn: '2027-02-28',
            status: 'active',
          })
          .returning()
      )[0],
    )
    const otherCourse = required(
      (
        await db
          .insert(courses)
          .values({
            institutionId: otherInstitution.id,
            unitId: otherUnit.id,
            code: 'OTHER101',
            title: 'Other Course',
          })
          .returning()
      )[0],
    )
    const otherOffering = required(
      (
        await db
          .insert(courseOfferings)
          .values({
            institutionId: otherInstitution.id,
            courseId: otherCourse.id,
            termId: otherTerm.id,
            status: 'active',
          })
          .returning()
      )[0],
    )
    const otherUser = required(
      (
        await db
          .insert(users)
          .values({
            email: 'other-lecturer@ctrorec.test',
            displayName: 'Other Lecturer',
          })
          .returning()
      )[0],
    )
    const otherMembership = required(
      (
        await db
          .insert(memberships)
          .values({
            institutionId: otherInstitution.id,
            userId: otherUser.id,
          })
          .returning()
      )[0],
    )
    const otherLecture = await insertPublishedLecture(
      otherInstitution.id,
      otherOffering.id,
      otherMembership.id,
      'Foreign institution lecture',
    )

    for (const cookie of [lecturerCookie, studentCookie]) {
      expect(
        (
          await api(`/api/course-offerings/${secondOffering.id}/lectures`, {
            cookie,
          })
        ).status,
      ).toBe(404)
      expect(
        (await api(`/api/lectures/${secondLecture.id}/audio`, { cookie }))
          .status,
      ).toBe(404)
      expect(
        (
          await api(`/api/lectures/${secondLecture.id}/publish`, {
            method: 'POST',
            cookie,
          })
        ).status,
      ).toBe(404)
      expect(
        (
          await api(`/api/course-offerings/${otherOffering.id}/lectures`, {
            cookie,
          })
        ).status,
      ).toBe(404)
      expect(
        (await api(`/api/lectures/${otherLecture.id}/audio`, { cookie }))
          .status,
      ).toBe(404)
    }
  })

  it('creates and edits a lecture, resumes an upload, and plays the assembled original', async () => {
    const lecturerCookie = cookieFrom(await signIn(lecturer))
    const studentCookie = cookieFrom(await signIn(student))
    const offerings = await api('/api/course-offerings', {
      cookie: lecturerCookie,
    })
    const offeringList = (await offerings.json()) as Array<{ id: string }>
    const offeringId = required(offeringList[0]).id
    const input = {
      title: '  Resilient lecture  ',
      description: '  Original teaching, recovered in chunks.  ',
      occurredAt: '2026-10-30T10:00:00.000Z',
    }

    expect(
      (
        await api(`/api/course-offerings/${offeringId}/lectures`, {
          method: 'POST',
          cookie: studentCookie,
          body: input,
        })
      ).status,
    ).toBe(404)
    const createdResponse = await api(
      `/api/course-offerings/${offeringId}/lectures`,
      { method: 'POST', cookie: lecturerCookie, body: input },
    )
    expect(createdResponse.status).toBe(201)
    const created = (await createdResponse.json()) as {
      id: string
      title: string
      description: string | null
      status: string
      audio: unknown
    }
    expect(created).toMatchObject({
      title: 'Resilient lecture',
      description: 'Original teaching, recovered in chunks.',
      status: 'draft',
      audio: null,
    })

    const editedResponse = await api(`/api/lectures/${created.id}`, {
      method: 'PATCH',
      cookie: lecturerCookie,
      body: { title: 'Resumable lecture', description: '' },
    })
    expect(editedResponse.status).toBe(200)
    expect(await editedResponse.json()).toMatchObject({
      title: 'Resumable lecture',
      description: null,
    })

    const wav = repeatPcmWav(await readFile(wavPath), 10)
    const sha256 = createHash('sha256').update(wav).digest('hex')
    const uploadInput = {
      fileName: 'lecture.wav',
      byteSize: wav.length,
      sha256,
    }
    const uploadResponse = await api(
      `/api/lectures/${created.id}/audio/uploads`,
      { method: 'POST', cookie: lecturerCookie, body: uploadInput },
    )
    expect(uploadResponse.status).toBe(201)
    const upload = (await uploadResponse.json()) as {
      id: string
      receivedBytes: number
      chunkSize: number
    }
    expect(upload.receivedBytes).toBe(0)
    expect(upload.chunkSize).toBe(16_384)
    expect(wav.length).toBeGreaterThan(upload.chunkSize)

    const duplicate = await api(`/api/lectures/${created.id}/audio/uploads`, {
      method: 'POST',
      cookie: lecturerCookie,
      body: uploadInput,
    })
    expect(duplicate.status).toBe(201)
    expect(await duplicate.json()).toMatchObject({ id: upload.id })
    expect(
      (
        await api(`/api/lectures/${created.id}/audio/uploads/active`, {
          cookie: studentCookie,
        })
      ).status,
    ).toBe(404)

    const oversized = await api(
      `/api/lectures/${created.id}/audio/uploads/${upload.id}`,
      {
        method: 'PATCH',
        cookie: lecturerCookie,
        body: wav.subarray(0, upload.chunkSize + 1),
        headers: {
          'Content-Type': 'application/offset+octet-stream',
          'Upload-Offset': '0',
        },
      },
    )
    expect(oversized.status).toBe(413)

    const firstChunk = wav.subarray(0, upload.chunkSize)
    const first = await api(
      `/api/lectures/${created.id}/audio/uploads/${upload.id}`,
      {
        method: 'PATCH',
        cookie: lecturerCookie,
        body: firstChunk,
        headers: {
          'Content-Type': 'application/offset+octet-stream',
          'Upload-Offset': '0',
        },
      },
    )
    expect(first.status).toBe(200)
    expect(await first.json()).toMatchObject({
      receivedBytes: firstChunk.length,
    })

    expect(
      (
        await api(`/api/lectures/${created.id}/audio/uploads/${upload.id}`, {
          method: 'PATCH',
          cookie: lecturerCookie,
          body: firstChunk,
          headers: {
            'Content-Type': 'application/offset+octet-stream',
            'Upload-Offset': '0',
          },
        })
      ).status,
    ).toBe(409)
    const recovered = await api(
      `/api/lectures/${created.id}/audio/uploads/${upload.id}`,
      { cookie: lecturerCookie },
    )
    expect(await recovered.json()).toMatchObject({
      receivedBytes: firstChunk.length,
    })

    for (
      let offset = firstChunk.length;
      offset < wav.length;
      offset += upload.chunkSize
    ) {
      const chunk = wav.subarray(
        offset,
        Math.min(offset + upload.chunkSize, wav.length),
      )
      const response = await api(
        `/api/lectures/${created.id}/audio/uploads/${upload.id}`,
        {
          method: 'PATCH',
          cookie: lecturerCookie,
          body: chunk,
          headers: {
            'Content-Type': 'application/offset+octet-stream',
            'Upload-Offset': String(offset),
          },
        },
      )
      expect(response.status).toBe(200)
    }

    const completed = await api(
      `/api/lectures/${created.id}/audio/uploads/${upload.id}/complete`,
      { method: 'POST', cookie: lecturerCookie },
    )
    expect(completed.status).toBe(200)
    expect(await completed.json()).toMatchObject({
      audio: {
        originalFileName: 'lecture.wav',
        byteSize: wav.length,
        sha256,
        dataSaver: { status: 'pending' },
      },
    })
    const repeatedCompletion = await api(
      `/api/lectures/${created.id}/audio/uploads/${upload.id}/complete`,
      { method: 'POST', cookie: lecturerCookie },
    )
    expect(repeatedCompletion.status).toBe(200)
    expect(await repeatedCompletion.json()).toMatchObject({
      audio: { sha256 },
    })
    expect(
      await (
        await api(`/api/lectures/${created.id}/audio/uploads/${upload.id}`, {
          cookie: lecturerCookie,
        })
      ).json(),
    ).toMatchObject({ status: 'completed' })

    expect(
      (
        await api(`/api/lectures/${created.id}/publish`, {
          method: 'POST',
          cookie: lecturerCookie,
        })
      ).status,
    ).toBe(200)
    const playback = await api(`/api/lectures/${created.id}/audio`, {
      cookie: studentCookie,
    })
    expect(playback.status).toBe(200)
    expect(Buffer.from(await playback.arrayBuffer()).equals(wav)).toBe(true)
  })

  it('attaches browser-capture provenance atomically with a WebM original', async () => {
    const cookie = cookieFrom(await signIn(lecturer))
    const lecture = await seededLecture()
    const webm = await readFile(
      new URL(
        '../../../packages/media/test/fixtures/capture.webm',
        import.meta.url,
      ),
    )
    const sha256 = createHash('sha256').update(webm).digest('hex')
    const created = await api(`/api/lectures/${lecture.id}/audio/uploads`, {
      method: 'POST',
      cookie,
      body: { fileName: 'hall-capture.webm', byteSize: webm.length, sha256 },
    })
    expect(created.status).toBe(201)
    const upload = (await created.json()) as { id: string }
    const appended = await api(
      `/api/lectures/${lecture.id}/audio/uploads/${upload.id}`,
      {
        method: 'PATCH',
        cookie,
        body: webm,
        headers: {
          'Content-Type': 'application/offset+octet-stream',
          'Upload-Offset': '0',
        },
      },
    )
    expect(appended.status).toBe(200)

    const stoppedAt = new Date()
    const startedAt = new Date(stoppedAt.getTime() - 5_000)
    const consentAttestedAt = new Date(startedAt.getTime() - 1_000)
    const clientCaptureId = randomUUID()
    const completed = await api(
      `/api/lectures/${lecture.id}/audio/uploads/${upload.id}/complete`,
      {
        method: 'POST',
        cookie,
        body: {
          capture: {
            clientCaptureId,
            recorderMimeType: 'audio/webm;codecs=opus',
            consentAttestedAt: consentAttestedAt.toISOString(),
            startedAt: startedAt.toISOString(),
            stoppedAt: stoppedAt.toISOString(),
            durationMs: 5_000,
            chunkCount: 2,
            persistentStorageGranted: true,
            stopReason: 'stopped',
            hashingDurationMs: 125,
            uploadDurationMs: 2_500,
            uploadRetryCount: 3,
          },
        },
      },
    )
    expect(completed.status).toBe(200)
    expect(await completed.json()).toMatchObject({
      audio: { mediaType: 'audio/webm', byteSize: webm.length, sha256 },
    })
    const provenance = required(
      (
        await db
          .select()
          .from(lectureAudioCaptures)
          .where(eq(lectureAudioCaptures.lectureId, lecture.id))
      )[0],
    )
    expect(provenance).toMatchObject({
      institutionId: lecture.institutionId,
      clientCaptureId,
      recorderMimeType: 'audio/webm;codecs=opus',
      startedAt,
      stoppedAt,
      consentAttestedAt,
      durationMs: 5_000,
      chunkCount: 2,
      persistentStorageGranted: true,
      stopReason: 'stopped',
      hashingDurationMs: 125,
      uploadDurationMs: 2_500,
      uploadRetryCount: 3,
    })
    const original = await api(`/api/lectures/${lecture.id}/audio`, { cookie })
    expect(original.status).toBe(200)
    expect(original.headers.get('content-type')).toBe('audio/webm')
    expect(Buffer.from(await original.arrayBuffer())).toEqual(webm)

    const evidence = await api(
      `/api/institutions/${lecture.institutionId}/admin/capture-evidence.csv?from=2020-01-01&to=2030-01-01`,
      { cookie },
    )
    expect(evidence.status).toBe(200)
    expect(evidence.headers.get('content-type')).toBe('text/csv; charset=utf-8')
    expect(evidence.headers.get('cache-control')).toBe('private, no-store')
    const records = (await evidence.text()).trimEnd().split('\r\n')
    const header = parseCsvRecord(required(records[0]))
    const evidenceRow = parseCsvRecord(
      required(records.find((record) => record.includes(clientCaptureId))),
    )
    expect(
      Object.fromEntries(
        header.map((name, index) => [name, evidenceRow[index]]),
      ),
    ).toMatchObject({
      capture_reference: clientCaptureId,
      lecture_id: lecture.id,
      original_media_type: 'audio/webm',
      original_byte_size: String(webm.length),
      hashing_duration_ms: '125',
      upload_duration_ms: '2500',
      upload_retry_count: '3',
      derivative_status: 'pending',
    })
    const studentCookie = cookieFrom(await signIn(student))
    const denied = await api(
      `/api/institutions/${lecture.institutionId}/admin/capture-evidence.csv`,
      { cookie: studentCookie },
    )
    expect(denied.status).toBe(404)
  })

  it('cleans failed or cancelled resumable sessions without attaching audio', async () => {
    const lecturerCookie = cookieFrom(await signIn(lecturer))
    const lecture = await seededLecture()
    const wav = repeatPcmWav(await readFile(wavPath), 10)
    const failedCreate = await api(
      `/api/lectures/${lecture.id}/audio/uploads`,
      {
        method: 'POST',
        cookie: lecturerCookie,
        body: {
          fileName: 'lecture.wav',
          byteSize: wav.length,
          sha256: '0'.repeat(64),
        },
      },
    )
    const failedUpload = (await failedCreate.json()) as {
      id: string
      chunkSize: number
    }
    for (
      let offset = 0;
      offset < wav.length;
      offset += failedUpload.chunkSize
    ) {
      const chunk = wav.subarray(
        offset,
        Math.min(offset + failedUpload.chunkSize, wav.length),
      )
      expect(
        (
          await api(
            `/api/lectures/${lecture.id}/audio/uploads/${failedUpload.id}`,
            {
              method: 'PATCH',
              cookie: lecturerCookie,
              body: chunk,
              headers: {
                'Content-Type': 'application/offset+octet-stream',
                'Upload-Offset': String(offset),
              },
            },
          )
        ).status,
      ).toBe(200)
    }
    const mismatch = await api(
      `/api/lectures/${lecture.id}/audio/uploads/${failedUpload.id}/complete`,
      { method: 'POST', cookie: lecturerCookie },
    )
    expect(mismatch.status).toBe(400)
    expect(
      (
        await api(`/api/lectures/${lecture.id}/audio/uploads/active`, {
          cookie: lecturerCookie,
        })
      ).status,
    ).toBe(404)
    await expect(
      readdir(join(uploadDirectory, 'sessions', failedUpload.id)),
    ).rejects.toMatchObject({ code: 'ENOENT' })

    const cancelledCreate = await api(
      `/api/lectures/${lecture.id}/audio/uploads`,
      {
        method: 'POST',
        cookie: lecturerCookie,
        body: {
          fileName: 'lecture.wav',
          byteSize: wav.length,
          sha256: createHash('sha256').update(wav).digest('hex'),
        },
      },
    )
    const cancelled = (await cancelledCreate.json()) as {
      id: string
      chunkSize: number
    }
    const chunk = wav.subarray(0, cancelled.chunkSize)
    expect(
      (
        await api(`/api/lectures/${lecture.id}/audio/uploads/${cancelled.id}`, {
          method: 'PATCH',
          cookie: lecturerCookie,
          body: chunk,
          headers: {
            'Content-Type': 'application/offset+octet-stream',
            'Upload-Offset': '0',
          },
        })
      ).status,
    ).toBe(200)
    expect(
      (
        await api(`/api/lectures/${lecture.id}/audio/uploads/active`, {
          method: 'DELETE',
          cookie: lecturerCookie,
        })
      ).status,
    ).toBe(204)
    expect(
      await (
        await api(`/api/lectures/${lecture.id}/audio/uploads/${cancelled.id}`, {
          cookie: lecturerCookie,
        })
      ).json(),
    ).toMatchObject({ status: 'cancelled' })
    expect(
      (
        await api(`/api/lectures/${lecture.id}/audio`, {
          cookie: lecturerCookie,
        })
      ).status,
    ).toBe(404)
  })

  it('stops playback when the current enrollment ends', async () => {
    const lecturerCookie = cookieFrom(await signIn(lecturer))
    const studentCookie = cookieFrom(await signIn(student))
    const lecture = await seededLecture()
    const wav = await readFile(wavPath)
    expect((await uploadAudio(lecturerCookie, lecture.id, wav)).status).toBe(
      201,
    )
    expect(
      (
        await api(`/api/lectures/${lecture.id}/publish`, {
          method: 'POST',
          cookie: lecturerCookie,
        })
      ).status,
    ).toBe(200)
    expect(
      (
        await api(`/api/lectures/${lecture.id}/audio`, {
          cookie: studentCookie,
        })
      ).status,
    ).toBe(200)

    await db
      .update(enrollments)
      .set({ endsAt: new Date(Date.now() - 1000) })
      .where(eq(enrollments.courseOfferingId, lecture.courseOfferingId))

    expect(
      (
        await api(`/api/lectures/${lecture.id}/audio`, {
          cookie: studentCookie,
        })
      ).status,
    ).toBe(404)
    expect(
      await (
        await api('/api/course-offerings', { cookie: studentCookie })
      ).json(),
    ).toEqual([])
  })
})

function repeatPcmWav(source: Buffer, repetitions: number): Buffer {
  if (
    source.length < 44 ||
    source.toString('ascii', 0, 4) !== 'RIFF' ||
    source.toString('ascii', 8, 12) !== 'WAVE' ||
    source.toString('ascii', 12, 16) !== 'fmt ' ||
    source.toString('ascii', 36, 40) !== 'data'
  ) {
    throw new Error('Expected the canonical PCM test fixture.')
  }
  const samples = source.subarray(44)
  const expanded = Buffer.concat([
    source.subarray(0, 44),
    ...Array.from({ length: repetitions }, () => samples),
  ])
  expanded.writeUInt32LE(expanded.length - 8, 4)
  expanded.writeUInt32LE(expanded.length - 44, 40)
  return expanded
}

async function insertPublishedLecture(
  institutionId: string,
  offeringId: string,
  creatorMembershipId: string,
  title: string,
) {
  const now = new Date()
  const lecture = required(
    (
      await db
        .insert(lectures)
        .values({
          institutionId,
          courseOfferingId: offeringId,
          createdByMembershipId: creatorMembershipId,
          title,
          occurredAt: now,
          status: 'published',
          publishedAt: now,
        })
        .returning()
    )[0],
  )
  await db.insert(lectureAudio).values({
    lectureId: lecture.id,
    institutionId,
    uploadedByMembershipId: creatorMembershipId,
    storageProvider: 'local',
    storageKey: `fixtures/${lecture.id}`,
    originalFileName: 'lecture.wav',
    mediaType: 'audio/wav',
    byteSize: 4044,
    sha256: 'a'.repeat(64),
  })
  return lecture
}

async function seededLecture() {
  return required(
    (
      await db
        .select()
        .from(lectures)
        .where(eq(lectures.title, 'Welcome and course orientation'))
        .limit(1)
    )[0],
  )
}

async function uploadAudio(
  cookie: string,
  lectureId: string,
  content: Buffer,
): Promise<Response> {
  const form = new FormData()
  form.append(
    'audio',
    new Blob([Uint8Array.from(content)], { type: 'audio/wav' }),
    'lecture.wav',
  )
  return api(`/api/lectures/${lectureId}/audio`, {
    method: 'POST',
    cookie,
    body: form,
  })
}

async function signIn(credentials: {
  email: string
  password: string
}): Promise<Response> {
  return api('/api/auth/sign-in', { method: 'POST', body: credentials })
}

async function api(
  path: string,
  options: {
    method?: string
    cookie?: string
    body?: unknown
    headers?: Record<string, string>
  } = {},
): Promise<Response> {
  const body = options.body
  const isBinary = body instanceof Uint8Array
  const requestBody =
    body instanceof FormData
      ? body
      : isBinary
        ? Uint8Array.from(body)
        : body === undefined
          ? undefined
          : JSON.stringify(body)
  return fetch(`${baseUrl}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      Accept: 'application/json',
      ...(body !== undefined && !(body instanceof FormData) && !isBinary
        ? { 'Content-Type': 'application/json' }
        : {}),
      ...(options.cookie ? { Cookie: options.cookie } : {}),
      ...options.headers,
    },
    ...(requestBody === undefined ? {} : { body: requestBody }),
  })
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

function required<T>(value: T | undefined): T {
  if (value === undefined) {
    throw new Error('Expected a database row.')
  }
  return value
}
