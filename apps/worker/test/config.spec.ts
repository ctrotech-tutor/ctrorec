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
    expect(environment.RECOVERY_EMAIL_ENABLED).toBe(false)
    expect(environment.RECOVERY_WEB_ORIGIN).toBe('http://localhost:3000')
  })

  it('requires credentials when Cloudinary storage is selected', () => {
    expect(() =>
      validateWorkerEnvironment({
        DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/lectures',
        AUDIO_STORAGE_PROVIDER: 'cloudinary',
      }),
    ).toThrow('Invalid worker environment')
  })

  it('requires an SMTP URL when recovery delivery is enabled', () => {
    expect(() =>
      validateWorkerEnvironment({
        DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/lectures',
        RECOVERY_EMAIL_ENABLED: 'true',
      }),
    ).toThrow('Invalid worker environment')
  })

  it('accepts only explicit SMTP connection protocols', () => {
    expect(() =>
      validateWorkerEnvironment({
        DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/lectures',
        RECOVERY_SMTP_URL: 'https://example.test/smtp',
      }),
    ).toThrow('Invalid worker environment')
    expect(
      validateWorkerEnvironment({
        DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/lectures',
        RECOVERY_EMAIL_ENABLED: 'true',
        RECOVERY_SMTP_URL: 'smtp://127.0.0.1:2525',
        RECOVERY_SMTP_IGNORE_TLS: 'true',
      }).RECOVERY_SMTP_IGNORE_TLS,
    ).toBe(true)
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
