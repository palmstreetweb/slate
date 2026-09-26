/**
 * Neon Function: public form submit (ADR-029, limits ADR-058)
 * + password-locked form unlock (ADR-043, `{ op: 'unlock' }` on the same URL).
 * Deploy: neon functions deploy submitresponse --src neon/functions/submit-response
 * DATABASE_URL is injected by Neon. Needs migration 016 (consume_submit_rates, try_fill_password).
 *
 * Order (ADR-058): shape checks, honeypot, form lookup and lock, then ONE rate
 * statement that charges every bucket or none and reads the schema only when
 * the charge went through. Junk ids, drafts and locked-without-token requests
 * cost one small read and write nothing.
 */

import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { bodyLimit } from 'hono/body-limit';
import { Pool } from 'pg';
import { fillUnlockToken, isValidUnlockToken } from './fillLock.js';
import { clientIp } from './requestIp.js';
import { clampText, clampValue, isSafeKey, keepFileRefs } from './answerShape.js';
import { aboutMinutes, charge, intEnv, ipMax, ownerKey, units, type Bucket } from './rateGate.js';

/** Hard caps on what one submission may carry (ADR-046, ADR-058). */
const MAX_BODY_BYTES = 64 * 1024;
const MAX_ANSWER_KEYS = 200;
const MAX_VISITED = 500;
const MAX_HIDDEN_KEYS = 50;
/** Submits are charged by size: 1 unit per 4 KiB of body, at least 1. */
const SUBMIT_UNIT = 4096;
/** The storage-sign path class: every id the app mints (f_ + 12 chars) fits. */
const FORM_ID_RE = /^[A-Za-z0-9_-]{4,64}$/;
/** 015 forms_slug_format. */
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** ADR-058 defaults. Env overrides must be integers in range; anything else keeps the default. */
export const LIMITS = {
  ipOwner: intEnv('SUBMIT_RATE_IP_OWNER_MAX', 2000), // 4 KiB units / h, IP + form owner
  ip: intEnv('SUBMIT_RATE_IP_MAX', 10000), // 4 KiB units / h, IP
  pw: intEnv('UNLOCK_RATE_PW_MAX', 2000), // password attempts / 10 min, IP + owner
  pwIp: intEnv('UNLOCK_RATE_PW_IP_MAX', 10000), // password attempts / 10 min, IP
  failIp: intEnv('UNLOCK_RATE_FAIL_IP_MAX', 500), // misses / h, IP, all forms
  failForm: intEnv('UNLOCK_RATE_FAIL_FORM_MAX', 300), // misses / h, form, all IPs
};
console.info('[submitresponse] limits (ADR-058)', LIMITS);

const TOO_LONG =
  'Your answers are too long to send. Please shorten the longest answer and try again.';

const isObj = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

type SubmitMeta = {
  startedAt: string;
  completedAt: string;
  durationMs: number;
  questionsVisited: string[];
  hiddenFields: Record<string, unknown>;
  score?: number;
};

type GateRow = {
  id: string;
  status: string;
  deleted_at: string | null;
  owner_id: string | null;
  fill_password_hash: string | null;
  has_schema: boolean;
};

type UnlockRow = {
  id: string;
  name: string;
  slug: string;
  owner_id: string | null;
  fill_password_hash: string | null;
  published_schema: unknown;
};

type TryRow = {
  ok: boolean | null;
  denied: string | null;
  retry_after_seconds: number;
  published_schema: unknown;
};

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
});

const app = new Hono();
// One preflight per 2 h instead of one per POST; the 429 wait is readable.
app.use('*', cors({ origin: '*', exposeHeaders: ['Retry-After'], maxAge: 7200 }));

app.options('*', (c) => c.body(null, 204));

/**
 * Keep only answers whose key is a question in the published schema, each
 * clamped. File questions keep only this form's own storage refs (ADR-058).
 * Stops a respondent (or a bot with a form id) from storing arbitrary blobs
 * in someone else's table.
 */
function sanitizeAnswers(
  raw: Record<string, unknown>,
  schema: unknown,
  formId: string,
): Record<string, unknown> {
  const byId = new Map<string, Record<string, unknown>>();
  const questions = (schema as { questions?: unknown } | null)?.questions;
  if (Array.isArray(questions)) {
    for (const q of questions) {
      if (isObj(q) && typeof q.id === 'string') byId.set(q.id, q);
    }
  }
  const out: Record<string, unknown> = {};
  let n = 0;
  for (const [k, v] of Object.entries(raw)) {
    const q = byId.get(k);
    if (!q) continue;
    if (n >= MAX_ANSWER_KEYS) break;
    const c = q.type === 'file_upload' ? keepFileRefs(v, formId, q) : clampValue(v);
    if (c === undefined) continue;
    out[k] = c;
    n += 1;
  }
  return out;
}

function sanitizeMeta(raw: Record<string, unknown>): SubmitMeta {
  const str = (v: unknown) => (typeof v === 'string' ? v.slice(0, 64) : '');
  const visited = Array.isArray(raw.questionsVisited)
    ? raw.questionsVisited
        .filter((x): x is string => typeof x === 'string')
        .slice(0, MAX_VISITED)
        .map((x) => x.slice(0, 64))
    : [];
  const hidden: Record<string, unknown> = {};
  if (isObj(raw.hiddenFields)) {
    for (const [k, v] of Object.entries(raw.hiddenFields).slice(0, MAX_HIDDEN_KEYS)) {
      if (!isSafeKey(k)) continue;
      const t = typeof v === 'string' ? v.slice(0, 500) : clampText(v);
      if (t !== undefined) hidden[k.slice(0, 64)] = t;
    }
  }
  const dur = Number(raw.durationMs);
  return {
    startedAt: str(raw.startedAt),
    completedAt: str(raw.completedAt),
    durationMs: Number.isFinite(dur) && dur >= 0 ? Math.min(dur, 86_400_000) : 0,
    questionsVisited: visited,
    hiddenFields: hidden,
    ...(typeof raw.score === 'number' && Number.isFinite(raw.score) ? { score: raw.score } : {}),
  };
}

/**
 * Honeypot drops (ADR-052, ADR-058) cost nothing and touch no DB. Logged at
 * most once per 10 s per isolate, with counts per form, so an autofill false
 * positive stays visible without a log line per bot request.
 */
let hpAt = 0;
let hpCounts = new Map<string, number>();
function noteHoneypot(formId: string): void {
  const k = hpCounts.has(formId) || hpCounts.size < 200 ? formId : '_other';
  hpCounts.set(k, (hpCounts.get(k) ?? 0) + 1);
  if (Date.now() - hpAt >= 10_000) {
    console.info('[submitresponse] honeypot drops', Object.fromEntries(hpCounts));
    hpCounts = new Map();
    hpAt = Date.now();
  }
}

const wrongPassword = (c: Context) => c.json({ error: 'wrong_password' }, 401);

const UNLOCK_COPY: Record<'pw' | 'fail_ip' | 'fail_form', (wait: string) => string> = {
  pw: (w) =>
    `Too many password attempts from this network right now. Please wait ${w}, or try from another network (for example mobile data).`,
  fail_ip: (w) =>
    `Too many wrong passwords from this network. Check the password with whoever shared the form, or try again in ${w}.`,
  fail_form: (w) =>
    `Too many wrong passwords for this form right now. Check the password with whoever shared it, then try again in ${w}.`,
};

/**
 * Unlock a password-locked form (ADR-043, counted per ADR-058). Unknown slugs,
 * unlocked forms and token reloads are free. A password guess is ONE statement
 * (try_fill_password): miss ceilings, CPU guard, bcrypt and the count commit
 * together, and any error answers exactly like a wrong password.
 */
async function handleUnlock(c: Context, body: Record<string, unknown>) {
  const slug = typeof body.slug === 'string' ? body.slug.trim() : '';
  const password = typeof body.password === 'string' ? body.password.trim().normalize('NFC') : '';
  if (
    !slug ||
    slug.length > 64 ||
    !SLUG_RE.test(slug) ||
    (body.password !== undefined && typeof body.password !== 'string') ||
    (body.token !== undefined && typeof body.token !== 'string') ||
    // bcrypt only reads 72 bytes — refuse longer before it reaches crypt().
    Buffer.byteLength(password, 'utf8') > 72
  ) {
    return wrongPassword(c);
  }

  let form: UnlockRow | undefined;
  try {
    // The schema only leaves this query for forms that are not locked.
    form = (
      await pool.query<UnlockRow>(
        `select id, name, slug, owner_id, fill_password_hash,
                case when fill_password_hash is null then published_schema end as published_schema
           from public.forms
          where slug = $1 and deleted_at is null and status = 'published'
            and published_schema is not null
          limit 1`,
        [slug],
      )
    ).rows[0];
  } catch (err) {
    console.error('[submitresponse] unlock lookup failed', err);
    return c.text('Temporarily unavailable', 503);
  }
  // Same answer as a wrong password: no "which slugs are locked" oracle.
  if (!form) return wrongPassword(c);
  const base = { id: form.id, name: form.name, slug: form.slug };

  // Lock was removed since the gate rendered — just hand over the form.
  if (!form.fill_password_hash) {
    return c.json({ ...base, locked: false, schema: form.published_schema });
  }
  const hash = form.fill_password_hash;

  // Tab reload with this tab's token: free, no bcrypt, no rate row.
  if (isValidUnlockToken(form.id, hash, body.token)) {
    let schema: unknown;
    try {
      schema = (
        await pool.query<{ published_schema: unknown }>(
          'select published_schema from public.forms where id = $1',
          [form.id],
        )
      ).rows[0]?.published_schema;
    } catch (err) {
      console.error('[submitresponse] unlock schema read failed', err);
      return c.text('Temporarily unavailable', 503);
    }
    return schema
      ? c.json({ ...base, locked: true, schema, unlockToken: fillUnlockToken(form.id, hash) })
      : wrongPassword(c);
  }
  if (!password) return wrongPassword(c);

  const ip = clientIp((n) => c.req.header(n));
  let r: TryRow | undefined;
  try {
    r = (
      await pool.query<TryRow>(
        `select t.ok, t.denied, t.retry_after_seconds,
                (select f.published_schema from public.forms f where t.ok and f.id = $5) as published_schema
           from public.try_fill_password($1, $2, $3, $4, $5, $6, $7, $8, $9) t`,
        [
          hash,
          password,
          ip,
          ownerKey(form.owner_id),
          form.id,
          ipMax(ip, LIMITS.pw),
          ipMax(ip, LIMITS.pwIp),
          ipMax(ip, LIMITS.failIp),
          LIMITS.failForm,
        ],
      )
    ).rows[0];
  } catch (err) {
    console.error('[submitresponse] unlock check failed', err);
    // A guess may have run: never answer differently from a wrong password.
    return wrongPassword(c);
  }
  if (!r) return wrongPassword(c);
  if (r.denied) {
    const copy = UNLOCK_COPY[r.denied as keyof typeof UNLOCK_COPY] ?? UNLOCK_COPY.pw;
    const wait = Math.max(1, Number(r.retry_after_seconds) || 60);
    c.header('Retry-After', String(wait));
    return c.json(
      { error: copy(aboutMinutes(wait)), reason: r.denied, retryAfterSeconds: wait },
      429,
    );
  }
  if (r.ok !== true || !r.published_schema) return wrongPassword(c);
  return c.json({
    ...base,
    locked: true,
    schema: r.published_schema,
    unlockToken: fillUnlockToken(form.id, hash),
  });
}

app.post(
  '/',
  // Counted in bytes, chunked bodies included, before anything is parsed.
  bodyLimit({ maxSize: MAX_BODY_BYTES, onError: (c) => c.text(TOO_LONG, 413) }),
  async (c) => {
    if (!process.env.DATABASE_URL) {
      return c.text('Server misconfigured', 500);
    }

    let text: string;
    let body: unknown;
    try {
      text = await c.req.text();
      body = JSON.parse(text);
    } catch {
      return c.text('Invalid JSON', 400);
    }
    const bodyBytes = Buffer.byteLength(text, 'utf8');
    if (bodyBytes > MAX_BODY_BYTES) return c.text(TOO_LONG, 413);
    if (!isObj(body)) return c.text('Invalid JSON', 400);

    if (body.op === 'unlock') return handleUnlock(c, body);

    const { formId, answers, meta, unlockToken } = body;
    if (
      typeof formId !== 'string' ||
      !FORM_ID_RE.test(formId) ||
      !isObj(answers) ||
      !isObj(meta) ||
      (unlockToken !== undefined && typeof unlockToken !== 'string')
    ) {
      return c.text('Missing fields', 400);
    }

    // Honeypot hit (ADR-052): same thanks screen, nothing stored, nothing charged.
    if (isObj(meta.hiddenFields) && meta.hiddenFields._hp) {
      noteHoneypot(formId);
      return c.json({ id: 'ignored' });
    }

    // Gate: never reads the schema, so a refused request moves no answers-sized data.
    let form: GateRow | undefined;
    try {
      form = (
        await pool.query<GateRow>(
          `select id, status, deleted_at, owner_id, fill_password_hash,
                  published_schema is not null as has_schema
             from public.forms where id = $1`,
          [formId],
        )
      ).rows[0];
    } catch (err) {
      console.error('[submitresponse] form lookup failed', err);
      return c.text('Temporarily unavailable', 503);
    }
    if (!form || form.deleted_at || form.status !== 'published' || !form.has_schema) {
      return c.text('Form not available', 404);
    }

    // Locked form (ADR-043): no valid unlock token, no submission.
    if (
      form.fill_password_hash &&
      !isValidUnlockToken(form.id, form.fill_password_hash, unlockToken)
    ) {
      return c.json({ error: 'locked' }, 401);
    }

    // IP + form owner, with a whole-IP backstop 5x larger (ADR-058). Fail closed.
    const ip = clientIp((n) => c.req.header(n));
    const cost = units(bodyBytes, SUBMIT_UNIT);
    const buckets: Bucket[] = [
      {
        key: `sub:ipowner:${ip}:${ownerKey(form.owner_id)}`,
        win: 3600,
        max: ipMax(ip, LIMITS.ipOwner),
        cost,
      },
      { key: `sub:ip:${ip}`, win: 3600, max: ipMax(ip, LIMITS.ip), cost },
    ];
    let v: Awaited<ReturnType<typeof charge>>;
    try {
      v = await charge(pool, buckets, form.id);
    } catch (err) {
      console.error('[submitresponse] rate limit check failed', err);
      return c.text('Temporarily unavailable', 503);
    }
    if (!v.ok) {
      c.header('Retry-After', String(v.retryAfter));
      return c.json(
        {
          error: `Too many responses from this network right now. Please wait ${aboutMinutes(v.retryAfter)}, or try from another network (for example mobile data).`,
          retryAfterSeconds: v.retryAfter,
        },
        429,
      );
    }
    // Unpublished between the gate and the charge.
    if (!v.schema) return c.text('Form not available', 404);

    const clean = sanitizeAnswers(answers, v.schema, form.id);
    const cleanMeta = sanitizeMeta(meta);

    const submissionId = `s_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
    try {
      await pool.query(
        `insert into public.submissions (id, form_id, answers, meta, received_at)
         values ($1, $2, $3::jsonb, $4::jsonb, now())`,
        [submissionId, form.id, JSON.stringify(clean), JSON.stringify(cleanMeta)],
      );
    } catch (err) {
      console.error('[submitresponse] insert failed', err);
      return c.text('Could not save your response. Please try again.', 500);
    }

    // Responses live in the app only (ADR-047): no email leaves this Function.
    return c.json({ id: submissionId });
  },
);

export default app;
