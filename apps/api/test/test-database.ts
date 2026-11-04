import { sql } from 'drizzle-orm'
import type { Database } from '@ctrorec/database'

export function requireTestDatabaseUrl(): string {
  const connectionString = process.env.TEST_DATABASE_URL
  if (!connectionString) {
    throw new Error('TEST_DATABASE_URL is required for API integration tests.')
  }

  const url = new URL(connectionString)
  const databaseName = decodeURIComponent(url.pathname.slice(1))
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !databaseName.endsWith('_test')
  ) {
    throw new Error(
      'TEST_DATABASE_URL must use PostgreSQL and a database name ending in _test.',
    )
  }

  return connectionString
}

export async function resetDatabase(db: Database): Promise<void> {
  await db.execute(sql`
    TRUNCATE TABLE
      auth_sessions,
      account_recovery_requests,
      institution_invitation_roles,
      institution_invitations,
      lecture_audio_derivatives,
      lecture_audio_captures,
      lecture_audio_uploads,
      lecture_audio,
      lectures,
      enrollments,
      lecturer_assignments,
      course_offerings,
      courses,
      academic_terms,
      academic_units,
      membership_roles,
      memberships,
      institutions,
      users
    CASCADE
  `)
  await db.execute(sql`DROP SCHEMA IF EXISTS pgboss CASCADE`)
}
