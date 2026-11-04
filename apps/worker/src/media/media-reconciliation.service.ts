import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { AudioStorage } from '@ctrorec/media'
import { DataSaverRepository } from './data-saver.repository.js'
import { AUDIO_STORAGE } from './media.constants.js'

const BATCH_SIZE = 100
const FILE_CONCURRENCY = 4

export interface MediaReconciliationResult {
  claimed: number
  deleted: number
  attached: number
  skippedProviders: number
  failures: number
}

@Injectable()
export class MediaReconciliationService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(MediaReconciliationService.name)
  private readonly enabled: boolean
  private readonly intervalMs: number
  private readonly graceMs: number
  private timer: NodeJS.Timeout | undefined
  private scheduledRun: Promise<void> | undefined
  private stopping = false

  constructor(
    @Inject(DataSaverRepository)
    private readonly repository: DataSaverRepository,
    @Inject(AUDIO_STORAGE) private readonly storage: AudioStorage,
    @Inject(ConfigService) config: ConfigService,
  ) {
    this.enabled = config.getOrThrow<boolean>('MEDIA_RECONCILIATION_ENABLED')
    this.intervalMs = config.getOrThrow<number>('MEDIA_RECONCILE_INTERVAL_MS')
    this.graceMs = config.getOrThrow<number>('MEDIA_RECONCILE_GRACE_MS')
  }

  onModuleInit(): void {
    if (!this.enabled) {
      return
    }
    this.timer = setInterval(() => this.schedule(), this.intervalMs)
    this.timer.unref()
    this.schedule()
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true
    if (this.timer) {
      clearInterval(this.timer)
    }
    await this.scheduledRun
  }

  async reconcile(now = new Date()): Promise<MediaReconciliationResult> {
    const result: MediaReconciliationResult = {
      claimed: 0,
      deleted: 0,
      attached: 0,
      skippedProviders: 0,
      failures: 0,
    }
    const candidates =
      await this.repository.listMediaObjectReconciliationCandidates(
        new Date(now.getTime() - this.graceMs),
        BATCH_SIZE,
      )

    await mapBounded(candidates, async (candidate) => {
      if (this.stopping) {
        return
      }
      if (candidate.storageProvider !== this.storage.provider) {
        result.skippedProviders += 1
        this.logger.warn(
          `Media intent ${candidate.id} requires storage provider ${candidate.storageProvider}; configured provider is ${this.storage.provider}.`,
        )
        return
      }

      try {
        const claimed =
          await this.repository.claimMediaObjectReconciliation(candidate)
        if (!claimed) {
          return
        }
        result.claimed += 1
        if (await this.repository.mediaObjectReferenceExists(claimed)) {
          await this.repository.markMediaObjectReferenceAttached(claimed.id)
          result.attached += 1
          return
        }

        // Deletion is idempotent. A lost provider response therefore remains a
        // deleting intent and is retried; it is never treated as proof of loss.
        await this.storage.delete(claimed.storageKey)
        await this.repository.markMediaObjectDeleted(claimed.id)
        result.deleted += 1
      } catch (error) {
        result.failures += 1
        this.logger.warn(
          `Could not reconcile media intent ${candidate.id}: ${
            error instanceof Error ? error.message : 'unknown error'
          }`,
        )
      }
    })

    return result
  }

  private schedule(): void {
    if (this.scheduledRun || this.stopping) {
      return
    }
    const run = this.reconcile()
      .then((result) => {
        const work = result.claimed + result.skippedProviders + result.failures
        if (work > 0) {
          this.logger.log(`Media reconciliation: ${JSON.stringify(result)}`)
        }
      })
      .catch((error: unknown) => {
        this.logger.error(
          `Media reconciliation failed: ${
            error instanceof Error ? error.message : 'unknown error'
          }`,
        )
      })
      .finally(() => {
        if (this.scheduledRun === run) {
          this.scheduledRun = undefined
        }
      })
    this.scheduledRun = run
  }
}

async function mapBounded<T>(
  items: readonly T[],
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0
  await Promise.all(
    Array.from(
      { length: Math.min(FILE_CONCURRENCY, items.length) },
      async () => {
        while (next < items.length) {
          const index = next
          next += 1
          const item = items[index]
          if (item !== undefined) {
            await worker(item)
          }
        }
      },
    ),
  )
}
