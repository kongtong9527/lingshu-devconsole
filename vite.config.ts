import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5180,
    proxy: { '/api': 'http://127.0.0.1:5181' },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: [],
  },
})
