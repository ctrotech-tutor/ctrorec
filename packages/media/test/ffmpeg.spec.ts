import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import { inspectAudio, transcodeDataSaver } from '../src/index.js'

const wavPath = fileURLToPath(
  new URL('../../../apps/api/test/fixtures/lecture.wav', import.meta.url),
)
let temporaryDirectory: string | undefined

afterEach(async () => {
  if (temporaryDirectory) {
    await rm(temporaryDirectory, { recursive: true, force: true })
    temporaryDirectory = undefined
  }
})

describe('data-saver transcoding', () => {
  it('creates a recognizable MP4 audio object with FFmpeg', async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'ctrorec-media-'))
    const destinationPath = join(temporaryDirectory, 'data-saver.m4a')

    await transcodeDataSaver({
      ffmpegPath: 'ffmpeg',
      sourcePath: wavPath,
      destinationPath,
    })
    const inspected = await inspectAudio(destinationPath)

    expect(inspected.mediaType).toBe('audio/mp4')
    expect(inspected.byteSize).toBeGreaterThan(0)
    expect(inspected.sha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it.each(['capture.webm', 'capture.ogg', 'capture-isom.m4a'])(
    'transcodes browser-captured %s to M4A',
    async (name) => {
      temporaryDirectory = await mkdtemp(join(tmpdir(), 'ctrorec-media-'))
      const destinationPath = join(temporaryDirectory, 'data-saver.m4a')
      await transcodeDataSaver({
        ffmpegPath: 'ffmpeg',
        sourcePath: fileURLToPath(
          new URL(`./fixtures/${name}`, import.meta.url),
        ),
        destinationPath,
        audioBitrate: name === 'capture-isom.m4a' ? 48_000 : 32_000,
      })
      expect((await inspectAudio(destinationPath)).mediaType).toBe('audio/mp4')
    },
  )

  it('honors cancellation without creating an output', async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'ctrorec-media-'))
    const destinationPath = join(temporaryDirectory, 'cancelled.m4a')
    const controller = new AbortController()
    controller.abort()

    await expect(
      transcodeDataSaver({
        ffmpegPath: 'ffmpeg',
        sourcePath: wavPath,
        destinationPath,
        signal: controller.signal,
      }),
    ).rejects.toThrow()
    await expect(stat(destinationPath)).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })
})
