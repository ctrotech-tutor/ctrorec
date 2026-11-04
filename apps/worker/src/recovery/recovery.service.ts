import { createHash, randomBytes } from 'node:crypto'
import {
  ACCOUNT_RECOVERY_JOB,
  ACCOUNT_RECOVERY_JOB_OPTIONS,
  parseAccountRecoveryJob,
} from '@ctrorec/database'
import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { QueueService } from '../queue/queue.service.js'
import { RecoveryMailer } from './recovery-mailer.js'
import { RecoveryRepository } from './recovery.repository.js'

@Injectable()
export class RecoveryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RecoveryService.name)
  private readonly deliveryEnabled: boolean
  private readonly webOrigin: string

  constructor(
    @Inject(RecoveryRepository)
    private readonly repository: RecoveryRepository,
    @Inject(RecoveryMailer) private readonly mailer: RecoveryMailer,
    @Inject(QueueService) private readonly queue: QueueService,
    @Inject(ConfigService) config: ConfigService,
  ) {
    this.deliveryEnabled = config.getOrThrow<boolean>('RECOVERY_EMAIL_ENABLED')
    this.webOrigin = config.getOrThrow<string>('RECOVERY_WEB_ORIGIN')
  }

  async onModuleInit(): Promise<void> {
    const boss = await this.queue.client()
    await boss.createQueue(ACCOUNT_RECOVERY_JOB, ACCOUNT_RECOVERY_JOB_OPTIONS)
    await boss.work<unknown, void>(
      ACCOUNT_RECOVERY_JOB,
      { includeMetadata: true, localConcurrency: 1 },
      async (jobs) => {
        for (const job of jobs) {
          await this.process(job.data)
        }
      },
    )
    this.logger.log(
      this.deliveryEnabled
        ? 'Account-recovery email worker is ready'
        : 'Account-recovery worker is ready; SMTP delivery is disabled',
    )
  }

  async process(value: unknown): Promise<void> {
    const { requestId } = parseAccountRecoveryJob(value)
    if (!this.deliveryEnabled) {
      await this.repository.discardWithoutDelivery(requestId)
      this.logger.warn(
        `Recovery request ${requestId} discarded because SMTP delivery is disabled.`,
      )
      return
    }

    const token = randomBytes(32).toString('base64url')
    const tokenHash = createHash('sha256').update(token, 'utf8').digest('hex')
    const prepared = await this.repository.prepare(requestId, tokenHash)
    if (!prepared) {
      return
    }

    try {
      const resetUrl = new URL('/reset-password', this.webOrigin)
      resetUrl.hash = new URLSearchParams({ token }).toString()
      await this.mailer.send({
        to: prepared.email,
        resetUrl: resetUrl.toString(),
        expiresAt: prepared.expiresAt,
      })
      if (
        !(await this.repository.markDelivered(requestId, tokenHash, new Date()))
      ) {
        throw new Error(
          'The recovery request changed during SMTP delivery; the token remains invalid.',
        )
      }
    } catch (error) {
      await this.repository.markFailed(requestId, tokenHash)
      throw error
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.mailer.close()
  }
}
