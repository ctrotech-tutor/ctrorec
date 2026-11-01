import { describe, expect, it } from 'vitest'
import { HealthController } from '../src/health/health.controller.js'

describe('HealthController', () => {
  it('reports API liveness without depending on external services', () => {
    expect(new HealthController().getHealth()).toEqual({
      service: 'api',
      status: 'ok',
    })
  })
})
