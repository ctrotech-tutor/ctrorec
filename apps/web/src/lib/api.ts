import { queryOptions } from '@tanstack/react-query'

interface HealthResponse {
  service: 'api'
  status: 'ok'
}

function isHealthResponse(value: unknown): value is HealthResponse {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  return (
    'service' in value &&
    value.service === 'api' &&
    'status' in value &&
    value.status === 'ok'
  )
}

export const apiHealthOptions = queryOptions({
  queryKey: ['system', 'api-health'],
  queryFn: async ({ signal }): Promise<HealthResponse> => {
    const response = await fetch('/api/health', {
      headers: { Accept: 'application/json' },
      signal,
    })

    if (!response.ok) {
      throw new Error(`API health request failed with ${response.status}.`)
    }

    const body: unknown = await response.json()
    if (!isHealthResponse(body)) {
      throw new Error(
        'API health response did not match the expected contract.',
      )
    }

    return body
  },
  retry: 1,
})
