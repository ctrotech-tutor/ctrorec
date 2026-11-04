import { and, eq, isNull, sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import {
  createDatabase,
  type Database,
  type DatabasePool,
} from '../src/client.js'
import {
  academicTerms,
  academicUnits,
  courseOfferings,
  enrollments,
  institutionInvitations,
  institutions,
  lectureAudio,
  lectureAudioCaptures,
  lectureAudioDerivatives,
  lectureAudioUploads,
  lecturerAssignments,
  lectures,
  membershipRoles,
} from '../src/schema/index.js'
import { seedDevelopment } from '../src/seeds/development.js'
import {
  createAcademicFixture,
  createAdditionalStaffMembership,
} from './fixtures.js'
import { expectPostgresError } from './postgres-errors.js'
import { exactlyOne } from './rows.js'
import { requireTestDatabaseUrl, resetDatabase } from './test-database.js'

let db: Database
let pool: DatabasePool

beforeEach(async () => {
  if (!db) {
    ;({ db, pool } = createDatabase(requireTestDatabaseUrl(), {
      applicationName: 'ctrorec-schema-tests',
      maxConnections: 2,
    }))
  }
  await resetDatabase(db)
})

afterAll(async () => {
  await pool?.end()
})

describe('academic database invariants', () => {
  it('generates native UUIDv7 identifiers on PostgreSQL 18', async () => {
    const institution = exactlyOne(
      await db
        .insert(institutions)
        .values({ name: 'UUID Institution', slug: 'uuid-institution' })
        .returning(),
    )
    const result = await db.execute<{ version: number }>(
      sql`SELECT uuid_extract_version(${institution.id}::uuid) AS version`,
    )

    expect(result.rows[0]?.version).toBe(7)
    expect(institution.createdAt).toBeInstanceOf(Date)
  })

  it('enforces one open invitation and complete acceptance provenance', async () => {
    const fixture = await createAcademicFixture(db, 'invitations')
    const values = {
      institutionId: fixture.institution.id,
      invitedByMembershipId: fixture.lecturerMembership.id,
      email: 'invited@ctrorec.test',
      displayName: 'Invited Person',
      expiresAt: new Date('2030-01-01T00:00:00.000Z'),
    }
    const first = exactlyOne(
      await db
        .insert(institutionInvitations)
        .values({ ...values, tokenHash: 'a'.repeat(64) })
        .returning(),
    )
    await expectPostgresError(
      db
        .insert(institutionInvitations)
        .values({ ...values, tokenHash: 'b'.repeat(64) }),
      {
        code: '23505',
        constraint: 'institution_invitations_one_open_email_unique',
      },
    )
    await expectPostgresError(
      db
        .update(institutionInvitations)
        .set({ acceptedAt: new Date() })
        .where(eq(institutionInvitations.id, first.id)),
      {
        code: '23514',
        constraint: 'institution_invitations_acceptance_complete',
      },
    )

    await db
      .update(institutionInvitations)
      .set({ revokedAt: new Date(), revocationReason: 'replaced' })
      .where(eq(institutionInvitations.id, first.id))
    await db
      .insert(institutionInvitations)
      .values({ ...values, tokenHash: 'b'.repeat(64) })
    expect(
      await db
        .select()
        .from(institutionInvitations)
        .where(eq(institutionInvitations.email, values.email)),
    ).toHaveLength(2)
  })

  it('rejects a course from another institution on an offering', async () => {
    const first = await createAcademicFixture(db, 'first')
    const second = await createAcademicFixture(db, 'second')

    await expectPostgresError(
      db.insert(courseOfferings).values({
        institutionId: second.institution.id,
        courseId: first.course.id,
        termId: second.term.id,
      }),
      { code: '23503', constraint: 'course_offerings_course_fk' },
    )
  })

  it('rejects an academic parent from another institution', async () => {
    const first = await createAcademicFixture(db, 'parent-one')
    const second = await createAcademicFixture(db, 'parent-two')

    await expectPostgresError(
      db.insert(academicUnits).values({
        institutionId: second.institution.id,
        parentId: first.unit.id,
        kind: 'department',
        code: 'CROSS-TENANT',
        name: 'Cross Tenant Unit',
      }),
      { code: '23503', constraint: 'academic_units_parent_fk' },
    )
  })

  it('rejects an enrollment membership from another institution', async () => {
    const first = await createAcademicFixture(db, 'enroll-one')
    const second = await createAcademicFixture(db, 'enroll-two')

    await expectPostgresError(
      db.insert(enrollments).values({
        institutionId: first.institution.id,
        courseOfferingId: first.offering.id,
        membershipId: second.studentMembership.id,
      }),
      { code: '23503', constraint: 'enrollments_membership_fk' },
    )
  })

  it('allows enrollment history but prevents duplicate active enrollment', async () => {
    const fixture = await createAcademicFixture(db, 'history')
    const values = {
      institutionId: fixture.institution.id,
      courseOfferingId: fixture.offering.id,
      membershipId: fixture.studentMembership.id,
      enrolledAt: new Date('2026-10-01T08:00:00.000Z'),
    }
    const initial = exactlyOne(
      await db.insert(enrollments).values(values).returning(),
    )

    await expectPostgresError(db.insert(enrollments).values(values), {
      code: '23505',
      constraint: 'enrollments_active_unique',
    })

    await db
      .update(enrollments)
      .set({ endsAt: new Date('2027-01-01T08:00:00.000Z') })
      .where(eq(enrollments.id, initial.id))
    await db.insert(enrollments).values({
      ...values,
      enrolledAt: new Date('2027-01-02T08:00:00.000Z'),
    })

    const history = await db
      .select()
      .from(enrollments)
      .where(eq(enrollments.membershipId, fixture.studentMembership.id))
    expect(history).toHaveLength(2)
    expect(history.filter((row) => row.endsAt === null)).toHaveLength(1)
  })

  it('allows multiple active lecturers on one course offering', async () => {
    const fixture = await createAcademicFixture(db, 'multiple-lecturers')
    const secondStaff = await createAdditionalStaffMembership(
      db,
      fixture,
      'multiple-lecturers-second',
    )
    await db.insert(lecturerAssignments).values([
      {
        institutionId: fixture.institution.id,
        courseOfferingId: fixture.offering.id,
        membershipId: fixture.lecturerMembership.id,
        role: 'lead',
      },
      {
        institutionId: fixture.institution.id,
        courseOfferingId: fixture.offering.id,
        membershipId: secondStaff.id,
        role: 'assistant',
      },
    ])

    const activeAssignments = await db
      .select()
      .from(lecturerAssignments)
      .where(
        and(
          eq(lecturerAssignments.courseOfferingId, fixture.offering.id),
          isNull(lecturerAssignments.endsAt),
        ),
      )
    expect(activeAssignments).toHaveLength(2)
  })

  it('preserves lectures across lecturer reassignment', async () => {
    const fixture = await createAcademicFixture(db, 'reassignment')
    const secondStaff = await createAdditionalStaffMembership(
      db,
      fixture,
      'reassignment-second',
    )
    const firstAssignment = exactlyOne(
      await db
        .insert(lecturerAssignments)
        .values({
          institutionId: fixture.institution.id,
          courseOfferingId: fixture.offering.id,
          membershipId: fixture.lecturerMembership.id,
          startsAt: new Date('2026-10-01T08:00:00.000Z'),
        })
        .returning(),
    )
    const lecture = exactlyOne(
      await db
        .insert(lectures)
        .values({
          institutionId: fixture.institution.id,
          courseOfferingId: fixture.offering.id,
          createdByMembershipId: fixture.lecturerMembership.id,
          title: 'Original recorded teaching',
          occurredAt: new Date('2026-10-15T09:00:00.000Z'),
        })
        .returning(),
    )

    await db
      .update(lecturerAssignments)
      .set({ endsAt: new Date('2027-01-01T08:00:00.000Z') })
      .where(eq(lecturerAssignments.id, firstAssignment.id))
    await db.insert(lecturerAssignments).values({
      institutionId: fixture.institution.id,
      courseOfferingId: fixture.offering.id,
      membershipId: secondStaff.id,
      startsAt: new Date('2027-01-02T08:00:00.000Z'),
    })

    const assignments = await db
      .select()
      .from(lecturerAssignments)
      .where(eq(lecturerAssignments.courseOfferingId, fixture.offering.id))
    const preservedLecture = exactlyOne(
      await db.select().from(lectures).where(eq(lectures.id, lecture.id)),
    )
    expect(assignments).toHaveLength(2)
    expect(preservedLecture.courseOfferingId).toBe(fixture.offering.id)
    expect(preservedLecture.createdByMembershipId).toBe(
      fixture.lecturerMembership.id,
    )
  })

  it('prevents deletion of an offering that owns lecture history', async () => {
    const fixture = await createAcademicFixture(db, 'delete-offering')
    await db.insert(lectures).values({
      institutionId: fixture.institution.id,
      courseOfferingId: fixture.offering.id,
      createdByMembershipId: fixture.lecturerMembership.id,
      title: 'Lecture that must be preserved',
      occurredAt: new Date('2026-10-15T09:00:00.000Z'),
    })

    await expectPostgresError(
      db
        .delete(courseOfferings)
        .where(eq(courseOfferings.id, fixture.offering.id)),
      { code: '23001', constraint: 'lectures_offering_fk' },
    )
  })

  it('enforces audio tenancy, one original, and restrictive lecture deletion', async () => {
    const first = await createAcademicFixture(db, 'audio-one')
    const second = await createAcademicFixture(db, 'audio-two')
    const lecture = exactlyOne(
      await db
        .insert(lectures)
        .values({
          institutionId: first.institution.id,
          courseOfferingId: first.offering.id,
          createdByMembershipId: first.lecturerMembership.id,
          title: 'Lecture with an original',
          occurredAt: new Date('2026-10-15T09:00:00.000Z'),
        })
        .returning(),
    )
    const audio = {
      lectureId: lecture.id,
      institutionId: first.institution.id,
      uploadedByMembershipId: first.lecturerMembership.id,
      storageProvider: 'local',
      originalFileName: 'lecture.wav',
      mediaType: 'audio/wav' as const,
      byteSize: 4044,
      sha256: 'a'.repeat(64),
    }
    await db
      .insert(lectureAudio)
      .values({ ...audio, storageKey: 'audio/original' })

    await expectPostgresError(
      db
        .insert(lectureAudio)
        .values({ ...audio, storageKey: 'audio/replacement' }),
      { code: '23505', constraint: 'lecture_audio_pkey' },
    )

    const otherLecture = exactlyOne(
      await db
        .insert(lectures)
        .values({
          institutionId: first.institution.id,
          courseOfferingId: first.offering.id,
          createdByMembershipId: first.lecturerMembership.id,
          title: 'Lecture targeted by a cross-tenant audio row',
          occurredAt: new Date('2026-10-16T09:00:00.000Z'),
        })
        .returning(),
    )
    await expectPostgresError(
      db.insert(lectureAudio).values({
        ...audio,
        lectureId: otherLecture.id,
        institutionId: second.institution.id,
        uploadedByMembershipId: second.lecturerMembership.id,
        storageKey: 'audio/cross-tenant',
      }),
      { code: '23503', constraint: 'lecture_audio_lecture_fk' },
    )

    await expectPostgresError(
      db.delete(lectures).where(eq(lectures.id, lecture.id)),
      { code: '23001', constraint: 'lecture_audio_lecture_fk' },
    )
  })

  it('enforces resumable upload tenancy, offsets, and completion state', async () => {
    const first = await createAcademicFixture(db, 'upload-one')
    const second = await createAcademicFixture(db, 'upload-two')
    const lecture = exactlyOne(
      await db
        .insert(lectures)
        .values({
          institutionId: first.institution.id,
          courseOfferingId: first.offering.id,
          createdByMembershipId: first.lecturerMembership.id,
          title: 'Lecture with an upload session',
          occurredAt: new Date('2026-10-15T09:00:00.000Z'),
        })
        .returning(),
    )
    const upload = {
      lectureId: lecture.id,
      institutionId: first.institution.id,
      createdByMembershipId: first.lecturerMembership.id,
      originalFileName: 'lecture.wav',
      byteSize: 40_000,
      sha256: 'a'.repeat(64),
      chunkSize: 16_384,
      expiresAt: new Date('2026-11-02T09:00:00.000Z'),
    }
    const active = exactlyOne(
      await db.insert(lectureAudioUploads).values(upload).returning(),
    )

    await expectPostgresError(db.insert(lectureAudioUploads).values(upload), {
      code: '23505',
      constraint: 'lecture_audio_uploads_active_lecture_unique',
    })
    await expectPostgresError(
      db
        .update(lectureAudioUploads)
        .set({ receivedBytes: 40_001 })
        .where(eq(lectureAudioUploads.id, active.id)),
      {
        code: '23514',
        constraint: 'lecture_audio_uploads_received_bytes_valid',
      },
    )
    await expectPostgresError(
      db
        .update(lectureAudioUploads)
        .set({ status: 'completed', receivedBytes: 40_000 })
        .where(eq(lectureAudioUploads.id, active.id)),
      {
        code: '23514',
        constraint: 'lecture_audio_uploads_completion_valid',
      },
    )
    await expectPostgresError(
      db.insert(lectureAudioUploads).values({
        ...upload,
        institutionId: second.institution.id,
        createdByMembershipId: second.lecturerMembership.id,
        status: 'cancelled',
      }),
      { code: '23503', constraint: 'lecture_audio_uploads_lecture_fk' },
    )

    await db
      .update(lectureAudioUploads)
      .set({ status: 'cancelled' })
      .where(eq(lectureAudioUploads.id, active.id))
    await db.insert(lectureAudioUploads).values(upload)
    await expectPostgresError(
      db.delete(lectures).where(eq(lectures.id, lecture.id)),
      { code: '23001', constraint: 'lecture_audio_uploads_lecture_fk' },
    )
  })

  it('enforces derivative tenancy, readiness, and original preservation', async () => {
    const first = await createAcademicFixture(db, 'derivative-one')
    const second = await createAcademicFixture(db, 'derivative-two')
    const lecture = exactlyOne(
      await db
        .insert(lectures)
        .values({
          institutionId: first.institution.id,
          courseOfferingId: first.offering.id,
          createdByMembershipId: first.lecturerMembership.id,
          title: 'Lecture with a derivative',
          occurredAt: new Date('2026-10-15T09:00:00.000Z'),
        })
        .returning(),
    )
    await db.insert(lectureAudio).values({
      lectureId: lecture.id,
      institutionId: first.institution.id,
      uploadedByMembershipId: first.lecturerMembership.id,
      storageProvider: 'local',
      storageKey: 'audio/original-for-derivative',
      originalFileName: 'lecture.wav',
      mediaType: 'audio/wav',
      byteSize: 4044,
      sha256: 'a'.repeat(64),
    })

    await expectPostgresError(
      db.insert(lectureAudioDerivatives).values({
        lectureId: lecture.id,
        institutionId: second.institution.id,
        sourceSha256: 'a'.repeat(64),
      }),
      { code: '23503', constraint: 'lecture_audio_derivatives_original_fk' },
    )

    const derivative = exactlyOne(
      await db
        .insert(lectureAudioDerivatives)
        .values({
          lectureId: lecture.id,
          institutionId: first.institution.id,
          sourceSha256: 'a'.repeat(64),
        })
        .returning(),
    )
    await expectPostgresError(
      db.insert(lectureAudioDerivatives).values({
        lectureId: lecture.id,
        institutionId: first.institution.id,
        sourceSha256: 'a'.repeat(64),
      }),
      {
        code: '23505',
        constraint: 'lecture_audio_derivatives_lecture_kind_unique',
      },
    )
    await expectPostgresError(
      db
        .update(lectureAudioDerivatives)
        .set({ status: 'ready' })
        .where(eq(lectureAudioDerivatives.id, derivative.id)),
      {
        code: '23514',
        constraint: 'lecture_audio_derivatives_ready_state_valid',
      },
    )

    await db
      .update(lectureAudioDerivatives)
      .set({
        status: 'ready',
        storageProvider: 'local',
        storageKey: 'audio/data-saver',
        byteSize: 1000,
        sha256: 'b'.repeat(64),
        completedAt: new Date(),
      })
      .where(eq(lectureAudioDerivatives.id, derivative.id))
    await expectPostgresError(
      db.delete(lectureAudio).where(eq(lectureAudio.lectureId, lecture.id)),
      { code: '23001', constraint: 'lecture_audio_derivatives_original_fk' },
    )
  })

  it('enforces capture-provenance tenancy, timeline, and original preservation', async () => {
    const first = await createAcademicFixture(db, 'capture-one')
    const second = await createAcademicFixture(db, 'capture-two')
    const lecture = exactlyOne(
      await db
        .insert(lectures)
        .values({
          institutionId: first.institution.id,
          courseOfferingId: first.offering.id,
          createdByMembershipId: first.lecturerMembership.id,
          title: 'Lecture with capture provenance',
          occurredAt: new Date('2026-10-15T09:00:00.000Z'),
        })
        .returning(),
    )
    await db.insert(lectureAudio).values({
      lectureId: lecture.id,
      institutionId: first.institution.id,
      uploadedByMembershipId: first.lecturerMembership.id,
      storageProvider: 'local',
      storageKey: 'audio/original-for-capture',
      originalFileName: 'lecture.webm',
      mediaType: 'audio/webm',
      byteSize: 4_044,
      sha256: 'a'.repeat(64),
    })
    const capture = {
      lectureId: lecture.id,
      institutionId: first.institution.id,
      clientCaptureId: '019a1000-0000-7000-8000-0000000000c1',
      recorderMimeType: 'audio/webm;codecs=opus',
      consentAttestedAt: new Date('2026-10-15T08:59:59.000Z'),
      startedAt: new Date('2026-10-15T09:00:00.000Z'),
      stoppedAt: new Date('2026-10-15T09:05:00.000Z'),
      durationMs: 300_000,
      chunkCount: 150,
      persistentStorageGranted: true,
      stopReason: 'stopped',
      hashingDurationMs: 125,
      uploadDurationMs: 2_500,
      uploadRetryCount: 3,
    }

    await expectPostgresError(
      db.insert(lectureAudioCaptures).values({
        ...capture,
        institutionId: second.institution.id,
      }),
      { code: '23503', constraint: 'lecture_audio_captures_original_fk' },
    )
    await db.insert(lectureAudioCaptures).values(capture)
    await expectPostgresError(
      db
        .update(lectureAudioCaptures)
        .set({ startedAt: new Date('2026-10-15T09:06:00.000Z') })
        .where(eq(lectureAudioCaptures.lectureId, lecture.id)),
      { code: '23514', constraint: 'lecture_audio_captures_times_valid' },
    )
    await expectPostgresError(
      db
        .update(lectureAudioCaptures)
        .set({ uploadRetryCount: null })
        .where(eq(lectureAudioCaptures.lectureId, lecture.id)),
      {
        code: '23514',
        constraint: 'lecture_audio_captures_handoff_measurements_valid',
      },
    )
    await expectPostgresError(
      db.delete(lectureAudio).where(eq(lectureAudio.lectureId, lecture.id)),
      { code: '23001', constraint: 'lecture_audio_captures_original_fk' },
    )
  })

  it('rejects invalid term dates and incomplete publication metadata', async () => {
    const fixture = await createAcademicFixture(db, 'checks')

    await expectPostgresError(
      db.insert(academicTerms).values({
        institutionId: fixture.institution.id,
        code: 'INVALID-DATES',
        name: 'Invalid Dates',
        startsOn: '2027-03-01',
        endsOn: '2027-02-01',
      }),
      { code: '23514', constraint: 'academic_terms_dates_valid' },
    )
    await expectPostgresError(
      db.insert(lectures).values({
        institutionId: fixture.institution.id,
        courseOfferingId: fixture.offering.id,
        createdByMembershipId: fixture.lecturerMembership.id,
        title: 'Published without a publication timestamp',
        occurredAt: new Date('2026-10-15T09:00:00.000Z'),
        status: 'published',
      }),
      { code: '23514', constraint: 'lectures_publish_time_required' },
    )
  })

  it('supports multiple roles for one institutional membership', async () => {
    const fixture = await createAcademicFixture(db, 'roles')
    await db.insert(membershipRoles).values({
      institutionId: fixture.institution.id,
      membershipId: fixture.lecturerMembership.id,
      role: 'institution_admin',
    })

    const roles = await db
      .select()
      .from(membershipRoles)
      .where(eq(membershipRoles.membershipId, fixture.lecturerMembership.id))
    expect(roles.map((row) => row.role).sort()).toEqual([
      'academic_staff',
      'institution_admin',
    ])
  })

  it('runs the development seed idempotently', async () => {
    const first = await seedDevelopment(db)
    const second = await seedDevelopment(db)
    const institutionRows = await db.select().from(institutions)
    const lectureRows = await db.select().from(lectures)

    expect(first.seeded).toBe(true)
    expect(second.seeded).toBe(false)
    expect(institutionRows).toHaveLength(1)
    expect(lectureRows).toHaveLength(1)
  })
})
