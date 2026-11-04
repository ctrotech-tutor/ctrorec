import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
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

export const lectureMediaDeletions = pgTable(
  'lecture_media_deletions',
  {
    id: uuidPrimaryKey(),
    institutionId: uuid('institution_id').notNull(),
    lectureId: uuid('lecture_id').notNull(),
    requestedByMembershipId: uuid('requested_by_membership_id').notNull(),
    reason: text('reason').notNull(),
    originalFileName: text('original_file_name').notNull(),
    originalMediaType: text('original_media_type').notNull(),
    originalByteSize: bigint('original_byte_size', {
      mode: 'number',
    }).notNull(),
    originalSha256: text('original_sha256').notNull(),
    createdAt: createdAt(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    unique('lecture_media_deletions_lecture_unique').on(table.lectureId),
    index('lecture_media_deletions_institution_idx').on(
      table.institutionId,
      table.createdAt,
    ),
    foreignKey({
      columns: [table.institutionId],
      foreignColumns: [institutions.id],
      name: 'lecture_media_deletions_institution_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.lectureId, table.institutionId],
      foreignColumns: [lectures.id, lectures.institutionId],
      name: 'lecture_media_deletions_lecture_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.requestedByMembershipId, table.institutionId],
      foreignColumns: [memberships.id, memberships.institutionId],
      name: 'lecture_media_deletions_requester_fk',
    }).onDelete('restrict'),
    check(
      'lecture_media_deletions_reason_valid',
      sql`btrim(${table.reason}) = ${table.reason} AND char_length(${table.reason}) BETWEEN 1 AND 500`,
    ),
    check(
      'lecture_media_deletions_original_file_name_valid',
      sql`btrim(${table.originalFileName}) = ${table.originalFileName} AND char_length(${table.originalFileName}) BETWEEN 1 AND 255`,
    ),
    check(
      'lecture_media_deletions_original_media_type_valid',
      sql`${table.originalMediaType} IN ('audio/mpeg', 'audio/wav', 'audio/mp4', 'audio/webm', 'audio/ogg')`,
    ),
    check(
      'lecture_media_deletions_original_size_positive',
      sql`${table.originalByteSize} > 0`,
    ),
    check(
      'lecture_media_deletions_original_sha256_valid',
      sql`${table.originalSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      'lecture_media_deletions_completion_valid',
      sql`${table.completedAt} IS NULL OR ${table.completedAt} >= ${table.createdAt}`,
    ),
  ],
)

export const lectureMediaHolds = pgTable(
  'lecture_media_holds',
  {
    id: uuidPrimaryKey(),
    institutionId: uuid('institution_id').notNull(),
    lectureId: uuid('lecture_id').notNull(),
    createdByMembershipId: uuid('created_by_membership_id').notNull(),
    reason: text('reason').notNull(),
    createdAt: createdAt(),
    releasedByMembershipId: uuid('released_by_membership_id'),
    releaseReason: text('release_reason'),
    releasedAt: timestamp('released_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('lecture_media_holds_active_lecture_unique')
      .on(table.lectureId)
      .where(sql`${table.releasedAt} IS NULL`),
    index('lecture_media_holds_institution_idx').on(
      table.institutionId,
      table.lectureId,
      table.createdAt,
    ),
    foreignKey({
      columns: [table.institutionId],
      foreignColumns: [institutions.id],
      name: 'lecture_media_holds_institution_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.lectureId, table.institutionId],
      foreignColumns: [lectures.id, lectures.institutionId],
      name: 'lecture_media_holds_lecture_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.createdByMembershipId, table.institutionId],
      foreignColumns: [memberships.id, memberships.institutionId],
      name: 'lecture_media_holds_creator_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.releasedByMembershipId, table.institutionId],
      foreignColumns: [memberships.id, memberships.institutionId],
      name: 'lecture_media_holds_releaser_fk',
    }).onDelete('restrict'),
    check(
      'lecture_media_holds_reason_valid',
      sql`btrim(${table.reason}) = ${table.reason} AND char_length(${table.reason}) BETWEEN 1 AND 500`,
    ),
    check(
      'lecture_media_holds_release_complete',
      sql`(
        (${table.releasedAt} IS NULL AND ${table.releasedByMembershipId} IS NULL AND ${table.releaseReason} IS NULL)
        OR (${table.releasedAt} IS NOT NULL AND ${table.releasedAt} >= ${table.createdAt} AND ${table.releasedByMembershipId} IS NOT NULL AND btrim(${table.releaseReason}) = ${table.releaseReason} AND char_length(${table.releaseReason}) BETWEEN 1 AND 500)
      )`,
    ),
  ],
)

export const mediaObjectIntents = pgTable(
  'media_object_intents',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    institutionId: uuid('institution_id')
      .notNull()
      .references(() => institutions.id, { onDelete: 'restrict' }),
    lectureId: uuid('lecture_id').notNull(),
    deletionRequestId: uuid('deletion_request_id'),
    kind: text('kind').notNull(),
    storageProvider: text('storage_provider').notNull(),
    storageKey: text('storage_key').notNull().unique(),
    byteSize: bigint('byte_size', { mode: 'number' }).notNull(),
    sha256: text('sha256').notNull(),
    status: text('status').notNull().default('pending'),
    reconciliationAttempts: integer('reconciliation_attempts')
      .notNull()
      .default(0),
    attachedAt: timestamp('attached_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('media_object_intents_lecture_idx').on(
      table.institutionId,
      table.lectureId,
    ),
    index('media_object_intents_reconciliation_idx').on(
      table.status,
      table.updatedAt,
    ),
    index('media_object_intents_deletion_request_idx').on(
      table.deletionRequestId,
    ),
    foreignKey({
      columns: [table.deletionRequestId],
      foreignColumns: [lectureMediaDeletions.id],
      name: 'media_object_intents_deletion_request_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.lectureId, table.institutionId],
      foreignColumns: [lectures.id, lectures.institutionId],
      name: 'media_object_intents_lecture_fk',
    }).onDelete('restrict'),
    check(
      'media_object_intents_kind_valid',
      sql`${table.kind} IN ('original', 'data_saver')`,
    ),
    check(
      'media_object_intents_status_valid',
      sql`${table.status} IN ('pending', 'attached', 'deleting', 'deleted')`,
    ),
    check(
      'media_object_intents_storage_key_not_blank',
      sql`length(btrim(${table.storageKey})) > 0`,
    ),
    check(
      'media_object_intents_storage_provider_not_blank',
      sql`length(btrim(${table.storageProvider})) > 0`,
    ),
    check(
      'media_object_intents_byte_size_positive',
      sql`${table.byteSize} > 0`,
    ),
    check(
      'media_object_intents_sha256_valid',
      sql`${table.sha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      'media_object_intents_reconciliation_attempts_valid',
      sql`${table.reconciliationAttempts} >= 0`,
    ),
    check(
      'media_object_intents_state_complete',
      sql`(
        (${table.status} = 'pending' AND ${table.attachedAt} IS NULL AND ${table.deletedAt} IS NULL)
        OR (${table.status} = 'attached' AND ${table.attachedAt} IS NOT NULL AND ${table.deletedAt} IS NULL)
        OR (${table.status} = 'deleting' AND ${table.deletedAt} IS NULL)
        OR (${table.status} = 'deleted' AND ${table.deletedAt} IS NOT NULL)
      )`,
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
      sql`${table.mediaType} IN ('audio/mpeg', 'audio/wav', 'audio/mp4', 'audio/webm', 'audio/ogg')`,
    ),
    check('lecture_audio_byte_size_positive', sql`${table.byteSize} > 0`),
    check(
      'lecture_audio_sha256_valid',
      sql`${table.sha256} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
)

export const lectureAudioCaptures = pgTable(
  'lecture_audio_captures',
  {
    lectureId: uuid('lecture_id').primaryKey(),
    institutionId: uuid('institution_id').notNull(),
    clientCaptureId: uuid('client_capture_id').notNull(),
    recorderMimeType: text('recorder_mime_type').notNull(),
    consentAttestedAt: timestamp('consent_attested_at', {
      withTimezone: true,
    }).notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    stoppedAt: timestamp('stopped_at', { withTimezone: true }).notNull(),
    durationMs: integer('duration_ms').notNull(),
    chunkCount: integer('chunk_count').notNull(),
    persistentStorageGranted: boolean('persistent_storage_granted').notNull(),
    stopReason: text('stop_reason').notNull(),
    hashingDurationMs: integer('hashing_duration_ms'),
    uploadDurationMs: integer('upload_duration_ms'),
    uploadRetryCount: integer('upload_retry_count'),
    createdAt: createdAt(),
  },
  (table) => [
    unique('lecture_audio_captures_client_unique').on(table.clientCaptureId),
    foreignKey({
      columns: [table.lectureId, table.institutionId],
      foreignColumns: [lectures.id, lectures.institutionId],
      name: 'lecture_audio_captures_lecture_fk',
    }).onDelete('restrict'),
    check(
      'lecture_audio_captures_mime_valid',
      sql`btrim(${table.recorderMimeType}) = ${table.recorderMimeType} AND char_length(${table.recorderMimeType}) BETWEEN 1 AND 120`,
    ),
    check(
      'lecture_audio_captures_times_valid',
      sql`${table.consentAttestedAt} <= ${table.startedAt} AND ${table.startedAt} <= ${table.stoppedAt}`,
    ),
    check(
      'lecture_audio_captures_measurements_valid',
      sql`${table.durationMs} >= 0 AND ${table.chunkCount} > 0`,
    ),
    check(
      'lecture_audio_captures_stop_reason_valid',
      sql`${table.stopReason} IN ('stopped', 'interrupted', 'track-ended', 'recorder-error', 'size-limit')`,
    ),
    check(
      'lecture_audio_captures_handoff_measurements_valid',
      sql`(
        ${table.hashingDurationMs} IS NULL
        AND ${table.uploadDurationMs} IS NULL
        AND ${table.uploadRetryCount} IS NULL
      ) OR (
        ${table.hashingDurationMs} IS NOT NULL
        AND ${table.uploadDurationMs} IS NOT NULL
        AND ${table.uploadRetryCount} IS NOT NULL
        AND ${table.hashingDurationMs} >= 0
        AND ${table.uploadDurationMs} >= 0
        AND ${table.uploadRetryCount} >= 0
      )`,
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
