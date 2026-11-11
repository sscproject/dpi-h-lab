/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'client',
  plugins: [react()],
  build: { outDir: '../dist-client', emptyOutDir: true },
  server: {
    port: 5173,
    // Keep the browser's Host header so join links point at the web address, not the API port.
    proxy: { '/api': { target: 'http://localhost:3000', changeOrigin: false } },
  },
  test: {
    root: '.',
    include: ['tests/**/*.test.ts'],
    testTimeout: 20000,
    hookTimeout: 120000,
  },
});
