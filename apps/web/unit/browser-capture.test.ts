import { describe, expect, it } from 'vitest'
import {
  captureFormat,
  formatCaptureDuration,
  selectCaptureMimeType,
} from '../src/lib/browser-capture'

describe('browser capture formats', () => {
  it('uses feature detection in priority order', () => {
    const supported = new Set(['audio/ogg;codecs=opus', 'audio/mp4'])
    expect(selectCaptureMimeType((type) => supported.has(type))).toBe(
      'audio/ogg;codecs=opus',
    )
    expect(selectCaptureMimeType(() => false)).toBeNull()
  })

  it('maps actual recorder MIME types to honest original extensions', () => {
    expect(captureFormat('audio/webm;codecs=opus')).toEqual({
      mediaType: 'audio/webm',
      extension: 'webm',
    })
    expect(captureFormat('audio/mp4;codecs=mp4a.40.2')).toEqual({
      mediaType: 'audio/mp4',
      extension: 'm4a',
    })
    expect(captureFormat('audio/ogg;codecs=opus')).toEqual({
      mediaType: 'audio/ogg',
      extension: 'ogg',
    })
    expect(() => captureFormat('video/webm')).toThrow('unsupported')
  })

  it('formats active elapsed time rather than deriving it from chunks', () => {
    expect(formatCaptureDuration(0)).toBe('00:00')
    expect(formatCaptureDuration(59_999)).toBe('00:59')
    expect(formatCaptureDuration(61_000)).toBe('01:01')
    expect(formatCaptureDuration(3_661_000)).toBe('01:01:01')
  })
})
