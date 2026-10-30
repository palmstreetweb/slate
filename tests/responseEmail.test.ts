// @vitest-environment node
/**
 * ADR-072: new-response emails. The token, the email and the scheduled run of `notifysend`.
 * The database is a small stand-in for 023's functions; Resend is a mocked fetch.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { unsubToken, verifyUnsubToken } from '../neon/functions/notify-send/unsubToken.js';
import {
  buildResponseEmail,
  cleanFormName,
  countPhrase,
  responseEmailSubject,
} from '../neon/functions/notify-send/notifyEmail.js';

const SECRET = 's'.repeat(40);

describe('unsubscribe token', () => {
  it('round-trips the form id', () => {
    const t = unsubToken(SECRET, 'f_abc123def456');
    expect(verifyUnsubToken(SECRET, t)).toBe('f_abc123def456');
  });

  it('refuses another secret, another form, a cut token and junk', () => {
    const t = unsubToken(SECRET, 'f_abc123def456');
    expect(verifyUnsubToken('x'.repeat(40), t)).toBeNull();
    expect(verifyUnsubToken(SECRET, t.replace('f_abc', 'f_abd'))).toBeNull();
    expect(verifyUnsubToken(SECRET, t.slice(0, -1))).toBeNull();
    expect(verifyUnsubToken(SECRET, '')).toBeNull();
    expect(verifyUnsubToken(SECRET, undefined)).toBeNull();
    expect(verifyUnsubToken(SECRET, `${'a'.repeat(200)}.x`)).toBeNull();
  });

  it('never signs or checks with a short secret', () => {
    expect(() => unsubToken('short', 'f_abc123def456')).toThrow();
    const t = unsubToken(SECRET, 'f_abc123def456');
    expect(verifyUnsubToken('short', t)).toBeNull();
  });
});

describe('the email', () => {
  const base = {
    formName: 'Roof estimate',
    newCount: 3,
    responsesUrl: 'https://slateforms.vercel.app/forms/f_1/submissions',
    unsubscribeUrl: 'https://notify.example/unsubscribe?t=abc',
  };

  it('says how many and where, and nothing else', () => {
    const e = buildResponseEmail(base);
    expect(e.subject).toBe('3 new responses on “Roof estimate”');
    expect(e.text).toContain('See responses: https://slateforms.vercel.app/forms/f_1/submissions');
    expect(e.text).toContain(
      'Turn off emails for this form: https://notify.example/unsubscribe?t=abc',
    );
    expect(e.html).toContain('See responses');
  });

  it('one response is “it”, more are “them”, in the body and the preview line', () => {
    const one = buildResponseEmail({ ...base, newCount: 1 });
    expect(one.html).toContain('Open Slate to read it.');
    expect(one.html).not.toContain('read them');
    expect(buildResponseEmail(base).html).not.toContain('read it.');
  });

  it('counts in plain words', () => {
    expect(countPhrase(1)).toBe('1 new response');
    expect(countPhrase(1200 - 201)).toBe('999 new responses');
    expect(countPhrase(1000)).toBe('1,000+ new responses');
    expect(responseEmailSubject('X', 1)).toBe('1 new response on “X”');
  });

  it('escapes the owner’s form name and keeps it to one short line', () => {
    const e = buildResponseEmail({
      ...base,
      formName: '<img src=x onerror=alert(1)>\r\nBcc: a@b.c',
    });
    expect(e.html).not.toContain('<img src=x');
    expect(e.subject).not.toMatch(/[\r\n]/);
    expect(cleanFormName('a'.repeat(200))).toHaveLength(80);
    expect(cleanFormName('   ')).toBe('Untitled form');
  });

  it('refuses links that are not https', () => {
    expect(() => buildResponseEmail({ ...base, responsesUrl: 'javascript:alert(1)' })).toThrow();
    expect(() => buildResponseEmail({ ...base, unsubscribeUrl: 'http://x.example/u' })).toThrow();
  });
});

// --- the scheduled run --------------------------------------------------------

type Due = {
  form_id: string;
  owner_id: string;
  owner_email: string;
  form_name: string;
  new_count: number;
  upto: string;
  owner_sent_today: number;
  total_sent_today: number;
};

const db = vi.hoisted(() => ({
  locked: false,
  lockFree: true,
  ownerMax: 50,
  dayMax: 300,
  due: [] as Due[],
  sent: [] as Array<[string, string, string]>,
  failed: [] as string[],
  unsubscribed: [] as string[],
  released: 0,
  log: [] as string[],
}));

vi.mock('pg', () => {
  const query = async (sql: string, params: unknown[] = []) => {
    const q = sql.replace(/\s+/g, ' ').trim();
    db.log.push(q);
    if (q.startsWith('select pg_try_advisory_lock')) {
      db.locked = db.lockFree;
      return { rows: [{ ok: db.lockFree }] };
    }
    if (q.startsWith('select pg_advisory_unlock')) {
      db.locked = false;
      return { rows: [{ ok: true }] };
    }
    if (q.includes('response_email_owner_day_max()')) {
      return { rows: [{ owner_max: db.ownerMax, day_max: db.dayMax }] };
    }
    if (q.startsWith('select * from public.response_emails_due')) return { rows: db.due };
    if (q.startsWith('select public.response_email_sent')) {
      db.sent.push(params as [string, string, string]);
      return { rows: [] };
    }
    if (q.startsWith('select public.response_email_failed')) {
      db.failed.push(params[0] as string);
      return { rows: [] };
    }
    if (q.startsWith('select public.response_email_unsubscribe')) {
      db.unsubscribed.push(params[0] as string);
      return { rows: [{ response_email_unsubscribe: true }] };
    }
    throw new Error(`unexpected SQL: ${q}`);
  };
  return {
    Pool: class {
      on() {
        return this;
      }
      query = query;
      async connect() {
        return { query, release: () => (db.released += 1) };
      }
    },
  };
});

const ENV = {
  DATABASE_URL: 'postgres://x',
  RESEND_API_KEY: 're_test',
  UNSUB_SECRET: SECRET,
  NOTIFY_PUBLIC_URL: 'https://notify.example',
};

function dueRow(over: Partial<Due> = {}): Due {
  return {
    form_id: 'f_aaaaaaaaaaaa',
    owner_id: 'owner-1',
    owner_email: 'owner@example.com',
    form_name: 'Roof estimate',
    new_count: 2,
    upto: '2026-10-30T12:00:00.000Z',
    owner_sent_today: 0,
    total_sent_today: 0,
    ...over,
  };
}

describe('notifysend', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let app: { request: (path: string, init?: RequestInit) => Response | Promise<Response> };

  beforeEach(async () => {
    Object.assign(db, {
      locked: false,
      lockFree: true,
      ownerMax: 50,
      dayMax: 300,
      due: [],
      sent: [],
      failed: [],
      unsubscribed: [],
      released: 0,
      log: [],
    });
    for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
    fetchMock = vi.fn(async () => new Response('{"id":"e_1"}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    vi.resetModules();
    app = (await import('../neon/functions/notify-send/index.js')).default as typeof app;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const run = () =>
    app.request('/run', {
      method: 'POST',
      headers: { 'x-neon-trigger-invocation-id': 'inv-1', 'content-type': 'application/json' },
      body: JSON.stringify({ data: { scheduled_at: '2026-10-30T12:00:00Z' } }),
    });

  it('only the schedule can start a run', async () => {
    const res = await app.request('/run', { method: 'POST' });
    expect(res.status).toBe(403);
    expect(db.log).toHaveLength(0);
  });

  it('refuses to run half-configured', async () => {
    vi.stubEnv('UNSUB_SECRET', 'short');
    const res = await run();
    expect(res.status).toBe(500);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends one email per due form and moves its cursor', async () => {
    db.due = [dueRow()];
    const res = await run();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, due: 1, sent: 1, failed: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    const headers = init.headers as Record<string, string>;
    expect(headers['Idempotency-Key']).toBe(`resp-f_aaaaaaaaaaaa-${Date.parse(dueRow().upto)}`);
    const body = JSON.parse(String(init.body));
    expect(body.to).toEqual(['owner@example.com']);
    expect(body.subject).toBe('2 new responses on “Roof estimate”');
    expect(body.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    expect(body.headers['List-Unsubscribe']).toMatch(
      /^<https:\/\/notify\.example\/unsubscribe\?t=f_aaaaaaaaaaaa\./,
    );
    expect(body.html).toContain('https://slateforms.vercel.app/forms/f_aaaaaaaaaaaa/submissions');
    expect(db.sent).toEqual([['f_aaaaaaaaaaaa', 'owner-1', '2026-10-30T12:00:00.000Z']]);
    expect(db.locked).toBe(false);
    expect(db.released).toBe(1);
  });

  it('a failed send keeps the cursor and backs off', async () => {
    fetchMock.mockResolvedValueOnce(new Response('nope', { status: 500 }));
    db.due = [dueRow()];
    expect(await (await run()).json()).toMatchObject({ sent: 0, failed: 1 });
    expect(db.sent).toEqual([]);
    expect(db.failed).toEqual(['f_aaaaaaaaaaaa']);
  });

  it('a send that throws (timeout) is a failure, and the run goes on', async () => {
    fetchMock.mockRejectedValueOnce(new Error('timeout'));
    db.due = [dueRow(), dueRow({ form_id: 'f_bbbbbbbbbbbb' })];
    expect(await (await run()).json()).toMatchObject({ sent: 1, failed: 1 });
    expect(db.failed).toEqual(['f_aaaaaaaaaaaa']);
    expect(db.sent.map((s) => s[0])).toEqual(['f_bbbbbbbbbbbb']);
  });

  it('holds the owner’s cap across forms in one run', async () => {
    db.ownerMax = 2;
    db.due = [
      dueRow({ form_id: 'f_aaaaaaaaaaaa', owner_sent_today: 1 }),
      dueRow({ form_id: 'f_bbbbbbbbbbbb', owner_sent_today: 1 }),
      dueRow({ form_id: 'f_cccccccccccc', owner_id: 'owner-2', owner_sent_today: 0 }),
    ];
    expect(await (await run()).json()).toMatchObject({ sent: 2, capped: 1 });
    expect(db.sent.map((s) => s[0])).toEqual(['f_aaaaaaaaaaaa', 'f_cccccccccccc']);
  });

  it('holds the day’s cap for everyone', async () => {
    db.dayMax = 1;
    db.due = [
      dueRow({ total_sent_today: 0 }),
      dueRow({ form_id: 'f_bbbbbbbbbbbb', owner_id: 'o2' }),
    ];
    expect(await (await run()).json()).toMatchObject({ sent: 1, capped: 1 });
  });

  it('a second run at the same time does nothing', async () => {
    db.lockFree = false;
    db.due = [dueRow()];
    expect(await (await run()).json()).toMatchObject({ skipped: 'busy', sent: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(db.log.some((q) => q.includes('response_emails_due'))).toBe(false);
  });

  it('unsubscribe: GET only asks, POST turns emails off', async () => {
    const t = encodeURIComponent(unsubToken(SECRET, 'f_aaaaaaaaaaaa'));
    const get = await app.request(`/unsubscribe?t=${t}`);
    expect(get.status).toBe(200);
    expect(await get.text()).toContain('<form method="post"');
    expect(get.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(db.unsubscribed).toEqual([]);

    const post = await app.request(`/unsubscribe?t=${t}`, {
      method: 'POST',
      body: 'List-Unsubscribe=One-Click',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(post.status).toBe(200);
    expect(await post.text()).toContain('Emails are off');
    expect(db.unsubscribed).toEqual(['f_aaaaaaaaaaaa']);
  });

  it('unsubscribe: a forged token touches nothing', async () => {
    const bad = encodeURIComponent(`f_aaaaaaaaaaaa.${'A'.repeat(43)}`);
    expect((await app.request(`/unsubscribe?t=${bad}`, { method: 'POST' })).status).toBe(400);
    expect((await app.request('/unsubscribe', { method: 'POST' })).status).toBe(400);
    expect(db.log).toHaveLength(0);
  });
});
