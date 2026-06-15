import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { cpSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { resolve } from 'node:path';

const repoRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root: 'examples',
  plugins: [
    react(),
    {
      name: 'copy-brand-static',
      closeBundle() {
        const src = resolve(repoRoot, 'brand');
        const dest = resolve(repoRoot, 'examples/dist/brand');
        cpSync(src, dest, { recursive: true });
      },
    },
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@palmstreetweb/slate': fileURLToPath(new URL('./src/index.ts', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    open: true,
  },
});
