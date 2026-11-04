import { spawn } from 'node:child_process'

const CONNECTION_PARAMETER_MAP: Record<string, string> = {
  application_name: 'PGAPPNAME',
  channel_binding: 'PGCHANNELBINDING',
  connect_timeout: 'PGCONNECT_TIMEOUT',
  host: 'PGHOST',
  sslcert: 'PGSSLCERT',
  sslkey: 'PGSSLKEY',
  sslmode: 'PGSSLMODE',
  sslpassword: 'PGSSLPASSWORD',
  sslrootcert: 'PGSSLROOTCERT',
}

export function databaseNameFromUrl(connectionString: string): string {
  const url = parsePostgresUrl(connectionString)
  const databaseName = decodeURIComponent(url.pathname.slice(1))
  if (!databaseName || databaseName.includes('/')) {
    throw new Error('The PostgreSQL URL must contain one database name.')
  }
  return databaseName
}

export function assertRestoreDatabaseUrl(connectionString: string): void {
  const databaseName = databaseNameFromUrl(connectionString)
  if (!databaseName.endsWith('_restore_test')) {
    throw new Error(
      'Restore drills require a database name ending in _restore_test.',
    )
  }
}

/** Keep credentials in libpq's environment rather than process arguments. */
export function postgresToolEnvironment(
  connectionString: string,
  applicationName: string,
): NodeJS.ProcessEnv {
  const url = parsePostgresUrl(connectionString)
  const databaseName = databaseNameFromUrl(connectionString)
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    PGDATABASE: databaseName,
    PGAPPNAME: applicationName,
  }

  if (url.hostname) {
    environment.PGHOST = decodeURIComponent(url.hostname)
  }
  if (url.port) {
    environment.PGPORT = url.port
  }
  if (url.username) {
    environment.PGUSER = decodeURIComponent(url.username)
  }
  if (url.password) {
    environment.PGPASSWORD = decodeURIComponent(url.password)
  } else {
    delete environment.PGPASSWORD
  }

  const seen = new Set<string>()
  for (const [key, value] of url.searchParams) {
    if (seen.has(key)) {
      throw new Error(`PostgreSQL URL parameter ${key} is repeated.`)
    }
    seen.add(key)
    const environmentName = CONNECTION_PARAMETER_MAP[key]
    if (!environmentName) {
      throw new Error(
        `PostgreSQL URL parameter ${key} is not supported by the backup tool.`,
      )
    }
    environment[environmentName] = value
  }

  return environment
}

export async function runPostgresTool(
  executable: string,
  args: readonly string[],
  environment: NodeJS.ProcessEnv,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, [...args], {
      env: environment,
      shell: false,
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    let stderr = ''
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < 32_000) {
        stderr += chunk.toString('utf8')
      }
    })
    child.once('error', reject)
    child.once('close', (code, signal) => {
      if (code === 0) {
        resolve()
        return
      }
      const detail = stderr.trim().slice(-8_000)
      reject(
        new Error(
          `${executable} failed (${signal ?? `exit ${code ?? 'unknown'}`})${
            detail ? `: ${detail}` : ''
          }`,
        ),
      )
    })
  })
}

function parsePostgresUrl(connectionString: string): URL {
  const url = new URL(connectionString)
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error('A PostgreSQL connection URL is required.')
  }
  return url
}
