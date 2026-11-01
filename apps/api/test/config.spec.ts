import { describe, expect, it } from 'vitest'
import { validateApiEnvironment } from '../src/config.js'

describe('API environment', () => {
  it('uses safe local defaults', () => {
    const environment = validateApiEnvironment({
      DATABASE_URL: 'postgresql://localhost:5432/ctrorec_test',
    })

    expect(environment.API_HOST).toBe('0.0.0.0')
    expect(environment.API_PORT).toBe(3001)
    expect(environment.API_DOCS_ENABLED).toBe(false)
    expect(environment.AUTH_COOKIE_SECURE).toBe(true)
    expect(environment.API_TRUST_PROXY_HOPS).toBe(0)
    expect(environment.QUEUE_SCHEMA).toBe('pgboss')
    expect(environment.AUDIO_STORAGE_PROVIDER).toBe('local')
    expect(environment.CLOUDINARY_FOLDER).toBe('ctrorec')
  })

  it('requires credentials when Cloudinary storage is selected', () => {
    expect(() =>
      validateApiEnvironment({
        DATABASE_URL: 'postgresql://localhost:5432/ctrorec_test',
        AUDIO_STORAGE_PROVIDER: 'cloudinary',
      }),
    ).toThrow('Invalid API environment')
  })

  it('rejects an invalid port', () => {
    expect(() => validateApiEnvironment({ API_PORT: '70000' })).toThrow(
      'Invalid API environment',
    )
  })
})
