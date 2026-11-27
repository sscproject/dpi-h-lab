/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'client',
  plugins: [react()],
  build: {
    outDir: '../dist-client',
    emptyOutDir: true,
    // Fonts stay separate files: the site's security policy allows fonts from the site itself
    // (font-src 'self'), not ones embedded in the CSS as data: URLs.
    assetsInlineLimit: (file) => (/\.(woff2?|ttf|otf|eot)$/i.test(file) ? false : undefined),
  },
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
