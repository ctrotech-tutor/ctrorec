import { createFileRoute } from '@tanstack/react-router'

const requestHeadersToStrip = ['connection', 'content-length', 'host']
const responseHeadersToStrip = [
  'connection',
  'content-encoding',
  'content-length',
  'keep-alive',
  'transfer-encoding',
]

export const Route = createFileRoute('/api/$')({
  server: {
    handlers: {
      GET: proxyToApi,
      HEAD: proxyToApi,
      POST: proxyToApi,
      PUT: proxyToApi,
      PATCH: proxyToApi,
      DELETE: proxyToApi,
      OPTIONS: proxyToApi,
    },
  },
})

async function proxyToApi({
  request,
}: {
  request: Request
}): Promise<Response> {
  const incomingUrl = new URL(request.url)
  const target = new URL(
    process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:3001',
  )
  target.pathname = incomingUrl.pathname
  target.search = incomingUrl.search

  const headers = new Headers(request.headers)
  for (const header of requestHeadersToStrip) {
    headers.delete(header)
  }
  headers.set('x-forwarded-host', incomingUrl.host)
  headers.set('x-forwarded-proto', incomingUrl.protocol.slice(0, -1))
  headers.delete('x-forwarded-for')
  const clientIp = (request as Request & { ip?: unknown }).ip
  if (typeof clientIp === 'string' && clientIp.length > 0) {
    headers.set('x-forwarded-for', clientIp)
  }

  const init: RequestInit & { duplex: 'half' } = {
    method: request.method,
    headers,
    redirect: 'manual',
    signal: request.signal,
    duplex: 'half',
    ...(request.method !== 'GET' && request.method !== 'HEAD'
      ? { body: request.body }
      : {}),
  }

  try {
    const upstream = await fetch(target, init)
    const responseHeaders = new Headers(upstream.headers)
    const cookies = upstream.headers.getSetCookie()
    for (const header of responseHeadersToStrip) {
      responseHeaders.delete(header)
    }
    responseHeaders.delete('set-cookie')
    for (const cookie of cookies) {
      responseHeaders.append('set-cookie', cookie)
    }

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    })
  } catch (error) {
    if (request.signal.aborted) {
      return new Response(null, { status: 499 })
    }
    console.error('API proxy request failed', error)
    return Response.json(
      { message: 'The API is unavailable.', statusCode: 502 },
      { status: 502 },
    )
  }
}
