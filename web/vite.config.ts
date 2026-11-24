import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
import { prerender } from './scripts/prerender'

// https://vite.dev/config/
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  plugins: [react(), prerender()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
})
