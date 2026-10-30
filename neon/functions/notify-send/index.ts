/**
 * Neon Function: new-response emails to form owners (ADR-072).
 * Deploy: neon functions deploy notifysend --src neon/functions/notify-send
 * Schedule: a Function Trigger, `*\/5 * * * *`, function_path `/run`.
 * Needs migration 023. Env: RESEND_API_KEY, UNSUB_SECRET (≥ 32 characters), NOTIFY_PUBLIC_URL (this
 * Function's own https URL, for the unsubscribe link), optional STUDIO_URL and NOTIFY_EMAIL_FROM.
 *
 * POST /run (the schedule only: Neon strips client-set X-Neon-* headers, so the invocation id
 * header attests the caller). One run at a time (session advisory lock 87123005). The database picks
 * the forms that are due (023 response_emails_due: emails on, new live responses, 15 minutes since
 * the last email, no backoff, the owner's verified sign-in address); each gets one email with a count
 * and a link, never an answer. Sent → the cursor moves; failed → it stays and the form backs off.
 * The owner's and the whole day's caps hold even when one run has many forms of one owner.
 *
 * GET /unsubscribe?t= shows a confirm button (mail scanners open links; a GET never changes
 * anything). POST /unsubscribe?t= turns that form's emails off: the button, and RFC 8058 one-click
 * from the List-Unsubscribe header. The token is checked before any database work.
 */

import { Hono, type Context } from 'hono';
import { Pool } from 'pg';
import { buildResponseEmail, NOTIFY_EMAIL_FROM } from './notifyEmail.js';
import { MIN_SECRET_LENGTH, unsubToken, verifyUnsubToken } from './unsubToken.js';

/** Forms per run. Every 5 minutes this is far more than the day caps let through. */
const BATCH = 25;
const SEND_TIMEOUT_MS = 8000;
const RUN_LOCK = [87123005, 1] as const;
const DEFAULT_STUDIO_URL = 'https://slateforms.vercel.app';

// Same connection ceiling as the other Functions (ADR-071).
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 3,
  query_timeout: 10_000,
});
pool.on('connect', (client) => {
  void client
    .query('set statement_timeout = 8000; set lock_timeout = 4000')
    .catch((err: unknown) => console.warn('[pool] timeouts not set', String(err).slice(0, 120)));
});

export type DueRow = {
  form_id: string;
  owner_id: string;
  owner_email: string;
  form_name: string;
  new_count: number;
  upto: Date | string;
  owner_sent_today: number;
  total_sent_today: number;
};

type Config = {
  resendKey: string;
  secret: string;
  publicUrl: string;
  studioUrl: string;
  from: string;
};

/** Everything a run needs, or the names of what's missing. Nothing is sent half-configured. */
export function readConfig(
  env: Record<string, string | undefined>,
): Config | { missing: string[] } {
  const missing: string[] = [];
  const resendKey = env.RESEND_API_KEY?.trim() ?? '';
  const secret = env.UNSUB_SECRET?.trim() ?? '';
  const publicUrl = httpsOrigin(env.NOTIFY_PUBLIC_URL);
  const studioUrl = httpsOrigin(env.STUDIO_URL) ?? DEFAULT_STUDIO_URL;
  if (!env.DATABASE_URL) missing.push('DATABASE_URL');
  if (!resendKey) missing.push('RESEND_API_KEY');
  if (secret.length < MIN_SECRET_LENGTH) missing.push('UNSUB_SECRET');
  if (!publicUrl) missing.push('NOTIFY_PUBLIC_URL');
  if (missing.length || !publicUrl) return { missing };
  return {
    resendKey,
    secret,
    publicUrl,
    studioUrl,
    from: env.NOTIFY_EMAIL_FROM?.trim() || NOTIFY_EMAIL_FROM,
  };
}

function httpsOrigin(value: string | undefined): string | null {
  try {
    const url = new URL((value ?? '').trim());
    return url.protocol === 'https:' ? url.origin : null;
  } catch {
    return null;
  }
}

const app = new Hono();

app.get('/', (c) => c.json({ ok: true, service: 'notifysend' }));

app.post('/run', async (c) => {
  if (!c.req.header('x-neon-trigger-invocation-id')) {
    return c.json({ error: 'not a trigger call' }, 403);
  }
  const config = readConfig(process.env);
  if ('missing' in config) {
    console.error('[notifysend] not configured:', config.missing.join(', '));
    return c.json({ error: 'Server misconfigured' }, 500);
  }
  try {
    const result = await runOnce(config);
    console.info('[notifysend] run', result);
    return c.json({ ok: true, ...result });
  } catch (err) {
    console.error('[notifysend] run failed', String(err).slice(0, 200));
    return c.json({ error: 'Run failed' }, 503);
  }
});

export async function runOnce(
  config: Config,
): Promise<{ skipped?: 'busy'; due: number; sent: number; failed: number; capped: number }> {
  const client = await pool.connect();
  let locked = false;
  try {
    const { rows: lockRows } = await client.query<{ ok: boolean }>(
      'select pg_try_advisory_lock($1, $2) as ok',
      [...RUN_LOCK],
    );
    locked = lockRows[0]?.ok === true;
    if (!locked) return { skipped: 'busy', due: 0, sent: 0, failed: 0, capped: 0 };

    const { rows: caps } = await client.query<{ owner_max: number; day_max: number }>(
      `select public.response_email_owner_day_max() as owner_max,
              public.response_email_day_max() as day_max`,
    );
    const ownerMax = Number(caps[0]?.owner_max ?? 0);
    const dayMax = Number(caps[0]?.day_max ?? 0);

    const { rows } = await client.query<DueRow>('select * from public.response_emails_due($1)', [
      BATCH,
    ]);

    let total = rows.length ? Number(rows[0]!.total_sent_today) : 0;
    const perOwner = new Map<string, number>();
    let sent = 0;
    let failed = 0;
    let capped = 0;

    for (const row of rows) {
      const ownerSent = perOwner.get(row.owner_id) ?? Number(row.owner_sent_today);
      // Over a cap the cursor stays put: tomorrow's email counts these responses too.
      if (total >= dayMax || ownerSent >= ownerMax) {
        capped += 1;
        continue;
      }
      const upto = row.upto instanceof Date ? row.upto : new Date(row.upto);
      const ok = await sendOne(config, row, upto);
      if (ok) {
        await client.query('select public.response_email_sent($1, $2, $3)', [
          row.form_id,
          row.owner_id,
          upto.toISOString(),
        ]);
        perOwner.set(row.owner_id, ownerSent + 1);
        total += 1;
        sent += 1;
      } else {
        await client.query('select public.response_email_failed($1)', [row.form_id]);
        failed += 1;
      }
    }
    return { due: rows.length, sent, failed, capped };
  } finally {
    if (locked) {
      await client.query('select pg_advisory_unlock($1, $2)', [...RUN_LOCK]).catch(() => undefined);
    }
    client.release();
  }
}

async function sendOne(config: Config, row: DueRow, upto: Date): Promise<boolean> {
  const unsubscribeUrl = `${config.publicUrl}/unsubscribe?t=${encodeURIComponent(
    unsubToken(config.secret, row.form_id),
  )}`;
  const email = buildResponseEmail({
    formName: row.form_name,
    newCount: Number(row.new_count),
    responsesUrl: `${config.studioUrl}/forms/${encodeURIComponent(row.form_id)}/submissions`,
    unsubscribeUrl,
  });
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      headers: {
        Authorization: `Bearer ${config.resendKey}`,
        'Content-Type': 'application/json',
        // A retry after a timeout that did go through is not a second email.
        'Idempotency-Key': `resp-${row.form_id}-${upto.getTime()}`,
      },
      body: JSON.stringify({
        from: config.from,
        to: [row.owner_email],
        subject: email.subject,
        html: email.html,
        text: email.text,
        headers: {
          'List-Unsubscribe': `<${unsubscribeUrl}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.warn('[notifysend] Resend', res.status, body.slice(0, 200));
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[notifysend] send failed', String(err).slice(0, 200));
    return false;
  }
}

// ---------------------------------------------------------------------------
// Unsubscribe
// ---------------------------------------------------------------------------

const PAGE_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  'Content-Security-Policy':
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
};

app.get('/unsubscribe', (c) => {
  const secret = process.env.UNSUB_SECRET?.trim() ?? '';
  const token = c.req.query('t');
  if (!verifyUnsubToken(secret, token)) {
    return page(
      c,
      400,
      'This link doesn’t work',
      'It may have been cut short. You can turn emails off in Slate: Share → Email me new responses.',
    );
  }
  return page(
    c,
    200,
    'Turn off emails for this form?',
    'You’ll stop getting new-response emails for this form. Responses still arrive in Slate.',
    token!,
  );
});

app.post('/unsubscribe', async (c) => {
  const secret = process.env.UNSUB_SECRET?.trim() ?? '';
  const formId = verifyUnsubToken(secret, c.req.query('t'));
  if (!formId) {
    return page(
      c,
      400,
      'This link doesn’t work',
      'It may have been cut short. You can turn emails off in Slate: Share → Email me new responses.',
    );
  }
  try {
    await pool.query('select public.response_email_unsubscribe($1)', [formId]);
  } catch (err) {
    console.error('[notifysend] unsubscribe failed', String(err).slice(0, 200));
    return page(c, 503, 'Couldn’t turn emails off', 'Please try again in a minute.');
  }
  // Already off reads the same: the result the person wanted.
  return page(
    c,
    200,
    'Emails are off',
    'You won’t get new-response emails for this form. Turn them back on in Slate any time: Share → Email me new responses.',
  );
});

function page(
  c: Context,
  status: 200 | 400 | 503,
  title: string,
  body: string,
  confirmToken?: string,
) {
  const button = confirmToken
    ? `<form method="post" action="?t=${escapeHtml(encodeURIComponent(confirmToken))}"><button type="submit">Turn off emails</button></form>`
    : '';
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><meta name="robots" content="noindex"/><title>${escapeHtml(title)}</title><style>body{margin:0;background:#15181D;color:#F2EFE8;font:400 16px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif}main{max-width:440px;margin:0 auto;padding:64px 16px}h1{font-weight:600;font-size:24px;line-height:1.25;margin:0 0 12px}p{color:#8A93A1;margin:0 0 28px}button{background:#E23B2D;color:#F2EFE8;border:0;border-radius:999px;font:600 15px/1 inherit;padding:16px 32px;cursor:pointer}button:focus-visible{outline:2px solid #F2EFE8;outline-offset:3px}</style></head><body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(body)}</p>${button}</main></body></html>`;
  return c.body(html, status, PAGE_HEADERS);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export default app;
