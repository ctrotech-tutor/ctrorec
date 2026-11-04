import { createHash } from 'node:crypto'
import type { ConfigService } from '@nestjs/config'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { QueueService } from '../src/queue/queue.service.js'
import type { RecoveryMailer } from '../src/recovery/recovery-mailer.js'
import type { RecoveryRepository } from '../src/recovery/recovery.repository.js'
import { RecoveryService } from '../src/recovery/recovery.service.js'

const requestId = '019a1000-0000-7000-8000-0000000000a1'
const prepared = {
  email: 'student@ctrorec.test',
  expiresAt: new Date('2026-11-04T18:00:00.000Z'),
}
const repository = {
  prepare: vi.fn(),
  discardWithoutDelivery: vi.fn(),
  markDelivered: vi.fn(),
  markFailed: vi.fn(),
}
const mailer = {
  send: vi.fn(),
  close: vi.fn(async () => undefined),
}

beforeEach(() => {
  vi.clearAllMocks()
  repository.prepare.mockResolvedValue(prepared)
  repository.markDelivered.mockResolvedValue(true)
  repository.markFailed.mockResolvedValue(undefined)
  repository.discardWithoutDelivery.mockResolvedValue(undefined)
  mailer.send.mockResolvedValue(undefined)
})

describe('account-recovery worker delivery boundaries', () => {
  it('discards without creating token material when delivery is disabled', async () => {
    await service(false).process({ requestId })

    expect(repository.discardWithoutDelivery).toHaveBeenCalledWith(requestId)
    expect(repository.prepare).not.toHaveBeenCalled()
    expect(mailer.send).not.toHaveBeenCalled()
  })

  it('stores only the token hash and sends a fragment reset URL', async () => {
    await service().process({ requestId })

    const message = mailer.send.mock.calls[0]?.[0] as
      { resetUrl: string; to: string } | undefined
    if (!message) {
      throw new Error('Expected a recovery message.')
    }
    const token = tokenFrom(message.resetUrl)
    const hash = createHash('sha256').update(token, 'utf8').digest('hex')
    expect(message.to).toBe(prepared.email)
    expect(new URL(message.resetUrl).pathname).toBe('/reset-password')
    expect(repository.prepare).toHaveBeenCalledWith(requestId, hash)
    expect(repository.markDelivered).toHaveBeenCalledWith(
      requestId,
      hash,
      expect.any(Date),
    )
    expect(JSON.stringify(repository.prepare.mock.calls)).not.toContain(token)
    expect(JSON.stringify({ requestId })).not.toContain(token)
  })

  it('rotates the raw token and hash on a retry after SMTP failure', async () => {
    mailer.send.mockRejectedValueOnce(new Error('SMTP unavailable'))

    await expect(service().process({ requestId })).rejects.toThrow(
      'SMTP unavailable',
    )
    await service().process({ requestId })

    const firstMessage = mailer.send.mock.calls[0]?.[0] as
      { resetUrl: string } | undefined
    const secondMessage = mailer.send.mock.calls[1]?.[0] as
      { resetUrl: string } | undefined
    if (!firstMessage || !secondMessage) {
      throw new Error('Expected both delivery attempts.')
    }
    const firstToken = tokenFrom(firstMessage.resetUrl)
    const secondToken = tokenFrom(secondMessage.resetUrl)
    expect(firstToken).not.toBe(secondToken)
    const firstHash = createHash('sha256')
      .update(firstToken, 'utf8')
      .digest('hex')
    const secondHash = createHash('sha256')
      .update(secondToken, 'utf8')
      .digest('hex')
    expect(repository.markFailed).toHaveBeenCalledWith(requestId, firstHash)
    expect(repository.prepare).toHaveBeenNthCalledWith(1, requestId, firstHash)
    expect(repository.prepare).toHaveBeenNthCalledWith(2, requestId, secondHash)
  })

  it('does not acknowledge a token whose delivered transition was lost', async () => {
    repository.markDelivered.mockResolvedValue(false)

    await expect(service().process({ requestId })).rejects.toThrow(
      'changed during SMTP delivery',
    )
    expect(repository.markFailed).toHaveBeenCalledTimes(1)
  })
})

function service(enabled = true): RecoveryService {
  const configuration: Record<string, boolean | string> = {
    RECOVERY_EMAIL_ENABLED: enabled,
    RECOVERY_WEB_ORIGIN: 'http://127.0.0.1:3000',
  }
  return new RecoveryService(
    repository as unknown as RecoveryRepository,
    mailer as unknown as RecoveryMailer,
    {} as QueueService,
    {
      getOrThrow: (key: string) => configuration[key],
    } as unknown as ConfigService,
  )
}

function tokenFrom(resetUrl: string): string {
  const token = new URLSearchParams(new URL(resetUrl).hash.slice(1)).get(
    'token',
  )
  if (!token || token.length < 40) {
    throw new Error('Expected a high-entropy fragment token.')
  }
  return token
}
