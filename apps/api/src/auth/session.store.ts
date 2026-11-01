import type { Database } from '@ctrorec/database'
import { authSessions } from '@ctrorec/database/schema'
import { Inject, Injectable } from '@nestjs/common'
import {
  AuthenticationStorage,
  type SessionRecord,
  type SessionStore,
} from '@nestjs/authentication'
import { and, eq, lt, lte } from 'drizzle-orm'
import { DATABASE } from '../database/database.constants.js'

@Injectable()
export class DrizzleSessionStore implements SessionStore {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(AuthenticationStorage) storage: AuthenticationStorage,
  ) {
    storage.registerSource({ sessions: this })
  }

  async getSession(id: string): Promise<SessionRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(authSessions)
      .where(eq(authSessions.id, id))
      .limit(1)
    return row ? withoutNulls(row) : undefined
  }

  async createSession(record: SessionRecord): Promise<void> {
    await this.db.insert(authSessions).values(record)
    await this.db
      .delete(authSessions)
      .where(lte(authSessions.expiresAt, record.createdAt))
  }

  async touchSession(id: string, lastActiveAt: Date): Promise<void> {
    await this.db
      .update(authSessions)
      .set({ lastActiveAt })
      .where(
        and(
          eq(authSessions.id, id),
          lt(authSessions.lastActiveAt, lastActiveAt),
        ),
      )
  }

  async deleteSession(id: string): Promise<boolean> {
    const deleted = await this.db
      .delete(authSessions)
      .where(eq(authSessions.id, id))
      .returning({ id: authSessions.id })
    return deleted.length === 1
  }

  async listUserSessions(userId: string): Promise<SessionRecord[]> {
    const rows = await this.db
      .select()
      .from(authSessions)
      .where(eq(authSessions.userId, userId))
    return rows.map(withoutNulls)
  }

  async deleteUserSessions(userId: string): Promise<void> {
    await this.db.delete(authSessions).where(eq(authSessions.userId, userId))
  }
}

type WithoutNulls<T> = {
  [K in keyof T as null extends T[K] ? never : K]: T[K]
} & {
  [K in keyof T as null extends T[K] ? K : never]?: Exclude<T[K], null>
}

function withoutNulls<T extends object>(row: T): WithoutNulls<T> {
  return Object.fromEntries(
    Object.entries(row).filter(([, value]) => value !== null),
  ) as WithoutNulls<T>
}
