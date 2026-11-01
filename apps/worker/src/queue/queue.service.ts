import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common'
// Runtime import is required for Nest's emitted constructor metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { ConfigService } from '@nestjs/config'
import { PgBoss } from 'pg-boss'

@Injectable()
export class QueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name)
  private boss: PgBoss | undefined
  private readyPromise: Promise<void> | undefined

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const boss = new PgBoss({
      application_name: 'ctrorec-worker',
      connectionString: this.config.getOrThrow<string>('DATABASE_URL'),
      schema: this.config.getOrThrow<string>('QUEUE_SCHEMA'),
    })
    this.boss = boss

    boss.on('error', (error) => {
      this.logger.error('PostgreSQL queue error', error.stack)
    })
    this.readyPromise = (async () => {
      await boss.start()
      this.logger.log('PostgreSQL job queue is ready')
    })()
    await this.readyPromise
  }

  async client(): Promise<PgBoss> {
    await this.readyPromise
    if (!this.boss) {
      throw new Error('The PostgreSQL job queue is unavailable.')
    }
    return this.boss
  }

  async onModuleDestroy(): Promise<void> {
    await this.boss?.stop()
  }
}
