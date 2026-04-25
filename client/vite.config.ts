import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const repoRoot = resolve(__dirname, '..')
const API_TARGET = 'http://localhost:4000'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  loadEnv(mode, repoRoot, '')

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': resolve(__dirname, './src'),
      },
    },
    preview: {
      port: 9998,
    },
    server: {
      proxy: {
        '/api': {
          target: API_TARGET,
          changeOrigin: true,
        },
      },
    },
  }
})
