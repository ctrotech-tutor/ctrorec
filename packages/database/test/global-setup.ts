import { fileURLToPath } from 'node:url'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { createDatabase } from '../src/client.js'
import { requireTestDatabaseUrl } from './test-database.js'

export default async function setup(): Promise<void> {
  const { db, pool } = createDatabase(requireTestDatabaseUrl(), {
    applicationName: 'ctrorec-test-migrator',
    maxConnections: 1,
  })

  try {
    await migrate(db, {
      migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
    })
  } finally {
    await pool.end()
  }
}
