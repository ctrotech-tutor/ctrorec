import { sql } from 'drizzle-orm'
import {
  check,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { createdAt, timestamps, uuidPrimaryKey } from './columns.js'
import { institutions, memberships, users } from './identity.js'

export const institutionInvitations = pgTable(
  'institution_invitations',
  {
    id: uuidPrimaryKey(),
    institutionId: uuid('institution_id').notNull(),
    invitedByMembershipId: uuid('invited_by_membership_id').notNull(),
    email: text('email').notNull(),
    displayName: text('display_name').notNull(),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    acceptedUserId: uuid('accepted_user_id'),
    acceptedMembershipId: uuid('accepted_membership_id'),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revocationReason: text('revocation_reason'),
    ...timestamps(),
  },
  (table) => [
    unique('institution_invitations_token_hash_unique').on(table.tokenHash),
    unique('institution_invitations_id_institution_unique').on(
      table.id,
      table.institutionId,
    ),
    uniqueIndex('institution_invitations_one_open_email_unique')
      .on(table.institutionId, table.email)
      .where(sql`${table.acceptedAt} IS NULL AND ${table.revokedAt} IS NULL`),
    index('institution_invitations_institution_created_idx').on(
      table.institutionId,
      table.createdAt,
    ),
    foreignKey({
      columns: [table.institutionId],
      foreignColumns: [institutions.id],
      name: 'institution_invitations_institution_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.invitedByMembershipId, table.institutionId],
      foreignColumns: [memberships.id, memberships.institutionId],
      name: 'institution_invitations_issuer_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.acceptedUserId],
      foreignColumns: [users.id],
      name: 'institution_invitations_accepted_user_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.acceptedMembershipId, table.institutionId],
      foreignColumns: [memberships.id, memberships.institutionId],
      name: 'institution_invitations_accepted_membership_fk',
    }).onDelete('restrict'),
    check(
      'institution_invitations_email_normalized',
      sql`${table.email} = lower(btrim(${table.email})) AND position('@' IN ${table.email}) > 1`,
    ),
    check(
      'institution_invitations_display_name_nonempty',
      sql`btrim(${table.displayName}) <> ''`,
    ),
    check(
      'institution_invitations_token_hash_valid',
      sql`${table.tokenHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      'institution_invitations_expiry_valid',
      sql`${table.expiresAt} > ${table.createdAt}`,
    ),
    check(
      'institution_invitations_acceptance_complete',
      sql`(${table.acceptedAt} IS NULL AND ${table.acceptedUserId} IS NULL AND ${table.acceptedMembershipId} IS NULL) OR (${table.acceptedAt} IS NOT NULL AND ${table.acceptedUserId} IS NOT NULL AND ${table.acceptedMembershipId} IS NOT NULL)`,
    ),
    check(
      'institution_invitations_revocation_complete',
      sql`(${table.revokedAt} IS NULL AND ${table.revocationReason} IS NULL) OR (${table.revokedAt} IS NOT NULL AND ${table.revocationReason} IN ('administrator', 'replaced'))`,
    ),
    check(
      'institution_invitations_not_accepted_and_revoked',
      sql`${table.acceptedAt} IS NULL OR ${table.revokedAt} IS NULL`,
    ),
  ],
)

export const institutionInvitationRoles = pgTable(
  'institution_invitation_roles',
  {
    institutionId: uuid('institution_id').notNull(),
    invitationId: uuid('invitation_id').notNull(),
    role: text('role').notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({
      columns: [table.institutionId, table.invitationId, table.role],
      name: 'institution_invitation_roles_pkey',
    }),
    foreignKey({
      columns: [table.invitationId, table.institutionId],
      foreignColumns: [
        institutionInvitations.id,
        institutionInvitations.institutionId,
      ],
      name: 'institution_invitation_roles_invitation_fk',
    }).onDelete('restrict'),
    check(
      'institution_invitation_roles_role_valid',
      sql`${table.role} IN ('institution_admin', 'academic_staff', 'student')`,
    ),
  ],
)
