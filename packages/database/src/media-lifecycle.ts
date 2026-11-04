import {
  and,
  asc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  notExists,
  or,
  sql,
} from 'drizzle-orm'
import type { Database, DatabaseTransaction } from './client.js'
import { assertLectureMediaWriteAllowed } from './media-retention.js'
import {
  lectureAudio,
  lectureAudioDerivatives,
  lectureMediaDeletions,
  mediaObjectIntents,
} from './schema/index.js'

type Executor = Database | DatabaseTransaction

export type MediaObjectIntent = typeof mediaObjectIntents.$inferSelect
export type NewMediaObjectIntent = typeof mediaObjectIntents.$inferInsert

export interface MediaObjectAttachment {
  kind: 'original' | 'data_saver'
  storageProvider: string
  storageKey: string
  byteSize: number
  sha256: string
}

export class MediaObjectStateChangedError extends Error {
  constructor() {
    super(
      'The media object lifecycle state changed before it could be attached.',
    )
    this.name = 'MediaObjectStateChangedError'
  }
}

/** Allocate the UUIDv7 before constructing the storage key that contains it. */
export async function newMediaObjectIntentId(db: Executor): Promise<string> {
  const result = await db.execute<{ id: string }>(sql`SELECT uuidv7() AS id`)
  const id = result.rows[0]?.id
  if (!id) {
    throw new Error('PostgreSQL did not allocate a media object intent ID.')
  }
  return id
}

/** Record the intended write before the storage write is attempted. */
export async function createMediaObjectIntent(
  db: Executor,
  value: NewMediaObjectIntent,
): Promise<MediaObjectIntent> {
  return db.transaction(async (transaction) => {
    await assertLectureMediaWriteAllowed(
      transaction,
      value.institutionId,
      value.lectureId,
    )
    const rows = await transaction
      .insert(mediaObjectIntents)
      .values(value)
      .returning()
    const intent = rows[0]
    if (!intent) {
      throw new Error('The media object intent was not created.')
    }
    return intent
  })
}

/**
 * Attach only a still-pending intent. This runs in the same transaction as the
 * lecture audio or derivative row so reconciliation cannot race a committed
 * reference with a delete.
 */
export async function attachMediaObjectIntent(
  db: Executor,
  intentId: string,
  expected: MediaObjectAttachment,
): Promise<void> {
  const attached = await db
    .update(mediaObjectIntents)
    .set({ status: 'attached', attachedAt: new Date() })
    .where(
      and(
        eq(mediaObjectIntents.id, intentId),
        eq(mediaObjectIntents.status, 'pending'),
        eq(mediaObjectIntents.kind, expected.kind),
        eq(mediaObjectIntents.storageProvider, expected.storageProvider),
        eq(mediaObjectIntents.storageKey, expected.storageKey),
        eq(mediaObjectIntents.byteSize, expected.byteSize),
        eq(mediaObjectIntents.sha256, expected.sha256),
      ),
    )
    .returning({ id: mediaObjectIntents.id })
  if (attached.length !== 1) {
    throw new MediaObjectStateChangedError()
  }
}

/**
 * Durably authorize compensation before deleting storage. An attached or
 * deleted intent returns null; a database error is propagated and must not be
 * treated as permission to delete.
 */
export async function requestMediaObjectDeletion(
  db: Executor,
  intentId: string,
): Promise<MediaObjectIntent | null> {
  const updated = await db
    .update(mediaObjectIntents)
    .set({ status: 'deleting', updatedAt: new Date() })
    .where(
      and(
        eq(mediaObjectIntents.id, intentId),
        eq(mediaObjectIntents.status, 'pending'),
      ),
    )
    .returning()
  if (updated[0]) {
    return updated[0]
  }

  const current = await db
    .select()
    .from(mediaObjectIntents)
    .where(eq(mediaObjectIntents.id, intentId))
    .limit(1)
  return current[0]?.status === 'deleting' ? current[0] : null
}

export async function markMediaObjectDeleted(
  db: Executor,
  intentId: string,
): Promise<void> {
  await db.transaction(async (transaction) => {
    const [deleted] = await transaction
      .update(mediaObjectIntents)
      .set({ status: 'deleted', deletedAt: new Date() })
      .where(
        and(
          eq(mediaObjectIntents.id, intentId),
          eq(mediaObjectIntents.status, 'deleting'),
        ),
      )
      .returning({ deletionRequestId: mediaObjectIntents.deletionRequestId })
    if (!deleted?.deletionRequestId) {
      return
    }

    // Concurrent objects can finish together. Serialize their final checks on
    // the request row so the last commit observes every other deleted intent.
    const [deletion] = await transaction
      .select({ id: lectureMediaDeletions.id })
      .from(lectureMediaDeletions)
      .where(eq(lectureMediaDeletions.id, deleted.deletionRequestId))
      .limit(1)
      .for('update')
    if (!deletion) {
      return
    }

    await transaction
      .update(lectureMediaDeletions)
      .set({ completedAt: new Date() })
      .where(
        and(
          eq(lectureMediaDeletions.id, deleted.deletionRequestId),
          isNull(lectureMediaDeletions.completedAt),
          notExists(
            transaction
              .select({ incomplete: sql`1` })
              .from(mediaObjectIntents)
              .where(
                and(
                  eq(
                    mediaObjectIntents.deletionRequestId,
                    lectureMediaDeletions.id,
                  ),
                  ne(mediaObjectIntents.status, 'deleted'),
                ),
              ),
          ),
        ),
      )
  })
}

export async function listMediaObjectReconciliationCandidates(
  db: Executor,
  updatedBefore: Date,
  limit: number,
): Promise<MediaObjectIntent[]> {
  return db
    .select()
    .from(mediaObjectIntents)
    .where(
      and(
        inArray(mediaObjectIntents.status, ['pending', 'deleting']),
        or(
          isNotNull(mediaObjectIntents.deletionRequestId),
          lte(mediaObjectIntents.updatedAt, updatedBefore),
        ),
      ),
    )
    .orderBy(asc(mediaObjectIntents.updatedAt), asc(mediaObjectIntents.id))
    .limit(limit)
}

/** Atomically claim a candidate. Only one reconciler can claim a deleting row. */
export async function claimMediaObjectReconciliation(
  db: Executor,
  candidate: MediaObjectIntent,
): Promise<MediaObjectIntent | null> {
  const claimedAt = new Date()
  const ownership =
    candidate.status === 'pending'
      ? and(
          eq(mediaObjectIntents.id, candidate.id),
          eq(mediaObjectIntents.status, 'pending'),
        )
      : and(
          eq(mediaObjectIntents.id, candidate.id),
          eq(mediaObjectIntents.status, 'deleting'),
          eq(mediaObjectIntents.updatedAt, candidate.updatedAt),
        )
  const claimed = await db
    .update(mediaObjectIntents)
    .set({
      status: 'deleting',
      updatedAt: claimedAt,
      reconciliationAttempts: sql`${mediaObjectIntents.reconciliationAttempts} + 1`,
    })
    .where(ownership)
    .returning()
  return claimed[0] ?? null
}

/** A defensive reference check immediately before every reconciler delete. */
export async function mediaObjectReferenceExists(
  db: Executor,
  intent: Pick<MediaObjectIntent, 'storageProvider' | 'storageKey'>,
): Promise<boolean> {
  const originals = await db
    .select({ lectureId: lectureAudio.lectureId })
    .from(lectureAudio)
    .where(
      and(
        eq(lectureAudio.storageProvider, intent.storageProvider),
        eq(lectureAudio.storageKey, intent.storageKey),
      ),
    )
    .limit(1)
  if (originals.length > 0) {
    return true
  }

  const derivatives = await db
    .select({ id: lectureAudioDerivatives.id })
    .from(lectureAudioDerivatives)
    .where(
      and(
        eq(lectureAudioDerivatives.storageProvider, intent.storageProvider),
        eq(lectureAudioDerivatives.storageKey, intent.storageKey),
      ),
    )
    .limit(1)
  return derivatives.length > 0
}

export async function markMediaObjectReferenceAttached(
  db: Executor,
  intentId: string,
): Promise<void> {
  await db
    .update(mediaObjectIntents)
    .set({ status: 'attached', attachedAt: new Date() })
    .where(
      and(
        eq(mediaObjectIntents.id, intentId),
        eq(mediaObjectIntents.status, 'deleting'),
      ),
    )
}
