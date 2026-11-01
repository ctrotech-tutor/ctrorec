export const DATA_SAVER_KIND = 'data_saver' as const
export const DATA_SAVER_JOB = 'lecture-audio-data-saver' as const

export const DATA_SAVER_JOB_OPTIONS = {
  retryLimit: 3,
  retryDelay: 15,
  retryBackoff: true,
  retryDelayMax: 120,
  expireInSeconds: 3600,
  heartbeatSeconds: 30,
} as const

export interface DataSaverJob {
  derivativeId: string
  lectureId: string
  sourceSha256: string
}

export function parseDataSaverJob(value: unknown): DataSaverJob {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Invalid data-saver job payload.')
  }
  const { derivativeId, lectureId, sourceSha256 } = value as Record<
    string,
    unknown
  >
  if (
    !isUuid(derivativeId) ||
    !isUuid(lectureId) ||
    typeof sourceSha256 !== 'string' ||
    !/^[0-9a-f]{64}$/.test(sourceSha256)
  ) {
    throw new Error('Invalid data-saver job payload.')
  }
  return { derivativeId, lectureId, sourceSha256 }
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
}
