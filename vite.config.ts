import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  root: 'examples',
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@palmstreetweb/forms': fileURLToPath(new URL('./src/index.ts', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    open: true,
  },
});
