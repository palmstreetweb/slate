// @vitest-environment node
import { generateKeyPairSync, sign } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// --- a tiny in-memory stand-in for the two tables the Function touches -----
type Pending = {
  email: string;
  otp_code: string | null;
  link_url: string | null;
  expires_at: string | null;
  sent_digest: string | null;
  sent_at: Date | null;
};
const store = vi.hoisted(() => ({
  pending: new Map<string, Pending>(),
  buckets: new Map<string, number>(),
}));

vi.mock('pg', () => ({
  Pool: class {
    async query(sql: string, params: unknown[] = []) {
      const q = sql.replace(/\s+/g, ' ').trim();
      if (q.startsWith('delete from public.auth_email_pending')) return { rows: [] };
      if (q.startsWith('insert into public.auth_email_pending')) {
        const [email, otp, link, exp] = params as [
          string,
          string | null,
          string | null,
          string | null,
        ];
        const cur = store.pending.get(email);
        store.pending.set(email, {
          email,
          otp_code: otp ?? cur?.otp_code ?? null,
          link_url: link ?? cur?.link_url ?? null,
          expires_at: exp ?? cur?.expires_at ?? null,
          sent_digest: cur?.sent_digest ?? null,
          sent_at: cur?.sent_at ?? null,
        });
        return { rows: [] };
      }
      if (q.startsWith('select email, otp_code')) {
        const row = store.pending.get(params[0] as string);
        return { rows: row ? [{ ...row }] : [] };
      }
      if (q.startsWith('update public.auth_email_pending set sent_digest = $2')) {
        const [email, digest, otp, link] = params as [string, string, string | null, string | null];
        const row = store.pending.get(email);
        if (!row || row.sent_digest === digest || row.otp_code !== otp || row.link_url !== link) {
          return { rows: [] };
        }
        row.sent_digest = digest;
        row.sent_at = new Date();
        return { rows: [{ ...row }] };
      }
      if (q.startsWith('update public.auth_email_pending set sent_digest = null')) {
        const row = store.pending.get(params[0] as string);
        if (row && row.sent_digest === params[1]) {
          row.sent_digest = null;
          row.sent_at = null;
        }
        return { rows: [] };
      }
      if (q.startsWith('select allowed from public.consume_submit_rate')) {
        const [key, , max] = params as [string, number, number];
        const n = (store.buckets.get(key) ?? 0) + 1;
        store.buckets.set(key, n);
        return { rows: [{ allowed: n <= max }] };
      }
      throw new Error(`unexpected SQL: ${q.slice(0, 60)}`);
    }
  },
}));

const AUTH = 'https://ep-x.neonauth.c-4.us-east-2.aws.neon.tech/neondb/auth';
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const resend = vi.fn();

let app: { fetch: (req: Request) => Promise<Response> };

beforeAll(async () => {
  vi.stubEnv('DATABASE_URL', 'postgres://fake');
  vi.stubEnv('RESEND_API_KEY', 're_test');
  vi.stubEnv('NEON_AUTH_URL', AUTH);
  // The Function waits up to 1.8 s for the matching code/link webhook; tests don't need to.
  vi.stubEnv('AUTH_EMAIL_WAIT_MS', '30');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === `${AUTH}/.well-known/jwks.json`) {
        return Response.json({ keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'k1' }] });
      }
      if (url === 'https://api.resend.com/emails') return resend(JSON.parse(String(init?.body)));
      throw new Error(`unexpected fetch ${url}`);
    }),
  );
  app = (await import('../neon/functions/auth-email/index.ts')).default as never;
});

afterAll(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  store.pending.clear();
  store.buckets.clear();
  resend.mockReset().mockImplementation(async () => Response.json({ id: 'mail_1' }));
});

const b64url = (s: string) => Buffer.from(s, 'utf8').toString('base64url');

function webhook(payload: Record<string, unknown>, opts: { badSig?: boolean } = {}): Request {
  const raw = JSON.stringify(payload);
  const ts = String(Date.now());
  const header = b64url(JSON.stringify({ alg: 'EdDSA', kid: 'k1' }));
  const input = `${header}.${b64url(`${ts}.${b64url(raw)}`)}`;
  let sig = sign(null, Buffer.from(input), privateKey).toString('base64url');
  if (opts.badSig) sig = sig.replace(/^./, sig[0] === 'A' ? 'B' : 'A');
  return new Request('https://fn.example/', {
    method: 'POST',
    headers: {
      'x-neon-signature': `${header}..${sig}`,
      'x-neon-signature-kid': 'k1',
      'x-neon-timestamp': ts,
    },
    body: raw,
  });
}

const otp = (email: string, code: string, otpType?: string) =>
  webhook({
    event_type: 'send.otp',
    user: { email },
    event_data: { otp_code: code, ...(otpType ? { otp_type: otpType } : {}) },
  });
const link = (email: string, url: string) =>
  webhook({ event_type: 'send.magic_link', user: { email }, event_data: { link_url: url } });

describe('authemail webhook', () => {
  it('sends one email for the code + link pair', async () => {
    const [a, b] = await Promise.all([
      app.fetch(otp('nora@example.com', '482913', 'sign-in')),
      app.fetch(link('nora@example.com', 'https://slateforms.vercel.app/?token=abc')),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(resend).toHaveBeenCalledTimes(1);
    const mail = resend.mock.calls[0]![0] as { to: string[]; html: string };
    expect(mail.to).toEqual(['nora@example.com']);
    expect(mail.html).toContain('482913');
  });

  it('never emails a password-reset or verification code as a sign-in code (M-AUTH-1)', async () => {
    for (const type of ['forget-password', 'email-verification', 'reset_password']) {
      const res = await app.fetch(otp('victim@example.com', '111222', type));
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ ignored: `otp:${type}` });
    }
    expect(resend).not.toHaveBeenCalled();
  });

  it('still sends sign-in codes whatever Neon calls them', async () => {
    for (const [i, type] of ['sign-in', 'sign_in', 'signin', undefined].entries()) {
      await app.fetch(otp(`p${i}@example.com`, `12345${i}`, type));
    }
    expect(resend).toHaveBeenCalledTimes(4);
  });

  it('caps sends per address per hour (M-AUTH-2)', async () => {
    for (let i = 0; i < 9; i++) {
      await app.fetch(otp('inbox@example.com', String(100000 + i), 'sign-in'));
    }
    expect(resend).toHaveBeenCalledTimes(6);
    // The cap key is a hash, never the raw address.
    expect([...store.buckets.keys()].some((k) => k.includes('inbox@example.com'))).toBe(false);
  });

  it('frees the claim when Resend fails, so a retry can send', async () => {
    resend.mockImplementationOnce(async () => new Response('down', { status: 500 }));
    const first = await app.fetch(otp('retry@example.com', '555666', 'sign-in'));
    expect(first.status).toBe(502);
    const again = await app.fetch(otp('retry@example.com', '555666', 'sign-in'));
    expect(again.status).toBe(200);
    expect(resend).toHaveBeenCalledTimes(2);
  });

  it('rejects a bad signature without sending', async () => {
    const res = await app.fetch(
      webhook(
        { event_type: 'send.otp', user: { email: 'x@example.com' }, event_data: { otp_code: '1' } },
        { badSig: true },
      ),
    );
    expect(res.status).toBe(401);
    expect(resend).not.toHaveBeenCalled();
  });

  it('has no signature bypass switch anymore', async () => {
    vi.stubEnv('AUTH_WEBHOOK_SKIP_VERIFY', '1');
    vi.stubEnv('NODE_ENV', 'development');
    const res = await app.fetch(
      new Request('https://fn.example/', {
        method: 'POST',
        body: JSON.stringify({ event_type: 'send.otp', user: { email: 'x@example.com' } }),
      }),
    );
    expect(res.status).toBe(401);
    vi.stubEnv('AUTH_WEBHOOK_SKIP_VERIFY', '');
  });
});
