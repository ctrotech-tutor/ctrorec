import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import type { AudioStorage } from '@ctrorec/media'
import type { ConfigService } from '@nestjs/config'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { QueueService } from '../src/queue/queue.service.js'
import { DataSaverService } from '../src/media/data-saver.service.js'
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

const repository = {
  claim: vi.fn(),
  markReady: vi.fn(),
  markFailed: vi.fn(),
}
const storage: AudioStorage = {
  provider: 'test',
  save: vi.fn(async () => undefined),
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
})

describe('data-saver retry boundaries', () => {
  it('does not reprocess an already completed job', async () => {
    repository.claim.mockResolvedValue(null)

    await service.process(job, new AbortController().signal)

    expect(storage.open).not.toHaveBeenCalled()
    expect(storage.save).not.toHaveBeenCalled()
    expect(repository.markReady).not.toHaveBeenCalled()
  })

  it('does not delete a newer object when a stale attempt loses its transition', async () => {
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
    )
    expect(repository.markFailed).toHaveBeenCalledWith(
      job.derivativeId,
      processingStartedAt,
    )
    // Only the pre-save replacement cleanup is allowed. A failed stale
    // transition must not issue the compensating delete for the current row.
    expect(storage.delete).toHaveBeenCalledTimes(1)
  })
})
