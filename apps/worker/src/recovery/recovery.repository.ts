import type { Database, DatabaseTransaction } from '@ctrorec/database'
import { accountRecoveryRequests, users } from '@ctrorec/database/schema'
import { Inject, Injectable } from '@nestjs/common'
import { and, eq, gt, inArray, isNull, sql } from 'drizzle-orm'
import { DATABASE } from '../database/database.constants.js'

export interface PreparedRecovery {
  email: string
  expiresAt: Date
}

@Injectable()
export class RecoveryRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async prepare(
    requestId: string,
    tokenHash: string,
  ): Promise<PreparedRecovery | null> {
    return this.db.transaction(async (tx) => {
      const candidate = await this.findById(tx, requestId, false)
      if (
        !candidate ||
        !['pending', 'delivering', 'failed'].includes(candidate.status)
      ) {
        return null
      }
      await lockEmail(tx, candidate.email)
      const request = await this.findById(tx, requestId, true)
      if (
        !request ||
        !['pending', 'delivering', 'failed'].includes(request.status) ||
        request.consumedAt ||
        request.revokedAt
      ) {
        return null
      }
      const now = new Date()
      if (request.expiresAt.getTime() <= now.getTime()) {
        await this.markExpired(tx, request.id, now)
        return null
      }

      const [user] = await tx
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.email, request.email), eq(users.status, 'active')))
        .limit(1)
      if (!user) {
        await tx
          .update(accountRecoveryRequests)
          .set({ status: 'discarded', updatedAt: now })
          .where(eq(accountRecoveryRequests.id, request.id))
        return null
      }

      const rows = await tx
        .update(accountRecoveryRequests)
        .set({
          userId: user.id,
          tokenHash,
          status: 'delivering',
          deliveredAt: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(accountRecoveryRequests.id, request.id),
            inArray(accountRecoveryRequests.status, [
              'pending',
              'delivering',
              'failed',
            ]),
            gt(accountRecoveryRequests.expiresAt, sql`now()`),
            isNull(accountRecoveryRequests.consumedAt),
            isNull(accountRecoveryRequests.revokedAt),
          ),
        )
        .returning({ id: accountRecoveryRequests.id })
      return rows.length === 1
        ? { email: request.email, expiresAt: request.expiresAt }
        : null
    })
  }

  async discardWithoutDelivery(requestId: string): Promise<void> {
    await this.db
      .update(accountRecoveryRequests)
      .set({ status: 'discarded', updatedAt: new Date() })
      .where(
        and(
          eq(accountRecoveryRequests.id, requestId),
          inArray(accountRecoveryRequests.status, [
            'pending',
            'delivering',
            'failed',
          ]),
          isNull(accountRecoveryRequests.consumedAt),
          isNull(accountRecoveryRequests.revokedAt),
        ),
      )
  }

  async markDelivered(
    requestId: string,
    tokenHash: string,
    deliveredAt: Date,
  ): Promise<boolean> {
    const rows = await this.db
      .update(accountRecoveryRequests)
      .set({ status: 'delivered', deliveredAt, updatedAt: deliveredAt })
      .where(
        and(
          eq(accountRecoveryRequests.id, requestId),
          eq(accountRecoveryRequests.tokenHash, tokenHash),
          eq(accountRecoveryRequests.status, 'delivering'),
          gt(accountRecoveryRequests.expiresAt, deliveredAt),
          isNull(accountRecoveryRequests.consumedAt),
          isNull(accountRecoveryRequests.revokedAt),
        ),
      )
      .returning({ id: accountRecoveryRequests.id })
    return rows.length === 1
  }

  async markFailed(requestId: string, tokenHash: string): Promise<void> {
    await this.db
      .update(accountRecoveryRequests)
      .set({ status: 'failed', updatedAt: new Date() })
      .where(
        and(
          eq(accountRecoveryRequests.id, requestId),
          eq(accountRecoveryRequests.tokenHash, tokenHash),
          eq(accountRecoveryRequests.status, 'delivering'),
        ),
      )
  }

  private async findById(
    tx: DatabaseTransaction,
    requestId: string,
    forUpdate: boolean,
  ) {
    const query = tx
      .select()
      .from(accountRecoveryRequests)
      .where(eq(accountRecoveryRequests.id, requestId))
      .limit(1)
    const [row] = forUpdate ? await query.for('update') : await query
    return row ?? null
  }

  private async markExpired(
    tx: DatabaseTransaction,
    requestId: string,
    now: Date,
  ): Promise<void> {
    await tx
      .update(accountRecoveryRequests)
      .set({ status: 'expired', updatedAt: now })
      .where(eq(accountRecoveryRequests.id, requestId))
  }
}

async function lockEmail(
  tx: DatabaseTransaction,
  email: string,
): Promise<void> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext(${`ctrorec:recovery:${email}`}))`,
  )
}
