import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false,
    globalSetup: ['test/global-setup.ts'],
    hookTimeout: 30_000,
    include: ['test/**/*.integration.test.ts'],
    maxWorkers: 1,
    testTimeout: 30_000,
  },
})
