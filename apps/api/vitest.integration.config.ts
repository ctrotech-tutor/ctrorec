import { tmpdir } from 'node:os'
import { join } from 'node:path'
import swc from 'unplugin-swc'
import { defineConfig } from 'vitest/config'

const testDatabaseUrl = process.env.TEST_DATABASE_URL
if (!testDatabaseUrl) {
  throw new Error('TEST_DATABASE_URL is required for API integration tests.')
}
const audioTestRoot = join(tmpdir(), 'ctrorec-api-integration')

export default defineConfig({
  plugins: [swc.vite()],
  test: {
    environment: 'node',
    env: {
      AUDIO_STORAGE_ROOT: join(audioTestRoot, 'audio'),
      AUDIO_UPLOAD_TEMP_DIR: join(audioTestRoot, 'uploads'),
      AUDIO_MAX_UPLOAD_BYTES: '1048576',
      AUDIO_UPLOAD_CHUNK_BYTES: '16384',
      AUTH_COOKIE_SECURE: 'true',
      DATABASE_URL: testDatabaseUrl,
      NODE_ENV: 'test',
      WEB_ORIGIN: 'http://localhost:3000',
    },
    fileParallelism: false,
    globalSetup: ['test/global-setup.ts'],
    hookTimeout: 30_000,
    include: ['test/**/*.integration.test.ts'],
    maxWorkers: 1,
    testTimeout: 30_000,
  },
})
