import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { queryOptions } from '@tanstack/react-query'

export interface CourseOffering {
  id: string
  section: string
  status: string
  institution: { id: string; slug: string; name: string }
  course: { code: string; title: string }
  term: { code: string; name: string }
  access: { canManage: boolean; canStudy: boolean }
}

export type DataSaverAudio =
  | { status: 'pending' | 'processing' | 'failed' }
  | {
      status: 'ready'
      mediaType: string
      byteSize: number
      sha256: string
      url: string
      downloadUrl: string
    }

export interface LectureAudio {
  originalFileName: string
  mediaType: string
  byteSize: number
  sha256: string
  url: string
  downloadUrl: string
  dataSaver: DataSaverAudio | null
}

export interface Lecture {
  id: string
  title: string
  description: string | null
  occurredAt: string
  status: string
  publishedAt: string | null
  audio: LectureAudio | null
}

export interface AudioUploadSession {
  id: string
  lectureId: string
  fileName: string
  byteSize: number
  receivedBytes: number
  chunkSize: number
  sha256: string
  status: string
  expiresAt: string
}

export interface AudioUploadProgress {
  phase: 'hashing' | 'uploading' | 'completing'
  receivedBytes: number
  totalBytes: number
}

export const courseKeys = {
  all: ['course-workspace'] as const,
  offerings: () => [...courseKeys.all, 'offerings'] as const,
  lectures: (offeringId: string) =>
    [...courseKeys.all, 'lectures', offeringId] as const,
}

export const courseOfferingsOptions = queryOptions({
  queryKey: courseKeys.offerings(),
  queryFn: async ({ signal }) => {
    const value = await requestJson('/api/course-offerings', { signal })
    if (!Array.isArray(value) || !value.every(isCourseOffering)) {
      throw new Error(
        'The course response did not match the expected contract.',
      )
    }
    return value
  },
  retry: 1,
})

export function courseLecturesOptions(offeringId: string) {
  return queryOptions({
    queryKey: courseKeys.lectures(offeringId),
    queryFn: async ({ signal }) => {
      const value = await requestJson(
        `/api/course-offerings/${encodeURIComponent(offeringId)}/lectures`,
        { signal },
      )
      if (!Array.isArray(value) || !value.every(isLecture)) {
        throw new Error(
          'The lecture response did not match the expected contract.',
        )
      }
      return value
    },
    retry: 1,
  })
}

export async function createLecture(input: {
  offeringId: string
  title: string
  description: string
  occurredAt: string
}): Promise<Lecture> {
  const value = await requestJson(
    `/api/course-offerings/${encodeURIComponent(input.offeringId)}/lectures`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: input.title,
        description: input.description,
        occurredAt: input.occurredAt,
      }),
    },
  )
  return requireLecture(value, 'The lecture creation response was invalid.')
}

export async function updateLecture(input: {
  lectureId: string
  title: string
  description: string
  occurredAt: string
}): Promise<Lecture> {
  const value = await requestJson(
    `/api/lectures/${encodeURIComponent(input.lectureId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: input.title,
        description: input.description,
        occurredAt: input.occurredAt,
      }),
    },
  )
  return requireLecture(value, 'The lecture update response was invalid.')
}

export async function getManagedLecture(lectureId: string): Promise<Lecture> {
  const value = await requestJson(
    `/api/lectures/${encodeURIComponent(lectureId)}`,
  )
  return requireLecture(value, 'The lecture response was invalid.')
}

export async function cancelActiveAudioUpload(
  lectureId: string,
): Promise<void> {
  await requestJson(
    `/api/lectures/${encodeURIComponent(lectureId)}/audio/uploads/active`,
    { method: 'DELETE' },
  )
}

export async function uploadLectureAudio(input: {
  lectureId: string
  file: File
  onProgress?: (progress: AudioUploadProgress) => void
}): Promise<Lecture> {
  const { file, lectureId } = input
  if (file.size === 0) {
    throw new Error('Choose a non-empty audio file.')
  }
  const report = (
    phase: AudioUploadProgress['phase'],
    receivedBytes: number,
  ) => {
    input.onProgress?.({ phase, receivedBytes, totalBytes: file.size })
  }
  const checksum = await hashFile(file, (receivedBytes) => {
    report('hashing', receivedBytes)
  })

  const active = await getActiveAudioUpload(lectureId)
  if (active && (active.byteSize !== file.size || active.sha256 !== checksum)) {
    throw new Error(
      'A different upload is active for this lecture. Resume that file or clear the interrupted upload first.',
    )
  }
  let session: AudioUploadSession
  if (active) {
    session = active
  } else {
    try {
      session = await createAudioUpload(lectureId, file, checksum)
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        const existing = await getManagedLecture(lectureId)
        if (existing.audio?.sha256 === checksum) {
          return existing
        }
      }
      throw error
    }
  }

  while (session.receivedBytes < file.size) {
    const offset = session.receivedBytes
    const chunk = file.slice(
      offset,
      Math.min(offset + session.chunkSize, file.size),
    )
    let recovered = false
    for (let attempt = 0; attempt < 3 && !recovered; attempt += 1) {
      try {
        session = await appendAudioChunk(lectureId, session.id, offset, chunk)
        report('uploading', session.receivedBytes)
        recovered = true
      } catch (error) {
        const current = await getAudioUpload(lectureId, session.id).catch(
          () => null,
        )
        if (current?.status === 'completed') {
          const existing = await getManagedLecture(lectureId)
          if (existing.audio?.sha256 === checksum) {
            return existing
          }
        }
        if (current?.status === 'active' && current.receivedBytes > offset) {
          session = current
          report('uploading', session.receivedBytes)
          recovered = true
          continue
        }
        if (!isRetryable(error) || attempt === 2) {
          throw error
        }
        await delay(250 * 2 ** attempt)
      }
    }
  }

  report('completing', file.size)
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const value = await requestJson(
        `/api/lectures/${encodeURIComponent(lectureId)}/audio/uploads/${encodeURIComponent(session.id)}/complete`,
        { method: 'POST' },
      )
      return requireLecture(
        value,
        'The upload completion response was invalid.',
      )
    } catch (error) {
      if (!isRetryable(error) || attempt === 2) {
        throw error
      }
      await delay(250 * 2 ** attempt)
    }
  }
  throw new Error('The upload could not be completed.')
}

async function getActiveAudioUpload(
  lectureId: string,
): Promise<AudioUploadSession | null> {
  const value = await requestJson(
    `/api/lectures/${encodeURIComponent(lectureId)}/audio/uploads/active`,
    { allowNotFound: true },
  )
  if (value === null) {
    return null
  }
  return requireAudioUpload(value)
}

async function createAudioUpload(
  lectureId: string,
  file: File,
  checksum: string,
): Promise<AudioUploadSession> {
  const value = await requestJson(
    `/api/lectures/${encodeURIComponent(lectureId)}/audio/uploads`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileName: file.name,
        byteSize: file.size,
        sha256: checksum,
      }),
    },
  )
  return requireAudioUpload(value)
}

async function getAudioUpload(
  lectureId: string,
  uploadId: string,
): Promise<AudioUploadSession> {
  const value = await requestJson(
    `/api/lectures/${encodeURIComponent(lectureId)}/audio/uploads/${encodeURIComponent(uploadId)}`,
  )
  return requireAudioUpload(value)
}

async function appendAudioChunk(
  lectureId: string,
  uploadId: string,
  offset: number,
  chunk: Blob,
): Promise<AudioUploadSession> {
  const value = await requestJson(
    `/api/lectures/${encodeURIComponent(lectureId)}/audio/uploads/${encodeURIComponent(uploadId)}`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/offset+octet-stream',
        'Upload-Offset': String(offset),
      },
      body: chunk,
    },
  )
  return requireAudioUpload(value)
}

async function hashFile(
  file: File,
  onProgress: (receivedBytes: number) => void,
): Promise<string> {
  const hash = sha256.create()
  const hashChunkSize = 4 * 1024 * 1024
  for (let offset = 0; offset < file.size; offset += hashChunkSize) {
    const chunk = file.slice(offset, offset + hashChunkSize)
    hash.update(new Uint8Array(await chunk.arrayBuffer()))
    onProgress(Math.min(offset + hashChunkSize, file.size))
  }
  return bytesToHex(hash.digest())
}

function isRetryable(error: unknown): boolean {
  return (
    !(error instanceof ApiError) ||
    error.status === 408 ||
    error.status === 429 ||
    error.status >= 500
  )
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function requireLecture(value: unknown, message: string): Lecture {
  if (!isLecture(value)) {
    throw new Error(message)
  }
  return value
}

function requireAudioUpload(value: unknown): AudioUploadSession {
  if (!isAudioUpload(value)) {
    throw new Error('The upload session response was invalid.')
  }
  return value
}

export async function publishLecture(lectureId: string): Promise<Lecture> {
  const value = await requestJson(
    `/api/lectures/${encodeURIComponent(lectureId)}/publish`,
    { method: 'POST' },
  )
  if (!isLecture(value)) {
    throw new Error('The publish response did not match the expected contract.')
  }
  return value
}

async function requestJson(
  path: string,
  init: {
    method?: string
    body?: BodyInit
    headers?: Record<string, string>
    signal?: AbortSignal
    allowNotFound?: boolean
  } = {},
): Promise<unknown> {
  const response = await fetch(path, {
    method: init.method ?? 'GET',
    credentials: 'same-origin',
    headers: { Accept: 'application/json', ...init.headers },
    ...(init.body ? { body: init.body } : {}),
    ...(init.signal ? { signal: init.signal } : {}),
  })
  if (init.allowNotFound && response.status === 404) {
    return null
  }
  if (!response.ok) {
    throw await responseError(response)
  }
  return response.status === 204 ? null : response.json()
}

class ApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function responseError(response: Response): Promise<ApiError> {
  const fallback =
    response.status === 401
      ? 'Your session has expired. Sign in again.'
      : response.status === 404
        ? 'This course or lecture is not available to your account.'
        : response.status === 429
          ? 'Too many requests. Wait before trying again.'
          : 'The request could not be completed. Try again.'
  try {
    const body: unknown = await response.json()
    if (isRecord(body) && typeof body.message === 'string') {
      return new ApiError(
        response.status === 404 ? fallback : body.message,
        response.status,
      )
    }
  } catch {
    // Use the actionable fallback when the response is not JSON.
  }
  return new ApiError(fallback, response.status)
}

function isCourseOffering(value: unknown): value is CourseOffering {
  if (
    !isRecord(value) ||
    !isRecord(value.institution) ||
    !isRecord(value.course) ||
    !isRecord(value.term) ||
    !isRecord(value.access)
  ) {
    return false
  }
  return (
    typeof value.id === 'string' &&
    typeof value.section === 'string' &&
    typeof value.status === 'string' &&
    typeof value.institution.id === 'string' &&
    typeof value.institution.slug === 'string' &&
    typeof value.institution.name === 'string' &&
    typeof value.course.code === 'string' &&
    typeof value.course.title === 'string' &&
    typeof value.term.code === 'string' &&
    typeof value.term.name === 'string' &&
    typeof value.access.canManage === 'boolean' &&
    typeof value.access.canStudy === 'boolean'
  )
}

function isAudioUpload(value: unknown): value is AudioUploadSession {
  if (!isRecord(value)) {
    return false
  }
  return (
    typeof value.id === 'string' &&
    typeof value.lectureId === 'string' &&
    typeof value.fileName === 'string' &&
    typeof value.byteSize === 'number' &&
    Number.isSafeInteger(value.byteSize) &&
    value.byteSize > 0 &&
    typeof value.receivedBytes === 'number' &&
    Number.isSafeInteger(value.receivedBytes) &&
    value.receivedBytes >= 0 &&
    value.receivedBytes <= value.byteSize &&
    typeof value.chunkSize === 'number' &&
    Number.isSafeInteger(value.chunkSize) &&
    value.chunkSize >= 16_384 &&
    value.chunkSize <= 8_388_608 &&
    typeof value.sha256 === 'string' &&
    /^[0-9a-f]{64}$/.test(value.sha256) &&
    typeof value.status === 'string' &&
    typeof value.expiresAt === 'string'
  )
}

function isLecture(value: unknown): value is Lecture {
  if (!isRecord(value)) {
    return false
  }
  return (
    typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    (typeof value.description === 'string' || value.description === null) &&
    typeof value.occurredAt === 'string' &&
    typeof value.status === 'string' &&
    (typeof value.publishedAt === 'string' || value.publishedAt === null) &&
    (value.audio === null || isLectureAudio(value.audio))
  )
}

function isLectureAudio(value: unknown): value is LectureAudio {
  if (!isRecord(value)) {
    return false
  }
  return (
    typeof value.originalFileName === 'string' &&
    typeof value.mediaType === 'string' &&
    typeof value.byteSize === 'number' &&
    Number.isSafeInteger(value.byteSize) &&
    value.byteSize > 0 &&
    typeof value.sha256 === 'string' &&
    /^[0-9a-f]{64}$/.test(value.sha256) &&
    typeof value.url === 'string' &&
    typeof value.downloadUrl === 'string' &&
    (value.dataSaver === null || isDataSaverAudio(value.dataSaver))
  )
}

function isDataSaverAudio(value: unknown): value is DataSaverAudio {
  if (!isRecord(value) || typeof value.status !== 'string') {
    return false
  }
  if (['pending', 'processing', 'failed'].includes(value.status)) {
    return true
  }
  return (
    value.status === 'ready' &&
    typeof value.mediaType === 'string' &&
    typeof value.byteSize === 'number' &&
    Number.isSafeInteger(value.byteSize) &&
    value.byteSize > 0 &&
    typeof value.sha256 === 'string' &&
    /^[0-9a-f]{64}$/.test(value.sha256) &&
    typeof value.url === 'string' &&
    typeof value.downloadUrl === 'string'
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
