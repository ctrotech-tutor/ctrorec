import type { DatabaseTransaction } from '@ctrorec/database'
import {
  DATA_SAVER_JOB,
  DATA_SAVER_JOB_OPTIONS,
  type DataSaverJob,
} from '@ctrorec/media'
import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { sql } from 'drizzle-orm'
import { fromDrizzle, PgBoss } from 'pg-boss'
import type { LectureAudioDerivative } from './lectures.repository.js'

@Injectable()
export class MediaJobsService implements OnModuleDestroy {
  private readonly logger = new Logger(MediaJobsService.name)
  private boss: PgBoss | undefined
  private readyPromise: Promise<void> | undefined

  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}

  async ready(): Promise<void> {
    if (!this.readyPromise) {
      const boss = new PgBoss({
        application_name: 'ctrorec-api-media-jobs',
        connectionString: this.config.getOrThrow<string>('DATABASE_URL'),
        schema: this.config.getOrThrow<string>('QUEUE_SCHEMA'),
      })
      this.boss = boss
      boss.on('error', (error) => {
        this.logger.error('PostgreSQL media queue error', error.stack)
      })
      this.readyPromise = (async () => {
        await boss.start()
        await boss.createQueue(DATA_SAVER_JOB, DATA_SAVER_JOB_OPTIONS)
      })().catch(async (error: unknown) => {
        if (this.boss === boss) {
          this.boss = undefined
          this.readyPromise = undefined
        }
        await boss.stop().catch(() => undefined)
        throw error
      })
    }
    await this.readyPromise
  }

  async publishDataSaver(
    derivative: LectureAudioDerivative,
    transaction: DatabaseTransaction,
  ): Promise<void> {
    await this.ready()
    const boss = this.boss
    if (!boss) {
      throw new Error('The media queue is unavailable.')
    }
    const job: DataSaverJob = {
      derivativeId: derivative.id,
      lectureId: derivative.lectureId,
      sourceSha256: derivative.sourceSha256,
    }
    const jobId = await boss.send(DATA_SAVER_JOB, job, {
      ...DATA_SAVER_JOB_OPTIONS,
      id: derivative.id,
      db: fromDrizzle(transaction, sql),
    })
    if (jobId !== derivative.id) {
      throw new Error('The media queue did not accept the derivative job.')
    }
  }

  async onModuleDestroy(): Promise<void> {
    const pending = this.readyPromise
    this.readyPromise = undefined
    await pending?.catch(() => undefined)
    const boss = this.boss
    this.boss = undefined
    await boss?.stop()
  }
}
