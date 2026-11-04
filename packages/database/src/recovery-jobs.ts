export const ACCOUNT_RECOVERY_JOB = 'account-recovery-email' as const

export const ACCOUNT_RECOVERY_OPEN_STATUSES = [
  'pending',
  'delivering',
  'delivered',
  'failed',
] as const

export const ACCOUNT_RECOVERY_JOB_OPTIONS = {
  retryLimit: 4,
  retryDelay: 10,
  retryBackoff: true,
  retryDelayMax: 60,
  expireInSeconds: 300,
  heartbeatSeconds: 30,
} as const

export interface AccountRecoveryJob {
  requestId: string
}

export function parseAccountRecoveryJob(value: unknown): AccountRecoveryJob {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Invalid account-recovery job payload.')
  }
  const { requestId } = value as Record<string, unknown>
  if (
    typeof requestId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      requestId,
    )
  ) {
    throw new Error('Invalid account-recovery job payload.')
  }
  return { requestId }
}
