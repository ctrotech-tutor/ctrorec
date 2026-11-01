import { createWriteStream } from 'node:fs'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import {
  DATA_SAVER_JOB,
  DATA_SAVER_JOB_OPTIONS,
  inspectAudio,
  parseDataSaverJob,
  transcodeDataSaver,
  type AudioStorage,
} from '@ctrorec/media'
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { QueueService } from '../queue/queue.service.js'
import { DataSaverRepository } from './data-saver.repository.js'
import { AUDIO_STORAGE } from './media.constants.js'

@Injectable()
export class DataSaverService implements OnModuleInit {
  private readonly logger = new Logger(DataSaverService.name)
  private readonly ffmpegPath: string
  private readonly temporaryRoot: string
  private readonly timeoutMs: number

  constructor(
    @Inject(DataSaverRepository)
    private readonly repository: DataSaverRepository,
    @Inject(AUDIO_STORAGE) private readonly storage: AudioStorage,
    @Inject(QueueService) private readonly queue: QueueService,
    @Inject(ConfigService) config: ConfigService,
  ) {
    this.ffmpegPath = config.getOrThrow<string>('FFMPEG_BIN')
    this.temporaryRoot = config.getOrThrow<string>('MEDIA_TEMP_DIR')
    this.timeoutMs = config.getOrThrow<number>('MEDIA_PROCESSING_TIMEOUT_MS')
  }

  async onModuleInit(): Promise<void> {
    const boss = await this.queue.client()
    await boss.createQueue(DATA_SAVER_JOB, DATA_SAVER_JOB_OPTIONS)
    await boss.work<unknown, void>(
      DATA_SAVER_JOB,
      { includeMetadata: true, localConcurrency: 1 },
      async (jobs) => {
        for (const job of jobs) {
          await this.process(job.data, job.signal)
        }
      },
    )
    this.logger.log('Data-saver audio worker is ready')
  }

  async process(value: unknown, jobSignal: AbortSignal): Promise<void> {
    const job = parseDataSaverJob(value)
    const claimed = await this.repository.claim(job)
    if (!claimed) {
      return
    }

    const { audio, derivative } = claimed
    const key = `${audio.institutionId}/${audio.lectureId}/${derivative.id}.m4a`
    const signal = AbortSignal.any([
      jobSignal,
      AbortSignal.timeout(this.timeoutMs),
    ])
    let saved = false
    await mkdir(this.temporaryRoot, { recursive: true })
    const temporaryDirectory = await mkdtemp(
      join(this.temporaryRoot, 'data-saver-'),
    )
    const sourcePath = join(temporaryDirectory, 'source.audio')
    const destinationPath = join(temporaryDirectory, 'data-saver.m4a')

    try {
      signal.throwIfAborted()
      const source = await this.storage.open(audio.storageKey, audio.byteSize)
      await pipeline(source, createWriteStream(sourcePath, { flags: 'wx' }), {
        signal,
      })
      const inspectedSource = await inspectAudio(sourcePath)
      if (
        inspectedSource.sha256 !== audio.sha256 ||
        inspectedSource.byteSize !== audio.byteSize
      ) {
        throw new Error('The downloaded source failed integrity verification.')
      }

      await transcodeDataSaver({
        ffmpegPath: this.ffmpegPath,
        sourcePath,
        destinationPath,
        signal,
      })
      const inspected = await inspectAudio(destinationPath)
      if (inspected.mediaType !== 'audio/mp4') {
        throw new Error('The derivative is not an MP4 audio object.')
      }
      if (inspected.byteSize >= audio.byteSize) {
        await this.repository.markFailed(
          derivative.id,
          derivative.processingStartedAt,
        )
        this.logger.warn(
          `Data-saver derivative ${derivative.id} was not smaller than its original.`,
        )
        return
      }

      signal.throwIfAborted()
      await this.storage.delete(key)
      signal.throwIfAborted()
      await this.storage.save(key, destinationPath)
      saved = true
      await this.storage.verify(key, inspected.byteSize)
      signal.throwIfAborted()
      const marked = await this.repository.markReady(
        derivative.id,
        derivative.processingStartedAt,
        {
          storageProvider: this.storage.provider,
          storageKey: key,
          byteSize: inspected.byteSize,
          sha256: inspected.sha256,
        },
      )
      if (!marked) {
        throw new Error('The derivative ready state could not be committed.')
      }
    } catch (error) {
      try {
        const failed = await this.repository.markFailed(
          derivative.id,
          derivative.processingStartedAt,
        )
        if (saved && failed) {
          await this.storage.delete(key)
        }
      } catch (cleanupError) {
        this.logger.error(
          `Failed to clean up derivative ${derivative.id}: ${
            cleanupError instanceof Error
              ? cleanupError.message
              : 'unknown error'
          }`,
        )
      }
      throw error
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true })
    }
  }
}
