import { describe, expect, it } from 'vitest'
import {
  assertRestoreDatabaseUrl,
  databaseNameFromUrl,
  postgresToolEnvironment,
} from '../src/backup/postgres-tools.js'

describe('backup PostgreSQL process boundaries', () => {
  it('passes decoded connection settings through libpq environment variables', () => {
    const environment = postgresToolEnvironment(
      'postgresql://backup%20user:p%40ss@db.example:5433/ctrorec?sslmode=require&application_name=snapshot',
      'ctrorec-backup-test',
    )

    expect(environment).toMatchObject({
      PGHOST: 'db.example',
      PGPORT: '5433',
      PGUSER: 'backup user',
      PGPASSWORD: 'p@ss',
      PGDATABASE: 'ctrorec',
      PGSSLMODE: 'require',
      PGAPPNAME: 'snapshot',
    })
  })

  it('rejects silently unsupported connection parameters', () => {
    expect(() =>
      postgresToolEnvironment(
        'postgresql://postgres:postgres@localhost/ctrorec?options=unsafe',
        'ctrorec-backup-test',
      ),
    ).toThrow('not supported')
  })

  it('allows only explicitly named restore-drill databases', () => {
    expect(
      databaseNameFromUrl(
        'postgresql://postgres:postgres@localhost/ctrorec_restore_test',
      ),
    ).toBe('ctrorec_restore_test')
    expect(() =>
      assertRestoreDatabaseUrl(
        'postgresql://postgres:postgres@localhost/ctrorec_restore_test',
      ),
    ).not.toThrow()
    expect(() =>
      assertRestoreDatabaseUrl(
        'postgresql://postgres:postgres@localhost/ctrorec',
      ),
    ).toThrow('_restore_test')
  })
})
