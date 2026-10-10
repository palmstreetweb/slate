// @vitest-environment node
/**
 * Vercel deploys every non-underscore `api/*.ts` as a Serverless Function
 * (audit 2026-10 M-1: nine helper modules were live as anonymous endpoints
 * that cold-started their bundles and crashed 500). Only handlers live at the
 * top of `api/`; everything they import lives under `api/_lib/`, which Vercel
 * skips.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const apiDir = fileURLToPath(new URL('../api', import.meta.url));

describe('api/ layout (ADR-071)', () => {
  const entries = readdirSync(apiDir);
  const files = entries.filter((n) => statSync(join(apiDir, n)).isFile());
  const dirs = entries.filter((n) => statSync(join(apiDir, n)).isDirectory());

  it('the only top-level files are the two route handlers', () => {
    expect(files.sort()).toEqual(['auth-email.ts', 'generate.ts']);
  });

  it('every top-level file exports a default request handler', () => {
    for (const name of files) {
      const src = readFileSync(join(apiDir, name), 'utf8');
      expect(src, name).toMatch(/export default (async )?function handler\(/);
    }
  });

  it('helpers live only in underscore-prefixed folders', () => {
    expect(dirs.length).toBeGreaterThan(0);
    for (const d of dirs) expect(d, d).toMatch(/^_/);
    const lib = readdirSync(join(apiDir, '_lib')).filter((n) => n.endsWith('.ts'));
    expect(lib.sort()).toEqual([
      'authJwt.ts',
      'extractDocument.ts',
      'generateFormSchema.ts',
      'mapGeneratedForm.ts',
      'modelForm.ts',
      'neonDataApi.ts',
      'rateLimit.ts',
      'runGenerate.ts',
      'sentry.ts',
      'sentryGate.ts',
    ]);
  });

  it('nothing outside api/ imports a helper from the old top-level path', () => {
    const roots = ['examples', 'tests', 'scripts'].map((d) =>
      fileURLToPath(new URL(`../${d}`, import.meta.url)),
    );
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((n) => {
        const p = join(dir, n);
        if (statSync(p).isDirectory()) return n === 'node_modules' || n === 'dist' ? [] : walk(p);
        return /\.(ts|tsx|mjs)$/.test(n) ? [p] : [];
      });
    const old =
      /['"](?:\.\.\/)+api\/(authJwt|rateLimit|runGenerate|sentry|sentryGate|neonDataApi|extractDocument|generateFormSchema|mapGeneratedForm|_modelForm)\.js['"]/;
    for (const file of roots.flatMap(walk)) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(old);
    }
  });
});
