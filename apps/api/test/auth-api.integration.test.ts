import type { Server } from 'node:http'
import {
  createDatabase,
  seedDevelopment,
  type Database,
  type DatabasePool,
} from '@ctrorec/database'
import { users } from '@ctrorec/database/schema'
import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { eq } from 'drizzle-orm'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest'
import { AppModule } from '../src/app.module.js'
import { configureApi } from '../src/configure-api.js'
import { requireTestDatabaseUrl, resetDatabase } from './test-database.js'

const lecturer = {
  email: 'lecturer@ctrorec.test',
  password: 'Lecturer-Dev-2026!',
}
const student = {
  email: 'student@ctrorec.test',
  password: 'Student-Dev-2026!',
}

let db: Database
let pool: DatabasePool
let app: NestExpressApplication
let baseUrl: string

beforeAll(() => {
  ;({ db, pool } = createDatabase(requireTestDatabaseUrl(), {
    applicationName: 'ctrorec-api-http-tests',
    maxConnections: 2,
  }))
})

beforeEach(async () => {
  await resetDatabase(db)
  await seedDevelopment(db)
  app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: false,
  })
  configureApi(app, { shutdownHooks: false })
  await app.listen(0, '127.0.0.1')
  const server = app.getHttpServer() as Server
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Expected the test API to listen on a TCP port.')
  }
  baseUrl = `http://127.0.0.1:${address.port}`
})

afterEach(async () => {
  await app.close()
})

afterAll(async () => {
  await pool.end()
})

describe('authentication HTTP API', () => {
  it('keeps health public and requires authentication for the current user', async () => {
    const health = await api('/api/health')
    const anonymous = await api('/api/auth/me')

    expect(health.status).toBe(200)
    expect(anonymous.status).toBe(401)
  })

  it('sets a protected session cookie and returns institutional memberships', async () => {
    const response = await signIn(lecturer)
    const setCookie = response.headers.get('set-cookie') ?? ''
    const cookie = cookieFrom(response)
    const me = await api('/api/auth/me', { cookie })
    const body = (await me.json()) as {
      user: { email: string; displayName: string }
      memberships: Array<{
        institution: { slug: string }
        roles: string[]
      }>
    }

    expect(response.status).toBe(200)
    expect(setCookie).toContain('__Host-sid=')
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('Secure')
    expect(setCookie).toContain('SameSite=Lax')
    expect(setCookie).toContain('Path=/')
    expect(me.status).toBe(200)
    expect(body.user).toMatchObject({
      email: lecturer.email,
      displayName: 'Development Lecturer',
    })
    expect(body.memberships).toHaveLength(1)
    expect(body.memberships[0]).toMatchObject({
      institution: { slug: 'asteria-university' },
      roles: ['academic_staff', 'institution_admin'],
    })
    expect(JSON.stringify(body)).not.toContain('passwordHash')
  })

  it('returns the same credential error for unknown and incorrect passwords', async () => {
    const incorrect = await signIn({
      email: lecturer.email,
      password: 'incorrect-password',
    })
    const unknown = await signIn({
      email: 'unknown@ctrorec.test',
      password: 'incorrect-password',
    })
    const incorrectBody = (await incorrect.json()) as { message: string }
    const unknownBody = (await unknown.json()) as { message: string }

    expect(incorrect.status).toBe(401)
    expect(unknown.status).toBe(401)
    expect(incorrectBody.message).toBe('Invalid email or password')
    expect(unknownBody.message).toBe(incorrectBody.message)
    expect(incorrect.headers.get('set-cookie')).toBeNull()
    expect(unknown.headers.get('set-cookie')).toBeNull()
  })

  it('signs out and rejects the revoked cookie', async () => {
    const cookie = cookieFrom(await signIn(lecturer))
    const signOut = await api('/api/auth/sign-out', {
      method: 'POST',
      cookie,
    })
    const me = await api('/api/auth/me', { cookie })

    expect(signOut.status).toBe(204)
    expect(me.status).toBe(401)
  })

  it('does not let one user revoke another user’s session', async () => {
    const lecturerCookie = cookieFrom(await signIn(lecturer))
    const studentCookie = cookieFrom(await signIn(student))
    const sessionsResponse = await api('/api/auth/sessions', {
      cookie: lecturerCookie,
    })
    const sessions = (await sessionsResponse.json()) as Array<{
      id: string
      current: boolean
    }>
    const lecturerSession = sessions.find((session) => session.current)
    if (!lecturerSession) {
      throw new Error('Expected the lecturer session to be listed.')
    }

    const denied = await api(`/api/auth/sessions/${lecturerSession.id}`, {
      method: 'DELETE',
      cookie: studentCookie,
    })
    const stillValid = await api('/api/auth/me', { cookie: lecturerCookie })
    const revoked = await api(`/api/auth/sessions/${lecturerSession.id}`, {
      method: 'DELETE',
      cookie: lecturerCookie,
    })
    const afterRevocation = await api('/api/auth/me', {
      cookie: lecturerCookie,
    })

    expect(denied.status).toBe(404)
    expect(stillValid.status).toBe(200)
    expect(revoked.status).toBe(204)
    expect(afterRevocation.status).toBe(401)
  })

  it('ends access immediately when a user is suspended', async () => {
    const cookie = cookieFrom(await signIn(lecturer))
    await db
      .update(users)
      .set({ status: 'suspended' })
      .where(eq(users.email, lecturer.email))
    const me = await api('/api/auth/me', { cookie })

    expect(me.status).toBe(401)
  })

  it('rejects cross-origin browser sign-in attempts', async () => {
    const response = await api('/api/auth/sign-in', {
      method: 'POST',
      body: lecturer,
      headers: {
        Origin: 'https://attacker.invalid',
        'Sec-Fetch-Site': 'cross-site',
      },
    })

    expect(response.status).toBe(403)
    expect(response.headers.get('set-cookie')).toBeNull()
  })

  it('throttles repeated password attempts for one account', async () => {
    const statuses: number[] = []
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const response = await signIn({
        email: lecturer.email,
        password: 'incorrect-password',
      })
      statuses.push(response.status)
    }

    expect(statuses).toEqual([401, 401, 401, 401, 401, 429])
  })
})

async function signIn(credentials: {
  email: string
  password: string
}): Promise<Response> {
  return api('/api/auth/sign-in', { method: 'POST', body: credentials })
}

async function api(
  path: string,
  options: {
    method?: string
    cookie?: string
    body?: unknown
    headers?: Record<string, string>
  } = {},
): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.cookie ? { Cookie: options.cookie } : {}),
      ...options.headers,
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  })
}

function cookieFrom(response: Response): string {
  const setCookie = response.headers.get('set-cookie')
  if (!setCookie) {
    throw new Error(`Expected a session cookie; received ${response.status}.`)
  }
  const [cookie] = setCookie.split(';')
  if (!cookie) {
    throw new Error('Expected a non-empty session cookie.')
  }
  return cookie
}
