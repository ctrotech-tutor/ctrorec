import { fileURLToPath } from 'node:url'
import { defineConfig } from '@playwright/test'

if (!process.env.TEST_DATABASE_URL) {
  try {
    process.loadEnvFile(fileURLToPath(new URL('../../.env', import.meta.url)))
  } catch (error) {
    if (!(
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ENOENT'
    )) {
      throw error
    }
  }
}
const testDatabaseUrl = process.env.TEST_DATABASE_URL
if (!testDatabaseUrl) {
  throw new Error('TEST_DATABASE_URL is required for browser tests.')
}
const outputDirectory = fileURLToPath(
  new URL('./test-results', import.meta.url),
)

export default defineConfig({
  fullyParallel: false,
  reporter: process.env.CI ? 'github' : 'list',
  testDir: './tests',
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:3000',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    launchOptions: {
      args: [
        '--use-fake-device-for-media-stream',
        '--use-fake-ui-for-media-stream',
        `--use-file-for-fake-audio-capture=${fileURLToPath(new URL('../api/test/fixtures/lecture.wav', import.meta.url))}`,
      ],
    },
  },
  webServer: [
    {
      command:
        'pnpm --dir ../.. db:migrate && pnpm --dir ../.. db:reset:test && pnpm --dir ../.. db:seed && pnpm --dir ../.. build:api && pnpm --dir ../worker build && pnpm --dir ../.. exec concurrently --kill-others-on-fail --names api,worker "pnpm --dir apps/api start" "pnpm --dir apps/worker start"',
      env: {
        ...process.env,
        AUDIO_STORAGE_ROOT: `${outputDirectory}/audio`,
        AUDIO_UPLOAD_TEMP_DIR: `${outputDirectory}/uploads`,
        AUDIO_UPLOAD_CHUNK_BYTES: '16384',
        MEDIA_TEMP_DIR: `${outputDirectory}/processing`,
        AUTH_COOKIE_SECURE: 'false',
        DATABASE_URL: testDatabaseUrl,
        TEST_DATABASE_URL: testDatabaseUrl,
        WEB_ORIGIN: 'http://127.0.0.1:3000',
        RECOVERY_EMAIL_ENABLED: 'true',
        RECOVERY_SMTP_URL: 'smtp://127.0.0.1:2525',
        RECOVERY_EMAIL_FROM: 'no-reply@ctrorec.test',
        RECOVERY_WEB_ORIGIN: 'http://127.0.0.1:3000',
        RECOVERY_SMTP_IGNORE_TLS: 'true',
      },
      reuseExistingServer: false,
      timeout: 120_000,
      url: 'http://127.0.0.1:3001/api/health',
    },
    {
      command: 'pnpm build && pnpm start',
      reuseExistingServer: false,
      timeout: 120_000,
      url: 'http://127.0.0.1:3000',
    },
    {
      command: 'node tests/smtp-catcher.mjs',
      reuseExistingServer: false,
      timeout: 30_000,
      url: 'http://127.0.0.1:2526/health',
    },
  ],
  workers: 1,
})
