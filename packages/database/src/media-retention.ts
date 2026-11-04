import { and, eq, inArray, isNull } from 'drizzle-orm'
import type { Database, DatabaseTransaction } from './client.js'
import {
  lectureAudio,
  lectureAudioDerivatives,
  lectureAudioUploads,
  lectureMediaDeletions,
  lectureMediaHolds,
  lectures,
  mediaObjectIntents,
} from './schema/index.js'

type Executor = Database | DatabaseTransaction

export type LectureMediaDeletion = typeof lectureMediaDeletions.$inferSelect
export type LectureMediaHold = typeof lectureMediaHolds.$inferSelect

export type MediaRetentionErrorCode =
  | 'invalid-reason'
  | 'lecture-not-found'
  | 'media-deleted'
  | 'no-audio'
  | 'active-hold'
  | 'hold-released'

export class MediaRetentionError extends Error {
  constructor(
    readonly code: MediaRetentionErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'MediaRetentionError'
  }
}

/**
 * Serialize a new media write with intentional deletion. A share lock lets
 * ordinary writes proceed concurrently, while deletion's lecture-row write
 * lock waits for them and prevents later writes from resurrecting the media.
 */
export async function assertLectureMediaWriteAllowed(
  db: Executor,
  institutionId: string,
  lectureId: string,
): Promise<void> {
  const [lecture] = await db
    .select({ id: lectures.id })
    .from(lectures)
    .where(
      and(
        eq(lectures.id, lectureId),
        eq(lectures.institutionId, institutionId),
      ),
    )
    .limit(1)
    .for('share')
  if (!lecture) {
    throw new MediaRetentionError(
      'lecture-not-found',
      'The lecture was not found.',
    )
  }
  const [deletion] = await db
    .select({ id: lectureMediaDeletions.id })
    .from(lectureMediaDeletions)
    .where(
      and(
        eq(lectureMediaDeletions.lectureId, lectureId),
        eq(lectureMediaDeletions.institutionId, institutionId),
      ),
    )
    .limit(1)
  if (deletion) {
    throw new MediaRetentionError(
      'media-deleted',
      'The institution deleted this lecture media. Create a new lecture instead of replacing it.',
    )
  }
}

export async function placeLectureMediaHold(
  db: Database,
  input: {
    institutionId: string
    lectureId: string
    createdByMembershipId: string
    reason: string
  },
): Promise<LectureMediaHold> {
  return db.transaction(async (transaction) => {
    await assertLectureMediaWriteAllowed(
      transaction,
      input.institutionId,
      input.lectureId,
    )
    const [audio] = await transaction
      .select({ lectureId: lectureAudio.lectureId })
      .from(lectureAudio)
      .where(
        and(
          eq(lectureAudio.lectureId, input.lectureId),
          eq(lectureAudio.institutionId, input.institutionId),
        ),
      )
      .limit(1)
    if (!audio) {
      throw new MediaRetentionError(
        'no-audio',
        'This lecture has no committed recording.',
      )
    }
    const [hold] = await transaction
      .insert(lectureMediaHolds)
      .values({
        institutionId: input.institutionId,
        lectureId: input.lectureId,
        createdByMembershipId: input.createdByMembershipId,
        reason: retentionReason(input.reason),
      })
      .returning()
    if (!hold) {
      throw new Error('The lecture media hold was not returned.')
    }
    return hold
  })
}

export async function releaseLectureMediaHold(
  db: Database,
  input: {
    id: string
    institutionId: string
    releasedByMembershipId: string
    reason: string
  },
): Promise<LectureMediaHold | null> {
  return db.transaction(async (transaction) => {
    const [existing] = await transaction
      .select()
      .from(lectureMediaHolds)
      .where(
        and(
          eq(lectureMediaHolds.id, input.id),
          eq(lectureMediaHolds.institutionId, input.institutionId),
        ),
      )
      .limit(1)
      .for('update')
    if (!existing) {
      return null
    }
    if (existing.releasedAt) {
      throw new MediaRetentionError(
        'hold-released',
        'This retention hold has already been released.',
      )
    }
    const [released] = await transaction
      .update(lectureMediaHolds)
      .set({
        releasedAt: new Date(),
        releasedByMembershipId: input.releasedByMembershipId,
        releaseReason: retentionReason(input.reason),
      })
      .where(eq(lectureMediaHolds.id, existing.id))
      .returning()
    if (!released) {
      throw new Error('The released lecture media hold was not returned.')
    }
    return released
  })
}

export async function requestLectureMediaDeletion(
  db: Database,
  input: {
    institutionId: string
    lectureId: string
    requestedByMembershipId: string
    reason: string
  },
): Promise<{ deletion: LectureMediaDeletion; created: boolean }> {
  return db.transaction(async (transaction) => {
    const [lecture] = await transaction
      .select({ id: lectures.id })
      .from(lectures)
      .where(
        and(
          eq(lectures.id, input.lectureId),
          eq(lectures.institutionId, input.institutionId),
        ),
      )
      .limit(1)
      .for('update')
    if (!lecture) {
      throw new MediaRetentionError(
        'lecture-not-found',
        'The lecture was not found.',
      )
    }

    const [existing] = await transaction
      .select()
      .from(lectureMediaDeletions)
      .where(
        and(
          eq(lectureMediaDeletions.lectureId, input.lectureId),
          eq(lectureMediaDeletions.institutionId, input.institutionId),
        ),
      )
      .limit(1)
    if (existing) {
      return { deletion: existing, created: false }
    }

    const [activeHold] = await transaction
      .select({ id: lectureMediaHolds.id })
      .from(lectureMediaHolds)
      .where(
        and(
          eq(lectureMediaHolds.lectureId, input.lectureId),
          eq(lectureMediaHolds.institutionId, input.institutionId),
          isNull(lectureMediaHolds.releasedAt),
        ),
      )
      .limit(1)
    if (activeHold) {
      throw new MediaRetentionError(
        'active-hold',
        'Release the active retention hold before deleting this media.',
      )
    }

    const [audio] = await transaction
      .select()
      .from(lectureAudio)
      .where(
        and(
          eq(lectureAudio.lectureId, input.lectureId),
          eq(lectureAudio.institutionId, input.institutionId),
        ),
      )
      .limit(1)
      .for('update')
    if (!audio) {
      throw new MediaRetentionError(
        'no-audio',
        'This lecture has no committed recording.',
      )
    }

    const [deletion] = await transaction
      .insert(lectureMediaDeletions)
      .values({
        institutionId: input.institutionId,
        lectureId: input.lectureId,
        requestedByMembershipId: input.requestedByMembershipId,
        reason: retentionReason(input.reason),
        originalFileName: audio.originalFileName,
        originalMediaType: audio.mediaType,
        originalByteSize: audio.byteSize,
        originalSha256: audio.sha256,
      })
      .returning()
    if (!deletion) {
      throw new Error('The lecture media deletion was not returned.')
    }

    const now = new Date()
    await transaction
      .update(mediaObjectIntents)
      .set({
        status: 'deleting',
        deletionRequestId: deletion.id,
        updatedAt: now,
      })
      .where(
        and(
          eq(mediaObjectIntents.lectureId, input.lectureId),
          eq(mediaObjectIntents.institutionId, input.institutionId),
          inArray(mediaObjectIntents.status, [
            'pending',
            'attached',
            'deleting',
          ]),
        ),
      )
    await transaction
      .update(lectureAudioUploads)
      .set({ status: 'expired', updatedAt: now })
      .where(
        and(
          eq(lectureAudioUploads.lectureId, input.lectureId),
          eq(lectureAudioUploads.institutionId, input.institutionId),
          eq(lectureAudioUploads.status, 'active'),
        ),
      )
    await transaction
      .delete(lectureAudioDerivatives)
      .where(
        and(
          eq(lectureAudioDerivatives.lectureId, input.lectureId),
          eq(lectureAudioDerivatives.institutionId, input.institutionId),
        ),
      )
    await transaction
      .delete(lectureAudio)
      .where(
        and(
          eq(lectureAudio.lectureId, input.lectureId),
          eq(lectureAudio.institutionId, input.institutionId),
        ),
      )

    return { deletion, created: true }
  })
}

function retentionReason(value: string): string {
  const reason = value.trim()
  if (!reason || reason.length > 500) {
    throw new MediaRetentionError(
      'invalid-reason',
      'A reason between 1 and 500 characters is required.',
    )
  }
  return reason
}
