import type { Database } from '@ctrorec/database'
import {
  courseOfferings,
  courses,
  lectureAudio,
  lectureAudioCaptures,
  lectureAudioDerivatives,
  lectures,
} from '@ctrorec/database/schema'
import { Inject, Injectable } from '@nestjs/common'
import { and, asc, desc, eq, gte, lt } from 'drizzle-orm'
import { DATABASE } from '../database/database.constants.js'
import {
  CAPTURE_EVIDENCE_EXPORT_LIMIT,
  type CaptureEvidenceRow,
} from './capture-evidence.js'

@Injectable()
export class CaptureEvidenceRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  list(
    institutionId: string,
    filters: { from?: Date; to?: Date },
  ): Promise<CaptureEvidenceRow[]> {
    return this.db
      .select({
        captureReference: lectureAudioCaptures.clientCaptureId,
        lectureId: lectures.id,
        courseCode: courses.code,
        offeringSection: courseOfferings.section,
        lectureTitle: lectures.title,
        lectureOccurredAt: lectures.occurredAt,
        recorderMimeType: lectureAudioCaptures.recorderMimeType,
        consentAttestedAt: lectureAudioCaptures.consentAttestedAt,
        captureStartedAt: lectureAudioCaptures.startedAt,
        captureStoppedAt: lectureAudioCaptures.stoppedAt,
        captureDurationMs: lectureAudioCaptures.durationMs,
        savedChunkCount: lectureAudioCaptures.chunkCount,
        persistentStorageGranted: lectureAudioCaptures.persistentStorageGranted,
        stopReason: lectureAudioCaptures.stopReason,
        hashingDurationMs: lectureAudioCaptures.hashingDurationMs,
        uploadDurationMs: lectureAudioCaptures.uploadDurationMs,
        uploadRetryCount: lectureAudioCaptures.uploadRetryCount,
        originalMediaType: lectureAudio.mediaType,
        originalByteSize: lectureAudio.byteSize,
        originalSha256: lectureAudio.sha256,
        serverRecordedAt: lectureAudioCaptures.createdAt,
        derivativeStatus: lectureAudioDerivatives.status,
        derivativeAttempts: lectureAudioDerivatives.attempts,
        derivativeByteSize: lectureAudioDerivatives.byteSize,
        derivativeProcessingStartedAt:
          lectureAudioDerivatives.processingStartedAt,
        derivativeCompletedAt: lectureAudioDerivatives.completedAt,
      })
      .from(lectureAudioCaptures)
      .innerJoin(
        lectureAudio,
        and(
          eq(lectureAudio.lectureId, lectureAudioCaptures.lectureId),
          eq(lectureAudio.institutionId, lectureAudioCaptures.institutionId),
        ),
      )
      .innerJoin(
        lectures,
        and(
          eq(lectures.id, lectureAudioCaptures.lectureId),
          eq(lectures.institutionId, lectureAudioCaptures.institutionId),
        ),
      )
      .innerJoin(
        courseOfferings,
        and(
          eq(courseOfferings.id, lectures.courseOfferingId),
          eq(courseOfferings.institutionId, lectures.institutionId),
        ),
      )
      .innerJoin(
        courses,
        and(
          eq(courses.id, courseOfferings.courseId),
          eq(courses.institutionId, courseOfferings.institutionId),
        ),
      )
      .leftJoin(
        lectureAudioDerivatives,
        and(
          eq(lectureAudioDerivatives.lectureId, lectureAudioCaptures.lectureId),
          eq(
            lectureAudioDerivatives.institutionId,
            lectureAudioCaptures.institutionId,
          ),
          eq(lectureAudioDerivatives.kind, 'data_saver'),
        ),
      )
      .where(
        and(
          eq(lectureAudioCaptures.institutionId, institutionId),
          ...(filters.from
            ? [gte(lectureAudioCaptures.startedAt, filters.from)]
            : []),
          ...(filters.to
            ? [lt(lectureAudioCaptures.startedAt, filters.to)]
            : []),
        ),
      )
      .orderBy(
        desc(lectureAudioCaptures.startedAt),
        asc(lectureAudioCaptures.clientCaptureId),
      )
      .limit(CAPTURE_EVIDENCE_EXPORT_LIMIT + 1)
  }
}
