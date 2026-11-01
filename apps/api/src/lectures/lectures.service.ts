import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import type { Readable } from 'node:stream'
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnsupportedMediaTypeException,
} from '@nestjs/common'
import { AUDIO_STORAGE, type AudioStorage } from './audio-storage.js'
import { inspectAudio, parseByteRange, type ByteRange } from './audio.js'
import {
  AudioUploadStateChangedError,
  LecturesRepository,
  type LectureAudio,
  type LectureAudioDerivative,
  type LectureContext,
  type OfferingAccess,
  type OfferingContext,
} from './lectures.repository.js'
import { MediaJobsService } from './media-jobs.service.js'

interface OfferingView {
  id: string
  section: string
  status: string
  institution: { id: string; slug: string; name: string }
  course: { code: string; title: string }
  term: { code: string; name: string }
  access: { canManage: boolean; canStudy: boolean }
}

type DataSaverView =
  | { status: 'pending' | 'processing' | 'failed' }
  | {
      status: 'ready'
      mediaType: string
      byteSize: number
      sha256: string
      url: string
      downloadUrl: string
    }

interface AudioView {
  originalFileName: string
  mediaType: string
  byteSize: number
  sha256: string
  url: string
  downloadUrl: string
  dataSaver: DataSaverView | null
}

export interface LectureView {
  id: string
  title: string
  description: string | null
  occurredAt: string
  status: string
  publishedAt: string | null
  audio: AudioView | null
}

interface ManageContext {
  lecture: LectureContext
  access: OfferingAccess & { membershipId: string }
}

interface OpenedAudio {
  stream: Readable | null
  range: ByteRange
  mediaType: string
  byteSize: number
  etag: string
  fileName: string
}

export interface OpenAudioOptions {
  rangeHeader?: string
  ifRangeHeader?: string
  variant?: 'original' | 'data-saver'
}

@Injectable()
export class LecturesService {
  private readonly logger = new Logger(LecturesService.name)

  constructor(
    @Inject(LecturesRepository)
    private readonly repository: LecturesRepository,
    @Inject(AUDIO_STORAGE) private readonly storage: AudioStorage,
    @Inject(MediaJobsService) private readonly mediaJobs: MediaJobsService,
  ) {}

  async listOfferings(userId: string): Promise<OfferingView[]> {
    const now = new Date()
    const [teaching, studying] = await Promise.all([
      this.repository.listTeachingOfferings(userId, now),
      this.repository.listStudyingOfferings(userId, now),
    ])
    const offerings = new Map<string, OfferingView>()

    for (const context of teaching) {
      offerings.set(
        context.offering.id,
        toOfferingView(context, { canManage: true, canStudy: false }),
      )
    }
    for (const context of studying) {
      const existing = offerings.get(context.offering.id)
      if (existing) {
        existing.access.canStudy = true
      } else {
        offerings.set(
          context.offering.id,
          toOfferingView(context, { canManage: false, canStudy: true }),
        )
      }
    }
    return [...offerings.values()]
  }

  async listLectures(
    userId: string,
    offeringId: string,
  ): Promise<LectureView[]> {
    if (!isUuid(offeringId)) {
      throw new NotFoundException()
    }
    const offering = await this.repository.findOffering(offeringId)
    if (!offering || !isReadableOffering(offering)) {
      throw new NotFoundException()
    }
    const access = await this.repository.getAccess(
      userId,
      offering.offering.institutionId,
      offeringId,
      new Date(),
    )
    if (!access.canManage && !access.canStudy) {
      throw new NotFoundException()
    }

    const rows = await this.repository.listLectures(offeringId)
    return rows
      .filter(
        (context) => access.canManage || context.lecture.status === 'published',
      )
      .map(toLectureView)
  }

  async createLecture(
    userId: string,
    offeringId: string,
    input: { title: string; description?: string; occurredAt: string },
  ): Promise<LectureView> {
    const { offering, access } = await this.assertCanManageOffering(
      userId,
      offeringId,
    )
    const created = await this.repository.insertLecture({
      institutionId: offering.offering.institutionId,
      courseOfferingId: offeringId,
      createdByMembershipId: access.membershipId,
      title: cleanLectureTitle(input.title),
      description: cleanLectureDescription(input.description),
      occurredAt: parseLectureDate(input.occurredAt),
    })
    return toLectureView({
      ...offering,
      lecture: created,
      audio: null,
      dataSaver: null,
    })
  }

  async updateLecture(
    userId: string,
    lectureId: string,
    input: { title?: string; description?: string; occurredAt?: string },
  ): Promise<LectureView> {
    const { lecture } = await this.assertCanManageLecture(userId, lectureId)
    if (lecture.lecture.status === 'archived') {
      throw new ConflictException('An archived lecture cannot be edited.')
    }
    if (Object.keys(input).length === 0) {
      throw new BadRequestException('Provide at least one lecture change.')
    }
    const updated = await this.repository.updateLecture(
      lectureId,
      lecture.lecture.institutionId,
      {
        ...(input.title === undefined
          ? {}
          : { title: cleanLectureTitle(input.title) }),
        ...(input.description === undefined
          ? {}
          : { description: cleanLectureDescription(input.description) }),
        ...(input.occurredAt === undefined
          ? {}
          : { occurredAt: parseLectureDate(input.occurredAt) }),
      },
    )
    if (!updated) {
      throw new NotFoundException()
    }
    return toLectureView({ ...lecture, lecture: updated })
  }

  async getManagedLecture(
    userId: string,
    lectureId: string,
  ): Promise<LectureView> {
    const { lecture } = await this.assertCanManageLecture(userId, lectureId)
    return toLectureView(lecture)
  }

  async assertCanManageOffering(
    userId: string,
    offeringId: string,
  ): Promise<{
    offering: OfferingContext
    access: OfferingAccess & { membershipId: string }
  }> {
    if (!isUuid(offeringId)) {
      throw new NotFoundException()
    }
    const offering = await this.repository.findOffering(offeringId)
    if (!offering || offering.offering.status !== 'active') {
      throw new NotFoundException()
    }
    const access = await this.repository.getAccess(
      userId,
      offering.offering.institutionId,
      offeringId,
      new Date(),
    )
    const membershipId = access.membershipId
    if (!access.canManage || !membershipId) {
      throw new NotFoundException()
    }
    return { offering, access: { ...access, membershipId } }
  }

  async assertCanManageLecture(
    userId: string,
    lectureId: string,
  ): Promise<ManageContext> {
    if (!isUuid(lectureId)) {
      throw new NotFoundException()
    }
    const lecture = await this.repository.findLecture(lectureId)
    if (!lecture || lecture.offering.status !== 'active') {
      throw new NotFoundException()
    }
    const access = await this.repository.getAccess(
      userId,
      lecture.lecture.institutionId,
      lecture.lecture.courseOfferingId,
      new Date(),
    )
    const membershipId = access.membershipId
    if (!access.canManage || !membershipId) {
      throw new NotFoundException()
    }
    return { lecture, access: { ...access, membershipId } }
  }

  async attachAudio(
    userId: string,
    lectureId: string,
    file: Express.Multer.File,
  ): Promise<LectureView> {
    return this.attachUploadedAudio(userId, lectureId, file)
  }

  async attachUploadedAudio(
    userId: string,
    lectureId: string,
    file: { path: string; originalname: string; expectedSha256?: string },
    completedUploadId?: string,
  ): Promise<LectureView> {
    const { lecture, access } = await this.assertCanManageLecture(
      userId,
      lectureId,
    )
    if (lecture.lecture.status !== 'draft' || lecture.audio) {
      throw new ConflictException(
        'This lecture already has an original recording.',
      )
    }

    let saved = false
    let key = ''
    try {
      let inspected
      try {
        inspected = await inspectAudio(file.path)
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === 'Unsupported audio signature.'
        ) {
          throw new UnsupportedMediaTypeException(
            'Upload an MP3, WAV, or M4A audio file.',
          )
        }
        throw new BadRequestException('The uploaded audio file is invalid.')
      }

      if (file.expectedSha256 && inspected.sha256 !== file.expectedSha256) {
        throw new BadRequestException(
          'The assembled upload does not match its expected checksum. Start the upload again.',
        )
      }
      key = `${lecture.lecture.institutionId}/${lectureId}/${randomUUID()}.${audioFileExtension(inspected.mediaType)}`
      await this.mediaJobs.ready()
      await this.storage.save(key, file.path)
      saved = true
      try {
        const { audio, dataSaver } = await this.repository.insertAudio(
          {
            lectureId,
            institutionId: lecture.lecture.institutionId,
            uploadedByMembershipId: access.membershipId,
            storageProvider: this.storage.provider,
            storageKey: key,
            originalFileName: cleanAudioFileName(file.originalname),
            mediaType: inspected.mediaType,
            byteSize: inspected.byteSize,
            sha256: inspected.sha256,
          },
          (transaction, derivative) =>
            this.mediaJobs.publishDataSaver(derivative, transaction),
          completedUploadId,
        )
        return toLectureView({ ...lecture, audio, dataSaver })
      } catch (error) {
        if (error instanceof AudioUploadStateChangedError) {
          throw new ConflictException(
            'The upload session changed. Check its status before retrying.',
          )
        }
        if (isUniqueViolation(error)) {
          throw new ConflictException(
            'This lecture already has an original recording.',
          )
        }
        throw error
      }
    } catch (error) {
      if (saved) {
        try {
          await this.storage.delete(key)
        } catch (cleanupError) {
          this.logger.error(
            'Failed to compensate a stored audio object.',
            cleanupError instanceof Error ? cleanupError.stack : undefined,
          )
        }
      }
      throw error
    } finally {
      try {
        await rm(file.path, { force: true })
      } catch (cleanupError) {
        this.logger.warn(
          `Failed to remove an upload temporary file: ${
            cleanupError instanceof Error ? cleanupError.message : 'unknown'
          }`,
        )
      }
    }
  }

  async publish(userId: string, lectureId: string): Promise<LectureView> {
    const { lecture } = await this.assertCanManageLecture(userId, lectureId)
    if (!lecture.audio) {
      throw new ConflictException(
        'Upload the original recording before publishing.',
      )
    }
    if (lecture.lecture.status === 'published') {
      return toLectureView(lecture)
    }
    if (lecture.lecture.status !== 'draft') {
      throw new ConflictException('An archived lecture cannot be published.')
    }
    try {
      await this.storage.verify(
        lecture.audio.storageKey,
        lecture.audio.byteSize,
      )
    } catch (error) {
      this.logger.error(
        'Stored audio failed the publication check.',
        error instanceof Error ? error.stack : undefined,
      )
      throw new ServiceUnavailableException(
        'The recording is temporarily unavailable.',
      )
    }

    const published = await this.repository.markPublished(
      lectureId,
      lecture.lecture.institutionId,
      new Date(),
    )
    if (!published) {
      throw new ConflictException('The lecture publication state changed.')
    }
    return toLectureView({ ...lecture, lecture: published })
  }

  async openAudio(
    userId: string,
    lectureId: string,
    options: OpenAudioOptions = {},
  ): Promise<OpenedAudio> {
    if (!isUuid(lectureId)) {
      throw new NotFoundException()
    }
    const lecture = await this.repository.findLecture(lectureId)
    if (!lecture || !isReadableOffering(lecture) || !lecture.audio) {
      throw new NotFoundException()
    }
    const access = await this.repository.getAccess(
      userId,
      lecture.lecture.institutionId,
      lecture.lecture.courseOfferingId,
      new Date(),
    )
    const lecturerAccess = access.canManage
    const studentAccess =
      access.canStudy && lecture.lecture.status === 'published'
    if (!lecturerAccess && !studentAccess) {
      throw new NotFoundException()
    }

    const media =
      options.variant === 'data-saver'
        ? readyDataSaver(lecture.audio, lecture.dataSaver)
        : {
            storageKey: lecture.audio.storageKey,
            mediaType: lecture.audio.mediaType,
            byteSize: lecture.audio.byteSize,
            sha256: lecture.audio.sha256,
            fileName: lecture.audio.originalFileName,
          }
    const etag = `"${media.sha256}"`
    const rangeHeader =
      options.ifRangeHeader && options.ifRangeHeader !== etag
        ? undefined
        : options.rangeHeader
    const range = parseByteRange(rangeHeader, media.byteSize)
    if (range.kind === 'unsatisfiable') {
      return {
        stream: null,
        range,
        mediaType: media.mediaType,
        byteSize: media.byteSize,
        etag,
        fileName: media.fileName,
      }
    }

    try {
      const stream =
        range.kind === 'single'
          ? await this.storage.open(
              media.storageKey,
              media.byteSize,
              range.start,
              range.end,
            )
          : await this.storage.open(media.storageKey, media.byteSize)
      return {
        stream,
        range,
        mediaType: media.mediaType,
        byteSize: media.byteSize,
        etag,
        fileName: media.fileName,
      }
    } catch (error) {
      this.logger.error(
        'Stored audio could not be opened.',
        error instanceof Error ? error.stack : undefined,
      )
      throw new ServiceUnavailableException(
        'The recording is temporarily unavailable.',
      )
    }
  }
}

function toOfferingView(
  context: OfferingContext,
  access: { canManage: boolean; canStudy: boolean },
): OfferingView {
  return {
    id: context.offering.id,
    section: context.offering.section,
    status: context.offering.status,
    institution: {
      id: context.institution.id,
      slug: context.institution.slug,
      name: context.institution.name,
    },
    course: { code: context.course.code, title: context.course.title },
    term: { code: context.term.code, name: context.term.name },
    access,
  }
}

function toLectureView(context: LectureContext): LectureView {
  return {
    id: context.lecture.id,
    title: context.lecture.title,
    description: context.lecture.description,
    occurredAt: context.lecture.occurredAt.toISOString(),
    status: context.lecture.status,
    publishedAt: context.lecture.publishedAt?.toISOString() ?? null,
    audio: context.audio ? toAudioView(context.audio, context.dataSaver) : null,
  }
}

function toAudioView(
  audio: LectureAudio,
  dataSaver: LectureAudioDerivative | null,
): AudioView {
  return {
    originalFileName: audio.originalFileName,
    mediaType: audio.mediaType,
    byteSize: audio.byteSize,
    sha256: audio.sha256,
    url: `/api/lectures/${audio.lectureId}/audio`,
    downloadUrl: `/api/lectures/${audio.lectureId}/audio/download`,
    dataSaver: dataSaver ? toDataSaverView(dataSaver) : null,
  }
}

function toDataSaverView(derivative: LectureAudioDerivative): DataSaverView {
  if (
    derivative.status === 'ready' &&
    derivative.byteSize !== null &&
    derivative.sha256 !== null
  ) {
    return {
      status: 'ready',
      mediaType: derivative.mediaType,
      byteSize: derivative.byteSize,
      sha256: derivative.sha256,
      url: `/api/lectures/${derivative.lectureId}/audio/data-saver`,
      downloadUrl: `/api/lectures/${derivative.lectureId}/audio/data-saver/download`,
    }
  }
  return {
    status:
      derivative.status === 'processing' || derivative.status === 'failed'
        ? derivative.status
        : 'pending',
  }
}

function readyDataSaver(
  original: LectureAudio,
  derivative: LectureAudioDerivative | null,
) {
  if (
    !derivative ||
    derivative.status !== 'ready' ||
    derivative.storageKey === null ||
    derivative.byteSize === null ||
    derivative.sha256 === null
  ) {
    throw new NotFoundException()
  }
  const suffix = '-data-saver.m4a'
  const originalBase = original.originalFileName.replace(/\.[^.]+$/, '')
  return {
    storageKey: derivative.storageKey,
    mediaType: derivative.mediaType,
    byteSize: derivative.byteSize,
    sha256: derivative.sha256,
    fileName: `${originalBase.slice(0, 255 - suffix.length)}${suffix}`,
  }
}

export function cleanAudioFileName(input: string): string {
  const candidate = input.replaceAll('\\', '/').split('/').at(-1)
  const base = candidate
    ? Array.from(candidate)
        .filter((character) => {
          const code = character.charCodeAt(0)
          return code > 31 && code !== 127
        })
        .join('')
        .trim()
    : ''
  return (base || 'recording').slice(0, 255)
}

function cleanLectureTitle(input: string): string {
  const title = input.trim()
  if (title.length === 0 || title.length > 200) {
    throw new BadRequestException(
      'Lecture titles must contain 1–200 characters.',
    )
  }
  return title
}

function cleanLectureDescription(input: string | undefined): string | null {
  const description = input?.trim() ?? ''
  return description.length > 0 ? description : null
}

function parseLectureDate(input: string): Date {
  const date = new Date(input)
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException('Provide a valid lecture date and time.')
  }
  return date
}

function audioFileExtension(mediaType: string): string {
  switch (mediaType) {
    case 'audio/mpeg':
      return 'mp3'
    case 'audio/wav':
      return 'wav'
    case 'audio/mp4':
      return 'm4a'
    default:
      throw new Error('Unsupported inspected audio media type.')
  }
}

function isReadableOffering(context: OfferingContext): boolean {
  return ['active', 'completed'].includes(context.offering.status)
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
