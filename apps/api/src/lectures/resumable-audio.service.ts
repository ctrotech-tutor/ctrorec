import { randomUUID } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import {
  BadRequestException,
  ConflictException,
  GoneException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { Request } from 'express'
import {
  LecturesService,
  cleanAudioFileName,
  type CaptureProvenanceInput,
  type LectureView,
} from './lectures.service.js'
import {
  LecturesRepository,
  type LectureAudioUpload,
} from './lectures.repository.js'
import {
  assembleUpload,
  receiveUploadChunk,
  stageUploadChunk,
  uploadChunkPath,
  uploadSessionDirectory,
} from './resumable-upload.js'

export interface AudioUploadView {
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

@Injectable()
export class ResumableAudioService {
  private readonly logger = new Logger(ResumableAudioService.name)
  private readonly temporaryRoot: string
  private readonly chunkSize: number
  private readonly maximumUploadBytes: number
  private readonly sessionTtlMs: number

  constructor(
    @Inject(LecturesRepository)
    private readonly repository: LecturesRepository,
    @Inject(LecturesService) private readonly lectures: LecturesService,
    @Inject(ConfigService) config: ConfigService,
  ) {
    this.temporaryRoot = config.getOrThrow<string>('AUDIO_UPLOAD_TEMP_DIR')
    this.chunkSize = config.getOrThrow<number>('AUDIO_UPLOAD_CHUNK_BYTES')
    this.maximumUploadBytes = config.getOrThrow<number>(
      'AUDIO_MAX_UPLOAD_BYTES',
    )
    this.sessionTtlMs = config.getOrThrow<number>('AUDIO_UPLOAD_SESSION_TTL_MS')
  }

  async create(
    userId: string,
    lectureId: string,
    input: { fileName: string; byteSize: number; sha256: string },
  ): Promise<AudioUploadView> {
    const { lecture, access } = await this.lectures.assertCanManageLecture(
      userId,
      lectureId,
    )
    if (lecture.lecture.status !== 'draft' || lecture.audio) {
      throw new ConflictException(
        'This lecture already has an original recording.',
      )
    }
    if (input.byteSize > this.maximumUploadBytes) {
      throw new PayloadTooLargeException(
        'The audio file exceeds the size limit.',
      )
    }
    await this.expireSessions(lectureId)
    const fileName = cleanAudioFileName(input.fileName)
    const existing = await this.repository.findActiveAudioUpload(
      lectureId,
      lecture.lecture.institutionId,
    )
    if (existing) {
      return this.existingOrConflict(existing, fileName, input)
    }

    let created: LectureAudioUpload
    try {
      created = await this.repository.createAudioUpload({
        lectureId,
        institutionId: lecture.lecture.institutionId,
        createdByMembershipId: access.membershipId,
        originalFileName: fileName,
        byteSize: input.byteSize,
        sha256: input.sha256,
        chunkSize: this.chunkSize,
        expiresAt: new Date(Date.now() + this.sessionTtlMs),
      })
    } catch (error) {
      if (isUniqueViolation(error)) {
        const concurrent = await this.repository.findActiveAudioUpload(
          lectureId,
          lecture.lecture.institutionId,
        )
        if (concurrent) {
          return this.existingOrConflict(concurrent, fileName, input)
        }
      }
      throw error
    }

    try {
      await mkdir(this.directory(created.id), { recursive: true })
    } catch (error) {
      await this.repository.cancelAudioUpload(created.id)
      throw error
    }
    return toAudioUploadView(created)
  }

  async getActive(userId: string, lectureId: string): Promise<AudioUploadView> {
    const { lecture } = await this.lectures.assertCanManageLecture(
      userId,
      lectureId,
    )
    await this.expireSessions(lectureId)
    const upload = await this.repository.findActiveAudioUpload(
      lectureId,
      lecture.lecture.institutionId,
    )
    if (!upload) {
      throw new NotFoundException('No active upload session exists.')
    }
    return toAudioUploadView(upload)
  }

  async get(
    userId: string,
    lectureId: string,
    uploadId: string,
  ): Promise<AudioUploadView> {
    const upload = await this.requireUpload(userId, lectureId, uploadId)
    if (
      upload.status === 'active' &&
      upload.expiresAt.getTime() <= Date.now()
    ) {
      await this.expireSessions(lectureId)
      throw new GoneException('The upload session expired. Start it again.')
    }
    return toAudioUploadView(upload)
  }

  async append(
    userId: string,
    lectureId: string,
    uploadId: string,
    offsetHeader: string | undefined,
    request: Request,
  ): Promise<AudioUploadView> {
    const offset = parseUploadOffset(offsetHeader)
    const initial = await this.requireActive(userId, lectureId, uploadId)
    if (request.headers['content-type'] !== 'application/offset+octet-stream') {
      throw new UnsupportedMediaTypeException(
        'Use application/offset+octet-stream for upload chunks.',
      )
    }
    const contentLength = Number(request.headers['content-length'])
    if (Number.isFinite(contentLength) && contentLength > initial.chunkSize) {
      throw new PayloadTooLargeException(
        'The chunk exceeds the upload session chunk size.',
      )
    }
    const directory = this.directory(uploadId)
    const incoming = await receiveUploadChunk(
      request,
      directory,
      initial.chunkSize,
    )

    try {
      const updated = await this.repository.withAudioUploadLock(
        uploadId,
        lectureId,
        initial.institutionId,
        async (upload, transaction) => {
          if (!upload) {
            throw new NotFoundException()
          }
          if (upload.status !== 'active') {
            throw new GoneException('The upload session is no longer active.')
          }
          if (upload.expiresAt.getTime() <= Date.now()) {
            await this.repository.expireAudioUpload(transaction, uploadId)
            return null
          }
          if (upload.receivedBytes !== offset || offset >= upload.byteSize) {
            throw new ConflictException(
              `Upload-Offset must be ${upload.receivedBytes}. Retrieve the session before retrying.`,
            )
          }
          const expectedBytes = Math.min(
            upload.chunkSize,
            upload.byteSize - offset,
          )
          if (incoming.byteSize !== expectedBytes) {
            throw new BadRequestException(
              `This chunk must contain exactly ${expectedBytes} bytes.`,
            )
          }
          await stageUploadChunk(
            incoming.path,
            uploadChunkPath(directory, offset),
          )
          const advanced = await this.repository.advanceAudioUpload(
            transaction,
            uploadId,
            offset,
            offset + incoming.byteSize,
          )
          if (!advanced) {
            throw new ConflictException(
              'The upload session changed. Retrieve its status before retrying.',
            )
          }
          return advanced
        },
      )
      if (!updated) {
        await this.removeDirectory(directory)
        throw new GoneException('The upload session expired. Start it again.')
      }
      return toAudioUploadView(updated)
    } finally {
      await rm(incoming.path, { force: true })
    }
  }

  async complete(
    userId: string,
    lectureId: string,
    uploadId: string,
    capture?: CaptureProvenanceInput,
  ): Promise<LectureView> {
    const upload = await this.requireUpload(userId, lectureId, uploadId)
    if (upload.status === 'completed') {
      const lecture = await this.lectures.getManagedLecture(userId, lectureId)
      if (lecture.audio?.sha256 !== upload.sha256) {
        throw new ConflictException(
          'The completed upload does not match the lecture recording.',
        )
      }
      return lecture
    }
    if (upload.status !== 'active') {
      throw new GoneException('The upload session is no longer active.')
    }
    if (upload.expiresAt.getTime() <= Date.now()) {
      await this.expireSessions(lectureId)
      throw new GoneException('The upload session expired. Start it again.')
    }
    if (upload.receivedBytes !== upload.byteSize) {
      throw new ConflictException(
        `Upload is incomplete at byte ${upload.receivedBytes} of ${upload.byteSize}.`,
      )
    }
    const directory = this.directory(uploadId)
    const assembledPath = join(directory, `${randomUUID()}.complete`)
    try {
      await assembleUpload(
        directory,
        assembledPath,
        upload.chunkSize,
        upload.byteSize,
      )
      const lecture = await this.lectures.attachUploadedAudio(
        userId,
        lectureId,
        {
          path: assembledPath,
          originalname: upload.originalFileName,
          expectedSha256: upload.sha256,
        },
        upload.id,
        capture,
      )
      await this.removeDirectory(directory)
      return lecture
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof UnsupportedMediaTypeException ||
        error instanceof ConflictException
      ) {
        await this.repository.cancelAudioUpload(uploadId)
        await this.removeDirectory(directory)
      }
      throw error
    } finally {
      await rm(assembledPath, { force: true })
    }
  }

  async cancel(
    userId: string,
    lectureId: string,
    uploadId: string,
  ): Promise<void> {
    const upload = await this.requireUpload(userId, lectureId, uploadId)
    if (upload.status === 'completed') {
      throw new ConflictException('A completed upload cannot be cancelled.')
    }
    if (upload.status === 'active') {
      await this.repository.cancelAudioUpload(uploadId)
    }
    await this.removeDirectory(this.directory(uploadId))
  }

  async cancelActive(userId: string, lectureId: string): Promise<void> {
    const { lecture } = await this.lectures.assertCanManageLecture(
      userId,
      lectureId,
    )
    await this.expireSessions(lectureId)
    const active = await this.repository.findActiveAudioUpload(
      lectureId,
      lecture.lecture.institutionId,
    )
    if (active) {
      await this.repository.cancelAudioUpload(active.id)
      await this.removeDirectory(this.directory(active.id))
    }
  }

  private async requireActive(
    userId: string,
    lectureId: string,
    uploadId: string,
  ): Promise<LectureAudioUpload> {
    const upload = await this.requireUpload(userId, lectureId, uploadId)
    if (upload.status !== 'active') {
      throw new GoneException('The upload session is no longer active.')
    }
    if (upload.expiresAt.getTime() <= Date.now()) {
      await this.expireSessions(lectureId)
      throw new GoneException('The upload session expired. Start it again.')
    }
    return upload
  }

  private async requireUpload(
    userId: string,
    lectureId: string,
    uploadId: string,
  ): Promise<LectureAudioUpload> {
    if (!isUuid(uploadId)) {
      throw new NotFoundException()
    }
    const { lecture } = await this.lectures.assertCanManageLecture(
      userId,
      lectureId,
    )
    const upload = await this.repository.findAudioUpload(
      uploadId,
      lectureId,
      lecture.lecture.institutionId,
    )
    if (!upload) {
      throw new NotFoundException()
    }
    return upload
  }

  private existingOrConflict(
    existing: LectureAudioUpload,
    fileName: string,
    input: { byteSize: number; sha256: string },
  ): AudioUploadView {
    if (
      existing.originalFileName !== fileName ||
      existing.byteSize !== input.byteSize ||
      existing.sha256 !== input.sha256
    ) {
      throw new ConflictException(
        'A different upload is already active for this lecture. Resume or cancel it first.',
      )
    }
    return toAudioUploadView(existing)
  }

  private async expireSessions(lectureId: string): Promise<void> {
    const expired = await this.repository.expireAudioUploads(
      lectureId,
      new Date(),
    )
    await Promise.all(
      expired.map((upload) => this.removeDirectory(this.directory(upload.id))),
    )
  }

  private directory(uploadId: string): string {
    return uploadSessionDirectory(this.temporaryRoot, uploadId)
  }

  private async removeDirectory(path: string): Promise<void> {
    try {
      await rm(path, { recursive: true, force: true })
    } catch (error) {
      this.logger.warn(
        `Failed to clean an upload session directory: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      )
    }
  }
}

function toAudioUploadView(upload: LectureAudioUpload): AudioUploadView {
  return {
    id: upload.id,
    lectureId: upload.lectureId,
    fileName: upload.originalFileName,
    byteSize: upload.byteSize,
    receivedBytes: upload.receivedBytes,
    chunkSize: upload.chunkSize,
    sha256: upload.sha256,
    status: upload.status,
    expiresAt: upload.expiresAt.toISOString(),
  }
}

function parseUploadOffset(input: string | undefined): number {
  if (!input || !/^\d+$/.test(input)) {
    throw new BadRequestException(
      'Upload-Offset must be a non-negative integer.',
    )
  }
  const offset = Number(input)
  if (!Number.isSafeInteger(offset)) {
    throw new BadRequestException('Upload-Offset is too large.')
  }
  return offset
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  )
}

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('cause' in error)) {
    return false
  }
  const cause = error.cause
  return (
    typeof cause === 'object' &&
    cause !== null &&
    'code' in cause &&
    cause.code === '23505'
  )
}
