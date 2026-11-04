import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import type { NewMediaObjectIntent } from '@ctrorec/database'
import type { AudioStorage } from '@ctrorec/media'
import type { ConfigService } from '@nestjs/config'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { QueueService } from '../src/queue/queue.service.js'
import {
  DataSaverService,
  dataSaverBitrate,
} from '../src/media/data-saver.service.js'
import type {
  ClaimedDataSaver,
  DataSaverRepository,
} from '../src/media/data-saver.repository.js'

vi.mock('@ctrorec/media', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    inspectAudio: vi.fn(async (path: string) =>
      path.endsWith('source.audio')
        ? {
            mediaType: 'audio/wav',
            byteSize: 1_000,
            sha256: 'a'.repeat(64),
          }
        : {
            mediaType: 'audio/mp4',
            byteSize: 500,
            sha256: 'b'.repeat(64),
          },
    ),
    transcodeDataSaver: vi.fn(async () => undefined),
  }
})

const job = {
  derivativeId: '019a1000-0000-7000-8000-00000000000d',
  lectureId: '019a1000-0000-7000-8000-00000000000c',
  sourceSha256: 'a'.repeat(64),
}
const processingStartedAt = new Date('2026-11-01T12:00:00.000Z')
const claimed = {
  audio: {
    institutionId: '019a1000-0000-7000-8000-000000000001',
    lectureId: job.lectureId,
    storageKey: 'original-key',
    byteSize: 1_000,
    sha256: job.sourceSha256,
  },
  derivative: {
    id: job.derivativeId,
    processingStartedAt,
  },
} as unknown as ClaimedDataSaver

let pendingIntent: NewMediaObjectIntent | undefined
const repository = {
  claim: vi.fn(),
  markReady: vi.fn(),
  markFailed: vi.fn(),
  newMediaObjectIntentId: vi.fn(
    async () => '019a1000-0000-7000-8000-0000000000e1',
  ),
  createMediaObjectIntent: vi.fn(async (value: NewMediaObjectIntent) => {
    pendingIntent = value
    return value
  }),
  requestMediaObjectDeletion: vi.fn(async () =>
    pendingIntent?.storageKey
      ? {
          storageProvider: pendingIntent.storageProvider,
          storageKey: pendingIntent.storageKey,
        }
      : null,
  ),
  markMediaObjectDeleted: vi.fn(async () => undefined),
}
const save = vi.fn(async (_key: string, _sourcePath: string) => undefined)
const storage: AudioStorage = {
  provider: 'test',
  save,
  verify: vi.fn(async () => undefined),
  open: vi.fn(async () => Readable.from([Buffer.alloc(1_000)])),
  delete: vi.fn(async () => undefined),
}
const configuration: Record<string, string | number> = {
  FFMPEG_BIN: 'ffmpeg',
  MEDIA_TEMP_DIR: join(tmpdir(), 'ctrorec-worker-unit'),
  MEDIA_PROCESSING_TIMEOUT_MS: 30_000,
}
const service = new DataSaverService(
  repository as unknown as DataSaverRepository,
  storage,
  {} as QueueService,
  {
    getOrThrow: (key: string) => configuration[key],
  } as unknown as ConfigService,
)

beforeEach(() => {
  vi.clearAllMocks()
  pendingIntent = undefined
})

describe('data-saver retry boundaries', () => {
  it('does not reprocess an already completed job', async () => {
    repository.claim.mockResolvedValue(null)

    await service.process(job, new AbortController().signal)

    expect(storage.open).not.toHaveBeenCalled()
    expect(storage.save).not.toHaveBeenCalled()
    expect(repository.markReady).not.toHaveBeenCalled()
  })

  it('deletes only the stale attempt’s unique object when its transition loses', async () => {
    repository.claim.mockResolvedValue(claimed)
    repository.markReady.mockResolvedValue(false)
    repository.markFailed.mockResolvedValue(false)

    await expect(
      service.process(job, new AbortController().signal),
    ).rejects.toThrow('The derivative ready state could not be committed.')

    expect(repository.markReady).toHaveBeenCalledWith(
      job.derivativeId,
      processingStartedAt,
      expect.objectContaining({ byteSize: 500 }),
      expect.any(String),
    )
    expect(repository.markFailed).toHaveBeenCalledWith(
      job.derivativeId,
      processingStartedAt,
    )
    const attemptKey = save.mock.calls[0]?.[0]
    expect(attemptKey).toBeDefined()
    expect(attemptKey).not.toBe(
      `${claimed.audio.institutionId}/${job.lectureId}/${job.derivativeId}.m4a`,
    )
    expect(storage.delete).toHaveBeenCalledTimes(1)
    expect(storage.delete).toHaveBeenCalledWith(attemptKey)
  })

  it('compensates an object even when the storage save response is lost', async () => {
    repository.claim.mockResolvedValue(claimed)
    save.mockRejectedValueOnce(new Error('Lost provider response'))

    await expect(
      service.process(job, new AbortController().signal),
    ).rejects.toThrow('Lost provider response')

    expect(repository.createMediaObjectIntent).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledTimes(1)
    expect(
      repository.createMediaObjectIntent.mock.invocationCallOrder[0],
    ).toBeLessThan(save.mock.invocationCallOrder[0]!)
    expect(storage.delete).toHaveBeenCalledWith(save.mock.calls[0]?.[0])
    expect(repository.markMediaObjectDeleted).toHaveBeenCalledWith(
      pendingIntent?.id,
    )
  })
})

describe('data-saver bitrate selection', () => {
  it('uses the capture duration to avoid a larger derivative for compressed audio', () => {
    expect(
      dataSaverBitrate({ mediaType: 'audio/mp4', byteSize: 24_000 }, 4_000),
    ).toBe(32_000)
    expect(
      dataSaverBitrate({ mediaType: 'audio/mp4', byteSize: 100_000 }, 4_000),
    ).toBe(48_000)
  })

  it('defaults compressed WebM/Ogg to 32 kbps and other originals to 48 kbps', () => {
    expect(
      dataSaverBitrate({ mediaType: 'audio/webm', byteSize: 24_000 }, null),
    ).toBe(32_000)
    expect(
      dataSaverBitrate({ mediaType: 'audio/ogg', byteSize: 24_000 }, null),
    ).toBe(32_000)
    expect(
      dataSaverBitrate({ mediaType: 'audio/wav', byteSize: 24_000 }, null),
    ).toBe(48_000)
  })
})
