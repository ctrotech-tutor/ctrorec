import { createHash } from 'node:crypto'
import type { Server } from 'node:http'
import { PasswordHasher } from '@nestjs/authentication'
import {
  createDatabase,
  seedDevelopment,
  type Database,
  type DatabasePool,
} from '@ctrorec/database'
import {
  institutionInvitationRoles,
  institutionInvitations,
  institutions,
  membershipRoles,
  memberships,
  users,
} from '@ctrorec/database/schema'
import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { and, eq, isNull } from 'drizzle-orm'
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

const adminCredentials = {
  email: 'lecturer@ctrorec.test',
  password: 'Lecturer-Dev-2026!',
}
const studentCredentials = {
  email: 'student@ctrorec.test',
  password: 'Student-Dev-2026!',
}
const INSTITUTION_ID = '019a1000-0000-7000-8000-000000000001'
const adminRoot = `/api/institutions/${INSTITUTION_ID}/admin/invitations`

interface InvitationView {
  id: string
  email: string
  displayName: string
  roles: string[]
  status: string
  expiresAt: string
  acceptedAt: string | null
  revokedAt: string | null
  revocationReason: string | null
}
interface CreatedInvitation {
  invitation: InvitationView
  token: string
}
interface InvitationPreview {
  institution: { name: string; slug: string }
  email: string
  displayName: string
  roles: string[]
  accountExists: boolean
}
interface AcceptedInvitation {
  accepted: true
  email: string
  displayName: string
  roles: string[]
}

let db: Database
let pool: DatabasePool
let app: NestExpressApplication
let baseUrl: string

beforeAll(() => {
  ;({ db, pool } = createDatabase(requireTestDatabaseUrl(), {
    applicationName: 'ctrorec-invitation-http-tests',
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

describe('institution invitations', () => {
  it('replaces and revokes invitations without exposing stored token material', async () => {
    const admin = cookieFrom(await signIn(adminCredentials))
    const student = cookieFrom(await signIn(studentCredentials))
    expect((await api(adminRoot, { cookie: student })).status).toBe(404)

    const first = await createInvitation(admin, {
      email: ' New.Person@Example.test ',
      displayName: '  New Person  ',
      roles: ['student', 'academic_staff'],
      expiresInDays: 3,
    })
    expect(first.response.status).toBe(201)
    expect(first.body.invitation).toMatchObject({
      email: 'new.person@example.test',
      displayName: 'New Person',
      roles: ['academic_staff', 'student'],
      status: 'pending',
    })
    expect(first.body.token.length).toBeGreaterThanOrEqual(40)
    expect(JSON.stringify(first.body.invitation)).not.toContain('tokenHash')
    expect((await inspect(first.body.token)).status).toBe(200)

    const second = await createInvitation(admin, {
      email: 'new.person@example.test',
      displayName: 'New Person',
      roles: ['student'],
    })
    expect(second.response.status).toBe(201)
    expect((await inspect(first.body.token)).status).toBe(400)

    const listed = await api(adminRoot, { cookie: admin })
    const listBody = await json<InvitationView[]>(listed)
    expect(listBody).toHaveLength(2)
    expect(listBody.map((invitation) => invitation.status).sort()).toEqual([
      'pending',
      'replaced',
    ])
    expect(JSON.stringify(listBody)).not.toContain(first.body.token)
    expect(JSON.stringify(listBody)).not.toContain(second.body.token)
    expect(JSON.stringify(listBody)).not.toContain('tokenHash')

    const revoked = await api(
      `${adminRoot}/${second.body.invitation.id}/revoke`,
      { method: 'POST', cookie: admin },
    )
    expect(revoked.status).toBe(200)
    expect((await json<InvitationView>(revoked)).status).toBe('revoked')
    expect((await inspect(second.body.token)).status).toBe(400)
    expect(
      (
        await api(`${adminRoot}/${second.body.invitation.id}/revoke`, {
          method: 'POST',
          cookie: admin,
        })
      ).status,
    ).toBe(200)

    const afterRevocation = await createInvitation(admin, {
      email: 'new.person@example.test',
      displayName: 'New Person',
      roles: ['student'],
    })
    expect(afterRevocation.response.status).toBe(201)

    const stored = await db
      .select()
      .from(institutionInvitations)
      .where(eq(institutionInvitations.email, 'new.person@example.test'))
    expect(stored).toHaveLength(3)
    for (const row of stored) {
      expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/)
      expect(row.tokenHash).not.toBe(first.body.token)
    }
    const current = stored.find(
      (row) => row.id === afterRevocation.body.invitation.id,
    )
    expect(current?.tokenHash).toBe(
      createHash('sha256')
        .update(afterRevocation.body.token, 'utf8')
        .digest('hex'),
    )
  })

  it('creates a new account, membership, and roles in one single-use acceptance', async () => {
    const admin = cookieFrom(await signIn(adminCredentials))
    const email = 'invited.student@example.test'
    const password = 'Invited-Student-2026!'
    const created = await createInvitation(admin, {
      email,
      displayName: 'Invited Student',
      roles: ['student'],
    })
    const preview = await json<InvitationPreview>(
      await inspect(created.body.token),
    )
    expect(preview).toMatchObject({
      email,
      displayName: 'Invited Student',
      accountExists: false,
      institution: { slug: 'asteria-university' },
    })

    expect(
      (
        await accept(created.body.token, {
          email,
          password: 'too-short',
        })
      ).status,
    ).toBe(400)
    expect((await inspect(created.body.token)).status).toBe(200)
    expect(
      await db.select().from(users).where(eq(users.email, email)),
    ).toHaveLength(0)

    const accepted = await accept(created.body.token, { email, password })
    expect(accepted.status).toBe(200)
    expect(await json<AcceptedInvitation>(accepted)).toMatchObject({
      accepted: true,
      email,
      displayName: 'Invited Student',
      roles: ['student'],
    })
    expect((await accept(created.body.token, { email, password })).status).toBe(
      400,
    )

    const session = await signIn({ email, password })
    expect(session.status).toBe(200)
    const me = await api('/api/auth/me', { cookie: cookieFrom(session) })
    const account = await json<{
      user: { email: string; displayName: string; emailVerified: boolean }
      memberships: Array<{ status: string; roles: string[] }>
    }>(me)
    expect(account.user).toMatchObject({
      email,
      displayName: 'Invited Student',
      emailVerified: false,
    })
    expect(account.memberships).toHaveLength(1)
    expect(account.memberships[0]).toMatchObject({
      status: 'active',
      roles: ['student'],
    })

    const user = required(
      (await db.select().from(users).where(eq(users.email, email)))[0],
    )
    const membership = required(
      (
        await db
          .select()
          .from(memberships)
          .where(
            and(
              eq(memberships.institutionId, INSTITUTION_ID),
              eq(memberships.userId, user.id),
            ),
          )
      )[0],
    )
    const invitation = required(
      (
        await db
          .select()
          .from(institutionInvitations)
          .where(eq(institutionInvitations.id, created.body.invitation.id))
      )[0],
    )
    expect(user.emailVerifiedAt).toBeNull()
    expect(invitation).toMatchObject({
      acceptedUserId: user.id,
      acceptedMembershipId: membership.id,
    })
    expect(invitation.acceptedAt).not.toBeNull()
    expect(
      await db
        .select()
        .from(membershipRoles)
        .where(eq(membershipRoles.membershipId, membership.id)),
    ).toHaveLength(1)
  })

  it('requires the current password for an existing account and preserves its identity', async () => {
    const admin = cookieFrom(await signIn(adminCredentials))
    const email = 'existing.person@example.test'
    const password = 'Existing-Password-2026!'
    const passwordHasher = app.get(PasswordHasher)
    const existing = required(
      (
        await db
          .insert(users)
          .values({
            email,
            displayName: 'Original Account Name',
            passwordHash: await passwordHasher.hash(password),
            status: 'active',
          })
          .returning()
      )[0],
    )
    const created = await createInvitation(admin, {
      email,
      displayName: 'Invitation Display Name',
      roles: ['academic_staff'],
    })
    expect(
      (await json<InvitationPreview>(await inspect(created.body.token)))
        .accountExists,
    ).toBe(true)
    expect(
      (
        await accept(created.body.token, {
          email,
          password: 'Incorrect-Password-2026!',
        })
      ).status,
    ).toBe(401)
    expect((await inspect(created.body.token)).status).toBe(200)

    const accepted = await accept(created.body.token, { email, password })
    expect(accepted.status).toBe(200)
    expect((await json<AcceptedInvitation>(accepted)).displayName).toBe(
      'Original Account Name',
    )
    const session = await signIn({ email, password })
    expect(session.status).toBe(200)
    const me = await json<{
      user: { displayName: string }
      memberships: Array<{ roles: string[] }>
    }>(await api('/api/auth/me', { cookie: cookieFrom(session) }))
    expect(me.user.displayName).toBe('Original Account Name')
    expect(me.memberships).toHaveLength(1)
    expect(me.memberships[0]?.roles).toEqual(['academic_staff'])
    expect(
      required(
        (await db.select().from(users).where(eq(users.id, existing.id)))[0],
      ).displayName,
    ).toBe('Original Account Name')
  })

  it('fails closed for expiry, suspended institutions, and existing memberships', async () => {
    const admin = cookieFrom(await signIn(adminCredentials))
    expect(
      (
        await createInvitation(admin, {
          email: studentCredentials.email,
          displayName: 'Development Student',
          roles: ['student'],
        })
      ).response.status,
    ).toBe(409)

    const created = await createInvitation(admin, {
      email: 'expiring.person@example.test',
      displayName: 'Expiring Person',
      roles: ['student'],
    })
    await db
      .update(institutionInvitations)
      .set({
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        expiresAt: new Date('2026-01-02T00:00:00.000Z'),
      })
      .where(eq(institutionInvitations.id, created.body.invitation.id))
    expect((await inspect(created.body.token)).status).toBe(400)

    const replacement = await createInvitation(admin, {
      email: 'expiring.person@example.test',
      displayName: 'Expiring Person',
      roles: ['student'],
    })
    expect(replacement.response.status).toBe(201)
    await db
      .update(institutions)
      .set({ status: 'suspended' })
      .where(eq(institutions.id, INSTITUTION_ID))
    expect((await inspect(replacement.body.token)).status).toBe(400)
    expect((await api(adminRoot, { cookie: admin })).status).toBe(404)
  })

  it('allows only one concurrent acceptance', async () => {
    const admin = cookieFrom(await signIn(adminCredentials))
    const email = 'concurrent.person@example.test'
    const created = await createInvitation(admin, {
      email,
      displayName: 'Concurrent Person',
      roles: ['student'],
    })
    const attempts = await Promise.all(
      ['Concurrent-Password-One!', 'Concurrent-Password-Two!'].map(
        async (password) => ({
          password,
          response: await accept(created.body.token, { email, password }),
        }),
      ),
    )
    const successful = attempts.filter(
      (attempt) => attempt.response.status === 200,
    )
    expect(successful).toHaveLength(1)
    expect(
      attempts.filter((attempt) => attempt.response.status === 400),
    ).toHaveLength(1)
    expect(
      await db.select().from(users).where(eq(users.email, email)),
    ).toHaveLength(1)
    expect(
      await db
        .select()
        .from(institutionInvitations)
        .where(eq(institutionInvitations.id, created.body.invitation.id)),
    ).toHaveLength(1)
    expect(
      await db
        .select()
        .from(institutionInvitationRoles)
        .where(
          eq(
            institutionInvitationRoles.invitationId,
            created.body.invitation.id,
          ),
        ),
    ).toHaveLength(1)
    expect(
      (
        await signIn({
          email,
          password: required(successful[0]).password,
        })
      ).status,
    ).toBe(200)
  })

  it('does not leave an open invitation when acceptance races replacement', async () => {
    const admin = cookieFrom(await signIn(adminCredentials))
    const email = 'acceptance.replacement@example.test'
    const created = await createInvitation(admin, {
      email,
      displayName: 'Race Person',
      roles: ['student'],
    })
    const [accepted, replacement] = await Promise.all([
      accept(created.body.token, {
        email,
        password: 'Race-Password-2026!',
      }),
      createInvitation(admin, {
        email,
        displayName: 'Race Person',
        roles: ['student'],
      }),
    ])

    const storedUser = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
    const openInvitations = await db
      .select()
      .from(institutionInvitations)
      .where(
        and(
          eq(institutionInvitations.email, email),
          isNull(institutionInvitations.acceptedAt),
          isNull(institutionInvitations.revokedAt),
        ),
      )
    if (accepted.status === 200) {
      expect(replacement.response.status).toBe(409)
      expect(storedUser).toHaveLength(1)
      expect(openInvitations).toHaveLength(0)
    } else {
      expect(accepted.status).toBe(400)
      expect(replacement.response.status).toBe(201)
      expect(storedUser).toHaveLength(0)
      expect(openInvitations).toHaveLength(1)
      expect(openInvitations[0]?.id).toBe(replacement.body.invitation.id)
    }
  })
})

async function createInvitation(
  cookie: string,
  body: {
    email: string
    displayName: string
    roles: string[]
    expiresInDays?: number
  },
): Promise<{ response: Response; body: CreatedInvitation }> {
  const response = await api(adminRoot, { method: 'POST', cookie, body })
  const responseBody = await json<CreatedInvitation>(response)
  return { response, body: responseBody }
}

async function inspect(token: string): Promise<Response> {
  return api('/api/invitations/inspect', {
    method: 'POST',
    body: { token },
  })
}

async function accept(
  token: string,
  body: { email: string; password: string },
): Promise<Response> {
  return api('/api/invitations/accept', {
    method: 'POST',
    body: { token, ...body },
  })
}

async function signIn(credentials: {
  email: string
  password: string
}): Promise<Response> {
  return api('/api/auth/sign-in', { method: 'POST', body: credentials })
}

async function api(
  path: string,
  options: { method?: string; cookie?: string; body?: unknown } = {},
): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      Accept: 'application/json',
      ...(options.body === undefined
        ? {}
        : { 'Content-Type': 'application/json' }),
      ...(options.cookie ? { Cookie: options.cookie } : {}),
    },
    ...(options.body === undefined
      ? {}
      : { body: JSON.stringify(options.body) }),
  })
}

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T
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

function required<T>(value: T | undefined): T {
  if (value === undefined) {
    throw new Error('Expected a stored row or result.')
  }
  return value
}
