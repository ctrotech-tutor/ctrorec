import type { Database } from '@ctrorec/database'
import { lectureAudio, lectureAudioDerivatives } from '@ctrorec/database/schema'
import type { DataSaverJob } from '@ctrorec/media'
import { Inject, Injectable } from '@nestjs/common'
import { and, eq, sql } from 'drizzle-orm'
import { DATABASE } from '../database/database.constants.js'

type LectureAudio = typeof lectureAudio.$inferSelect
type Derivative = typeof lectureAudioDerivatives.$inferSelect

export interface ClaimedDataSaver {
  audio: LectureAudio
  derivative: Derivative & { processingStartedAt: Date }
}

export interface ReadyDataSaver {
  storageProvider: string
  storageKey: string
  byteSize: number
  sha256: string
}

@Injectable()
export class DataSaverRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async claim(job: DataSaverJob): Promise<ClaimedDataSaver | null> {
    return this.db.transaction(async (transaction) => {
      const [existing] = await transaction
        .select({ derivative: lectureAudioDerivatives, audio: lectureAudio })
        .from(lectureAudioDerivatives)
        .innerJoin(
          lectureAudio,
          and(
            eq(lectureAudioDerivatives.lectureId, lectureAudio.lectureId),
            eq(
              lectureAudioDerivatives.institutionId,
              lectureAudio.institutionId,
            ),
          ),
        )
        .where(
          and(
            eq(lectureAudioDerivatives.id, job.derivativeId),
            eq(lectureAudioDerivatives.lectureId, job.lectureId),
            eq(lectureAudioDerivatives.sourceSha256, job.sourceSha256),
          ),
        )
        .limit(1)
      if (!existing || existing.audio.sha256 !== job.sourceSha256) {
        throw new Error('The derivative source no longer matches its job.')
      }
      if (existing.derivative.status === 'ready') {
        return null
      }

      const [claimed] = await transaction
        .update(lectureAudioDerivatives)
        .set({
          status: 'processing',
          processingStartedAt: new Date(),
          attempts: sql`${lectureAudioDerivatives.attempts} + 1`,
        })
        .where(
          and(
            eq(lectureAudioDerivatives.id, existing.derivative.id),
            eq(lectureAudioDerivatives.status, existing.derivative.status),
          ),
        )
        .returning()
      if (!claimed?.processingStartedAt) {
        throw new Error('The derivative was claimed by another worker.')
      }
      return {
        audio: existing.audio,
        derivative: {
          ...claimed,
          processingStartedAt: claimed.processingStartedAt,
        },
      }
    })
  }

  async markReady(
    derivativeId: string,
    processingStartedAt: Date,
    ready: ReadyDataSaver,
  ): Promise<boolean> {
    const [updated] = await this.db
      .update(lectureAudioDerivatives)
      .set({
        status: 'ready',
        storageProvider: ready.storageProvider,
        storageKey: ready.storageKey,
        byteSize: ready.byteSize,
        sha256: ready.sha256,
        processingStartedAt: null,
        completedAt: new Date(),
      })
      .where(
        and(
          eq(lectureAudioDerivatives.id, derivativeId),
          eq(lectureAudioDerivatives.processingStartedAt, processingStartedAt),
          eq(lectureAudioDerivatives.status, 'processing'),
        ),
      )
      .returning({ id: lectureAudioDerivatives.id })
    return updated !== undefined
  }

  async markFailed(
    derivativeId: string,
    processingStartedAt: Date,
  ): Promise<boolean> {
    const [updated] = await this.db
      .update(lectureAudioDerivatives)
      .set({
        status: 'failed',
        processingStartedAt: null,
      })
      .where(
        and(
          eq(lectureAudioDerivatives.id, derivativeId),
          eq(lectureAudioDerivatives.processingStartedAt, processingStartedAt),
          eq(lectureAudioDerivatives.status, 'processing'),
        ),
      )
      .returning({ id: lectureAudioDerivatives.id })
    return updated !== undefined
  }
}
