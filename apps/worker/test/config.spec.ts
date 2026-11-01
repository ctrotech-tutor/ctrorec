import { describe, expect, it } from 'vitest'
import { validateWorkerEnvironment } from '../src/config.js'

describe('worker environment', () => {
  it('requires a PostgreSQL connection', () => {
    expect(() => validateWorkerEnvironment({})).toThrow(
      'Invalid worker environment',
    )
  })

  it('accepts a standard PostgreSQL connection URL', () => {
    const environment = validateWorkerEnvironment({
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/lectures',
    })

    expect(environment.QUEUE_SCHEMA).toBe('pgboss')
    expect(environment.FFMPEG_BIN).toBe('ffmpeg')
    expect(environment.MEDIA_TEMP_DIR).toBe('../../.data/processing')
    expect(environment.MEDIA_PROCESSING_TIMEOUT_MS).toBe(1_800_000)
    expect(environment.AUDIO_STORAGE_PROVIDER).toBe('local')
  })

  it('requires credentials when Cloudinary storage is selected', () => {
    expect(() =>
      validateWorkerEnvironment({
        DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/lectures',
        AUDIO_STORAGE_PROVIDER: 'cloudinary',
      }),
    ).toThrow('Invalid worker environment')
  })

  it('rejects an unsafe processing timeout', () => {
    expect(() =>
      validateWorkerEnvironment({
        DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/lectures',
        MEDIA_PROCESSING_TIMEOUT_MS: '500',
      }),
    ).toThrow('Invalid worker environment')
  })
})
