import { sql } from 'drizzle-orm'
import {
  check,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'
import { timestamps, uuidPrimaryKey } from './columns.js'
import { users } from './identity.js'

export const accountRecoveryRequests = pgTable(
  'account_recovery_requests',
  {
    id: uuidPrimaryKey(),
    email: text('email').notNull(),
    userId: uuid('user_id'),
    tokenHash: text('token_hash'),
    status: text('status').notNull().default('pending'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revocationReason: text('revocation_reason'),
    ...timestamps(),
  },
  (table) => [
    unique('account_recovery_requests_token_hash_unique').on(table.tokenHash),
    index('account_recovery_requests_email_status_idx').on(
      table.email,
      table.status,
    ),
    index('account_recovery_requests_user_idx').on(table.userId),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: 'account_recovery_requests_user_fk',
    }).onDelete('restrict'),
    check(
      'account_recovery_requests_email_normalized',
      sql`${table.email} = lower(btrim(${table.email})) AND position('@' IN ${table.email}) > 1`,
    ),
    check(
      'account_recovery_requests_token_hash_valid',
      sql`${table.tokenHash} IS NULL OR ${table.tokenHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      'account_recovery_requests_expiry_valid',
      sql`${table.expiresAt} > ${table.createdAt}`,
    ),
    check(
      'account_recovery_requests_status_valid',
      sql`${table.status} IN ('pending', 'delivering', 'delivered', 'failed', 'discarded', 'expired', 'consumed', 'revoked')`,
    ),
    check(
      'account_recovery_requests_token_user_complete',
      sql`${table.tokenHash} IS NULL OR ${table.userId} IS NOT NULL`,
    ),
    check(
      'account_recovery_requests_delivery_state_valid',
      sql`(${table.status} = 'pending' AND ${table.tokenHash} IS NULL AND ${table.deliveredAt} IS NULL AND ${table.consumedAt} IS NULL) OR (${table.status} IN ('delivering', 'failed') AND ${table.tokenHash} IS NOT NULL AND ${table.deliveredAt} IS NULL AND ${table.consumedAt} IS NULL) OR (${table.status} = 'delivered' AND ${table.tokenHash} IS NOT NULL AND ${table.deliveredAt} IS NOT NULL AND ${table.consumedAt} IS NULL) OR (${table.status} = 'consumed' AND ${table.tokenHash} IS NOT NULL AND ${table.deliveredAt} IS NOT NULL AND ${table.consumedAt} IS NOT NULL) OR (${table.status} IN ('discarded', 'expired', 'revoked') AND ${table.consumedAt} IS NULL)`,
    ),
    check(
      'account_recovery_requests_revocation_complete',
      sql`(${table.revokedAt} IS NULL AND ${table.revocationReason} IS NULL) OR (${table.revokedAt} IS NOT NULL AND ${table.revocationReason} IN ('replaced', 'reset'))`,
    ),
    check(
      'account_recovery_requests_not_consumed_and_revoked',
      sql`${table.consumedAt} IS NULL OR ${table.revokedAt} IS NULL`,
    ),
  ],
)
