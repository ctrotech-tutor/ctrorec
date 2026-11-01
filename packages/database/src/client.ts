import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema/index.js'

export interface DatabaseConnectionOptions {
  applicationName?: string
  maxConnections?: number
}

export function createDatabase(
  connectionString: string,
  options: DatabaseConnectionOptions = {},
) {
  if (connectionString.length === 0) {
    throw new Error('A PostgreSQL connection string is required.')
  }

  const maxConnections = options.maxConnections ?? 10
  if (!Number.isInteger(maxConnections) || maxConnections < 1) {
    throw new Error('maxConnections must be a positive integer.')
  }

  const pool = new Pool({
    application_name: options.applicationName ?? 'ctrorec',
    connectionString,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 10_000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
    max: maxConnections,
  })
  const db = drizzle({ client: pool, schema })

  return { db, pool }
}

export type Database = ReturnType<typeof createDatabase>['db']
export type DatabaseTransaction = Parameters<
  Parameters<Database['transaction']>[0]
>[0]
export type DatabasePool = ReturnType<typeof createDatabase>['pool']
