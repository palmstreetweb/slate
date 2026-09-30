/**
 * One-off backfill for migration 021 (ADR-067): registers every object already
 * in the `form-uploads` bucket in public.form_uploads, so existing files count
 * toward their owner's quota, keep displaying, and are deleted with their
 * response. Run once at deploy time, after 021 and at least 10 minutes after
 * the new storagesign is live (the old one's last presigned PUTs expire in 10),
 * and before the new submitresponse. Safe to run again: it only adds what is
 * missing (and fills in unknown sizes).
 *
 * The bucket is only LISTED, never written: `neonctl buckets object list`, so
 * no Object Storage credentials are needed. The database is written only with
 * --apply, in one transaction; without it this prints the plan and changes
 * nothing.
 *
 *   DATABASE_URL=<neondb_owner connection string> \
 *   CONFIRM_HOST=<a substring of that host, e.g. ep-misty-snow-ax9wxjvf> \
 *   NEON_PROJECT_ID=odd-voice-53972178 NEON_BRANCH=production \
 *   npx vite-node scripts/backfill-storage-uploads.ts [--apply] [--orphans=register|skip]
 *
 * Or LISTING_FILE=<json from `neonctl buckets object list form-uploads --recursive -o json`>
 * instead of NEON_PROJECT_ID / NEON_BRANCH. Prints counts and bytes only: no keys,
 * no file names, never the connection string. The rules are in storageBackfill.ts.
 */

import pg from 'pg';
import {
  applyBackfill,
  describePlan,
  listBucket,
  loadDbState,
  planBackfill,
} from './storageBackfill.js';

async function main() {
  const url = process.env.DATABASE_URL;
  const confirm = process.env.CONFIRM_HOST;
  if (!url) throw new Error('DATABASE_URL is required.');
  const host = new URL(url).hostname;
  if (!confirm || !host.includes(confirm)) {
    throw new Error('Set CONFIRM_HOST to a substring of the database host you mean to change.');
  }
  const orphansArg = process.argv.find((a) => a.startsWith('--orphans='))?.slice(10) ?? 'register';
  if (orphansArg !== 'register' && orphansArg !== 'skip') {
    throw new Error('--orphans=register|skip');
  }
  const apply = process.argv.includes('--apply');

  const db = new pg.Pool({ connectionString: url, max: 2 });
  try {
    const has = await db.query(`select to_regclass('public.form_uploads') as t`);
    if (!has.rows[0]?.t) throw new Error('Migration 021 is not applied on this database.');
    const objects = listBucket();
    const plan = planBackfill({ objects, ...(await loadDbState(db)), orphans: orphansArg });
    console.log(describePlan(plan));
    if (!apply) {
      console.log('\nDry run: nothing written. Re-run with --apply to register these rows.');
      return;
    }
    const added = await applyBackfill(db, plan);
    console.log(`\nApplied: ${added} rows added, ${plan.sizes.length} sizes filled in.`);
  } finally {
    await db.end();
  }
}

main().catch((err: unknown) => {
  console.error('[backfill] failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
