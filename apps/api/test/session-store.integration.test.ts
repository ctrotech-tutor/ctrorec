import { randomUUID } from 'node:crypto'
import {
  createDatabase,
  type Database,
  type DatabasePool,
} from '@ctrorec/database'
import { users } from '@ctrorec/database/schema'
import { AuthenticationStorage } from '@nestjs/authentication'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { DrizzleSessionStore } from '../src/auth/session.store.js'
import { requireTestDatabaseUrl, resetDatabase } from './test-database.js'

let db: Database
let pool: DatabasePool
let store: DrizzleSessionStore
let userId: string

beforeAll(() => {
  ;({ db, pool } = createDatabase(requireTestDatabaseUrl(), {
    applicationName: 'ctrorec-session-store-tests',
    maxConnections: 4,
  }))
})

beforeEach(async () => {
  await resetDatabase(db)
  const [user] = await db
    .insert(users)
    .values({
      email: `${randomUUID()}@ctrorec.test`,
      displayName: 'Session Test User',
    })
    .returning()
  if (!user) {
    throw new Error('Expected a test user.')
  }
  userId = user.id
  store = new DrizzleSessionStore(
    db,
    new AuthenticationStorage({ contracts: [], allowInMemoryStorage: true }),
  )
})

afterAll(async () => {
  await pool.end()
})

describe('PostgreSQL session store', () => {
  it('round-trips session fields without null optional values', async () => {
    const record = sessionRecord({
      mfa: 'verified',
      metadata: { userAgent: 'Firefox', tags: ['phone', 1] },
    })
    await store.createSession(record)

    expect(await store.getSession(record.id)).toEqual(record)
    expect(await store.listUserSessions(userId)).toEqual([record])
    expect(await store.getSession(randomUUID())).toBeUndefined()
  })

  it('touches only forward and never recreates a deleted session', async () => {
    const record = sessionRecord()
    await store.createSession(record)
    const later = new Date(record.lastActiveAt.getTime() + 60_000)
    await store.touchSession(record.id, later)
    await store.touchSession(record.id, record.createdAt)

    expect((await store.getSession(record.id))?.lastActiveAt).toEqual(later)
    expect(await store.deleteSession(record.id)).toBe(true)
    await store.touchSession(record.id, new Date())
    expect(await store.getSession(record.id)).toBeUndefined()
    expect(await store.deleteSession(record.id)).toBe(false)
  })

  it('allows exactly one concurrent delete to win', async () => {
    const record = sessionRecord()
    await store.createSession(record)

    const results = await Promise.all(
      Array.from({ length: 6 }, () => store.deleteSession(record.id)),
    )
    expect(results.filter(Boolean)).toHaveLength(1)
  })

  it('prunes expired sessions when creating a new one', async () => {
    const now = Date.now()
    const expired = sessionRecord({
      createdAt: new Date(now - 120_000),
      lastActiveAt: new Date(now - 120_000),
      expiresAt: new Date(now - 60_000),
    })
    const current = sessionRecord()
    await store.createSession(expired)
    await store.createSession(current)

    expect(await store.getSession(expired.id)).toBeUndefined()
    expect(await store.getSession(current.id)).toEqual(current)
  })
})

function sessionRecord(
  overrides: Partial<Parameters<DrizzleSessionStore['createSession']>[0]> = {},
): Parameters<DrizzleSessionStore['createSession']>[0] {
  const createdAt = new Date()
  return {
    id: randomUUID(),
    userId,
    createdAt,
    lastActiveAt: createdAt,
    expiresAt: new Date(createdAt.getTime() + 3_600_000),
    ...overrides,
  }
}
