import {
  MediaRetentionError,
  type LectureMediaDeletion,
  type LectureMediaHold,
} from '@ctrorec/database'
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { AdminAccessService } from './admin-access.service.js'
import { AdminRepository } from './admin.repository.js'
import type {
  DeleteLectureMediaDto,
  MediaRetentionReasonDto,
} from './media-retention.dto.js'
import {
  MediaRetentionRepository,
  type MediaRetentionLectureRecord,
} from './media-retention.repository.js'

@Injectable()
export class MediaRetentionService {
  constructor(
    @Inject(MediaRetentionRepository)
    private readonly repository: MediaRetentionRepository,
    @Inject(AdminRepository)
    private readonly adminRepository: AdminRepository,
    @Inject(AdminAccessService)
    private readonly adminAccess: AdminAccessService,
  ) {}

  async listOfferingLectures(
    userId: string,
    institutionId: string,
    offeringId: string,
  ) {
    await this.adminAccess.require(userId, institutionId)
    const offering = await this.adminRepository.findOffering(
      institutionId,
      requireUuid(offeringId),
    )
    if (!offering) {
      throw new NotFoundException()
    }
    const lectures = await this.repository.listOfferingLectures(
      institutionId,
      offeringId,
    )
    return { offeringId, lectures: lectures.map(toLectureView) }
  }

  async placeHold(
    userId: string,
    institutionId: string,
    lectureId: string,
    input: MediaRetentionReasonDto,
  ) {
    const access = await this.adminAccess.require(userId, institutionId)
    try {
      const hold = await this.repository.placeHold({
        institutionId,
        lectureId: requireUuid(lectureId),
        createdByMembershipId: access.membershipId,
        reason: input.reason,
      })
      return toHoldView(hold)
    } catch (error) {
      translateRetentionError(error)
    }
  }

  async releaseHold(
    userId: string,
    institutionId: string,
    holdId: string,
    input: MediaRetentionReasonDto,
  ) {
    const access = await this.adminAccess.require(userId, institutionId)
    try {
      const hold = await this.repository.releaseHold({
        id: requireUuid(holdId),
        institutionId,
        releasedByMembershipId: access.membershipId,
        reason: input.reason,
      })
      if (!hold) {
        throw new NotFoundException()
      }
      return toHoldView(hold)
    } catch (error) {
      translateRetentionError(error)
    }
  }

  async requestDeletion(
    userId: string,
    institutionId: string,
    lectureId: string,
    input: DeleteLectureMediaDto,
  ) {
    const access = await this.adminAccess.require(userId, institutionId)
    if (input.confirmation !== 'DELETE MEDIA') {
      throw new BadRequestException('Type DELETE MEDIA to confirm deletion.')
    }
    try {
      const result = await this.repository.requestDeletion({
        institutionId,
        lectureId: requireUuid(lectureId),
        requestedByMembershipId: access.membershipId,
        reason: input.reason,
      })
      return {
        created: result.created,
        deletion: toDeletionView(result.deletion),
      }
    } catch (error) {
      translateRetentionError(error)
    }
  }
}

function toLectureView(row: MediaRetentionLectureRecord) {
  return {
    id: row.lecture.id,
    title: row.lecture.title,
    status: row.lecture.status,
    occurredAt: row.lecture.occurredAt.toISOString(),
    audio: row.audio
      ? {
          originalFileName: row.audio.originalFileName,
          mediaType: row.audio.mediaType,
          byteSize: row.audio.byteSize,
          sha256: row.audio.sha256,
        }
      : null,
    activeHold: row.hold ? toHoldView(row.hold) : null,
    deletion: row.deletion ? toDeletionView(row.deletion) : null,
  }
}

function toHoldView(hold: LectureMediaHold) {
  return {
    id: hold.id,
    lectureId: hold.lectureId,
    reason: hold.reason,
    createdAt: hold.createdAt.toISOString(),
    releasedAt: hold.releasedAt?.toISOString() ?? null,
    releaseReason: hold.releaseReason,
  }
}

function toDeletionView(deletion: LectureMediaDeletion) {
  return {
    id: deletion.id,
    lectureId: deletion.lectureId,
    reason: deletion.reason,
    originalFileName: deletion.originalFileName,
    originalMediaType: deletion.originalMediaType,
    originalByteSize: deletion.originalByteSize,
    originalSha256: deletion.originalSha256,
    requestedAt: deletion.createdAt.toISOString(),
    completedAt: deletion.completedAt?.toISOString() ?? null,
  }
}

function translateRetentionError(error: unknown): never {
  if (error instanceof MediaRetentionError) {
    if (error.code === 'invalid-reason') {
      throw new BadRequestException(error.message)
    }
    if (error.code === 'lecture-not-found') {
      throw new NotFoundException()
    }
    throw new ConflictException(error.message)
  }
  if (postgresCode(error) === '23505') {
    throw new ConflictException(
      'This lecture already has an active retention hold.',
    )
  }
  throw error
}

function postgresCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('cause' in error)) {
    return null
  }
  const cause = error.cause
  return typeof cause === 'object' &&
    cause !== null &&
    'code' in cause &&
    typeof cause.code === 'string'
    ? cause.code
    : null
}

function requireUuid(value: string): string {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  ) {
    throw new NotFoundException()
  }
  return value
}
