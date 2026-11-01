import { config } from 'dotenv'
import { createDatabase } from '../client.js'
import { seedDevelopment } from '../seeds/development.js'

for (const path of ['../../.env.local', '../../.env', '.env.local', '.env']) {
  config({ path, quiet: true })
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('The development seed cannot run in production.')
  }

  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error('DATABASE_URL is required for the development seed.')
  }

  const { db, pool } = createDatabase(connectionString, {
    applicationName: 'ctrorec-development-seed',
    maxConnections: 1,
  })

  try {
    const result = await seedDevelopment(db)
    console.log(
      result.seeded
        ? `Development seed created for ${result.institutionId}.`
        : `Development seed already present for ${result.institutionId}.`,
    )
  } finally {
    await pool.end()
  }
}

void main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
