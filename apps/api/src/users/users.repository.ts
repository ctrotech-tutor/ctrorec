import type { Database } from '@ctrorec/database'
import {
  institutions,
  membershipRoles,
  memberships,
  users,
} from '@ctrorec/database/schema'
import { Inject, Injectable } from '@nestjs/common'
import { and, asc, eq } from 'drizzle-orm'
import { DATABASE } from '../database/database.constants.js'
import type { AuthMembership, AuthUser } from '../auth/auth-user.js'
import { normalizeEmail } from '../auth/email.js'

type UserRow = typeof users.$inferSelect

interface Credentials {
  user: AuthUser
  passwordHash: string | null
}

@Injectable()
export class UsersRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async findById(id: string): Promise<AuthUser | null> {
    const [row] = await this.db
      .select()
      .from(users)
      .where(and(eq(users.id, id), eq(users.status, 'active')))
      .limit(1)
    return row ? toAuthUser(row) : null
  }

  async findCredentials(email: string): Promise<Credentials | null> {
    const [row] = await this.db
      .select()
      .from(users)
      .where(
        and(eq(users.email, normalizeEmail(email)), eq(users.status, 'active')),
      )
      .limit(1)

    return row
      ? { user: toAuthUser(row), passwordHash: row.passwordHash }
      : null
  }

  async updatePasswordHash(
    id: string,
    passwordHash: string,
    expectedCredentialsVersion: number,
  ): Promise<boolean> {
    const rows = await this.db
      .update(users)
      .set({ passwordHash })
      .where(
        and(
          eq(users.id, id),
          eq(users.credentialsVersion, expectedCredentialsVersion),
        ),
      )
      .returning({ id: users.id })
    return rows.length === 1
  }

  async listMemberships(userId: string): Promise<AuthMembership[]> {
    const rows = await this.db
      .select({
        membershipId: memberships.id,
        membershipStatus: memberships.status,
        institutionId: institutions.id,
        institutionSlug: institutions.slug,
        institutionName: institutions.name,
        institutionStatus: institutions.status,
        role: membershipRoles.role,
      })
      .from(memberships)
      .innerJoin(institutions, eq(memberships.institutionId, institutions.id))
      .leftJoin(
        membershipRoles,
        and(
          eq(membershipRoles.membershipId, memberships.id),
          eq(membershipRoles.institutionId, memberships.institutionId),
        ),
      )
      .where(eq(memberships.userId, userId))
      .orderBy(asc(institutions.name), asc(memberships.id))

    const byId = new Map<string, AuthMembership>()
    for (const row of rows) {
      let membership = byId.get(row.membershipId)
      if (!membership) {
        membership = {
          id: row.membershipId,
          status: row.membershipStatus,
          institution: {
            id: row.institutionId,
            slug: row.institutionSlug,
            name: row.institutionName,
            status: row.institutionStatus,
          },
          roles: [],
        }
        byId.set(row.membershipId, membership)
      }
      if (row.role) {
        membership.roles.push(row.role)
      }
    }

    return [...byId.values()]
  }
}

function toAuthUser(row: UserRow): AuthUser {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    emailVerified: row.emailVerifiedAt !== null,
    credentialsVersion: row.credentialsVersion,
    roles: [],
  }
}
