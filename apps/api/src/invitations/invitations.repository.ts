import type { Database, DatabaseTransaction } from '@ctrorec/database'
import {
  institutionInvitationRoles,
  institutionInvitations,
  institutions,
  membershipRoles,
  memberships,
  users,
} from '@ctrorec/database/schema'
import { Inject, Injectable } from '@nestjs/common'
import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import { DATABASE } from '../database/database.constants.js'

export type InvitationRow = typeof institutionInvitations.$inferSelect
export type InvitationUser = typeof users.$inferSelect
export type InvitationMembership = typeof memberships.$inferSelect
type Executor = Database | DatabaseTransaction

export interface InvitationRecord {
  invitation: InvitationRow
  institution: typeof institutions.$inferSelect
  invitedBy: { displayName: string; email: string }
  roles: string[]
}

interface JoinedInvitation {
  invitation: InvitationRow
  institution: typeof institutions.$inferSelect
  invitedByDisplayName: string
  invitedByEmail: string
}

@Injectable()
export class InvitationsRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async list(institutionId: string): Promise<InvitationRecord[]> {
    const rows = await invitationQuery(this.db)
      .where(eq(institutionInvitations.institutionId, institutionId))
      .orderBy(desc(institutionInvitations.createdAt))
      .limit(100)
    return withRoles(this.db, institutionId, rows)
  }

  async findById(
    executor: Executor,
    institutionId: string,
    invitationId: string,
  ): Promise<InvitationRecord | null> {
    const rows = await invitationQuery(executor)
      .where(
        and(
          eq(institutionInvitations.id, invitationId),
          eq(institutionInvitations.institutionId, institutionId),
        ),
      )
      .limit(1)
    return (await withRoles(executor, institutionId, rows))[0] ?? null
  }

  async findByIdForUpdate(
    tx: DatabaseTransaction,
    institutionId: string,
    invitationId: string,
  ): Promise<InvitationRecord | null> {
    const [row] = await tx
      .select({ id: institutionInvitations.id })
      .from(institutionInvitations)
      .where(
        and(
          eq(institutionInvitations.id, invitationId),
          eq(institutionInvitations.institutionId, institutionId),
        ),
      )
      .limit(1)
      .for('update')
    return row ? this.findById(tx, institutionId, row.id) : null
  }

  async findByToken(
    executor: Executor,
    tokenHash: string,
  ): Promise<InvitationRecord | null> {
    const [row] = await executor
      .select({
        id: institutionInvitations.id,
        institutionId: institutionInvitations.institutionId,
      })
      .from(institutionInvitations)
      .where(eq(institutionInvitations.tokenHash, tokenHash))
      .limit(1)
    return row ? this.findById(executor, row.institutionId, row.id) : null
  }

  async findByTokenForUpdate(
    tx: DatabaseTransaction,
    tokenHash: string,
  ): Promise<InvitationRecord | null> {
    const [row] = await tx
      .select()
      .from(institutionInvitations)
      .where(eq(institutionInvitations.tokenHash, tokenHash))
      .limit(1)
      .for('update')
    return row ? this.findById(tx, row.institutionId, row.id) : null
  }

  async findMembershipByEmail(
    executor: Executor,
    institutionId: string,
    email: string,
  ): Promise<{ membershipId: string; userId: string; status: string } | null> {
    const [row] = await executor
      .select({
        membershipId: memberships.id,
        userId: memberships.userId,
        status: memberships.status,
      })
      .from(memberships)
      .innerJoin(users, eq(memberships.userId, users.id))
      .where(
        and(
          eq(memberships.institutionId, institutionId),
          eq(users.email, email),
        ),
      )
      .limit(1)
    return row ?? null
  }

  async findUserByEmail(
    executor: Executor,
    email: string,
  ): Promise<InvitationUser | null> {
    const [row] = await executor
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1)
    return row ?? null
  }

  async findUserByEmailForUpdate(
    tx: DatabaseTransaction,
    email: string,
  ): Promise<InvitationUser | null> {
    const [row] = await tx
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1)
      .for('update')
    return row ?? null
  }

  async findMembershipByUser(
    tx: DatabaseTransaction,
    institutionId: string,
    userId: string,
  ): Promise<InvitationMembership | null> {
    const [row] = await tx
      .select()
      .from(memberships)
      .where(
        and(
          eq(memberships.institutionId, institutionId),
          eq(memberships.userId, userId),
        ),
      )
      .limit(1)
    return row ?? null
  }

  async replaceOpenInvitations(
    tx: DatabaseTransaction,
    institutionId: string,
    email: string,
    replacedAt: Date,
  ): Promise<void> {
    await tx
      .update(institutionInvitations)
      .set({
        revokedAt: replacedAt,
        revocationReason: 'replaced',
        updatedAt: replacedAt,
      })
      .where(
        and(
          eq(institutionInvitations.institutionId, institutionId),
          eq(institutionInvitations.email, email),
          isNull(institutionInvitations.acceptedAt),
          isNull(institutionInvitations.revokedAt),
        ),
      )
  }

  async insertInvitation(
    tx: DatabaseTransaction,
    values: typeof institutionInvitations.$inferInsert,
    roles: string[],
  ): Promise<InvitationRow> {
    const [row] = await tx
      .insert(institutionInvitations)
      .values(values)
      .returning()
    const invitation = required(row)
    await tx.insert(institutionInvitationRoles).values(
      roles.map((role) => ({
        institutionId: invitation.institutionId,
        invitationId: invitation.id,
        role,
      })),
    )
    return invitation
  }

  async insertUser(
    tx: DatabaseTransaction,
    values: typeof users.$inferInsert,
  ): Promise<InvitationUser> {
    const [row] = await tx.insert(users).values(values).returning()
    return required(row)
  }

  async updatePasswordHash(
    tx: DatabaseTransaction,
    userId: string,
    passwordHash: string,
    updatedAt: Date,
  ): Promise<void> {
    await tx
      .update(users)
      .set({ passwordHash, updatedAt })
      .where(eq(users.id, userId))
  }

  async insertMembership(
    tx: DatabaseTransaction,
    institutionId: string,
    userId: string,
    roles: string[],
  ): Promise<InvitationMembership> {
    const [row] = await tx
      .insert(memberships)
      .values({ institutionId, userId, status: 'active' })
      .returning()
    const membership = required(row)
    await tx.insert(membershipRoles).values(
      roles.map((role) => ({
        institutionId,
        membershipId: membership.id,
        role,
      })),
    )
    return membership
  }

  async revoke(
    tx: DatabaseTransaction,
    institutionId: string,
    invitationId: string,
    revokedAt: Date,
  ): Promise<void> {
    await tx
      .update(institutionInvitations)
      .set({
        revokedAt,
        revocationReason: 'administrator',
        updatedAt: revokedAt,
      })
      .where(
        and(
          eq(institutionInvitations.id, invitationId),
          eq(institutionInvitations.institutionId, institutionId),
          isNull(institutionInvitations.acceptedAt),
          isNull(institutionInvitations.revokedAt),
        ),
      )
  }

  async markAccepted(
    tx: DatabaseTransaction,
    input: {
      institutionId: string
      invitationId: string
      acceptedAt: Date
      userId: string
      membershipId: string
    },
  ): Promise<void> {
    const [row] = await tx
      .update(institutionInvitations)
      .set({
        acceptedAt: input.acceptedAt,
        acceptedUserId: input.userId,
        acceptedMembershipId: input.membershipId,
        updatedAt: input.acceptedAt,
      })
      .where(
        and(
          eq(institutionInvitations.id, input.invitationId),
          eq(institutionInvitations.institutionId, input.institutionId),
          isNull(institutionInvitations.acceptedAt),
          isNull(institutionInvitations.revokedAt),
        ),
      )
      .returning({ id: institutionInvitations.id })
    required(row)
  }
}

function invitationQuery(executor: Executor) {
  return executor
    .select({
      invitation: institutionInvitations,
      institution: institutions,
      invitedByDisplayName: users.displayName,
      invitedByEmail: users.email,
    })
    .from(institutionInvitations)
    .innerJoin(
      institutions,
      eq(institutionInvitations.institutionId, institutions.id),
    )
    .innerJoin(
      memberships,
      and(
        eq(institutionInvitations.invitedByMembershipId, memberships.id),
        eq(institutionInvitations.institutionId, memberships.institutionId),
      ),
    )
    .innerJoin(users, eq(memberships.userId, users.id))
}

async function withRoles(
  executor: Executor,
  institutionId: string,
  rows: JoinedInvitation[],
): Promise<InvitationRecord[]> {
  if (rows.length === 0) {
    return []
  }
  const roles = await executor
    .select({
      invitationId: institutionInvitationRoles.invitationId,
      role: institutionInvitationRoles.role,
    })
    .from(institutionInvitationRoles)
    .where(
      and(
        eq(institutionInvitationRoles.institutionId, institutionId),
        inArray(
          institutionInvitationRoles.invitationId,
          rows.map((row) => row.invitation.id),
        ),
      ),
    )
  return rows.map((row) => ({
    invitation: row.invitation,
    institution: row.institution,
    invitedBy: {
      displayName: row.invitedByDisplayName,
      email: row.invitedByEmail,
    },
    roles: roles
      .filter((role) => role.invitationId === row.invitation.id)
      .map((role) => role.role),
  }))
}

function required<T>(row: T | undefined): T {
  if (!row) {
    throw new Error('The invitation write did not return its stored row.')
  }
  return row
}
