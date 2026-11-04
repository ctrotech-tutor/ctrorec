import type { Dirent } from 'node:fs'
import { lstat, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { LecturesRepository } from './lectures.repository.js'
import { quarantineUploadPath } from './resumable-upload.js'

const EXPIRY_BATCH_SIZE = 250
const MAX_EXPIRY_BATCHES_PER_RUN = 4
const FILE_CONCURRENCY = 4
const TERMINAL_GRACE_MS = 5 * 60 * 1000
const ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000
const UPLOAD_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface UploadReconciliationResult {
  expiredSessions: number
  removedSessionDirectories: number
  removedRootFiles: number
  removedQuarantinedPaths: number
  failures: number
}

@Injectable()
export class UploadReconciliationService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(UploadReconciliationService.name)
  private readonly root: string
  private readonly enabled: boolean
  private readonly intervalMs: number
  private timer: NodeJS.Timeout | undefined
  private scheduledRun: Promise<void> | undefined
  private stopping = false

  constructor(
    @Inject(LecturesRepository)
    private readonly repository: LecturesRepository,
    @Inject(ConfigService) config: ConfigService,
  ) {
    this.root = config.getOrThrow<string>('AUDIO_UPLOAD_TEMP_DIR')
    this.enabled = config.getOrThrow<boolean>(
      'AUDIO_UPLOAD_RECONCILIATION_ENABLED',
    )
    this.intervalMs = config.getOrThrow<number>(
      'AUDIO_UPLOAD_RECONCILE_INTERVAL_MS',
    )
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

  async reconcile(now = new Date()): Promise<UploadReconciliationResult> {
    const result: UploadReconciliationResult = {
      expiredSessions: 0,
      removedSessionDirectories: 0,
      removedRootFiles: 0,
      removedQuarantinedPaths: 0,
      failures: 0,
    }

    for (
      let batch = 0;
      batch < MAX_EXPIRY_BATCHES_PER_RUN && !this.stopping;
      batch += 1
    ) {
      const expired = await this.repository.expireAudioUploadsBefore(
        now,
        EXPIRY_BATCH_SIZE,
      )
      result.expiredSessions += expired
      if (expired < EXPIRY_BATCH_SIZE) {
        break
      }
    }

    const trash = join(this.root, 'trash')
    const quarantined = await readDirectory(trash)
    await mapBounded(quarantined, async (entry) => {
      if (this.stopping) {
        return
      }
      try {
        await rm(join(trash, entry.name), { recursive: true, force: true })
        result.removedQuarantinedPaths += 1
      } catch (error) {
        this.recordFailure(result, 'quarantined upload path', error)
      }
    })

    const sessionsRoot = join(this.root, 'sessions')
    const sessions = await readDirectory(sessionsRoot)
    await mapBounded(sessions, async (entry) => {
      if (
        this.stopping ||
        !entry.isDirectory() ||
        !UPLOAD_ID_PATTERN.test(entry.name)
      ) {
        return
      }
      try {
        const upload = await this.repository.findAudioUploadState(entry.name)
        const directory = join(sessionsRoot, entry.name)
        if (!upload) {
          const details = await lstat(directory)
          if (details.mtimeMs > now.getTime() - ORPHAN_GRACE_MS) {
            return
          }
        } else if (
          upload.status === 'active' ||
          upload.updatedAt.getTime() > now.getTime() - TERMINAL_GRACE_MS
        ) {
          return
        }
        if (await quarantineUploadPath(this.root, directory)) {
          result.removedSessionDirectories += 1
        }
      } catch (error) {
        if (!isMissingFile(error)) {
          this.recordFailure(result, 'upload session directory', error)
        }
      }
    })

    const rootEntries = await readDirectory(this.root)
    await mapBounded(rootEntries, async (entry) => {
      if (
        this.stopping ||
        !entry.isFile() ||
        !UPLOAD_ID_PATTERN.test(entry.name)
      ) {
        return
      }
      try {
        const path = join(this.root, entry.name)
        const details = await lstat(path)
        if (details.mtimeMs <= now.getTime() - ORPHAN_GRACE_MS) {
          if (await quarantineUploadPath(this.root, path)) {
            result.removedRootFiles += 1
          }
        }
      } catch (error) {
        if (!isMissingFile(error)) {
          this.recordFailure(result, 'orphaned upload temporary file', error)
        }
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
        const work =
          result.expiredSessions +
          result.removedSessionDirectories +
          result.removedRootFiles +
          result.removedQuarantinedPaths +
          result.failures
        if (work > 0) {
          this.logger.log(`Upload reconciliation: ${JSON.stringify(result)}`)
        }
      })
      .catch((error: unknown) => {
        this.logger.error(
          `Upload reconciliation failed: ${
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

  private recordFailure(
    result: UploadReconciliationResult,
    target: string,
    error: unknown,
  ): void {
    result.failures += 1
    this.logger.warn(
      `Could not reconcile ${target}: ${
        error instanceof Error ? error.message : 'unknown error'
      }`,
    )
  }
}

async function readDirectory(path: string): Promise<Dirent[]> {
  try {
    return await readdir(path, { withFileTypes: true })
  } catch (error) {
    if (isMissingFile(error)) {
      return []
    }
    throw error
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

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  )
}
