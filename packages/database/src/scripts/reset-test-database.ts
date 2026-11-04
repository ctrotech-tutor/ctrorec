import { config } from 'dotenv'
import { sql } from 'drizzle-orm'
import { createDatabase } from '../client.js'

for (const path of ['../../.env.local', '../../.env', '.env.local', '.env']) {
  config({ path, quiet: true })
}

async function main(): Promise<void> {
  const connectionString = process.env.TEST_DATABASE_URL
  if (!connectionString) {
    throw new Error('TEST_DATABASE_URL is required to reset the test database.')
  }
  const url = new URL(connectionString)
  const databaseName = decodeURIComponent(url.pathname.slice(1))
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !databaseName.endsWith('_test')
  ) {
    throw new Error(
      'Refusing to reset a database whose name does not end in _test.',
    )
  }

  const { db, pool } = createDatabase(connectionString, {
    applicationName: 'ctrorec-test-reset',
    maxConnections: 1,
  })
  try {
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
    console.log(`Reset guarded test database ${databaseName}.`)
  } finally {
    await pool.end()
  }
}

void main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
