/**
 * The storage sweep (ADR-067): deletes the objects of permanently deleted
 * responses and forms, and uploads nobody claimed within 24 h, and checks each
 * upload once (HEAD) 30 min after it was signed, so a sign that was never used
 * stops counting against its owner. The database picks and leases the batch
 * (storage_sweep_begin) and records the outcome (storage_sweep_finish); this
 * module only does the object calls in between. No DB or S3 client of its own,
 * so the tests drive it with fakes.
 *
 * Bounded: at most `batch` objects, `concurrency` calls at a time, and no new
 * call once `budgetMs` has passed. Whatever wasn't done keeps its 5-minute
 * lease and is picked up by a later sweep. Deleting an object that is already
 * gone succeeds (S3 semantics), so a retried delete is harmless.
 */

import type { Pool } from 'pg';

export type SweepObjects = {
  /** Delete one object. Resolves when it is gone (or was never there). */
  remove(key: string): Promise<void>;
  /** The object's size, or null when it isn't there. Throws on anything else (throttling, outage). */
  head(key: string): Promise<number | null>;
};

export type SweepResult = {
  picked: number;
  deleted: number;
  verified: number;
  missing: number;
  failed: number;
  /** Not attempted: the time budget ran out. */
  left: number;
};

const BEGIN_SQL = `select b.obj_key, b.obj_action, b.obj_bytes
  from public.storage_sweep_begin($1, $2) b`;
const FINISH_SQL = `select f.deleted, f.verified, f.dropped
  from public.storage_sweep_finish($1::text[], $2::jsonb, $3) f`;

export async function runSweep(
  pool: Pick<Pool, 'query'>,
  objects: SweepObjects,
  opts: { owner?: string; batch?: number; concurrency?: number; budgetMs?: number } = {},
): Promise<SweepResult> {
  const batch = Math.max(1, Math.min(opts.batch ?? 50, 200));
  const concurrency = Math.max(1, Math.min(opts.concurrency ?? 8, 16));
  const budgetMs = opts.budgetMs ?? 2000;
  const started = Date.now();

  const rows = (await pool.query(BEGIN_SQL, [batch, opts.owner ?? null])).rows as Array<{
    obj_key?: unknown;
    obj_action?: unknown;
  }>;
  const work = rows.filter(
    (r): r is { obj_key: string; obj_action: 'delete' | 'head' } =>
      typeof r.obj_key === 'string' && (r.obj_action === 'delete' || r.obj_action === 'head'),
  );
  const deleted: string[] = [];
  const heads: Array<{ key: string; bytes: number | null }> = [];
  let failed = 0;
  let next = 0;

  const worker = async () => {
    while (next < work.length && Date.now() - started < budgetMs) {
      const r = work[next++]!;
      try {
        if (r.obj_action === 'delete') {
          await objects.remove(r.obj_key);
          deleted.push(r.obj_key);
        } else {
          heads.push({ key: r.obj_key, bytes: await objects.head(r.obj_key) });
        }
      } catch {
        // Keeps its lease; a later sweep tries again.
        failed += 1;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, work.length) }, worker));

  if (work.length) {
    await pool.query(FINISH_SQL, [
      deleted,
      JSON.stringify(heads),
      // A full global batch: there is probably more, so the gate opens again in seconds.
      opts.owner === undefined && work.length >= batch,
    ]);
  }
  return {
    picked: work.length,
    deleted: deleted.length,
    verified: heads.filter((h) => h.bytes !== null).length,
    missing: heads.filter((h) => h.bytes === null).length,
    failed,
    left: work.length - deleted.length - heads.length - failed,
  };
}
