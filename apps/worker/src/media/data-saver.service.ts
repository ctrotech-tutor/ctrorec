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

    const { audio, derivative, captureDurationMs } = claimed
    const signal = AbortSignal.any([
      jobSignal,
      AbortSignal.timeout(this.timeoutMs),
    ])
    let mediaIntent: { id: string; key: string } | undefined
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
        audioBitrate: dataSaverBitrate(audio, captureDurationMs),
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
      const intentId = await this.repository.newMediaObjectIntentId()
      const intent = {
        id: intentId,
        key: `${audio.institutionId}/${audio.lectureId}/${intentId}.m4a`,
      }
      mediaIntent = intent
      await this.repository.createMediaObjectIntent({
        id: intent.id,
        lectureId: audio.lectureId,
        institutionId: audio.institutionId,
        kind: 'data_saver',
        storageProvider: this.storage.provider,
        storageKey: intent.key,
        byteSize: inspected.byteSize,
        sha256: inspected.sha256,
      })
      await this.storage.save(intent.key, destinationPath)
      await this.storage.verify(intent.key, inspected.byteSize)
      signal.throwIfAborted()
      const marked = await this.repository.markReady(
        derivative.id,
        derivative.processingStartedAt,
        {
          storageProvider: this.storage.provider,
          storageKey: intent.key,
          byteSize: inspected.byteSize,
          sha256: inspected.sha256,
        },
        intent.id,
      )
      if (!marked) {
        throw new Error('The derivative ready state could not be committed.')
      }
    } catch (error) {
      try {
        await this.repository.markFailed(
          derivative.id,
          derivative.processingStartedAt,
        )
      } catch (stateError) {
        this.logger.error(
          `Failed to mark derivative ${derivative.id} as failed: ${
            stateError instanceof Error ? stateError.message : 'unknown error'
          }`,
        )
      }
      if (mediaIntent) {
        await this.compensateMediaObject(mediaIntent)
      }
      throw error
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true })
    }
  }

  private async compensateMediaObject(intent: {
    id: string
    key: string
  }): Promise<void> {
    try {
      const deletion = await this.repository.requestMediaObjectDeletion(
        intent.id,
      )
      if (!deletion) {
        return
      }
      if (deletion.storageProvider !== this.storage.provider) {
        throw new Error('The media intent belongs to another storage provider.')
      }
      await this.storage.delete(deletion.storageKey)
      await this.repository.markMediaObjectDeleted(intent.id)
    } catch (cleanupError) {
      this.logger.error(
        `Media cleanup remains pending for intent ${intent.id}.`,
        cleanupError instanceof Error ? cleanupError.stack : undefined,
      )
    }
  }
}

export function dataSaverBitrate(
  audio: { mediaType: string; byteSize: number },
  captureDurationMs: number | null,
): 32000 | 48000 {
  if (captureDurationMs !== null && captureDurationMs > 0) {
    const originalBitrate = (audio.byteSize * 8) / (captureDurationMs / 1_000)
    return originalBitrate <= 64_000 ? 32_000 : 48_000
  }
  return ['audio/webm', 'audio/ogg'].includes(audio.mediaType) ? 32_000 : 48_000
}
