/**
 * In-memory stand-in for the Postgres the public Functions talk to (ADR-058).
 * Emulates 016's consume_submit_rates (all or nothing, longest wait, costs,
 * bad keys refused without a write), 017's lookup_public_form (distinct misses
 * per IP, over budget refuses hits too, published title), 019's close
 * settings, 020's sign-up slots (published slots from the schema, claims from
 * live responses, the slot check in insert_public_submission, signup_left)
 * and the forms lookups, and logs every statement. Tests mock `pg` with
 * `fnDbPool(state)`.
 */

import { signupSlotsOf } from '../neon/functions/submit-response/signup.js';

export type FormRow = {
  id: string;
  name?: string;
  /** 017: the name as of the last publish. */
  published_name?: string | null;
  slug?: string;
  status: string;
  deleted_at: string | null;
  owner_id: string | null;
  fill_password_hash: string | null;
  published_schema: unknown;
  /** 019: close settings. */
  closes_at?: string | null;
  max_responses?: number | null;
  closed_message?: string | null;
};

export type TryResult = { ok: boolean | null; denied: string | null; retry_after_seconds: number };

export type FnDbState = {
  forms: Map<string, FormRow>;
  buckets: Map<string, { start: number; count: number }>;
  /** 017 slug_miss_buckets: per IP key, the window start and the distinct unknown slugs. */
  misses: Map<string, { start: number; slugs: Set<string> }>;
  log: Array<{ sql: string; params: unknown[] }>;
  submissions: Array<{
    id: string;
    form_id: string;
    answers: unknown;
    meta: unknown;
    deleted_at?: string | null;
    /** 021: the client's retry key. */
    submit_key?: string | null;
  }>;
  /** 021 form_uploads, by key. */
  uploads: Map<string, UploadRow>;
  /** 021's numbers and switches, so a test can pin one of them. */
  storage: StorageKnobs;
  now: number | null;
  fail: {
    gate?: boolean;
    rate?: boolean;
    insert?: boolean;
    try?: boolean;
    schema?: boolean;
    reserve?: boolean;
  };
  tryFill: ((params: unknown[]) => TryResult) | null;
};

export type UploadRow = {
  key: string;
  owner_id: string;
  form_id: string;
  question_id: string | null;
  bytes: number;
  content_type: string;
  created_at: number;
  state: 'pending' | 'claimed' | 'doomed';
  submission_id: string | null;
  legacy: boolean;
  verified: boolean;
};

export type StorageKnobs = {
  quota: number;
  pendingMax: number;
  globalMax: number;
  ttlMs: number;
  /** storage_legacy_until() is still ahead. */
  legacyOpen: boolean;
  /** The next reserve claims the sweep gate. */
  sweepDue: boolean;
};

const defaultStorage = (): StorageKnobs => ({
  quota: 1024 ** 3,
  pendingMax: 5000,
  globalMax: 100 * 1024 ** 3,
  ttlMs: 24 * 3600 * 1000,
  legacyOpen: true,
  sweepDue: false,
});

export function newFnDbState(): FnDbState {
  return {
    forms: new Map(),
    buckets: new Map(),
    misses: new Map(),
    log: [],
    submissions: [],
    uploads: new Map(),
    storage: defaultStorage(),
    now: null,
    fail: {},
    tryFill: null,
  };
}

export function resetFnDb(s: FnDbState): void {
  s.forms.clear();
  s.buckets.clear();
  s.misses.clear();
  s.log.length = 0;
  s.submissions.length = 0;
  s.uploads.clear();
  s.storage = defaultStorage();
  s.now = null;
  s.fail = {};
  s.tryFill = null;
}

/* ---------- 021 storage quotas ---------- */

const KEY_RE =
  /^(public|draft)\/([A-Za-z0-9_-]{4,64})\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[^/]{1,120}$/;

function live(s: FnDbState, u: UploadRow): boolean {
  const now = s.now ?? Date.now();
  return u.state === 'claimed' || (u.state === 'pending' && u.created_at > now - s.storage.ttlMs);
}

/** An owner's claimed + unexpired pending bytes (021 reserve_upload / storage_quota_status). */
export function ownerUsage(s: FnDbState, owner: string): { bytes: number; pending: number } {
  let bytes = 0;
  let pending = 0;
  for (const u of s.uploads.values()) {
    if (u.owner_id !== owner || !live(s, u)) continue;
    bytes += u.bytes;
    if (u.state === 'pending') pending += 1;
  }
  return { bytes, pending };
}

/** Test helper: an upload row as storagesign would have recorded it. */
export function addUpload(s: FnDbState, row: Partial<UploadRow> & { key: string }): UploadRow {
  const m = KEY_RE.exec(row.key);
  const u: UploadRow = {
    owner_id: 'u_owner',
    form_id: m?.[2] ?? 'f_unknown',
    question_id: null,
    bytes: 1000,
    content_type: 'image/jpeg',
    created_at: s.now ?? Date.now(),
    state: 'pending',
    submission_id: null,
    legacy: false,
    verified: false,
    ...row,
  };
  s.uploads.set(u.key, u);
  return u;
}

/** The same rules as 021 reserve_upload. */
function reserveUpload(
  s: FnDbState,
  [key, owner, formId, question, bytes, type, legacy]: [
    string,
    string,
    string,
    string | null,
    number,
    string,
    boolean,
  ],
): Record<string, unknown> {
  const m = KEY_RE.exec(key);
  if (!m || !owner || m[2] !== formId || !(bytes >= 1 && bytes <= 1024 ** 3)) {
    throw Object.assign(new Error('reserve_upload: bad arguments'), { code: '22023' });
  }
  const max = s.storage.quota;
  if (legacy && !s.storage.legacyOpen) {
    return { outcome: 'legacy_closed', used_bytes: null, max_bytes: max, sweep_due: false };
  }
  const due = s.storage.sweepDue;
  s.storage.sweepDue = false;
  const { bytes: used, pending } = ownerUsage(s, owner);
  const global = [...s.uploads.values()].reduce((n, u) => n + u.bytes, 0);
  const refuse = (outcome: string) => ({
    outcome,
    used_bytes: String(used),
    max_bytes: String(max),
    sweep_due: due,
  });
  if (used + bytes > max) return refuse('quota');
  if (pending >= s.storage.pendingMax) return refuse('pending');
  if (global + bytes > s.storage.globalMax) return refuse('global');
  if (s.uploads.has(key)) return refuse('exists');
  addUpload(s, {
    key,
    owner_id: owner,
    form_id: formId,
    question_id: question || null,
    bytes,
    content_type: type,
    legacy,
  });
  return {
    outcome: 'ok',
    used_bytes: String(used + bytes),
    max_bytes: String(max),
    sweep_due: due,
  };
}

/** 021 upload_keys_of: every storage ref anywhere in an answers document. */
export function uploadKeysOf(answers: unknown): string[] {
  const out = new Set<string>();
  const walk = (v: unknown) => {
    if (typeof v === 'string') {
      if (v.startsWith('slate-file://storage:')) out.add(v.slice(21));
    } else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(answers);
  return [...out];
}

/** 021 submissions_claim_uploads, run after every stored response. */
function claimUploads(s: FnDbState, sub: { id: string; form_id: string; answers: unknown }) {
  for (const key of uploadKeysOf(sub.answers)) {
    const u = s.uploads.get(key);
    if (u && u.form_id === sub.form_id && u.state === 'pending' && live(s, u)) {
      u.state = 'claimed';
      u.submission_id = sub.id;
    }
  }
}

/** The same rules as 021's 6-argument insert_public_submission. */
function insertWithFiles(
  s: FnDbState,
  [id, formId, answers, meta, files, submitKey]: [
    string,
    string,
    string,
    string,
    string,
    string | null,
  ],
): Record<string, unknown> {
  const none = { closed_message: null, full_slots: null, slots_left: null, bad_questions: null };
  if (submitKey) {
    const done = s.submissions.find((x) => x.form_id === formId && x.submit_key === submitKey);
    if (done) return { outcome: 'ok', ...none, stored_id: done.id };
  }
  const want = JSON.parse(files) as Array<{ key?: string; question?: string }>;
  const owner = s.forms.get(formId)?.owner_id ?? null;
  const uses = new Map<string, Set<string | undefined>>();
  for (const w of want) {
    if (!uses.has(w.key ?? '')) uses.set(w.key ?? '', new Set());
    uses.get(w.key ?? '')!.add(w.question);
  }
  const bad = new Set<string>();
  for (const w of want) {
    const u = w.key ? s.uploads.get(w.key) : undefined;
    const ok =
      !!w.key &&
      !!w.question &&
      uses.get(w.key)!.size === 1 &&
      (u
        ? u.form_id === formId &&
          (u.question_id === null || u.question_id === w.question) &&
          ((u.state === 'pending' && live(s, u)) ||
            (u.state === 'claimed' && u.submission_id === id))
        : s.storage.legacyOpen && !!owner && KEY_RE.exec(w.key)?.[2] === formId);
    if (!ok) bad.add(w.question ?? '');
  }
  if (bad.size) return { outcome: 'bad_files', ...none, bad_questions: [...bad], stored_id: null };
  const r = insertPublicSubmission(s, [id, formId, answers, meta]);
  if (r.outcome !== 'ok') return { ...none, ...r, bad_questions: null, stored_id: null };
  const sub = s.submissions.find((x) => x.id === id)!;
  sub.submit_key = submitKey;
  claimUploads(s, sub);
  for (const w of want) {
    if (w.key && !s.uploads.has(w.key)) {
      addUpload(s, {
        key: w.key,
        owner_id: owner!,
        form_id: formId,
        bytes: 0,
        state: 'claimed',
        submission_id: id,
        legacy: true,
      });
    }
  }
  return { outcome: 'ok', ...none, stored_id: id };
}

/** 021 storage_sweep_begin, without leases: what a sweep would pick now. */
function sweepBegin(s: FnDbState, [limit, owner]: [number, string | null]) {
  const now = s.now ?? Date.now();
  const rows = [...s.uploads.values()];
  const doomed = rows.filter((u) => u.state === 'doomed' && (!owner || u.owner_id === owner));
  const expired = owner
    ? []
    : rows.filter((u) => u.state === 'pending' && u.created_at <= now - s.storage.ttlMs);
  const heads = owner
    ? []
    : rows.filter(
        (u) =>
          !u.verified &&
          u.state !== 'doomed' &&
          u.created_at <= now - 30 * 60 * 1000 &&
          !expired.includes(u),
      );
  return [
    ...doomed.map((u) => ({ obj_key: u.key, obj_action: 'delete', obj_bytes: String(u.bytes) })),
    ...expired.map((u) => ({ obj_key: u.key, obj_action: 'delete', obj_bytes: String(u.bytes) })),
    ...heads.map((u) => ({ obj_key: u.key, obj_action: 'head', obj_bytes: String(u.bytes) })),
  ].slice(0, limit);
}

/** 021 storage_sweep_finish. */
function sweepFinish(s: FnDbState, [deleted, heads]: [string[], string, boolean]) {
  let d = 0;
  let v = 0;
  let dropped = 0;
  for (const key of deleted) {
    const u = s.uploads.get(key);
    if (u && (u.state === 'doomed' || (u.state === 'pending' && !live(s, u)))) {
      s.uploads.delete(key);
      d += 1;
    }
  }
  for (const h of JSON.parse(heads) as Array<{ key: string; bytes: number | null }>) {
    const u = s.uploads.get(h.key);
    if (!u) continue;
    if (h.bytes === null && u.state === 'pending') {
      s.uploads.delete(h.key);
      dropped += 1;
    } else if (u.state !== 'doomed') {
      u.verified = true;
      u.bytes = h.bytes ?? 0;
      v += 1;
    }
  }
  return { deleted: d, verified: v, dropped };
}

/** The same rules as 016 consume_submit_rates, over the in-memory buckets. */
export function consumeRates(
  s: FnDbState,
  keys: string[],
  wins: number[],
  maxes: number[],
  costs: number[] | null,
): { allowed: boolean; denied_index: number; retry_after_seconds: number } {
  const n = keys.length;
  if (n < 1 || n > 8 || wins.length !== n || maxes.length !== n || (costs && costs.length !== n)) {
    throw Object.assign(new Error('consume_submit_rates: 1 to 8 buckets'), { code: '22023' });
  }
  for (const w of wins) {
    if (!Number.isInteger(w) || w < 1 || w > 86400) {
      throw Object.assign(new Error('consume_submit_rates: window'), { code: '22023' });
    }
  }
  const now = s.now ?? Date.now();
  let worst = 0;
  let worstRetry = 0;
  for (let i = 0; i < n; i++) {
    const cost = costs?.[i] ?? 1;
    const key = keys[i]!;
    const max = maxes[i]!;
    let retry = 0;
    const bytes = Buffer.byteLength(key ?? '', 'utf8');
    if (bytes < 1 || bytes > 256 || !(max >= 1) || cost < 1 || cost > max) {
      retry = wins[i]!;
    } else {
      const b = s.buckets.get(key);
      if (b && b.start > now - wins[i]! * 1000 && b.count + cost > max) {
        retry = Math.max(1, wins[i]! - Math.floor((now - b.start) / 1000));
      }
    }
    if (retry > worstRetry) {
      worst = i + 1;
      worstRetry = retry;
    }
  }
  if (worst > 0) return { allowed: false, denied_index: worst, retry_after_seconds: worstRetry };
  for (let i = 0; i < n; i++) {
    const cost = costs?.[i] ?? 1;
    const key = keys[i]!;
    const b = s.buckets.get(key);
    if (!b || b.start <= now - wins[i]! * 1000) s.buckets.set(key, { start: now, count: cost });
    else b.count += cost;
  }
  return { allowed: true, denied_index: 0, retry_after_seconds: 0 };
}

/** The same rules as 017 lookup_public_form. */
export function lookupPublicForm(
  s: FnDbState,
  slug: string,
  ip: string,
  missMax: number,
  windowSec: number,
): Record<string, unknown> {
  if (!slug || !ip || !(missMax >= 1) || !(windowSec >= 1 && windowSec <= 86400)) {
    throw Object.assign(new Error('lookup_public_form: bad arguments'), { code: '22023' });
  }
  const now = s.now ?? Date.now();
  const empty = {
    id: null,
    name: null,
    slug: null,
    owner_id: null,
    fill_password_hash: null,
    published_schema: null,
  };
  const b = s.misses.get(ip);
  const live = !!b && b.start > now - windowSec * 1000;
  if (live && b!.slugs.size >= missMax) {
    return {
      outcome: 'denied',
      retry_after_seconds: Math.max(1, windowSec - Math.floor((now - b!.start) / 1000)),
      ...empty,
    };
  }
  const f = [...s.forms.values()].find(
    (x) =>
      x.slug === slug && !x.deleted_at && x.status === 'published' && x.published_schema != null,
  );
  if (f) {
    const brand = (f.published_schema as { brand?: { name?: unknown } } | null)?.brand?.name;
    return {
      outcome: 'ok',
      retry_after_seconds: 0,
      id: f.id,
      name: f.published_name ?? (typeof brand === 'string' ? brand : 'Form'),
      slug: f.slug,
      owner_id: f.owner_id,
      fill_password_hash: f.fill_password_hash,
      published_schema: f.fill_password_hash ? null : f.published_schema,
      // 019's join, as the Function's LOOKUP_SQL computes it.
      ...closeColumns(s, f),
    };
  }
  if (!live) s.misses.set(ip, { start: now, slugs: new Set([slug]) });
  else if (b!.slugs.size < missMax) b!.slugs.add(slug);
  return { outcome: 'miss', retry_after_seconds: 0, ...empty };
}

/** 020 forms.signup_slots: { questionId: { slot: capacity } } from the published schema, or null. */
export function signupDef(f: FormRow): Record<string, Record<string, number>> | null {
  const qs = (f.published_schema as { questions?: unknown } | null)?.questions;
  const out: Record<string, Record<string, number>> = {};
  // The last question with each id decides, as in the Function's map.
  for (const q of Array.isArray(qs) ? qs : []) {
    const r = q as Record<string, unknown>;
    if (!r || typeof r !== 'object' || typeof r.id !== 'string') continue;
    const caps =
      r.type === 'signup_slots'
        ? Object.fromEntries(signupSlotsOf(r).map((x) => [x.value, x.capacity]))
        : {};
    if (Object.keys(caps).length) out[r.id] = caps;
    else delete out[r.id];
  }
  return Object.keys(out).length ? out : null;
}

/** 020 claims: spots taken per question and slot by live responses. */
export function slotTaken(s: FnDbState, f: FormRow, qid: string, slot: string): number {
  const def = signupDef(f);
  if (!def?.[qid] || !(slot in def[qid]!)) return 0;
  return s.submissions.filter((x) => {
    if (x.form_id !== f.id || x.deleted_at) return false;
    const a = (x.answers as Record<string, { slots?: unknown }>)[qid];
    return Array.isArray(a?.slots) && a!.slots.includes(slot);
  }).length;
}

/** 020 signup_left. */
export function slotsLeft(s: FnDbState, f: FormRow): Record<string, Record<string, number>> | null {
  const def = signupDef(f);
  if (!def) return null;
  const out: Record<string, Record<string, number>> = {};
  for (const [q, caps] of Object.entries(def)) {
    out[q] = Object.fromEntries(
      Object.entries(caps).map(([slot, cap]) => [
        slot,
        Math.max(0, cap - slotTaken(s, f, q, slot)),
      ]),
    );
  }
  return out;
}

/** Live (not trashed) responses stored for a form. */
export function liveCount(s: FnDbState, formId: string): number {
  return s.submissions.filter((x) => x.form_id === formId && !x.deleted_at).length;
}

function closedByDate(s: FnDbState, f: FormRow): boolean {
  return f.closes_at != null && Date.parse(f.closes_at) <= (s.now ?? Date.now());
}

function closeColumns(s: FnDbState, f: FormRow) {
  return {
    closed_by_date: closedByDate(s, f),
    closed_full: f.max_responses != null ? liveCount(s, f.id) >= f.max_responses : null,
    closed_message: f.closed_message ?? null,
    slots_left: slotsLeft(s, f),
  };
}

/** The same rules as 020 insert_public_submission (019's, plus the slot check). */
function insertPublicSubmission(
  s: FnDbState,
  [id, formId, answers, meta]: [string, string, string, string],
): { outcome: string; closed_message: string | null; full_slots?: unknown; slots_left?: unknown } {
  const f = s.forms.get(formId);
  if (!f || f.deleted_at || f.status !== 'published')
    return { outcome: 'gone', closed_message: null };
  if (closedByDate(s, f)) return { outcome: 'closed', closed_message: f.closed_message ?? null };
  if (f.max_responses != null && liveCount(s, formId) >= f.max_responses) {
    return { outcome: 'full', closed_message: f.closed_message ?? null };
  }
  const parsed = JSON.parse(answers) as Record<string, { slots?: unknown }>;
  const def = signupDef(f);
  if (def) {
    const full: Array<{ question: string; slot: string }> = [];
    for (const [q, caps] of Object.entries(def).sort(([a], [b]) => (a < b ? -1 : 1))) {
      const picks = parsed[q]?.slots;
      for (const slot of Array.isArray(picks) ? picks : []) {
        if (typeof slot === 'string' && slot in caps && slotTaken(s, f, q, slot) >= caps[slot]!) {
          full.push({ question: q, slot });
        }
      }
    }
    if (full.length) {
      return {
        outcome: 'slot_full',
        closed_message: null,
        full_slots: full,
        slots_left: slotsLeft(s, f),
      };
    }
  }
  s.submissions.push({ id, form_id: formId, answers: parsed, meta: JSON.parse(meta) });
  return { outcome: 'ok', closed_message: null };
}

export function fnDbPool(s: FnDbState) {
  return class {
    async query(sql: string, params: unknown[] = []) {
      s.log.push({ sql, params });
      if (sql.includes('consume_submit_rates')) {
        if (s.fail.rate) throw new Error('rate table down');
        const [keys, wins, maxes, costs] = params as [string[], number[], number[], number[]];
        const r = consumeRates(s, keys, wins, maxes, costs);
        const formId = params[4] as string | undefined;
        const row: Record<string, unknown> = { ...r };
        if (formId !== undefined) {
          row.published_schema = r.allowed ? (s.forms.get(formId)?.published_schema ?? null) : null;
        }
        return { rows: [row] };
      }
      if (sql.includes('try_fill_password')) {
        if (s.fail.try) throw new Error('try failed');
        const t = s.tryFill
          ? s.tryFill(params)
          : { ok: false, denied: null, retry_after_seconds: 0 };
        const f = s.forms.get(params[4] as string);
        return { rows: [{ ...t, published_schema: t.ok ? (f?.published_schema ?? null) : null }] };
      }
      if (sql.includes('reserve_upload')) {
        if (s.fail.reserve) throw new Error('reserve failed');
        return { rows: [reserveUpload(s, params as Parameters<typeof reserveUpload>[1])] };
      }
      if (sql.includes('storage_sweep_begin')) {
        return { rows: sweepBegin(s, params as [number, string | null]) };
      }
      if (sql.includes('storage_sweep_finish')) {
        return { rows: [sweepFinish(s, params as [string[], string, boolean])] };
      }
      if (/^\s*delete from public\.form_uploads/.test(sql)) {
        const u = s.uploads.get(params[0] as string);
        if (u?.state === 'pending') s.uploads.delete(u.key);
        return { rows: [] };
      }
      if (sql.includes('insert_public_submission')) {
        if (s.fail.insert) throw new Error('insert failed');
        if (params.length === 6) {
          return { rows: [insertWithFiles(s, params as Parameters<typeof insertWithFiles>[1])] };
        }
        return { rows: [insertPublicSubmission(s, params as [string, string, string, string])] };
      }
      if (sql.includes('lookup_public_form')) {
        if (s.fail.gate) throw new Error('lookup failed');
        return { rows: [lookupPublicForm(s, ...(params as [string, string, number, number]))] };
      }
      if (/^\s*select published_schema from public\.forms/.test(sql)) {
        if (s.fail.schema) throw new Error('schema read failed');
        const f = s.forms.get(params[0] as string);
        return { rows: f ? [{ published_schema: f.published_schema }] : [] };
      }
      if (sql.includes('from public.forms') && sql.includes('has_schema')) {
        if (s.fail.gate) throw new Error('gate failed');
        const f = s.forms.get(params[0] as string);
        if (!f) return { rows: [] };
        return {
          rows: [
            {
              id: f.id,
              status: f.status,
              deleted_at: f.deleted_at,
              owner_id: f.owner_id,
              fill_password_hash: f.fill_password_hash,
              has_schema: f.published_schema != null,
              closed: closedByDate(s, f),
              closed_message: f.closed_message ?? null,
            },
          ],
        };
      }
      throw new Error(`fnDb: unexpected SQL ${sql}`);
    }
  };
}

/** Keys passed to consume_submit_rates, in call order. */
export function rateKeys(s: FnDbState): string[] {
  return s.log
    .filter((q) => q.sql.includes('consume_submit_rates'))
    .flatMap((q) => q.params[0] as string[]);
}

export const rateCalls = (s: FnDbState) =>
  s.log.filter((q) => q.sql.includes('consume_submit_rates'));
