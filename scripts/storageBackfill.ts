/**
 * What the 021 backfill registers (ADR-067). planBackfill is pure: the bucket
 * listing, the rows already in form_uploads, the forms and the storage refs
 * stored responses hold go in; the rows to insert and a summary come out.
 * Below it, the read-only listing and the one-transaction write, shared by
 * scripts/backfill-storage-uploads.ts and the branch harness.
 *
 * Rules:
 *   - An object already in form_uploads is left alone, except a row whose
 *     bytes are unknown (0: an old page's upload claimed without a row during
 *     the grace), which gets the object's real size.
 *   - Referenced by a stored response of the same form: claimed by the
 *     earliest such response, at its real size. It counts toward the owner's
 *     quota and keeps displaying.
 *   - Not referenced (an orphan: a re-record, a retake, an abandoned fill, a
 *     test upload, or a file of a form deleted for good): with orphans
 *     'register', pending from the backfill's own time, so a respondent still
 *     mid-fill at the deploy can submit it, and the sweep deletes the rest
 *     24 h later; with 'skip', not registered at all (never counted, never
 *     deleted, invisible as today).
 *   - A key that isn't a shape the app ever wrote is skipped and counted.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import type pg from 'pg';

export const KEY_RE =
  /^(public|draft)\/([A-Za-z0-9_-]{4,64})\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[^/]{1,120}$/;

/** The owner id for objects whose form no longer exists (the quota of nobody real). */
export const NO_OWNER = '(deleted form)';

export type BucketObject = { key: string; size: number; lastModified?: string };
export type StoredRef = { submissionId: string; formId: string; key: string; receivedAt: string };
export type ExistingRow = { key: string; bytes: number };

export type BackfillRow = {
  key: string;
  owner_id: string;
  form_id: string;
  scope: 'public' | 'draft';
  bytes: number;
  state: 'pending' | 'claimed';
  submission_id: string | null;
  created_at: string | null;
};

export type BackfillPlan = {
  insert: BackfillRow[];
  /** Rows with unknown bytes and the object's real size. */
  sizes: Array<{ key: string; bytes: number }>;
  summary: {
    objects: number;
    bytes: number;
    alreadyRegistered: number;
    claimed: { n: number; bytes: number };
    orphans: { n: number; bytes: number; ofDeletedForms: number };
    orphansAction: 'register' | 'skip';
    skippedOddKeys: number;
    /** Refs in stored responses whose object isn't in the bucket (they already show as missing). */
    deadRefs: number;
    byOwner: Record<string, { claimed: number; pending: number }>;
  };
};

export function planBackfill(input: {
  objects: BucketObject[];
  existing: ExistingRow[];
  forms: Map<string, { ownerId: string | null }>;
  refs: StoredRef[];
  orphans: 'register' | 'skip';
}): BackfillPlan {
  const existing = new Map(input.existing.map((r) => [r.key, r.bytes]));
  const inBucket = new Set(input.objects.map((o) => o.key));
  // The earliest response of the key's own form that names it.
  const claimBy = new Map<string, StoredRef>();
  for (const r of [...input.refs].sort((a, b) => (a.receivedAt < b.receivedAt ? -1 : 1))) {
    const m = KEY_RE.exec(r.key);
    if (!m || m[2] !== r.formId || claimBy.has(r.key)) continue;
    claimBy.set(r.key, r);
  }

  const plan: BackfillPlan = {
    insert: [],
    sizes: [],
    summary: {
      objects: input.objects.length,
      bytes: 0,
      alreadyRegistered: 0,
      claimed: { n: 0, bytes: 0 },
      orphans: { n: 0, bytes: 0, ofDeletedForms: 0 },
      orphansAction: input.orphans,
      skippedOddKeys: 0,
      deadRefs: new Set(input.refs.map((r) => r.key).filter((k) => !inBucket.has(k))).size,
      byOwner: {},
    },
  };
  const s = plan.summary;
  const tally = (owner: string, kind: 'claimed' | 'pending', bytes: number) => {
    s.byOwner[owner] ??= { claimed: 0, pending: 0 };
    s.byOwner[owner]![kind] += bytes;
  };

  for (const o of input.objects) {
    const size = Math.max(0, Math.min(Math.floor(Number(o.size) || 0), 1024 ** 3));
    s.bytes += size;
    if (existing.has(o.key)) {
      s.alreadyRegistered += 1;
      if (existing.get(o.key) === 0 && size > 0) plan.sizes.push({ key: o.key, bytes: size });
      continue;
    }
    const m = KEY_RE.exec(o.key);
    if (!m) {
      s.skippedOddKeys += 1;
      continue;
    }
    const scope = m[1] as 'public' | 'draft';
    const formId = m[2]!;
    const form = input.forms.get(formId);
    const owner = form?.ownerId || NO_OWNER;
    const ref = claimBy.get(o.key);
    if (ref && form) {
      s.claimed.n += 1;
      s.claimed.bytes += size;
      tally(owner, 'claimed', size);
      plan.insert.push({
        key: o.key,
        owner_id: owner,
        form_id: formId,
        scope,
        bytes: size,
        state: 'claimed',
        submission_id: ref.submissionId,
        created_at: o.lastModified ?? null,
      });
      continue;
    }
    s.orphans.n += 1;
    s.orphans.bytes += size;
    if (!form) s.orphans.ofDeletedForms += 1;
    if (input.orphans === 'skip') continue;
    tally(owner, 'pending', size);
    plan.insert.push({
      key: o.key,
      owner_id: owner,
      form_id: formId,
      scope,
      bytes: size,
      state: 'pending',
      submission_id: null,
      // The backfill's own time: 24 h before the sweep may delete it.
      created_at: null,
    });
  }
  return plan;
}

/* ---------- listing and the database (the CLI and the harness) ---------- */

const BUCKET = 'form-uploads';

type Listing = { objects?: unknown; is_truncated?: unknown; next_cursor?: unknown };

function parseObjects(listing: Listing): BucketObject[] {
  const raw = Array.isArray(listing.objects) ? listing.objects : [];
  return raw
    .map((o) => o as { key?: unknown; size?: unknown; last_modified?: unknown })
    .filter(
      (o): o is { key: string; size: unknown; last_modified?: unknown } =>
        typeof o.key === 'string',
    )
    .map((o) => ({
      key: o.key,
      size: Number(o.size) || 0,
      lastModified: typeof o.last_modified === 'string' ? o.last_modified : undefined,
    }));
}

/** Every object in the bucket, read-only, page by page. */
export function listBucket(): BucketObject[] {
  const file = process.env.LISTING_FILE;
  if (file) return parseObjects(JSON.parse(readFileSync(file, 'utf8')) as Listing);
  const project = process.env.NEON_PROJECT_ID;
  const branch = process.env.NEON_BRANCH;
  if (!project || !branch) throw new Error('Set NEON_PROJECT_ID and NEON_BRANCH, or LISTING_FILE.');
  const out: BucketObject[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 1000; page++) {
    const args = [
      '-y',
      'neonctl@latest',
      'buckets',
      'object',
      'list',
      BUCKET,
      '--recursive',
      '--limit',
      '1000',
      '--output',
      'json',
      '--project-id',
      project,
      '--branch',
      branch,
      ...(cursor ? ['--cursor', cursor] : []),
    ];
    const listing = JSON.parse(
      execFileSync('npx', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }),
    ) as Listing;
    out.push(...parseObjects(listing));
    if (listing.is_truncated !== true || typeof listing.next_cursor !== 'string') return out;
    cursor = listing.next_cursor;
  }
  throw new Error('Listing did not end after 1,000 pages.');
}

export async function loadDbState(db: pg.Pool) {
  const existing = (
    await db.query<{ key: string; bytes: string }>('select key, bytes from public.form_uploads')
  ).rows.map((r) => ({ key: r.key, bytes: Number(r.bytes) }));
  const forms = new Map(
    (
      await db.query<{ id: string; owner_id: string | null }>(
        'select id, owner_id from public.forms',
      )
    ).rows.map((r) => [r.id, { ownerId: r.owner_id }] as const),
  );
  const refs: StoredRef[] = (
    await db.query<{ submission_id: string; form_id: string; key: string; received_at: Date }>(
      `select s.id as submission_id, s.form_id, k.key, s.received_at
         from public.submissions s
         cross join lateral public.upload_keys_of(s.answers) k(key)`,
    )
  ).rows.map((r) => ({
    submissionId: r.submission_id,
    formId: r.form_id,
    key: r.key,
    receivedAt: new Date(r.received_at).toISOString(),
  }));
  return { existing, forms, refs };
}

/** Writes the plan in one transaction. Returns the rows actually added. */
export async function applyBackfill(db: pg.Pool, plan: BackfillPlan): Promise<number> {
  const c = await db.connect();
  try {
    await c.query('begin');
    await c.query(`set local lock_timeout = '5s'`);
    let added = 0;
    for (let i = 0; i < plan.insert.length; i += 500) {
      const batch = plan.insert.slice(i, i + 500);
      const r = await c.query(
        `insert into public.form_uploads
           (key, owner_id, form_id, question_id, scope, bytes, content_type, created_at, state,
            submission_id, claimed_at, verified_at, legacy)
         select b.key, b.owner_id, b.form_id, null, b.scope, b.bytes, 'application/octet-stream',
                coalesce(b.created_at, now()), b.state, b.submission_id,
                case when b.state = 'claimed' then now() end, now(), true
           from jsonb_to_recordset($1::jsonb) as b(
             key text, owner_id text, form_id text, scope text, bytes bigint,
             created_at timestamptz, state text, submission_id text)
         on conflict (key) do nothing`,
        [JSON.stringify(batch)],
      );
      added += r.rowCount ?? 0;
    }
    if (plan.sizes.length) {
      await c.query(
        `update public.form_uploads u
            set bytes = s.bytes, verified_at = now()
           from jsonb_to_recordset($1::jsonb) as s(key text, bytes bigint)
          where u.key = s.key and u.bytes = 0`,
        [JSON.stringify(plan.sizes)],
      );
    }
    await c.query('commit');
    return added;
  } catch (err) {
    await c.query('rollback').catch(() => {});
    throw err;
  } finally {
    c.release();
  }
}

function mb(n: number): string {
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function describePlan(plan: BackfillPlan): string {
  const s = plan.summary;
  const owners = Object.entries(s.byOwner)
    .map(
      ([o, v], i) =>
        `  owner #${i + 1}${o.startsWith('(') ? ` ${o}` : ''}: claimed ${mb(v.claimed)}, pending ${mb(v.pending)}`,
    )
    .join('\n');
  return [
    `bucket: ${s.objects} objects, ${mb(s.bytes)}`,
    `already registered: ${s.alreadyRegistered} (sizes to fill in: ${plan.sizes.length})`,
    `claimed by a stored response: ${s.claimed.n}, ${mb(s.claimed.bytes)}`,
    `orphans (no response names them): ${s.orphans.n}, ${mb(s.orphans.bytes)}, of forms deleted for good: ${s.orphans.ofDeletedForms} → ${
      s.orphansAction === 'register'
        ? 'registered pending now; the sweep deletes them 24 h after this run unless a submit claims them'
        : 'skipped: not registered, never counted, never deleted'
    }`,
    `keys in no shape the app writes (skipped): ${s.skippedOddKeys}`,
    `refs in responses with no object (already missing): ${s.deadRefs}`,
    `rows to add: ${plan.insert.length}`,
    owners,
  ].join('\n');
}
