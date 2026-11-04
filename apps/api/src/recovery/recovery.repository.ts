import type { Database, DatabaseTransaction } from '@ctrorec/database'
import { ACCOUNT_RECOVERY_OPEN_STATUSES } from '@ctrorec/database'
import {
  accountRecoveryRequests,
  authSessions,
  users,
} from '@ctrorec/database/schema'
import { Injectable } from '@nestjs/common'
import { and, desc, eq, gt, inArray, isNull, ne, sql } from 'drizzle-orm'

export type RecoveryRequestRow = typeof accountRecoveryRequests.$inferSelect
export type RecoveryUserRow = typeof users.$inferSelect
type Executor = Database | DatabaseTransaction

@Injectable()
export class RecoveryRepository {
  async latestForEmail(
    tx: DatabaseTransaction,
    email: string,
  ): Promise<RecoveryRequestRow | null> {
    const [row] = await tx
      .select()
      .from(accountRecoveryRequests)
      .where(eq(accountRecoveryRequests.email, email))
      .orderBy(desc(accountRecoveryRequests.createdAt))
      .limit(1)
    return row ?? null
  }

  async countSince(
    tx: DatabaseTransaction,
    email: string,
    since: Date,
  ): Promise<number> {
    const rows = await tx
      .select({ id: accountRecoveryRequests.id })
      .from(accountRecoveryRequests)
      .where(
        and(
          eq(accountRecoveryRequests.email, email),
          gt(accountRecoveryRequests.createdAt, since),
        ),
      )
      .limit(6)
    return rows.length
  }

  async revokeOpen(
    tx: DatabaseTransaction,
    email: string,
    revokedAt: Date,
    reason: 'replaced' | 'reset',
    exceptId?: string,
  ): Promise<void> {
    await tx
      .update(accountRecoveryRequests)
      .set({
        status: 'revoked',
        revokedAt,
        revocationReason: reason,
        updatedAt: revokedAt,
      })
      .where(
        and(
          eq(accountRecoveryRequests.email, email),
          inArray(
            accountRecoveryRequests.status,
            ACCOUNT_RECOVERY_OPEN_STATUSES,
          ),
          isNull(accountRecoveryRequests.consumedAt),
          isNull(accountRecoveryRequests.revokedAt),
          ...(exceptId ? [ne(accountRecoveryRequests.id, exceptId)] : []),
        ),
      )
  }

  async insert(
    tx: DatabaseTransaction,
    input: { email: string; expiresAt: Date },
  ): Promise<RecoveryRequestRow> {
    const [row] = await tx
      .insert(accountRecoveryRequests)
      .values({ email: input.email, expiresAt: input.expiresAt })
      .returning()
    if (!row) {
      throw new Error('The recovery request could not be stored.')
    }
    return row
  }

  async findByToken(
    executor: Executor,
    tokenHash: string,
  ): Promise<RecoveryRequestRow | null> {
    const [row] = await executor
      .select()
      .from(accountRecoveryRequests)
      .where(eq(accountRecoveryRequests.tokenHash, tokenHash))
      .limit(1)
    return row ?? null
  }

  async findByTokenForUpdate(
    tx: DatabaseTransaction,
    tokenHash: string,
  ): Promise<RecoveryRequestRow | null> {
    const [row] = await tx
      .select()
      .from(accountRecoveryRequests)
      .where(eq(accountRecoveryRequests.tokenHash, tokenHash))
      .limit(1)
      .for('update')
    return row ?? null
  }

  async findUser(
    executor: Executor,
    userId: string,
  ): Promise<RecoveryUserRow | null> {
    const [row] = await executor
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
    return row ?? null
  }

  async findUserForUpdate(
    tx: DatabaseTransaction,
    userId: string,
  ): Promise<RecoveryUserRow | null> {
    const [row] = await tx
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
      .for('update')
    return row ?? null
  }

  async updatePassword(
    tx: DatabaseTransaction,
    userId: string,
    email: string,
    passwordHash: string,
    updatedAt: Date,
  ): Promise<boolean> {
    const rows = await tx
      .update(users)
      .set({
        passwordHash,
        credentialsVersion: sql`${users.credentialsVersion} + 1`,
        updatedAt,
      })
      .where(
        and(
          eq(users.id, userId),
          eq(users.email, email),
          eq(users.status, 'active'),
        ),
      )
      .returning({ id: users.id })
    return rows.length === 1
  }

  async deleteUserSessions(
    tx: DatabaseTransaction,
    userId: string,
  ): Promise<void> {
    await tx.delete(authSessions).where(eq(authSessions.userId, userId))
  }

  async markConsumed(
    tx: DatabaseTransaction,
    requestId: string,
    tokenHash: string,
    consumedAt: Date,
  ): Promise<boolean> {
    const rows = await tx
      .update(accountRecoveryRequests)
      .set({ status: 'consumed', consumedAt, updatedAt: consumedAt })
      .where(
        and(
          eq(accountRecoveryRequests.id, requestId),
          eq(accountRecoveryRequests.tokenHash, tokenHash),
          eq(accountRecoveryRequests.status, 'delivered'),
          gt(accountRecoveryRequests.expiresAt, sql`now()`),
          isNull(accountRecoveryRequests.consumedAt),
          isNull(accountRecoveryRequests.revokedAt),
        ),
      )
      .returning({ id: accountRecoveryRequests.id })
    return rows.length === 1
  }
}
