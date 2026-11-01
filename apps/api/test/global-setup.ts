import { fileURLToPath } from 'node:url'
import { createDatabase } from '@ctrorec/database'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { requireTestDatabaseUrl } from './test-database.js'

export default async function setup(): Promise<void> {
  const { db, pool } = createDatabase(requireTestDatabaseUrl(), {
    applicationName: 'ctrorec-api-test-migrator',
    maxConnections: 1,
  })

  try {
    await migrate(db, {
      migrationsFolder: fileURLToPath(
        new URL('../../../packages/database/drizzle', import.meta.url),
      ),
    })
  } finally {
    await pool.end()
  }
}
