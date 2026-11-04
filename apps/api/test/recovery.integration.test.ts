import { createHash, randomBytes } from 'node:crypto'
import type { Server } from 'node:http'
import {
  createDatabase,
  seedDevelopment,
  type Database,
  type DatabasePool,
} from '@ctrorec/database'
import {
  accountRecoveryRequests,
  authSessions,
  memberships,
  users,
} from '@ctrorec/database/schema'
import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { desc, eq, sql } from 'drizzle-orm'
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

const student = {
  email: 'student@ctrorec.test',
  password: 'Student-Dev-2026!',
}
const genericMessage =
  'If an active account matches that email, a recovery link will be sent.'

let db: Database
let pool: DatabasePool
let app: NestExpressApplication
let baseUrl: string

beforeAll(() => {
  ;({ db, pool } = createDatabase(requireTestDatabaseUrl(), {
    applicationName: 'ctrorec-recovery-http-tests',
    maxConnections: 4,
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

describe('self-service account recovery', () => {
  it('is generic, normalizes email, persists hashless requests, and throttles repeats', async () => {
    const known = await request(' Student@Ctrorec.Test ')
    const unknown = await request('unknown@example.test')
    expect(known.status).toBe(202)
    expect(unknown.status).toBe(202)
    expect(await json(known)).toEqual({
      accepted: true,
      message: genericMessage,
    })
    expect(await json(unknown)).toEqual({
      accepted: true,
      message: genericMessage,
    })

    const rows = await db.select().from(accountRecoveryRequests)
    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.email).sort()).toEqual([
      student.email,
      'unknown@example.test',
    ])
    for (const row of rows) {
      expect(row.status).toBe('pending')
      expect(row.userId).toBeNull()
      expect(row.tokenHash).toBeNull()
    }
    const knownRow = required(rows.find((row) => row.email === student.email))
    const queued = await db.execute(
      sql`SELECT data FROM pgboss.job WHERE id = ${knownRow.id}`,
    )
    expect(queued.rows).toHaveLength(1)
    expect(queued.rows[0]?.data).toEqual({ requestId: knownRow.id })
    expect(JSON.stringify(queued.rows[0])).not.toContain(student.email)

    expect((await request(student.email)).status).toBe(202)
    expect(await db.select().from(accountRecoveryRequests)).toHaveLength(2)
    const statuses: number[] = []
    for (let attempt = 0; attempt < 4; attempt += 1) {
      statuses.push((await request(student.email)).status)
    }
    expect(statuses).toEqual([202, 202, 202, 429])
  })

  it('invalidates replaced and expired links without exposing account details', async () => {
    const firstId = await requestRecoveryId(student.email)
    const firstToken = await deliver(firstId, student.email)
    const preview = await inspect(firstToken)
    expect(preview.status).toBe(200)
    expect(await json(preview)).toEqual({
      valid: true,
      expiresAt: expect.any(String),
    })
    expect(
      JSON.stringify(await db.select().from(accountRecoveryRequests)),
    ).not.toContain(firstToken)

    await db
      .update(accountRecoveryRequests)
      .set({ createdAt: new Date(Date.now() - 120_000) })
      .where(eq(accountRecoveryRequests.id, firstId))
    expect((await request(student.email)).status).toBe(202)
    const requests = await db
      .select()
      .from(accountRecoveryRequests)
      .where(eq(accountRecoveryRequests.email, student.email))
      .orderBy(desc(accountRecoveryRequests.createdAt))
    expect(requests).toHaveLength(2)
    expect(requests.find((row) => row.id === firstId)).toMatchObject({
      status: 'revoked',
      revocationReason: 'replaced',
    })
    expect((await inspect(firstToken)).status).toBe(400)

    const secondId = required(requests.find((row) => row.id !== firstId)).id
    const secondToken = await deliver(secondId, student.email)
    await db
      .update(accountRecoveryRequests)
      .set({
        createdAt: new Date(Date.now() - 20 * 60_000),
        deliveredAt: new Date(Date.now() - 10 * 60_000),
        expiresAt: new Date(Date.now() - 60_000),
      })
      .where(eq(accountRecoveryRequests.id, secondId))
    expect((await inspect(secondToken)).status).toBe(400)
    expect(
      (
        await reset({
          token: secondToken,
          password: 'Expired-Link-2026!',
        })
      ).status,
    ).toBe(400)
  })

  it('resets once, revokes sessions and other links, and preserves account metadata', async () => {
    const firstCookie = cookieFrom(await signIn(student))
    const secondCookie = cookieFrom(await signIn(student))
    const before = required(
      (await db.select().from(users).where(eq(users.email, student.email)))[0],
    )
    const staleSessions = await db
      .select()
      .from(authSessions)
      .where(eq(authSessions.userId, before.id))
    expect(staleSessions).toHaveLength(2)
    expect(
      staleSessions.every(
        (session) =>
          session.metadata?.credentialsVersion === before.credentialsVersion,
      ),
    ).toBe(true)
    const membershipCount = (
      await db
        .select()
        .from(memberships)
        .where(eq(memberships.userId, before.id))
    ).length

    const requestId = await requestRecoveryId(student.email)
    const token = await deliver(requestId, student.email)
    const otherToken = randomBytes(32).toString('base64url')
    const now = new Date()
    await db.insert(accountRecoveryRequests).values({
      email: student.email,
      userId: before.id,
      tokenHash: hash(otherToken),
      status: 'delivered',
      deliveredAt: now,
      expiresAt: new Date(now.getTime() + 15 * 60_000),
    })

    expect((await reset({ token, password: 'short' })).status).toBe(400)
    expect((await inspect(token)).status).toBe(200)
    const response = await reset({
      token,
      password: 'Recovered-Student-2026!',
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(await json(response)).toEqual({ reset: true })

    expect((await me(firstCookie)).status).toBe(401)
    expect((await me(secondCookie)).status).toBe(401)
    expect(
      await db
        .select()
        .from(authSessions)
        .where(eq(authSessions.userId, before.id)),
    ).toHaveLength(0)

    // Model an old-password verification that inserts its session after the
    // reset transaction's delete. Its stale credential snapshot must fail.
    const concurrentSignInAt = new Date()
    await db.insert(authSessions).values(
      staleSessions.map((session) => ({
        ...session,
        createdAt: concurrentSignInAt,
        lastActiveAt: concurrentSignInAt,
      })),
    )
    expect((await me(firstCookie)).status).toBe(401)
    expect((await me(secondCookie)).status).toBe(401)
    expect((await inspect(token)).status).toBe(400)
    expect((await inspect(otherToken)).status).toBe(400)
    expect(
      (
        await db
          .select()
          .from(accountRecoveryRequests)
          .where(eq(accountRecoveryRequests.id, requestId))
      )[0],
    ).toMatchObject({ status: 'consumed' })
    expect(
      (
        await db
          .select()
          .from(accountRecoveryRequests)
          .where(eq(accountRecoveryRequests.tokenHash, hash(otherToken)))
      )[0],
    ).toMatchObject({ status: 'revoked', revocationReason: 'reset' })

    const after = required(
      (await db.select().from(users).where(eq(users.email, student.email)))[0],
    )
    expect(after.emailVerifiedAt?.toISOString() ?? null).toBe(
      before.emailVerifiedAt?.toISOString() ?? null,
    )
    expect(after.displayName).toBe(before.displayName)
    expect(after.credentialsVersion).toBe(before.credentialsVersion + 1)
    expect(
      await db
        .select()
        .from(memberships)
        .where(eq(memberships.userId, before.id)),
    ).toHaveLength(membershipCount)
    expect((await signIn(student)).status).toBe(401)
    const recoveredSignIn = await signIn({
      email: student.email,
      password: 'Recovered-Student-2026!',
    })
    expect(recoveredSignIn.status).toBe(200)
    expect((await me(cookieFrom(recoveredSignIn))).status).toBe(200)
    const [currentSession] = await db
      .select()
      .from(authSessions)
      .where(eq(authSessions.userId, before.id))
      .orderBy(desc(authSessions.createdAt))
      .limit(1)
    expect(currentSession?.metadata?.credentialsVersion).toBe(
      after.credentialsVersion,
    )
  })

  it('allows only one of two concurrent resets to commit', async () => {
    const id = await requestRecoveryId(student.email)
    const token = await deliver(id, student.email)
    const responses = await Promise.all([
      reset({ token, password: 'Concurrent-One-2026!' }),
      reset({ token, password: 'Concurrent-Two-2026!' }),
    ])
    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 400,
    ])
    expect(
      responses.every((response) => !response.headers.get('set-cookie')),
    ).toBe(true)
    expect((await inspect(token)).status).toBe(400)

    const passwords = ['Concurrent-One-2026!', 'Concurrent-Two-2026!']
    const signInStatuses: number[] = []
    for (const password of passwords) {
      signInStatuses.push(
        (await signIn({ email: student.email, password })).status,
      )
    }
    expect(signInStatuses.sort()).toEqual([200, 401])
  })

  it('rejects a delivered link when the account is no longer active', async () => {
    const id = await requestRecoveryId(student.email)
    const token = await deliver(id, student.email)
    await db
      .update(users)
      .set({ status: 'suspended' })
      .where(eq(users.email, student.email))

    expect((await inspect(token)).status).toBe(400)
    expect(
      (await reset({ token, password: 'Suspended-Reset-2026!' })).status,
    ).toBe(400)
    expect(
      (
        await db
          .select()
          .from(accountRecoveryRequests)
          .where(eq(accountRecoveryRequests.id, id))
      )[0],
    ).toMatchObject({ status: 'delivered', consumedAt: null })
  })
})

async function request(email: string): Promise<Response> {
  return api('/api/recovery/request', { method: 'POST', body: { email } })
}

async function requestRecoveryId(email: string): Promise<string> {
  const response = await request(email)
  expect(response.status).toBe(202)
  const [row] = await db
    .select()
    .from(accountRecoveryRequests)
    .where(eq(accountRecoveryRequests.email, email))
    .orderBy(desc(accountRecoveryRequests.createdAt))
    .limit(1)
  return required(row).id
}

async function deliver(requestId: string, email: string): Promise<string> {
  const user = required(
    (await db.select().from(users).where(eq(users.email, email)))[0],
  )
  const token = randomBytes(32).toString('base64url')
  const now = new Date()
  await db
    .update(accountRecoveryRequests)
    .set({
      userId: user.id,
      tokenHash: hash(token),
      status: 'delivered',
      deliveredAt: now,
      updatedAt: now,
    })
    .where(eq(accountRecoveryRequests.id, requestId))
  return token
}

async function inspect(token: string): Promise<Response> {
  return api('/api/recovery/inspect', { method: 'POST', body: { token } })
}

async function reset(input: {
  token: string
  password: string
}): Promise<Response> {
  return api('/api/recovery/reset', { method: 'POST', body: input })
}

async function signIn(credentials: {
  email: string
  password: string
}): Promise<Response> {
  return api('/api/auth/sign-in', { method: 'POST', body: credentials })
}

async function me(cookie: string): Promise<Response> {
  return api('/api/auth/me', { cookie })
}

async function api(
  path: string,
  options: {
    method?: string
    cookie?: string
    body?: unknown
  } = {},
): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.cookie ? { Cookie: options.cookie } : {}),
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

function hash(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) {
    throw new Error('Expected a stored recovery fixture.')
  }
  return value
}

async function json<T = unknown>(response: Response): Promise<T> {
  return (await response.json()) as T
}
