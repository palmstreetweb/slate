/**
 * Neon Function: public form submit (ADR-029 / ADR-030 rate limits)
 * + password-locked form unlock (ADR-043, `{ op: 'unlock' }` on the same URL).
 * Deploy: neon functions deploy submitresponse --src neon/functions/submit-response
 * DATABASE_URL is injected by Neon.
 */

import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { Pool } from 'pg';
import { fillUnlockToken, isValidUnlockToken } from './fillLock.js';
import { clientIp } from './requestIp.js';

/** Hard caps on what one submission may carry (ADR-046). */
const MAX_BODY_BYTES = 256 * 1024;
const MAX_ANSWER_KEYS = 200;
const MAX_STRING_CHARS = 10_000;
const MAX_ARRAY_ITEMS = 100;
const MAX_VISITED = 500;
const MAX_HIDDEN_KEYS = 50;

/** Password-locked forms (ADR-043): same endpoint, discriminated by `op`. */
type UnlockBody = {
  op: 'unlock';
  slug: string;
  /** First unlock. */
  password?: string;
  /** Tab reload: re-prove with the sessionStorage token instead of retyping. */
  token?: string;
};

type SubmitBody = {
  formId: string;
  answers: Record<string, unknown>;
  meta: {
    startedAt: string;
    completedAt: string;
    durationMs: number;
    questionsVisited: string[];
    hiddenFields: Record<string, unknown>;
    score?: number;
  };
  /** Required when the form has a fill password (ADR-043). */
  unlockToken?: string;
};

/** Per IP + form: default 10 submits / 10 minutes. */
const PER_IP_FORM_MAX = Number(process.env.SUBMIT_RATE_IP_FORM_MAX ?? 10);
const PER_IP_FORM_WINDOW_SEC = Number(process.env.SUBMIT_RATE_IP_FORM_WINDOW_SEC ?? 600);

/** Per IP overall: default 30 submits / hour. */
const PER_IP_MAX = Number(process.env.SUBMIT_RATE_IP_MAX ?? 30);
const PER_IP_WINDOW_SEC = Number(process.env.SUBMIT_RATE_IP_WINDOW_SEC ?? 3600);

/**
 * Unlock attempts (right or wrong) per IP + slug: default 40 / 10 minutes.
 * Roomy enough for a conference NAT, far too slow to spray a 4-digit PIN.
 */
const UNLOCK_IP_SLUG_MAX = Number(process.env.UNLOCK_RATE_IP_SLUG_MAX ?? 40);
const UNLOCK_IP_SLUG_WINDOW_SEC = Number(process.env.UNLOCK_RATE_IP_SLUG_WINDOW_SEC ?? 600);

/** Unlock attempts per IP overall: default 80 / hour. */
const UNLOCK_IP_MAX = Number(process.env.UNLOCK_RATE_IP_MAX ?? 80);
const UNLOCK_IP_WINDOW_SEC = Number(process.env.UNLOCK_RATE_IP_WINDOW_SEC ?? 3600);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
});

const app = new Hono();
app.use('*', cors({ origin: '*' }));

app.options('*', (c) => c.body(null, 204));

/** Clamp one answer value: strings, numbers, booleans, short arrays, small objects. */
function clampValue(v: unknown, depth = 0): unknown {
  if (v == null) return v;
  if (typeof v === 'string') return v.length > MAX_STRING_CHARS ? v.slice(0, MAX_STRING_CHARS) : v;
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  if (depth >= 2) return undefined;
  if (Array.isArray(v)) return v.slice(0, MAX_ARRAY_ITEMS).map((x) => clampValue(x, depth + 1));
  if (typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>).slice(0, 20)) {
      const c = clampValue(val, depth + 1);
      if (c !== undefined) out[k.slice(0, 64)] = c;
    }
    return out;
  }
  return undefined;
}

/**
 * Keep only answers whose key is a question in the published schema, each
 * clamped. Stops a respondent (or a bot with a form id) from storing
 * arbitrary blobs in someone else's table.
 */
function sanitizeAnswers(raw: unknown, schema: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const ids = new Set<string>();
  const questions = (schema as { questions?: unknown } | null)?.questions;
  if (Array.isArray(questions)) {
    for (const q of questions) {
      const id = (q as { id?: unknown } | null)?.id;
      if (typeof id === 'string') ids.add(id);
    }
  }
  const out: Record<string, unknown> = {};
  let n = 0;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!ids.has(k)) continue;
    if (n >= MAX_ANSWER_KEYS) break;
    const c = clampValue(v);
    if (c === undefined) continue;
    out[k] = c;
    n += 1;
  }
  return out;
}

function sanitizeMeta(raw: SubmitBody['meta']): SubmitBody['meta'] {
  const str = (v: unknown) => (typeof v === 'string' ? v.slice(0, 64) : '');
  const visited = Array.isArray(raw.questionsVisited)
    ? raw.questionsVisited.filter((x): x is string => typeof x === 'string').slice(0, MAX_VISITED)
    : [];
  const hidden: Record<string, unknown> = {};
  if (raw.hiddenFields && typeof raw.hiddenFields === 'object') {
    for (const [k, v] of Object.entries(raw.hiddenFields).slice(0, MAX_HIDDEN_KEYS)) {
      hidden[k.slice(0, 64)] = typeof v === 'string' ? v.slice(0, 500) : clampValue(v, 2);
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

async function consumeRate(
  key: string,
  windowSeconds: number,
  max: number,
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const { rows } = await pool.query<{
    allowed: boolean;
    hit_count: number;
    retry_after_seconds: number;
  }>(`select * from public.consume_submit_rate($1, $2, $3)`, [key, windowSeconds, max]);
  const row = rows[0];
  if (!row) return { allowed: false, retryAfterSeconds: windowSeconds };
  return {
    allowed: row.allowed,
    retryAfterSeconds: row.retry_after_seconds,
  };
}

async function handleUnlock(c: Context, body: UnlockBody) {
  const slug = typeof body.slug === 'string' ? body.slug.trim() : '';
  if (!slug || slug.length > 120) {
    return c.text('Missing slug', 400);
  }
  const password = typeof body.password === 'string' ? body.password : '';
  // bcrypt only reads 72 bytes — refuse giant bodies before they reach crypt().
  if (password.length > 72) {
    return c.json({ error: 'wrong_password' }, 401);
  }

  // Every attempt counts, right or wrong. Fail closed if the rate table errors.
  const ip = clientIp((n) => c.req.header(n));
  try {
    const perSlug = await consumeRate(
      `unlock:ipslug:${ip}:${slug}`,
      UNLOCK_IP_SLUG_WINDOW_SEC,
      UNLOCK_IP_SLUG_MAX,
    );
    const perIp = perSlug.allowed
      ? await consumeRate(`unlock:ip:${ip}`, UNLOCK_IP_WINDOW_SEC, UNLOCK_IP_MAX)
      : perSlug;
    if (!perIp.allowed) {
      c.header('Retry-After', String(perIp.retryAfterSeconds));
      return c.json(
        {
          error: 'Too many tries from this network. Please wait and try again.',
          retryAfterSeconds: perIp.retryAfterSeconds,
        },
        429,
      );
    }
  } catch (err) {
    console.error('[submitresponse] unlock rate limit check failed', err);
    return c.text('Temporarily unavailable', 503);
  }

  let form:
    | {
        id: string;
        name: string;
        slug: string;
        published_schema: unknown;
        fill_password_hash: string | null;
        password_ok: boolean | null;
      }
    | undefined;
  try {
    // crypt() runs in Postgres so the hash never leaves the database process
    // except to mint the token below.
    const res = await pool.query(
      `select id, name, slug, published_schema, fill_password_hash,
              case
                when fill_password_hash is null or $2 = '' then null
                else fill_password_hash = crypt($2, fill_password_hash)
              end as password_ok
       from public.forms
       where slug = $1
         and deleted_at is null
         and status = 'published'
         and published_schema is not null
       limit 1`,
      [slug, password],
    );
    form = res.rows[0];
  } catch (err) {
    console.error('[submitresponse] unlock lookup failed', err);
    return c.text('Temporarily unavailable', 503);
  }

  if (!form) {
    // Same answer as a wrong password: no "which slugs are locked" oracle.
    return c.json({ error: 'wrong_password' }, 401);
  }

  // Lock was removed since the gate rendered — just hand over the form.
  if (!form.fill_password_hash) {
    return c.json({
      id: form.id,
      name: form.name,
      slug: form.slug,
      locked: false,
      schema: form.published_schema,
    });
  }

  const ok =
    form.password_ok === true || isValidUnlockToken(form.id, form.fill_password_hash, body.token);
  if (!ok) {
    return c.json({ error: 'wrong_password' }, 401);
  }

  return c.json({
    id: form.id,
    name: form.name,
    slug: form.slug,
    locked: true,
    schema: form.published_schema,
    unlockToken: fillUnlockToken(form.id, form.fill_password_hash),
  });
}

app.post('/', async (c) => {
  if (!process.env.DATABASE_URL) {
    return c.text('Server misconfigured', 500);
  }

  // Refuse oversized bodies before parsing them. Content-Length can be
  // absent on chunked requests, so the parsed size is checked again below.
  const declared = Number(c.req.header('content-length') ?? 0);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return c.text('Payload too large', 413);
  }

  let body: SubmitBody;
  try {
    const text = await c.req.text();
    if (text.length > MAX_BODY_BYTES) return c.text('Payload too large', 413);
    body = JSON.parse(text) as SubmitBody;
  } catch {
    return c.text('Invalid JSON', 400);
  }

  if ((body as unknown as UnlockBody).op === 'unlock') {
    return handleUnlock(c, body as unknown as UnlockBody);
  }

  if (!body.formId || !body.answers || !body.meta) {
    return c.text('Missing fields', 400);
  }

  // Rate-limit before work (including honeypot) so bots still burn quota.
  const ip = clientIp((n) => c.req.header(n));
  try {
    const perForm = await consumeRate(
      `ipform:${ip}:${body.formId}`,
      PER_IP_FORM_WINDOW_SEC,
      PER_IP_FORM_MAX,
    );
    if (!perForm.allowed) {
      c.header('Retry-After', String(perForm.retryAfterSeconds));
      return c.json(
        {
          error: 'Too many submissions from this network. Please wait and try again.',
          retryAfterSeconds: perForm.retryAfterSeconds,
        },
        429,
      );
    }

    const perIp = await consumeRate(`ip:${ip}`, PER_IP_WINDOW_SEC, PER_IP_MAX);
    if (!perIp.allowed) {
      c.header('Retry-After', String(perIp.retryAfterSeconds));
      return c.json(
        {
          error: 'Too many submissions from this network. Please wait and try again.',
          retryAfterSeconds: perIp.retryAfterSeconds,
        },
        429,
      );
    }
  } catch (err) {
    console.error('[submitresponse] rate limit check failed', err);
    // Fail open only if the rate table is missing mid-migrate — still prefer fail closed.
    return c.text('Temporarily unavailable', 503);
  }

  if (body.meta.hiddenFields?._hp) {
    return c.json({ id: 'ignored' });
  }

  const formRes = await pool.query<{
    id: string;
    name: string;
    slug: string;
    status: string;
    published_schema: unknown;
    deleted_at: string | null;
    fill_password_hash: string | null;
  }>(
    `select id, name, slug, status, published_schema, deleted_at, fill_password_hash
     from public.forms where id = $1 limit 1`,
    [body.formId],
  );
  const form = formRes.rows[0];
  if (!form || form.deleted_at || form.status !== 'published') {
    return c.text('Form not available', 404);
  }

  // Locked form (ADR-043): no valid unlock token, no submission.
  if (
    form.fill_password_hash &&
    !isValidUnlockToken(form.id, form.fill_password_hash, body.unlockToken)
  ) {
    return c.json({ error: 'locked' }, 401);
  }

  const answers = sanitizeAnswers(body.answers, form.published_schema);
  if (!answers) return c.text('Missing fields', 400);
  const meta = sanitizeMeta(body.meta);

  const submissionId = `s_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  try {
    await pool.query(
      `insert into public.submissions (id, form_id, answers, meta, received_at)
       values ($1, $2, $3::jsonb, $4::jsonb, now())`,
      [submissionId, body.formId, JSON.stringify(answers), JSON.stringify(meta)],
    );
  } catch (err) {
    console.error('[submitresponse] insert failed', err);
    return c.text('Could not save your response. Please try again.', 500);
  }

  // Responses live in the app only (ADR-047): no email leaves this Function.
  return c.json({ id: submissionId });
});

export default app;
