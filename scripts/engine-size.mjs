#!/usr/bin/env node
/**
 * Engine bundle budget (BUILD_BRIEF §2.9: < 50 kB gzip; ADR-059, ADR-063).
 *
 * The published ESM build splits on-demand field UIs into their own chunks
 * (ADR-063). "The engine" is what `import { Form } from '@palmstreetweb/slate'`
 * loads up front: dist/index.js plus every chunk it imports statically,
 * followed recursively. Chunks reached only through `import()` load on demand
 * and are reported separately. Sizes are gzip -9 of the files as published
 * (unminified), the way ADR-059 measured them.
 *
 *   npm run build && node scripts/engine-size.mjs [--max-kb 50]
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const DIST = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const maxArg = process.argv.indexOf('--max-kb');
const MAX_KB = maxArg > 0 ? Number(process.argv[maxArg + 1]) : 50;

const STATIC_RE =
  /^(?:import|export)\s[^;]*?from\s*["'](\.\/[^"']+)["']|^import\s*["'](\.\/[^"']+)["']/gm;
const DYNAMIC_RE = /import\(\s*["'](\.\/[^"']+)["']\s*\)/g;

const gz = (buf) => gzipSync(buf, { level: 9 }).length;
const kb = (n) => (n / 1000).toFixed(1);

function staticClosure(entry) {
  const seen = new Set();
  const walk = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    const src = readFileSync(join(DIST, file), 'utf8');
    for (const m of src.matchAll(STATIC_RE)) walk((m[1] ?? m[2]).replace(/^\.\//, ''));
  };
  walk(entry);
  return [...seen];
}

const core = staticClosure('index.js');
const coreBuf = Buffer.concat(core.map((f) => readFileSync(join(DIST, f))));
const coreGz = gz(coreBuf);

const lazy = new Set();
for (const f of readdirSync(DIST).filter((x) => x.endsWith('.js'))) {
  const src = readFileSync(join(DIST, f), 'utf8');
  for (const m of src.matchAll(DYNAMIC_RE)) lazy.add(m[1].replace(/^\.\//, ''));
}

console.log(`engine (index.js + static chunks: ${core.join(', ')})`);
console.log(`  ${kb(coreBuf.length)} kB raw, ${kb(coreGz)} kB gzip (budget ${MAX_KB} kB)`);
for (const f of [...lazy].sort()) {
  const closure = staticClosure(f).filter((x) => !core.includes(x));
  const buf = Buffer.concat(closure.map((x) => readFileSync(join(DIST, x))));
  console.log(`  on demand: ${f} ${kb(gz(buf))} kB gzip`);
}
const styles = readFileSync(join(DIST, 'styles.css'));
console.log(`styles.css ${kb(styles.length)} kB raw, ${kb(gz(styles))} kB gzip`);

if (coreGz > MAX_KB * 1000) {
  console.error(`engine is over budget: ${kb(coreGz)} kB > ${MAX_KB} kB`);
  process.exit(1);
}
