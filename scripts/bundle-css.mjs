#!/usr/bin/env node
/**
 * Concatenate src/styles/*.css into a single dist/styles.css in the correct
 * order. We do this instead of letting tsup copy individual hashed files
 * because the public export is `@palmstreetweb/slate/styles.css` — one
 * import, not five.
 */

import { readFile, writeFile, readdir, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_STYLES = join(__dirname, '..', 'src', 'styles');
const DIST = join(__dirname, '..', 'dist');

// Concatenation order matters — tokens first so later rules can reference them.
const ORDER = ['tokens.css', 'base.css', 'animations.css', 'toggle.css', 'questions.css'];

async function main() {
  const parts = [];
  parts.push('/* @palmstreetweb/slate — bundled stylesheet */\n');
  for (const file of ORDER) {
    const path = join(SRC_STYLES, file);
    const content = await readFile(path, 'utf8');
    parts.push(`/* ===== ${file} ===== */\n${content.trimEnd()}\n`);
  }
  await writeFile(join(DIST, 'styles.css'), parts.join('\n'), 'utf8');

  // Remove the per-file hashed copies tsup wrote so consumers see only the
  // bundled file. (Tsup's copy loader emits them; we don't ship them.)
  const all = await readdir(DIST);
  for (const f of all) {
    if (f.endsWith('.css') && f !== 'styles.css') {
      await unlink(join(DIST, f));
    }
  }
}

await main();
console.log('[bundle-css] wrote dist/styles.css');
