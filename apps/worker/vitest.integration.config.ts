import { tmpdir } from 'node:os'
import { join } from 'node:path'
import swc from 'unplugin-swc'
import { defineConfig } from 'vitest/config'

const testDatabaseUrl = process.env.TEST_DATABASE_URL
if (!testDatabaseUrl) {
  throw new Error('TEST_DATABASE_URL is required for worker integration tests.')
}

export default defineConfig({
  plugins: [swc.vite()],
  test: {
    environment: 'node',
    env: {
      DATABASE_URL: testDatabaseUrl,
      NODE_ENV: 'test',
      MEDIA_TEMP_DIR: join(tmpdir(), 'ctrorec-worker-integration-processing'),
      MEDIA_RECONCILIATION_ENABLED: 'false',
    },
    fileParallelism: false,
    globalSetup: ['test/global-setup.ts'],
    hookTimeout: 30_000,
    include: ['test/**/*.integration.test.ts'],
    maxWorkers: 1,
    testTimeout: 30_000,
  },
})
