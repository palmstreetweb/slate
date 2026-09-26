/**
 * In-memory stand-in for the Postgres the public Functions talk to (ADR-058).
 * Emulates 016's consume_submit_rates (all or nothing, longest wait, costs,
 * bad keys refused without a write) and the forms lookups, and logs every
 * statement. Tests mock `pg` with `fnDbPool(state)`.
 */

export type FormRow = {
  id: string;
  name?: string;
  slug?: string;
  status: string;
  deleted_at: string | null;
  owner_id: string | null;
  fill_password_hash: string | null;
  published_schema: unknown;
};

export type TryResult = { ok: boolean | null; denied: string | null; retry_after_seconds: number };

export type FnDbState = {
  forms: Map<string, FormRow>;
  buckets: Map<string, { start: number; count: number }>;
  log: Array<{ sql: string; params: unknown[] }>;
  submissions: Array<{ id: string; form_id: string; answers: unknown; meta: unknown }>;
  now: number | null;
  fail: { gate?: boolean; rate?: boolean; insert?: boolean; try?: boolean; schema?: boolean };
  tryFill: ((params: unknown[]) => TryResult) | null;
};

export function newFnDbState(): FnDbState {
  return {
    forms: new Map(),
    buckets: new Map(),
    log: [],
    submissions: [],
    now: null,
    fail: {},
    tryFill: null,
  };
}

export function resetFnDb(s: FnDbState): void {
  s.forms.clear();
  s.buckets.clear();
  s.log.length = 0;
  s.submissions.length = 0;
  s.now = null;
  s.fail = {};
  s.tryFill = null;
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
      if (sql.includes('insert into public.submissions')) {
        if (s.fail.insert) throw new Error('insert failed');
        const [id, form_id, answers, meta] = params as [string, string, string, string];
        s.submissions.push({ id, form_id, answers: JSON.parse(answers), meta: JSON.parse(meta) });
        return { rows: [] };
      }
      if (sql.includes('where slug = $1')) {
        if (s.fail.gate) throw new Error('lookup failed');
        const f = [...s.forms.values()].find(
          (x) =>
            x.slug === params[0] &&
            !x.deleted_at &&
            x.status === 'published' &&
            x.published_schema != null,
        );
        if (!f) return { rows: [] };
        return {
          rows: [
            {
              id: f.id,
              name: f.name ?? 'Form',
              slug: f.slug,
              owner_id: f.owner_id,
              fill_password_hash: f.fill_password_hash,
              published_schema: f.fill_password_hash ? null : f.published_schema,
            },
          ],
        };
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
