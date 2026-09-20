/**
 * Neon Function: public form submit (ADR-029 / ADR-030 rate limits).
 * Deploy: neon functions deploy submitresponse --src neon/functions/submit-response
 * DATABASE_URL is injected by Neon.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { Pool } from 'pg';

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
};

/** Per IP + form: default 10 submits / 10 minutes. */
const PER_IP_FORM_MAX = Number(process.env.SUBMIT_RATE_IP_FORM_MAX ?? 10);
const PER_IP_FORM_WINDOW_SEC = Number(process.env.SUBMIT_RATE_IP_FORM_WINDOW_SEC ?? 600);

/** Per IP overall: default 30 submits / hour. */
const PER_IP_MAX = Number(process.env.SUBMIT_RATE_IP_MAX ?? 30);
const PER_IP_WINDOW_SEC = Number(process.env.SUBMIT_RATE_IP_WINDOW_SEC ?? 3600);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
});

const app = new Hono();
app.use('*', cors({ origin: '*' }));

app.options('*', (c) => c.body(null, 204));

function clientIp(c: { req: { header: (name: string) => string | undefined } }): string {
  const forwarded = c.req.header('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first.slice(0, 64);
  }
  const real =
    c.req.header('cf-connecting-ip') ||
    c.req.header('x-real-ip') ||
    c.req.header('true-client-ip');
  if (real?.trim()) return real.trim().slice(0, 64);
  return 'unknown';
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

app.post('/', async (c) => {
  if (!process.env.DATABASE_URL) {
    return c.text('Server misconfigured', 500);
  }

  let body: SubmitBody;
  try {
    body = (await c.req.json()) as SubmitBody;
  } catch {
    return c.text('Invalid JSON', 400);
  }

  if (!body.formId || !body.answers || !body.meta) {
    return c.text('Missing fields', 400);
  }

  // Rate-limit before work (including honeypot) so bots still burn quota.
  const ip = clientIp(c);
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
  }>(
    `select id, name, slug, status, published_schema, deleted_at
     from public.forms where id = $1 limit 1`,
    [body.formId],
  );
  const form = formRes.rows[0];
  if (!form || form.deleted_at || form.status !== 'published') {
    return c.text('Form not available', 404);
  }

  const submissionId = `s_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  try {
    await pool.query(
      `insert into public.submissions (id, form_id, answers, meta, received_at)
       values ($1, $2, $3::jsonb, $4::jsonb, now())`,
      [submissionId, body.formId, JSON.stringify(body.answers), JSON.stringify(body.meta)],
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Insert failed';
    return c.text(message, 500);
  }

  const resendKey = process.env.RESEND_API_KEY;
  const notifyTo = process.env.PSW_NOTIFY_EMAIL ?? 'hello@palmstreetweb.com';
  if (resendKey) {
    const origin =
      process.env.PUBLIC_FORM_BASE?.replace(/\/$/, '') ?? 'https://slateforms.vercel.app';
    const responsesUrl = `${origin}/#/forms/${body.formId}/submissions`;
    const html = buildNotifyHtml({
      formName: form.name,
      responsesUrl,
      answers: body.answers,
      schema: form.published_schema,
      durationMs: body.meta.durationMs,
    });
    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'Slate <notifications@palmstreetweb.com>',
          to: [notifyTo],
          subject: `New response: ${form.name}`,
          html,
        }),
      });
    } catch {
      // Notification failure must not fail the submission.
    }
  }

  return c.json({ id: submissionId });
});

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatAnswerPreview(value: unknown): string {
  if (value == null || value === '') return '—';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return '—';
    return value
      .map((item) => {
        if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
          return String(item);
        }
        if (item && typeof item === 'object') {
          const rec = item as Record<string, unknown>;
          if (typeof rec.name === 'string') return rec.name;
          if (typeof rec.filename === 'string') return rec.filename;
          if (typeof rec.label === 'string') return rec.label;
        }
        return null;
      })
      .filter((s): s is string => Boolean(s))
      .join(', ');
  }
  if (typeof value === 'object') {
    const rec = value as Record<string, unknown>;
    if (typeof rec.name === 'string') return rec.name;
    if (typeof rec.filename === 'string') return rec.filename;
    if (typeof rec.label === 'string') return rec.label;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return '—';
  }
}

function questionLabels(schema: unknown): Map<string, string> {
  const map = new Map<string, string>();
  if (!schema || typeof schema !== 'object') return map;
  const questions = (schema as { questions?: unknown }).questions;
  if (!Array.isArray(questions)) return map;
  for (const q of questions) {
    if (!q || typeof q !== 'object') continue;
    const row = q as Record<string, unknown>;
    const id = typeof row.id === 'string' ? row.id : '';
    if (!id) continue;
    const title = typeof row.title === 'string' ? row.title.trim() : '';
    const type = typeof row.type === 'string' ? row.type : '';
    if (type === 'welcome' || type === 'statement' || type === 'thanks' || type === 'review') {
      continue;
    }
    map.set(id, title || id);
  }
  return map;
}

function buildNotifyHtml(args: {
  formName: string;
  responsesUrl: string;
  answers: Record<string, unknown>;
  schema: unknown;
  durationMs: number;
}): string {
  const labels = questionLabels(args.schema);
  const keys = Object.keys(args.answers);
  const ordered = [
    ...[...labels.keys()].filter((id) => id in args.answers),
    ...keys.filter((id) => !labels.has(id)),
  ].slice(0, 12);

  const rows = ordered
    .map((id) => {
      const label = escapeHtml(labels.get(id) ?? id);
      const answer = escapeHtml(formatAnswerPreview(args.answers[id])).slice(0, 280);
      return `<tr>
  <td style="padding:8px 12px;border-bottom:1px solid #e8e4dc;vertical-align:top;color:#5c574e;width:38%">${label}</td>
  <td style="padding:8px 12px;border-bottom:1px solid #e8e4dc;vertical-align:top;color:#1a1814">${answer}</td>
</tr>`;
    })
    .join('');

  const seconds =
    Number.isFinite(args.durationMs) && args.durationMs > 0
      ? Math.round(args.durationMs / 1000)
      : null;
  const meta =
    seconds != null
      ? `<p style="margin:0 0 16px;color:#5c574e;font-size:13px">Completed in ${seconds}s</p>`
      : '';

  const table = rows
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:0 0 20px;font-size:14px;line-height:1.45">${rows}</table>`
    : `<p style="margin:0 0 20px;color:#5c574e">No answers recorded.</p>`;

  return `<div style="font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto;padding:8px;color:#1a1814">
  <p style="margin:0 0 8px;font-size:16px">New response for <strong>${escapeHtml(args.formName)}</strong>.</p>
  ${meta}
  ${table}
  <p style="margin:0"><a href="${escapeHtml(args.responsesUrl)}" style="color:#2c6ef2">View in Slate →</a></p>
</div>`;
}

export default app;
