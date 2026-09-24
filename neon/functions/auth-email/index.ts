/**
 * Neon Function: branded auth email (ADR-037).
 * Deploy: neon functions deploy authemail --src neon/functions/auth-email
 *
 * Neon Auth will not POST to this Function host. Production webhook URL is
 * https://slateforms.vercel.app/api/auth-email which forwards here.
 * Subscribed events: `send.otp` + `send.magic_link` (disables Neon templates).
 * We coalesce both payloads, then send one Resend email with the Slate lockup,
 * magic link, and 6-digit code.
 */

import { createHash, createPublicKey, verify } from 'node:crypto';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { Pool } from 'pg';
import {
  AUTH_EMAIL_FROM,
  AUTH_EMAIL_SUBJECT,
  AUTH_LOGO_CID,
  buildSignInEmail,
  digestSignInEmail,
} from './emailHtml.js';
import { SLATE_LOCKUP_PNG_BASE64 } from './logoPng.js';

const WAIT_MS = Number(process.env.AUTH_EMAIL_WAIT_MS ?? 1800);
const POLL_MS = 150;
const JWKS_TTL_MS = 60 * 60 * 1000;
const JWKS_TIMEOUT_MS = 5000;

/**
 * Send caps (audit M-AUTH-2). Anyone can type any address into the login box,
 * so without these the domain could be used to bomb an inbox or burn the whole
 * Resend quota (after which nobody can sign in). A real person needs a few.
 */
const MAX_PER_ADDRESS_PER_HOUR = Number(process.env.AUTH_EMAIL_MAX_PER_ADDRESS ?? 6);
const MAX_TOTAL_PER_HOUR = Number(process.env.AUTH_EMAIL_MAX_TOTAL ?? 300);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
});

const app = new Hono();
app.use('*', cors({ origin: '*' }));
app.options('*', (c) => c.body(null, 204));

app.get('/', (c) => c.json({ ok: true, service: 'authemail' }));

app.get('/logo.png', () => {
  const bytes = Buffer.from(SLATE_LOCKUP_PNG_BASE64, 'base64');
  return new Response(bytes, {
    status: 200,
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=604800, immutable',
    },
  });
});

app.post('/', handleWebhook);
app.post('/webhooks/neon-auth', handleWebhook);

async function handleWebhook(c: {
  req: { text: () => Promise<string>; header: (name: string) => string | undefined };
}) {
  if (!process.env.DATABASE_URL) {
    return json({ error: 'Server misconfigured' }, 500);
  }
  const resendKey = process.env.RESEND_API_KEY?.trim();
  if (!resendKey) {
    return json({ error: 'RESEND_API_KEY is not set' }, 500);
  }

  const rawHttp = await c.req.text();
  const unpacked = unpackProxy(rawHttp, c);
  try {
    await verifyNeonWebhook(unpacked.rawBody, unpacked.headers);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid signature';
    return json({ error: message }, 401);
  }

  let payload: WebhookPayload;
  try {
    payload = JSON.parse(unpacked.rawBody) as WebhookPayload;
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const eventType = payload.event_type;
  if (eventType !== 'send.otp' && eventType !== 'send.magic_link') {
    return json({ ok: true, ignored: eventType });
  }
  // Only sign-in codes get the "Sign in to Slate" email. A password-reset or
  // email-verification OTP sent as a sign-in code let an attacker relay one
  // into a persistent password on someone's account (audit M-AUTH-1).
  // Deny the known non-sign-in types rather than allow one spelling of
  // "sign-in": a label change on Neon's side must not stop every sign-in mail.
  const otpType = payload.event_data?.otp_type;
  if (eventType === 'send.otp' && typeof otpType === 'string' && isNonSignInOtp(otpType)) {
    return json({ ok: true, ignored: `otp:${otpType}` });
  }

  const email = payload.user?.email?.trim().toLowerCase();
  if (!email || !email.includes('@')) {
    return json({ error: 'Missing user email' }, 400);
  }

  const otpCode =
    eventType === 'send.otp' && typeof payload.event_data?.otp_code === 'string'
      ? payload.event_data.otp_code
      : null;
  const linkUrl =
    eventType === 'send.magic_link' && typeof payload.event_data?.link_url === 'string'
      ? payload.event_data.link_url
      : null;
  const expiresAt =
    typeof payload.event_data?.expires_at === 'string' ? payload.event_data.expires_at : null;

  // Codes and links are only useful for minutes. Sweep stale rows on every
  // webhook so the table never becomes a store of live-looking credentials.
  await pool.query(
    `delete from public.auth_email_pending where updated_at < now() - interval '1 hour'`,
  );

  await pool.query(
    `insert into public.auth_email_pending (email, otp_code, link_url, expires_at, updated_at)
     values ($1, $2, $3, $4, now())
     on conflict (email) do update set
       otp_code = coalesce(excluded.otp_code, public.auth_email_pending.otp_code),
       link_url = coalesce(excluded.link_url, public.auth_email_pending.link_url),
       expires_at = coalesce(excluded.expires_at, public.auth_email_pending.expires_at),
       updated_at = now()`,
    [email, otpCode, linkUrl, expiresAt],
  );

  const deadline = Date.now() + WAIT_MS;
  let row = await readPending(email);
  while (Date.now() < deadline && (!row?.otp_code || !row?.link_url)) {
    await sleep(POLL_MS);
    row = await readPending(email);
  }
  if (!row) {
    return json({ error: 'Pending row missing' }, 500);
  }

  const digest = digestSignInEmail({ otpCode: row.otp_code, linkUrl: row.link_url });
  if (!digest.replace(/\|/g, '')) {
    return json({ error: 'Nothing to send' }, 500);
  }

  // Atomic claim instead of a session advisory lock: the pool could lock and
  // unlock on different connections (duplicate mails, leaked locks — M-AUTH-3).
  // Exactly one webhook wins the right to send this digest.
  const claim = await pool.query<PendingRow>(
    `update public.auth_email_pending
     set sent_digest = $2, sent_at = now(), updated_at = now()
     where email = $1 and sent_digest is distinct from $2
       -- Only if the row still holds what we read; a newer code's webhook sends that one.
       and otp_code is not distinct from $3 and link_url is not distinct from $4
     returning email, otp_code, link_url, sent_digest, sent_at`,
    [email, digest, row.otp_code, row.link_url],
  );
  const claimed = claim.rows[0];
  if (!claimed) return json({ ok: true, deduped: true });

  const release = () =>
    pool
      .query(
        `update public.auth_email_pending set sent_digest = null, sent_at = null
         where email = $1 and sent_digest = $2`,
        [email, digest],
      )
      .catch(() => undefined);

  // 200 either way so Neon doesn't retry; a capped address just gets no mail.
  const capped = await overSendCap(email);
  if (capped) {
    console.warn(`[authemail] send cap reached (${capped})`);
    return json({ ok: true, capped: true });
  }

  const emailContent = buildSignInEmail({
    otpCode: claimed.otp_code,
    linkUrl: claimed.link_url,
  });
  const sent = await sendResend(resendKey, email, emailContent);
  if (!sent.ok) {
    await release();
    return json({ error: sent.error }, 502);
  }
  return json({ ok: true, sent: true });
}

/** Password reset, email verification, email change — anything but signing in. */
function isNonSignInOtp(otpType: string): boolean {
  return /pass|reset|forget|forgot|verif|change/i.test(otpType);
}

/** Counts one send against both caps. Returns which cap is full, or null. */
async function overSendCap(email: string): Promise<'address' | 'total' | null> {
  const take = async (key: string, max: number) => {
    const { rows } = await pool.query<{ allowed: boolean }>(
      `select allowed from public.consume_submit_rate($1, $2, $3)`,
      [key, 3600, max],
    );
    return rows[0]?.allowed !== false;
  };
  // Hash the address: the bucket table is not a place to keep emails.
  const who = createHash('sha256').update(email).digest('hex').slice(0, 32);
  if (!(await take(`authmail:to:${who}`, MAX_PER_ADDRESS_PER_HOUR))) return 'address';
  if (!(await take('authmail:all', MAX_TOTAL_PER_HOUR))) return 'total';
  return null;
}

type PendingRow = {
  email: string;
  otp_code: string | null;
  link_url: string | null;
  sent_digest: string | null;
  sent_at: Date | null;
};

async function readPending(email: string): Promise<PendingRow | null> {
  const { rows } = await pool.query<PendingRow>(
    `select email, otp_code, link_url, sent_digest, sent_at
     from public.auth_email_pending
     where email = $1`,
    [email],
  );
  return rows[0] ?? null;
}

async function sendResend(
  apiKey: string,
  to: string,
  content: { html: string; text: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const from = process.env.AUTH_EMAIL_FROM?.trim() || AUTH_EMAIL_FROM;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: AUTH_EMAIL_SUBJECT,
      html: content.html,
      text: content.text,
      attachments: [
        {
          filename: 'slate-lockup.png',
          content: SLATE_LOCKUP_PNG_BASE64,
          content_id: AUTH_LOGO_CID,
          content_type: 'image/png',
        },
      ],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return { ok: false, error: `Resend ${res.status}: ${body.slice(0, 240)}` };
  }
  return { ok: true };
}

type WebhookPayload = {
  event_type?: string;
  user?: { email?: string };
  event_data?: {
    otp_code?: string;
    otp_type?: string;
    link_url?: string;
    expires_at?: string;
  };
};

type Jwk = { kid?: string; kty?: string; crv?: string; x?: string };

let jwksCache: { fetchedAt: number; keys: Jwk[] } | null = null;

function authBaseUrl(): string {
  const explicit = process.env.NEON_AUTH_URL?.trim() || process.env.NEON_AUTH_BASE_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, '');
  throw new Error('NEON_AUTH_URL is not set');
}

async function loadJwks(): Promise<Jwk[]> {
  if (jwksCache && Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS) {
    return jwksCache.keys;
  }
  const res = await fetch(`${authBaseUrl()}/.well-known/jwks.json`, {
    signal: AbortSignal.timeout(JWKS_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`JWKS fetch failed (${res.status})`);
  }
  const body = (await res.json()) as { keys?: Jwk[] };
  const keys = Array.isArray(body.keys) ? body.keys : [];
  jwksCache = { fetchedAt: Date.now(), keys };
  return keys;
}

async function verifyNeonWebhook(
  rawBody: string,
  headers: { signature?: string; kid?: string; timestamp?: string },
): Promise<void> {
  // No bypass switch: a deploy with one set is an open mail relay.
  const { signature, kid, timestamp } = headers;
  if (!signature || !kid || !timestamp) {
    throw new Error('Missing Neon webhook signature headers');
  }
  const ageMs = Date.now() - Number(timestamp);
  if (!Number.isFinite(ageMs) || ageMs > 5 * 60 * 1000 || ageMs < -30_000) {
    throw new Error('Webhook timestamp too old');
  }
  const keys = await loadJwks();
  const jwk = keys.find((k) => k.kid === kid);
  if (!jwk) throw new Error(`JWKS key ${kid} not found`);
  const publicKey = createPublicKey({ key: jwk, format: 'jwk' });
  const [headerB64, emptyPayload, signatureB64] = signature.split('.');
  if (!headerB64 || emptyPayload !== '' || !signatureB64) {
    throw new Error('Expected detached JWS format');
  }
  const payloadB64 = Buffer.from(rawBody, 'utf8').toString('base64url');
  const signaturePayload = `${timestamp}.${payloadB64}`;
  const signaturePayloadB64 = Buffer.from(signaturePayload, 'utf8').toString('base64url');
  const signingInput = `${headerB64}.${signaturePayloadB64}`;
  const ok = verify(
    null,
    Buffer.from(signingInput),
    publicKey,
    Buffer.from(signatureB64, 'base64url'),
  );
  if (!ok) throw new Error('Invalid webhook signature');
}

type NeonSigHeaders = { signature?: string; kid?: string; timestamp?: string };

function unpackProxy(
  rawHttp: string,
  c: { req: { header: (name: string) => string | undefined } },
): { rawBody: string; headers: NeonSigHeaders } {
  try {
    const wrap = JSON.parse(rawHttp) as {
      slateProxy?: number;
      rawBody?: unknown;
      headers?: Record<string, string>;
    };
    if (wrap?.slateProxy === 1 && typeof wrap.rawBody === 'string') {
      const h = wrap.headers ?? {};
      return {
        rawBody: wrap.rawBody,
        headers: {
          signature: h['x-neon-signature'] || header(c, 'x-neon-signature'),
          kid: h['x-neon-signature-kid'] || header(c, 'x-neon-signature-kid'),
          timestamp: h['x-neon-timestamp'] || header(c, 'x-neon-timestamp'),
        },
      };
    }
  } catch {
    // raw HTTP body is the webhook payload
  }
  return {
    rawBody: rawHttp,
    headers: {
      signature: header(c, 'x-neon-signature'),
      kid: header(c, 'x-neon-signature-kid'),
      timestamp: header(c, 'x-neon-timestamp'),
    },
  };
}

function header(
  c: { req: { header: (name: string) => string | undefined } },
  name: string,
): string | undefined {
  const aliases = [name, name.toUpperCase()];
  if (name.startsWith('x-neon-')) {
    aliases.push(`x-slate-${name.slice('x-neon-'.length)}`);
    aliases.push(`X-Slate-${name.slice('x-neon-'.length)}`);
  }
  for (const key of aliases) {
    const value = c.req.header(key);
    if (value) return value;
  }
  return undefined;
}

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default app;
