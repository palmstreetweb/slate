import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { cpSync, existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { resolve } from 'node:path';
import generateHandler from './api/generate.js';

const repoRoot = fileURLToPath(new URL('.', import.meta.url));
const brandDir = resolve(repoRoot, 'brand');
const BRAND_MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.css': 'text/css',
};

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, repoRoot, '');
  if (env.ANTHROPIC_API_KEY) process.env.ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY;

  return {
    root: 'examples',
    /** Load `.env*` from repo root (where `.env.example` lives), not `examples/`. */
    envDir: repoRoot,
    plugins: [
      react(),
      {
        name: 'slate-generate-api',
        configureServer(server) {
          server.middlewares.use((req, res, next) => {
            const url = req.url?.split('?')[0] ?? '';
            if (url !== '/api/generate') return next();
            void (async () => {
              const chunks: Buffer[] = [];
              for await (const chunk of req) chunks.push(Buffer.from(chunk));
              const headers = new Headers();
              for (const [key, value] of Object.entries(req.headers)) {
                if (!value) continue;
                headers.set(key, Array.isArray(value) ? value.join(',') : value);
              }
              // Local dev only: the handler skips the sign-in check for these.
              headers.set('x-slate-dev', '1');
              const request = new Request(`http://127.0.0.1${url}`, {
                method: req.method ?? 'GET',
                headers,
                body:
                  req.method === 'GET' || req.method === 'HEAD' ? undefined : Buffer.concat(chunks),
              });
              const response = await generateHandler(request);
              res.statusCode = response.status;
              response.headers.forEach((value, key) => {
                res.setHeader(key, value);
              });
              res.end(Buffer.from(await response.arrayBuffer()));
            })().catch((err: unknown) => {
              console.error('[slate] /api/generate', err);
              res.statusCode = 500;
              res.setHeader('content-type', 'application/json');
              res.end(JSON.stringify({ error: 'Generate failed.' }));
            });
          });
        },
      },
      {
        name: 'serve-brand-dev',
        configureServer(server) {
          server.middlewares.use((req, res, next) => {
            const url = req.url?.split('?')[0] ?? '';
            if (url !== '/brand' && !url.startsWith('/brand/')) return next();
            const rel =
              url === '/brand' || url === '/brand/'
                ? 'index.html'
                : decodeURIComponent(url.slice('/brand/'.length));
            const file = resolve(join(brandDir, rel));
            if (!file.startsWith(brandDir) || !existsSync(file) || !statSync(file).isFile()) {
              return next();
            }
            res.setHeader('Content-Type', BRAND_MIME[extname(file)] || 'application/octet-stream');
            res.end(readFileSync(file));
          });
        },
      },
      {
        name: 'copy-brand-static',
        closeBundle() {
          const dest = resolve(repoRoot, 'examples/dist/brand');
          cpSync(brandDir, dest, { recursive: true });
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
  };
});
