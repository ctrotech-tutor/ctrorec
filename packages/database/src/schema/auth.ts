import { sql } from 'drizzle-orm'
import {
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
import { users } from './identity.js'

export const authSessions = pgTable(
  'auth_sessions',
  {
    id: text('id').primaryKey(),
    userId: uuid('user_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    lastActiveAt: timestamp('last_active_at', {
      withTimezone: true,
    }).notNull(),
    mfa: text('mfa', { enum: ['pending', 'verified'] }),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
  },
  (table) => [
    index('auth_sessions_user_idx').on(table.userId),
    index('auth_sessions_expires_idx').on(table.expiresAt),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: 'auth_sessions_user_fk',
    }).onDelete('cascade'),
    check('auth_sessions_id_nonempty', sql`btrim(${table.id}) <> ''`),
    check(
      'auth_sessions_mfa_valid',
      sql`${table.mfa} IS NULL OR ${table.mfa} IN ('pending', 'verified')`,
    ),
    check(
      'auth_sessions_expiry_valid',
      sql`${table.expiresAt} > ${table.createdAt}`,
    ),
  ],
)
