import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'

// GitHub Pages has no rewrites: unknown paths get 404.html, which stashes the URL and
// bounces to the app root, where restoreEntryPath() puts it back.
function spaFallback(): Plugin {
  let base = '/'
  return {
    name: 'spa-404-fallback',
    configResolved(c) { base = c.base },
    generateBundle() {
      const b = JSON.stringify(base)
      const source = `<!doctype html><meta charset="utf-8"><title>ClipSpike</title><script>try{sessionStorage.setItem('clipspike:spa-redirect',location.pathname+location.search)}catch(e){}location.replace(${b})</script>`
      this.emitFile({ type: 'asset', fileName: '404.html', source })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  plugins: [react(), spaFallback()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
})
