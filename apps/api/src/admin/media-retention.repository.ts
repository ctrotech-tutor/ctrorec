import {
  placeLectureMediaHold,
  releaseLectureMediaHold,
  requestLectureMediaDeletion,
  type Database,
  type LectureMediaDeletion,
  type LectureMediaHold,
} from '@ctrorec/database'
import {
  lectureAudio,
  lectureMediaDeletions,
  lectureMediaHolds,
  lectures,
} from '@ctrorec/database/schema'
import { Inject, Injectable } from '@nestjs/common'
import { and, desc, eq, isNotNull, isNull, or } from 'drizzle-orm'
import { DATABASE } from '../database/database.constants.js'

export interface MediaRetentionLectureRecord {
  lecture: typeof lectures.$inferSelect
  audio: typeof lectureAudio.$inferSelect | null
  deletion: LectureMediaDeletion | null
  hold: LectureMediaHold | null
}

@Injectable()
export class MediaRetentionRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async listOfferingLectures(
    institutionId: string,
    offeringId: string,
  ): Promise<MediaRetentionLectureRecord[]> {
    return this.db
      .select({
        lecture: lectures,
        audio: lectureAudio,
        deletion: lectureMediaDeletions,
        hold: lectureMediaHolds,
      })
      .from(lectures)
      .leftJoin(
        lectureAudio,
        and(
          eq(lectureAudio.lectureId, lectures.id),
          eq(lectureAudio.institutionId, lectures.institutionId),
        ),
      )
      .leftJoin(
        lectureMediaDeletions,
        and(
          eq(lectureMediaDeletions.lectureId, lectures.id),
          eq(lectureMediaDeletions.institutionId, lectures.institutionId),
        ),
      )
      .leftJoin(
        lectureMediaHolds,
        and(
          eq(lectureMediaHolds.lectureId, lectures.id),
          eq(lectureMediaHolds.institutionId, lectures.institutionId),
          isNull(lectureMediaHolds.releasedAt),
        ),
      )
      .where(
        and(
          eq(lectures.institutionId, institutionId),
          eq(lectures.courseOfferingId, offeringId),
          or(
            isNotNull(lectureAudio.lectureId),
            isNotNull(lectureMediaDeletions.id),
            isNotNull(lectureMediaHolds.id),
          ),
        ),
      )
      .orderBy(desc(lectures.occurredAt), desc(lectures.createdAt))
  }

  placeHold(input: {
    institutionId: string
    lectureId: string
    createdByMembershipId: string
    reason: string
  }): Promise<LectureMediaHold> {
    return placeLectureMediaHold(this.db, input)
  }

  releaseHold(input: {
    id: string
    institutionId: string
    releasedByMembershipId: string
    reason: string
  }): Promise<LectureMediaHold | null> {
    return releaseLectureMediaHold(this.db, input)
  }

  requestDeletion(input: {
    institutionId: string
    lectureId: string
    requestedByMembershipId: string
    reason: string
  }): Promise<{ deletion: LectureMediaDeletion; created: boolean }> {
    return requestLectureMediaDeletion(this.db, input)
  }
}
