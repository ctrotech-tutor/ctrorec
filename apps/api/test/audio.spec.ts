import { describe, expect, it } from 'vitest'
import { detectAudioMediaType, parseByteRange } from '../src/lectures/audio.js'

describe('audio signatures', () => {
  it('recognizes supported audio container signatures', () => {
    const wav = Buffer.from('RIFF0000WAVE', 'ascii')
    const m4a = Buffer.from('0000ftypM4A ', 'ascii')
    const mp3 = Buffer.from('ID3\x04\x00\x00\x00\x00\x00\x00', 'binary')
    const webm = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0])
    const ogg = Buffer.from('OggS00000000', 'ascii')

    expect(detectAudioMediaType(wav)).toBe('audio/wav')
    expect(detectAudioMediaType(m4a)).toBe('audio/mp4')
    expect(detectAudioMediaType(mp3)).toBe('audio/mpeg')
    expect(detectAudioMediaType(webm)).toBe('audio/webm')
    expect(detectAudioMediaType(ogg)).toBe('audio/ogg')
  })

  it('rejects video and unknown signatures', () => {
    expect(detectAudioMediaType(Buffer.from('RIFF0000AVI '))).toBeNull()
    expect(detectAudioMediaType(Buffer.from('0000ftypavc1'))).toBeNull()
    expect(detectAudioMediaType(Buffer.from('0000ftypisom'))).toBeNull()
    expect(detectAudioMediaType(Buffer.from('plain text'))).toBeNull()
  })
})

describe('single byte ranges', () => {
  it('returns a full response without a Range header', () => {
    expect(parseByteRange(undefined, 100)).toEqual({ kind: 'full' })
  })

  it('parses bounded, open-ended, and suffix ranges', () => {
    expect(parseByteRange('bytes=10-19', 100)).toEqual({
      kind: 'single',
      start: 10,
      end: 19,
    })
    expect(parseByteRange('bytes=90-', 100)).toEqual({
      kind: 'single',
      start: 90,
      end: 99,
    })
    expect(parseByteRange('bytes=-10', 100)).toEqual({
      kind: 'single',
      start: 90,
      end: 99,
    })
  })

  it('clamps an end beyond the object and a long suffix to its size', () => {
    expect(parseByteRange('bytes=90-999', 100)).toEqual({
      kind: 'single',
      start: 90,
      end: 99,
    })
    expect(parseByteRange('bytes=-999', 100)).toEqual({
      kind: 'single',
      start: 0,
      end: 99,
    })
  })

  it('rejects unsatisfiable, inverted, multipart, and malformed ranges', () => {
    for (const header of [
      'bytes=100-',
      'bytes=20-10',
      'bytes=0-1,4-5',
      'bytes=-0',
      'items=0-1',
      'bytes=abc-def',
    ]) {
      expect(parseByteRange(header, 100)).toEqual({
        kind: 'unsatisfiable',
      })
    }
  })
})
