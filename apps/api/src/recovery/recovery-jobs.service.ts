import type { DatabaseTransaction } from '@ctrorec/database'
import {
  ACCOUNT_RECOVERY_JOB,
  ACCOUNT_RECOVERY_JOB_OPTIONS,
  type AccountRecoveryJob,
} from '@ctrorec/database'
import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { sql } from 'drizzle-orm'
import { fromDrizzle, PgBoss } from 'pg-boss'

@Injectable()
export class RecoveryJobsService implements OnModuleDestroy {
  private readonly logger = new Logger(RecoveryJobsService.name)
  private boss: PgBoss | undefined
  private readyPromise: Promise<void> | undefined

  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}

  async publish(
    requestId: string,
    transaction: DatabaseTransaction,
  ): Promise<void> {
    await this.ready()
    const boss = this.boss
    if (!boss) {
      throw new Error('The recovery queue is unavailable.')
    }
    const job: AccountRecoveryJob = { requestId }
    const jobId = await boss.send(ACCOUNT_RECOVERY_JOB, job, {
      ...ACCOUNT_RECOVERY_JOB_OPTIONS,
      id: requestId,
      db: fromDrizzle(transaction, sql),
    })
    if (jobId !== requestId) {
      throw new Error('The recovery queue did not accept the request.')
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

  private async ready(): Promise<void> {
    if (!this.readyPromise) {
      const boss = new PgBoss({
        application_name: 'ctrorec-api-recovery-jobs',
        connectionString: this.config.getOrThrow<string>('DATABASE_URL'),
        schema: this.config.getOrThrow<string>('QUEUE_SCHEMA'),
      })
      this.boss = boss
      boss.on('error', (error) => {
        this.logger.error('PostgreSQL recovery queue error', error.stack)
      })
      this.readyPromise = (async () => {
        await boss.start()
        await boss.createQueue(
          ACCOUNT_RECOVERY_JOB,
          ACCOUNT_RECOVERY_JOB_OPTIONS,
        )
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
}
