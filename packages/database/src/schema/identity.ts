import { sql } from 'drizzle-orm'
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'
import { createdAt, timestamps, uuidPrimaryKey } from './columns.js'

export const institutions = pgTable(
  'institutions',
  {
    id: uuidPrimaryKey(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    status: text('status').notNull().default('active'),
    ...timestamps(),
  },
  (table) => [
    unique('institutions_slug_unique').on(table.slug),
    check(
      'institutions_slug_format',
      sql`${table.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`,
    ),
    check('institutions_name_nonempty', sql`btrim(${table.name}) <> ''`),
    check(
      'institutions_status_valid',
      sql`${table.status} IN ('active', 'suspended', 'archived')`,
    ),
  ],
)

export const users = pgTable(
  'users',
  {
    id: uuidPrimaryKey(),
    email: text('email').notNull(),
    displayName: text('display_name').notNull(),
    passwordHash: text('password_hash'),
    credentialsVersion: integer('credentials_version').notNull().default(0),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    status: text('status').notNull().default('active'),
    ...timestamps(),
  },
  (table) => [
    unique('users_email_unique').on(table.email),
    check(
      'users_email_normalized',
      sql`${table.email} = lower(btrim(${table.email})) AND position('@' IN ${table.email}) > 1`,
    ),
    check(
      'users_credentials_version_valid',
      sql`${table.credentialsVersion} >= 0`,
    ),
    check(
      'users_display_name_nonempty',
      sql`btrim(${table.displayName}) <> ''`,
    ),
    check(
      'users_status_valid',
      sql`${table.status} IN ('invited', 'active', 'suspended')`,
    ),
  ],
)

export const memberships = pgTable(
  'memberships',
  {
    id: uuidPrimaryKey(),
    institutionId: uuid('institution_id').notNull(),
    userId: uuid('user_id').notNull(),
    status: text('status').notNull().default('active'),
    ...timestamps(),
  },
  (table) => [
    unique('memberships_institution_user_unique').on(
      table.institutionId,
      table.userId,
    ),
    unique('memberships_id_institution_unique').on(
      table.id,
      table.institutionId,
    ),
    index('memberships_user_idx').on(table.userId),
    foreignKey({
      columns: [table.institutionId],
      foreignColumns: [institutions.id],
      name: 'memberships_institution_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: 'memberships_user_fk',
    }).onDelete('restrict'),
    check(
      'memberships_status_valid',
      sql`${table.status} IN ('active', 'suspended')`,
    ),
  ],
)

export const membershipRoles = pgTable(
  'membership_roles',
  {
    institutionId: uuid('institution_id').notNull(),
    membershipId: uuid('membership_id').notNull(),
    role: text('role').notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({
      columns: [table.institutionId, table.membershipId, table.role],
      name: 'membership_roles_pkey',
    }),
    foreignKey({
      columns: [table.membershipId, table.institutionId],
      foreignColumns: [memberships.id, memberships.institutionId],
      name: 'membership_roles_membership_fk',
    }).onDelete('cascade'),
    check(
      'membership_roles_role_valid',
      sql`${table.role} IN ('institution_admin', 'academic_staff', 'student')`,
    ),
  ],
)
