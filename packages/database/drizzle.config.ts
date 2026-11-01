import { config } from 'dotenv'
import { defineConfig } from 'drizzle-kit'

for (const path of ['../../.env.local', '../../.env', '.env.local', '.env']) {
  config({ path, quiet: true })
}

const url = process.env.DATABASE_URL
if (!url) {
  throw new Error('DATABASE_URL is required for Drizzle Kit commands.')
}

export default defineConfig({
  dbCredentials: { url },
  dialect: 'postgresql',
  out: './drizzle',
  schema: './src/schema/index.ts',
  strict: true,
  verbose: true,
})
