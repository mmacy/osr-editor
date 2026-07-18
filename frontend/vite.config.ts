/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    // The backend serves exactly what the wheel will someday ship.
    outDir: '../src/osreditor/static',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api': 'http://localhost:8630',
    },
  },
  test: {
    // Pure-logic tests run in node; component tests opt into jsdom with a
    // `// @vitest-environment jsdom` pragma.
    environment: 'node',
    setupFiles: ['./src/test/setup.ts'],
  },
})
