import { fileURLToPath } from 'node:url'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const workspaceRoot = fileURLToPath(new URL('../..', import.meta.url))

export default defineConfig({
  envDir: workspaceRoot,
  resolve: {
    tsconfigPaths: true,
  },
  server: {
    allowedHosts: ['localhost', '.e2b.app'],
    host: '0.0.0.0',
    port: 3000,
    proxy: {
      '/api': {
        target: process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:3001',
      },
    },
    strictPort: true,
  },
  plugins: [tanstackStart(), viteReact()],
})
