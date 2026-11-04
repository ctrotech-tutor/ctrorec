export class ApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export async function requestJson(
  path: string,
  init: {
    method?: string
    body?: BodyInit
    headers?: Record<string, string>
    signal?: AbortSignal
    allowNotFound?: boolean
  } = {},
): Promise<unknown> {
  const response = await fetch(path, {
    method: init.method ?? 'GET',
    credentials: 'same-origin',
    headers: { Accept: 'application/json', ...init.headers },
    ...(init.body ? { body: init.body } : {}),
    ...(init.signal ? { signal: init.signal } : {}),
  })
  if (init.allowNotFound && response.status === 404) {
    return null
  }
  if (!response.ok) {
    throw await responseError(response)
  }
  return response.status === 204 ? null : response.json()
}

async function responseError(response: Response): Promise<ApiError> {
  const fallback =
    response.status === 401
      ? 'Your session has expired. Sign in again.'
      : response.status === 404
        ? 'This resource is not available to your account.'
        : response.status === 429
          ? 'Too many requests. Wait before trying again.'
          : 'The request could not be completed. Try again.'
  try {
    const body: unknown = await response.json()
    if (isRecord(body) && typeof body.message === 'string') {
      return new ApiError(
        response.status === 404 ? fallback : body.message,
        response.status,
      )
    }
  } catch {
    // Use the actionable fallback when the response is not JSON.
  }
  return new ApiError(fallback, response.status)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
