import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { inspectAudio } from '../src/index.js'

function fixture(name: string): string {
  return fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))
}

describe('browser capture media inspection', () => {
  it.each([
    ['capture.webm', 'audio/webm'],
    ['capture.ogg', 'audio/ogg'],
    ['capture-isom.m4a', 'audio/mp4'],
  ] as const)(
    'recognizes %s as an audio-only original',
    async (name, mediaType) => {
      const inspected = await inspectAudio(fixture(name), {
        ffprobePath: 'ffprobe',
      })
      expect(inspected.mediaType).toBe(mediaType)
      expect(inspected.byteSize).toBeGreaterThan(0)
      expect(inspected.sha256).toMatch(/^[0-9a-f]{64}$/)
    },
  )

  it('rejects a WebM containing video even when it also contains audio', async () => {
    await expect(
      inspectAudio(fixture('video.webm'), { ffprobePath: 'ffprobe' }),
    ).rejects.toThrow('The uploaded file is not an audio-only recording.')
  })
})
