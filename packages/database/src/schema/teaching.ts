import { sql } from 'drizzle-orm'
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { courseOfferings } from './academic.js'
import { createdAt, timestamps, uuidPrimaryKey } from './columns.js'
import { institutions, memberships } from './identity.js'

export const lecturerAssignments = pgTable(
  'lecturer_assignments',
  {
    id: uuidPrimaryKey(),
    institutionId: uuid('institution_id').notNull(),
    courseOfferingId: uuid('course_offering_id').notNull(),
    membershipId: uuid('membership_id').notNull(),
    role: text('role').notNull().default('lead'),
    startsAt: timestamp('starts_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    ...timestamps(),
  },
  (table) => [
    unique('lecturer_assignments_id_institution_unique').on(
      table.id,
      table.institutionId,
    ),
    uniqueIndex('lecturer_assignments_active_unique')
      .on(table.courseOfferingId, table.membershipId)
      .where(sql`${table.endsAt} IS NULL`),
    index('lecturer_assignments_membership_idx').on(
      table.membershipId,
      table.endsAt,
    ),
    foreignKey({
      columns: [table.institutionId],
      foreignColumns: [institutions.id],
      name: 'lecturer_assignments_institution_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.courseOfferingId, table.institutionId],
      foreignColumns: [courseOfferings.id, courseOfferings.institutionId],
      name: 'lecturer_assignments_offering_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.membershipId, table.institutionId],
      foreignColumns: [memberships.id, memberships.institutionId],
      name: 'lecturer_assignments_membership_fk',
    }).onDelete('restrict'),
    check(
      'lecturer_assignments_role_valid',
      sql`${table.role} IN ('lead', 'assistant', 'guest')`,
    ),
    check(
      'lecturer_assignments_dates_valid',
      sql`${table.endsAt} IS NULL OR ${table.endsAt} > ${table.startsAt}`,
    ),
  ],
)

export const enrollments = pgTable(
  'enrollments',
  {
    id: uuidPrimaryKey(),
    institutionId: uuid('institution_id').notNull(),
    courseOfferingId: uuid('course_offering_id').notNull(),
    membershipId: uuid('membership_id').notNull(),
    enrolledAt: timestamp('enrolled_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    ...timestamps(),
  },
  (table) => [
    unique('enrollments_id_institution_unique').on(
      table.id,
      table.institutionId,
    ),
    uniqueIndex('enrollments_active_unique')
      .on(table.courseOfferingId, table.membershipId)
      .where(sql`${table.endsAt} IS NULL`),
    index('enrollments_membership_idx').on(table.membershipId, table.endsAt),
    foreignKey({
      columns: [table.institutionId],
      foreignColumns: [institutions.id],
      name: 'enrollments_institution_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.courseOfferingId, table.institutionId],
      foreignColumns: [courseOfferings.id, courseOfferings.institutionId],
      name: 'enrollments_offering_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.membershipId, table.institutionId],
      foreignColumns: [memberships.id, memberships.institutionId],
      name: 'enrollments_membership_fk',
    }).onDelete('restrict'),
    check(
      'enrollments_dates_valid',
      sql`${table.endsAt} IS NULL OR ${table.endsAt} > ${table.enrolledAt}`,
    ),
  ],
)

export const lectures = pgTable(
  'lectures',
  {
    id: uuidPrimaryKey(),
    institutionId: uuid('institution_id').notNull(),
    courseOfferingId: uuid('course_offering_id').notNull(),
    createdByMembershipId: uuid('created_by_membership_id').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    status: text('status').notNull().default('draft'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    ...timestamps(),
  },
  (table) => [
    unique('lectures_id_institution_unique').on(table.id, table.institutionId),
    index('lectures_offering_status_date_idx').on(
      table.courseOfferingId,
      table.status,
      table.occurredAt,
    ),
    index('lectures_creator_idx').on(table.createdByMembershipId),
    foreignKey({
      columns: [table.institutionId],
      foreignColumns: [institutions.id],
      name: 'lectures_institution_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.courseOfferingId, table.institutionId],
      foreignColumns: [courseOfferings.id, courseOfferings.institutionId],
      name: 'lectures_offering_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.createdByMembershipId, table.institutionId],
      foreignColumns: [memberships.id, memberships.institutionId],
      name: 'lectures_creator_fk',
    }).onDelete('restrict'),
    check('lectures_title_nonempty', sql`btrim(${table.title}) <> ''`),
    check(
      'lectures_status_valid',
      sql`${table.status} IN ('draft', 'published', 'archived')`,
    ),
    check(
      'lectures_publish_time_required',
      sql`${table.status} <> 'published' OR ${table.publishedAt} IS NOT NULL`,
    ),
  ],
)

export const lectureAudioUploads = pgTable(
  'lecture_audio_uploads',
  {
    id: uuidPrimaryKey(),
    lectureId: uuid('lecture_id').notNull(),
    institutionId: uuid('institution_id').notNull(),
    createdByMembershipId: uuid('created_by_membership_id').notNull(),
    originalFileName: text('original_file_name').notNull(),
    byteSize: bigint('byte_size', { mode: 'number' }).notNull(),
    sha256: text('sha256').notNull(),
    receivedBytes: bigint('received_bytes', { mode: 'number' })
      .notNull()
      .default(0),
    chunkSize: integer('chunk_size').notNull(),
    status: text('status').notNull().default('active'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex('lecture_audio_uploads_active_lecture_unique')
      .on(table.lectureId)
      .where(sql`${table.status} = 'active'`),
    index('lecture_audio_uploads_expiry_idx').on(table.status, table.expiresAt),
    foreignKey({
      columns: [table.institutionId],
      foreignColumns: [institutions.id],
      name: 'lecture_audio_uploads_institution_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.lectureId, table.institutionId],
      foreignColumns: [lectures.id, lectures.institutionId],
      name: 'lecture_audio_uploads_lecture_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.createdByMembershipId, table.institutionId],
      foreignColumns: [memberships.id, memberships.institutionId],
      name: 'lecture_audio_uploads_creator_fk',
    }).onDelete('restrict'),
    check(
      'lecture_audio_uploads_file_name_valid',
      sql`btrim(${table.originalFileName}) = ${table.originalFileName} AND char_length(${table.originalFileName}) BETWEEN 1 AND 255`,
    ),
    check(
      'lecture_audio_uploads_byte_size_positive',
      sql`${table.byteSize} > 0`,
    ),
    check(
      'lecture_audio_uploads_sha256_valid',
      sql`${table.sha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      'lecture_audio_uploads_received_bytes_valid',
      sql`${table.receivedBytes} >= 0 AND ${table.receivedBytes} <= ${table.byteSize}`,
    ),
    check(
      'lecture_audio_uploads_chunk_size_valid',
      sql`${table.chunkSize} BETWEEN 16384 AND 8388608`,
    ),
    check(
      'lecture_audio_uploads_status_valid',
      sql`${table.status} IN ('active', 'completed', 'cancelled', 'expired')`,
    ),
    check(
      'lecture_audio_uploads_completion_valid',
      sql`(${table.status} = 'completed' AND ${table.receivedBytes} = ${table.byteSize} AND ${table.completedAt} IS NOT NULL) OR (${table.status} <> 'completed' AND ${table.completedAt} IS NULL)`,
    ),
  ],
)

export const lectureAudio = pgTable(
  'lecture_audio',
  {
    lectureId: uuid('lecture_id').primaryKey(),
    institutionId: uuid('institution_id').notNull(),
    uploadedByMembershipId: uuid('uploaded_by_membership_id').notNull(),
    storageProvider: text('storage_provider').notNull(),
    storageKey: text('storage_key').notNull(),
    originalFileName: text('original_file_name').notNull(),
    mediaType: text('media_type').notNull(),
    byteSize: bigint('byte_size', { mode: 'number' }).notNull(),
    sha256: text('sha256').notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    unique('lecture_audio_lecture_institution_unique').on(
      table.lectureId,
      table.institutionId,
    ),
    unique('lecture_audio_storage_key_unique').on(table.storageKey),
    index('lecture_audio_uploader_idx').on(table.uploadedByMembershipId),
    foreignKey({
      columns: [table.institutionId],
      foreignColumns: [institutions.id],
      name: 'lecture_audio_institution_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.lectureId, table.institutionId],
      foreignColumns: [lectures.id, lectures.institutionId],
      name: 'lecture_audio_lecture_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.uploadedByMembershipId, table.institutionId],
      foreignColumns: [memberships.id, memberships.institutionId],
      name: 'lecture_audio_uploader_fk',
    }).onDelete('restrict'),
    check(
      'lecture_audio_storage_fields_valid',
      sql`btrim(${table.storageProvider}) <> '' AND btrim(${table.storageKey}) <> ''`,
    ),
    check(
      'lecture_audio_file_name_valid',
      sql`btrim(${table.originalFileName}) = ${table.originalFileName} AND char_length(${table.originalFileName}) BETWEEN 1 AND 255`,
    ),
    check(
      'lecture_audio_media_type_valid',
      sql`${table.mediaType} IN ('audio/mpeg', 'audio/wav', 'audio/mp4')`,
    ),
    check('lecture_audio_byte_size_positive', sql`${table.byteSize} > 0`),
    check(
      'lecture_audio_sha256_valid',
      sql`${table.sha256} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
)

export const lectureAudioDerivatives = pgTable(
  'lecture_audio_derivatives',
  {
    id: uuidPrimaryKey(),
    lectureId: uuid('lecture_id').notNull(),
    institutionId: uuid('institution_id').notNull(),
    kind: text('kind').notNull().default('data_saver'),
    status: text('status').notNull().default('pending'),
    sourceSha256: text('source_sha256').notNull(),
    storageProvider: text('storage_provider'),
    storageKey: text('storage_key'),
    mediaType: text('media_type').notNull().default('audio/mp4'),
    byteSize: bigint('byte_size', { mode: 'number' }),
    sha256: text('sha256'),
    attempts: integer('attempts').notNull().default(0),
    processingStartedAt: timestamp('processing_started_at', {
      withTimezone: true,
    }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    ...timestamps(),
  },
  (table) => [
    unique('lecture_audio_derivatives_lecture_kind_unique').on(
      table.lectureId,
      table.kind,
    ),
    unique('lecture_audio_derivatives_storage_key_unique').on(table.storageKey),
    index('lecture_audio_derivatives_status_idx').on(
      table.status,
      table.updatedAt,
    ),
    foreignKey({
      columns: [table.institutionId],
      foreignColumns: [institutions.id],
      name: 'lecture_audio_derivatives_institution_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.lectureId, table.institutionId],
      foreignColumns: [lectureAudio.lectureId, lectureAudio.institutionId],
      name: 'lecture_audio_derivatives_original_fk',
    }).onDelete('restrict'),
    check(
      'lecture_audio_derivatives_kind_valid',
      sql`${table.kind} = 'data_saver'`,
    ),
    check(
      'lecture_audio_derivatives_status_valid',
      sql`${table.status} IN ('pending', 'processing', 'ready', 'failed')`,
    ),
    check(
      'lecture_audio_derivatives_source_sha256_valid',
      sql`${table.sourceSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      'lecture_audio_derivatives_media_type_valid',
      sql`${table.mediaType} = 'audio/mp4'`,
    ),
    check(
      'lecture_audio_derivatives_attempts_valid',
      sql`${table.attempts} >= 0`,
    ),
    check(
      'lecture_audio_derivatives_processing_state_valid',
      sql`(${table.status} = 'processing' AND ${table.processingStartedAt} IS NOT NULL) OR (${table.status} <> 'processing' AND ${table.processingStartedAt} IS NULL)`,
    ),
    check(
      'lecture_audio_derivatives_ready_state_valid',
      sql`(${table.status} = 'ready' AND ${table.storageProvider} IS NOT NULL AND btrim(${table.storageProvider}) <> '' AND ${table.storageKey} IS NOT NULL AND btrim(${table.storageKey}) <> '' AND ${table.byteSize} IS NOT NULL AND ${table.byteSize} > 0 AND ${table.sha256} IS NOT NULL AND ${table.sha256} ~ '^[0-9a-f]{64}$' AND ${table.completedAt} IS NOT NULL) OR (${table.status} <> 'ready' AND ${table.storageProvider} IS NULL AND ${table.storageKey} IS NULL AND ${table.byteSize} IS NULL AND ${table.sha256} IS NULL AND ${table.completedAt} IS NULL)`,
    ),
  ],
)
