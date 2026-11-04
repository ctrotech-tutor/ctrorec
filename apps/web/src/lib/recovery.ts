import { requestJson } from './http'

export interface RecoveryRequestResult {
  accepted: true
  message: string
}

export interface RecoveryPreview {
  valid: true
  expiresAt: string
}

export async function requestRecovery(
  email: string,
): Promise<RecoveryRequestResult> {
  const value = await requestJson('/api/recovery/request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  })
  if (
    !isRecord(value) ||
    value.accepted !== true ||
    typeof value.message !== 'string'
  ) {
    throw new Error('The recovery response did not match its contract.')
  }
  return { accepted: true, message: value.message }
}

export async function inspectRecovery(
  token: string,
  signal?: AbortSignal,
): Promise<RecoveryPreview> {
  const value = await requestJson('/api/recovery/inspect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
    ...(signal ? { signal } : {}),
  })
  if (
    !isRecord(value) ||
    value.valid !== true ||
    typeof value.expiresAt !== 'string'
  ) {
    throw new Error('The recovery preview did not match its contract.')
  }
  return { valid: true, expiresAt: value.expiresAt }
}

export async function resetPassword(input: {
  token: string
  password: string
}): Promise<{ reset: true }> {
  const value = await requestJson('/api/recovery/reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!isRecord(value) || value.reset !== true) {
    throw new Error('The password reset did not match its contract.')
  }
  return { reset: true }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
