/**
 * Branch harness for ADR-067 (storage quotas): applies migration 021 to a THROWAWAY Neon branch of
 * production, runs the REAL storagesign and submitresponse Hono apps in-process against it (ten
 * copies of storagesign, like ten isolates), plus the currently deployed builds of both Functions
 * (extracted from OLD_REF, default 9843d6a = storagesign 14 / submitresponse 11), and prints a
 * pass/fail line per scenario, then latency. Tries 021's rollback block (the old Functions keep
 * working) and re-applies 021. Not part of `npm test`.
 *
 *   npx vite-node scripts/check-storage-quotas.ts
 *       creates branch step11-harness-<time> from production, runs, and DELETES it at the end,
 *       failed or not.
 *   CONFIRM_BRANCH=1 DATABASE_URL=<branch neondb_owner> npx vite-node scripts/check-storage-quotas.ts
 *       runs against an existing throwaway branch (not deleted).
 *
 * The host must never be production (PROD_ENDPOINT, default ep-misty-snow-ax9wxjvf): asserted
 * before any write. Object Storage is STUBBED: a local S3 look-alike on 127.0.0.1 that checks each
 * presigned PUT's SigV4 signature (with the harness's own placeholder keys) the way S3 does, and
 * records HEAD / DELETE. A Neon branch lists production's objects in its bucket, and nothing here
 * shows its writes are isolated, so the harness writes to no bucket at all. The connection string
 * and the branch's credentials are never printed.
 */

import { execFileSync } from 'node:child_process';
import { generateKeyPairSync, sign as edSign, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import pg from 'pg';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { applyBackfill, loadDbState, planBackfill } from './storageBackfill.js';
import { networkKey } from '../neon/functions/storage-sign/uploadKey.js';

type App = { request: (path: string, init: RequestInit) => Response | Promise<Response> };

const PROJECT = process.env.NEON_PROJECT_ID || 'odd-voice-53972178';
const PROD_ENDPOINT = process.env.PROD_ENDPOINT || 'ep-misty-snow-ax9wxjvf';
const OLD_REF = process.env.OLD_REF || '9843d6a';
const ROOT = resolve('.');
const GiB = 1024 ** 3;
/** storage_quota_limit(), read from the branch once 021 is applied. */
let QUOTA = 0;
const MiB = 1024 ** 2;

/* ---------- the throwaway branch ---------- */

let createdBranch: string | null = null;

function neonctl(args: string[]): string {
  return execFileSync('npx', ['-y', 'neonctl@latest', ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function assertNotProduction(url: string): void {
  const host = new URL(url).hostname;
  if (host.includes(PROD_ENDPOINT) || host.includes('ep-misty-snow')) {
    throw new Error('Refusing: this connection string points at production.');
  }
}

function branchUrl(): string {
  if (process.env.DATABASE_URL) {
    if (process.env.CONFIRM_BRANCH !== '1') {
      throw new Error('Set CONFIRM_BRANCH=1 with DATABASE_URL (a throwaway branch only).');
    }
    return process.env.DATABASE_URL;
  }
  const name = `step11-harness-${Date.now()}`;
  // The JSON carries connection URIs with a password: parsed, never printed.
  const out = JSON.parse(
    neonctl([
      'branches',
      'create',
      '--project-id',
      PROJECT,
      '--parent',
      'production',
      '--name',
      name,
      '--output',
      'json',
    ]),
  ) as { branch?: { id?: string }; id?: string };
  createdBranch = out.branch?.id ?? out.id ?? null;
  if (!createdBranch) throw new Error('branches create returned no id');
  console.log(`[harness] created branch ${name} (${createdBranch})`);
  return neonctl([
    'connection-string',
    createdBranch,
    '--project-id',
    PROJECT,
    '--role-name',
    'neondb_owner',
  ]).trim();
}

function deleteBranch(): void {
  if (!createdBranch) return;
  try {
    neonctl(['branches', 'delete', createdBranch, '--project-id', PROJECT]);
    console.log(`[harness] deleted branch ${createdBranch}`);
  } catch (err) {
    console.error(
      `[harness] COULD NOT DELETE BRANCH ${createdBranch}: delete it by hand`,
      err instanceof Error ? err.message.slice(0, 200) : err,
    );
    process.exitCode = 1;
  }
}

/* ---------- env, JWKS stub and S3 stub (before any app loads) ---------- */

const AUTH_BASE = 'https://auth.test/neondb/auth';
const S3_KEY = { accessKeyId: 'harness-key', secretAccessKey: 'harness-secret-not-real' };
const REGION = 'us-east-2';
const BUCKET = 'form-uploads';

const keys = generateKeyPairSync('ed25519');
const jwk = { ...keys.publicKey.export({ format: 'jwk' }), kid: 'harness-kid', alg: 'EdDSA' };
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith('https://auth.test/')) {
    return new Response(JSON.stringify({ keys: [jwk] }), { status: 200 });
  }
  return realFetch(input, init);
}) as typeof fetch;

function userJwt(sub: string): string {
  const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
  const head = b64({ alg: 'EdDSA', kid: 'harness-kid' });
  const body = b64({
    sub,
    role: 'authenticated',
    iss: 'https://auth.test',
    exp: Math.floor(Date.now() / 1000) + 3600,
  });
  return `${head}.${body}.${edSign(null, Buffer.from(`${head}.${body}`), keys.privateKey).toString('base64url')}`;
}

type StubObject = { size: number; type: string };
const s3 = {
  objects: new Map<string, StubObject>(),
  deletes: [] as string[],
  heads: [] as string[],
  puts: { ok: 0, refused: 0 },
  server: null as Server | null,
  endpoint: '',
};

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((ok, fail) => {
    const parts: Buffer[] = [];
    req.on('data', (d: Buffer) => parts.push(d));
    req.on('end', () => ok(Buffer.concat(parts)));
    req.on('error', fail);
  });
}

function amzDate(s: string): Date {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(s);
  if (!m) return new Date(NaN);
  return new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!));
}

/**
 * A presigned PUT is accepted only when its signature is what the Function would have produced for
 * this key, this Content-Type and THIS Content-Length (recomputed with the SDK's own presigner and
 * the same signing time), and it hasn't expired. That's S3's rule: a body of another length fails.
 */
async function acceptsPut(req: IncomingMessage, url: URL, body: Buffer): Promise<boolean> {
  const got = url.searchParams.get('X-Amz-Signature');
  const at = amzDate(url.searchParams.get('X-Amz-Date') ?? '');
  const expires = Number(url.searchParams.get('X-Amz-Expires'));
  if (!got || Number.isNaN(at.getTime()) || Date.now() > at.getTime() + expires * 1000)
    return false;
  const signed = (url.searchParams.get('X-Amz-SignedHeaders') ?? '').split(';');
  if (!signed.includes('content-length') || !signed.includes('content-type')) return false;
  const key = decodeURIComponent(url.pathname.slice(`/${BUCKET}/`.length));
  const client = new S3Client({
    region: REGION,
    endpoint: s3.endpoint,
    forcePathStyle: true,
    credentials: S3_KEY,
  });
  const again = await getSignedUrl(
    client,
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      ContentType: String(req.headers['content-type'] ?? ''),
      ContentLength: body.length,
    }),
    {
      expiresIn: expires,
      signableHeaders: new Set(['content-type', 'content-length']),
      signingDate: at,
    },
  );
  return new URL(again).searchParams.get('X-Amz-Signature') === got;
}

async function startS3(): Promise<void> {
  s3.server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', s3.endpoint);
      const key = decodeURIComponent(url.pathname.slice(`/${BUCKET}/`.length));
      const body = await readBody(req);
      if (req.method === 'PUT') {
        if (await acceptsPut(req, url, body)) {
          s3.objects.set(key, { size: body.length, type: String(req.headers['content-type']) });
          s3.puts.ok += 1;
          res.writeHead(200, { ETag: '"harness"' }).end();
        } else {
          s3.puts.refused += 1;
          res.writeHead(403).end('<Error><Code>SignatureDoesNotMatch</Code></Error>');
        }
        return;
      }
      if (req.method === 'HEAD') {
        s3.heads.push(key);
        const o = s3.objects.get(key);
        if (!o) return void res.writeHead(404).end();
        res.writeHead(200, { 'Content-Length': String(o.size), 'Content-Type': o.type }).end();
        return;
      }
      if (req.method === 'DELETE') {
        s3.deletes.push(key);
        s3.objects.delete(key);
        return void res.writeHead(204).end();
      }
      res.writeHead(405).end();
    })().catch(() => res.writeHead(500).end());
  });
  await new Promise<void>((ok) => s3.server!.listen(0, '127.0.0.1', ok));
  const addr = s3.server.address();
  if (!addr || typeof addr === 'string') throw new Error('stub S3 did not start');
  s3.endpoint = `http://127.0.0.1:${addr.port}`;
}

/* ---------- db helpers ---------- */

let db: pg.Pool;
const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
  (await db.query(sql, params)).rows as T[];

async function asRole(
  role: 'authenticated' | 'anonymous',
  sub: string | null,
  sql: string,
  params: unknown[] = [],
) {
  const c = await db.connect();
  try {
    await c.query('select auth.user_id()'); // pg_session_jwt warm-up as neondb_owner
    await c.query('begin');
    await c.query(`set local role ${role}`);
    await c.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify(sub ? { sub, role } : { role }),
    ]);
    const r = await c.query(sql, params);
    await c.query('commit');
    return r;
  } catch (err) {
    await c.query('rollback').catch(() => {});
    throw err;
  } finally {
    c.release();
  }
}

async function sqlError(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (err) {
    return (err as { code?: string }).code ?? 'error';
  }
}

function migrationSql(): string {
  return readFileSync(resolve('neon/migrations/021_storage_quotas.sql'), 'utf8');
}

function rollbackSql(): string {
  const text = migrationSql();
  return text
    .slice(text.indexOf('-- Rollback'))
    .split('\n')
    .filter((l) => l.startsWith('--   '))
    .map((l) => l.slice(5))
    .filter((l) => !l.startsWith('then:'))
    .join('\n');
}

/* ---------- results ---------- */

const results: Array<{ name: string; ok: boolean }> = [];
function check(name: string, ok: boolean, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

/* ---------- fixtures ---------- */

const A = 'u_s11_owner_a';
const B = 'u_s11_owner_b';
const F = {
  files: 'f_s11files0001',
  other: 'f_s11other0001',
  quota: 'f_s11quota0001',
  doomed: 'f_s11doomd0001',
};
const SLUG: Record<keyof typeof F, string> = { files: '', other: '', quota: '', doomed: '' };

const filesSchema = {
  brand: { name: 'Harness roof check' },
  questions: [
    { id: 'q_name', type: 'short_text', title: 'Name' },
    { id: 'q_docs', type: 'file_upload', title: 'Docs', maxSizeMb: 5 },
    { id: 'q_big', type: 'file_upload', title: 'Anything' },
    { id: 'q_voice', type: 'voice_note', title: 'Tell us', maxSeconds: 30 },
    {
      id: 'q_shots',
      type: 'photo_checklist',
      title: 'Photos',
      items: [
        { label: 'Front', value: 'front' },
        { label: 'Back', value: 'back' },
      ],
    },
  ],
};

const taken = new Set<string>();
function slug8(): string {
  for (;;) {
    const s = String(10_000_000 + Math.floor(Math.random() * 89_999_999));
    if (!taken.has(s)) {
      taken.add(s);
      return s;
    }
  }
}

async function seed() {
  for (const r of await q<{ slug: string }>('select slug from public.forms')) taken.add(r.slug);
  const rows: Array<[keyof typeof F, string]> = [
    ['files', A],
    ['other', A],
    ['doomed', A],
    ['quota', B],
  ];
  for (const [k, owner] of rows) {
    SLUG[k] = slug8();
    await asRole(
      'authenticated',
      owner,
      `insert into public.forms (id, name, slug, schema, published_schema, status)
       values ($1, $2, $3, $4::jsonb, $4::jsonb, 'published')`,
      [F[k], `Harness ${k}`, SLUG[k], JSON.stringify(filesSchema)],
    );
  }
}

async function cleanup() {
  await q(`delete from public.form_uploads where form_id like 'f_s11%'`).catch(() => {});
  await q(`delete from public.submissions where form_id like 'f_s11%'`).catch(() => {});
  await q(`delete from public.forms where id like 'f_s11%'`).catch(() => {});
  await q(`delete from public.form_uploads where form_id like 'f_s11%'`).catch(() => {});
  await q(`delete from public.retired_slugs where owner_id like 'u_s11%'`).catch(() => {});
  await q(`delete from public.submit_rate_buckets where bucket_key like '%10.67.%'`).catch(
    () => {},
  );
}

/* ---------- request helpers ---------- */

let signApps: App[] = [];
let submitApp: App;
let oldSign: App;
let oldSubmit: App;
const sign = () => signApps[0]!;

/** ip null: no X-Forwarded-For at all (the no-IP share). */
function post(app: App, body: unknown, ip: string | null, headers: Record<string, string> = {}) {
  return app.request('/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(ip === null ? {} : { 'X-Forwarded-For': ip }),
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

let ipN = 0;
const freshIp = () => `10.67.${Math.floor(++ipN / 250)}.${(ipN % 250) + 1}`;

type Signed = { status: number; key?: string; url?: string; text: string };

async function signUpload(
  app: App,
  o: {
    formId?: string;
    questionId?: string | null;
    size: number;
    name?: string;
    type?: string;
    scope?: 'public' | 'draft';
    bearer?: string;
    path?: string;
    ip?: string | null;
  },
): Promise<Signed> {
  const scope = o.scope ?? 'public';
  const res = await post(
    app,
    {
      op: 'upload',
      path: o.path ?? `${scope}/${o.formId ?? F.files}/${randomUUID()}/${o.name ?? 'photo.jpg'}`,
      contentType: o.type ?? 'image/jpeg',
      contentLength: o.size,
      ...(o.questionId === null ? {} : { questionId: o.questionId ?? 'q_big' }),
    },
    o.ip === undefined ? freshIp() : o.ip,
    o.bearer ? { Authorization: `Bearer ${o.bearer}` } : {},
  );
  const text = await res.text();
  let body: { key?: string; url?: string } = {};
  try {
    body = JSON.parse(text) as typeof body;
  } catch {
    // plain-text refusal
  }
  return { status: res.status, key: body.key, url: body.url, text };
}

async function putObject(url: string, size: number, type = 'image/jpeg'): Promise<number> {
  const res = await realFetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': type },
    body: Buffer.alloc(size, 7),
  });
  return res.status;
}

/** Sign (new shape) and upload; returns the stored ref. */
async function uploadFile(questionId: string, size = 200_000, formId = F.files): Promise<string> {
  const s = await signUpload(sign(), { formId, questionId, size });
  if (s.status !== 200 || !s.key || !s.url) throw new Error(`sign ${s.status}: ${s.text}`);
  const put = await putObject(s.url, size);
  if (put !== 200) throw new Error(`put ${put}`);
  return `slate-file://storage:${s.key}`;
}

const meta = () => ({
  startedAt: new Date(Date.now() - 60_000).toISOString(),
  completedAt: new Date().toISOString(),
  durationMs: 60_000,
  questionsVisited: [],
  hiddenFields: {},
});

async function submit(
  app: App,
  answers: Record<string, unknown>,
  o: { formId?: string; submitId?: string; ip?: string } = {},
) {
  const res = await post(
    app,
    {
      formId: o.formId ?? F.files,
      answers,
      meta: meta(),
      ...(o.submitId ? { submitId: o.submitId } : {}),
    },
    o.ip === undefined ? freshIp() : o.ip,
  );
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text) as typeof body;
  } catch {
    // plain text
  }
  return { status: res.status, body, text };
}

const keyOf = (ref: string) => ref.slice('slate-file://storage:'.length);
const row = async (key: string) =>
  (
    await q<{
      state: string;
      submission_id: string | null;
      bytes: string;
      question_id: string | null;
      legacy: boolean;
      owner_id: string;
      verified_at: Date | null;
    }>(`select * from public.form_uploads where key = $1`, [key])
  )[0];
const usage = async (owner: string) =>
  Number(
    (
      await q<{ n: string }>(
        `select coalesce(sum(bytes), 0) as n from public.form_uploads
          where owner_id = $1 and (state = 'claimed' or (state = 'pending' and created_at > now() - interval '24 hours'))`,
        [owner],
      )
    )[0]!.n,
  );
const quotaStatus = async (owner: string) =>
  (await asRole('authenticated', owner, 'select * from public.storage_quota_status()')).rows[0] as {
    used_bytes: string;
    max_bytes: string;
  };

/* ---------- the Functions as deployed today (OLD_REF) ---------- */

function extractOldFunctions(): string {
  const dir = mkdtempSync(join(tmpdir(), 'slate-s11-old-'));
  const files = execFileSync(
    'git',
    [
      'ls-tree',
      '-r',
      '--name-only',
      OLD_REF,
      'neon/functions/storage-sign',
      'neon/functions/submit-response',
    ],
    { encoding: 'utf8' },
  )
    .split('\n')
    .filter(Boolean);
  for (const f of files) {
    const out = join(dir, f);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, execFileSync('git', ['show', `${OLD_REF}:${f}`]));
  }
  symlinkSync(join(ROOT, 'node_modules'), join(dir, 'node_modules'));
  return dir;
}

/* ---------- scenarios ---------- */

async function migration() {
  const [first] = await q<{ t: Date }>('select public.storage_legacy_until() as t');
  await db.query(migrationSql());
  const [second] = await q<{ t: Date }>('select public.storage_legacy_until() as t');
  const hours = (new Date(first!.t).getTime() - Date.now()) / 3_600_000;
  check(
    '021 applies twice; the legacy grace is fixed by the first run (~72 h) and kept by the second',
    new Date(first!.t).getTime() === new Date(second!.t).getTime() && hours > 71 && hours <= 72,
    `${hours.toFixed(2)} h`,
  );
}

async function grants() {
  const denied = async (role: 'anonymous' | 'authenticated', sql: string) =>
    (await sqlError(() => asRole(role, role === 'authenticated' ? A : null, sql))) === '42501';
  const probes = [
    'select * from public.form_uploads limit 1',
    'select * from public.storage_sweep_state',
    `select * from public.reserve_upload('public/f_s11files0001/${randomUUID()}/x.jpg', 'u', 'f_s11files0001', null, 1, 'image/jpeg', false, 'noip')`,
    'select * from public.storage_quota_overrides',
    `insert into public.storage_quota_overrides (owner_id, bytes) values ('${A}', 5368709120)`,
    `select public.storage_quota_for('${A}')`,
    'select public.storage_pending_count_window()',
    `select * from public.insert_public_submission('s_x', 'f_s11files0001', '{}'::jsonb, '{}'::jsonb, '[]'::jsonb, null)`,
    'select * from public.storage_sweep_begin(10)',
    `select * from public.storage_sweep_finish('{}', '[]', false)`,
    `select public.upload_keys_of('{}'::jsonb)`,
    'select public.storage_legacy_until()',
  ];
  let all = true;
  for (const role of ['anonymous', 'authenticated'] as const) {
    for (const p of probes)
      if (!(await denied(role, p))) all = (console.log('  open:', role, p), false);
  }
  check('Data API roles can reach none of 021 (table, gate, reserve, insert, sweep, helpers)', all);
  check(
    'storage_quota_status is refused to anonymous',
    await denied('anonymous', 'select * from public.storage_quota_status()'),
  );
}

async function signing() {
  const asked = randomUUID();
  const res = await signUpload(sign(), {
    questionId: 'q_big',
    size: 300_000,
    path: `public/${F.files}/${asked}/Roof photo (1).jpg`,
  });
  const r = res.key ? await row(res.key) : undefined;
  check(
    'a new page’s sign: the server picks a fresh key and records it (owner, question, bytes)',
    res.status === 200 &&
      !!res.key &&
      !res.key.includes(asked) &&
      res.key.startsWith(`public/${F.files}/`) &&
      res.key.endsWith('/Roof photo (1).jpg') &&
      r?.owner_id === A &&
      r?.question_id === 'q_big' &&
      Number(r?.bytes) === 300_000 &&
      r?.state === 'pending',
    `${res.status}`,
  );
  const ok = await putObject(res.url!, 300_000);
  const bigger = await putObject(res.url!, 300_001);
  const smaller = await putObject(res.url!, 299_999);
  check(
    'the presigned PUT is bound to the exact byte length (S3 look-alike checks the signature)',
    ok === 200 && bigger === 403 && smaller === 403,
    `exact ${ok}, +1 ${bigger}, -1 ${smaller}`,
  );
  const docs = await signUpload(sign(), { questionId: 'q_docs', size: 5 * MiB + 1 });
  const voice = await signUpload(sign(), { questionId: 'q_voice', size: 2 * MiB });
  const name = await signUpload(sign(), { questionId: 'q_name', size: 10 });
  check(
    'each question’s own limit applies (5 MB docs, a 30 s voice note); a text question lends nothing',
    docs.status === 413 && voice.status === 413 && name.status === 404,
    `${docs.status} ${voice.status} ${name.status}`,
  );
  const path = `public/${F.files}/${randomUUID()}/old-page.jpg`;
  const legacy = await signUpload(sign(), { questionId: null, size: 1000, path });
  const lr = await row(path);
  const again = await signUpload(sign(), { questionId: null, size: 1000, path });
  check(
    'an old page’s sign (no question) during the grace: its own path, recorded with no question; reused is 409',
    legacy.status === 200 &&
      legacy.key === path &&
      lr?.legacy === true &&
      lr.question_id === null &&
      again.status === 409,
    `${legacy.status} ${again.status}`,
  );
}

async function claims() {
  const docs = await uploadFile('q_docs');
  const voice = await uploadFile('q_voice', 150_000);
  const front = await uploadFile('q_shots');
  const r = await submit(submitApp, {
    q_name: 'Ada',
    q_docs: [docs],
    q_voice: { audio: voice, sec: '12' },
    q_shots: { front },
  });
  const id = r.body.id as string;
  const rows = await Promise.all([docs, voice, front].map((x) => row(keyOf(x))));
  check(
    'claim on submit: every file the response names is claimed by it, in the insert’s transaction',
    r.status === 200 && rows.every((x) => x?.state === 'claimed' && x.submission_id === id),
    `${r.status}`,
  );

  const reuse = await submit(submitApp, { q_docs: [docs] }, { submitId: randomUUID() });
  check(
    'a file another response already claimed: 400 naming the question',
    reuse.status === 400 &&
      reuse.body.reason === 'files' &&
      JSON.stringify(reuse.body.questions) === '["q_docs"]',
    `${reuse.status} ${JSON.stringify(reuse.body)}`,
  );

  const forDocs = await uploadFile('q_docs');
  const wrongQ = await submit(submitApp, { q_big: [forDocs] }, { submitId: randomUUID() });
  const otherForm = await uploadFile('q_big', 1000, F.other);
  const foreign = await submit(submitApp, { q_big: [otherForm] }, { submitId: randomUUID() });
  check(
    'a file minted for another question, or another form’s file: 400, nothing stored',
    wrongQ.status === 400 &&
      foreign.status === 400 &&
      (await row(keyOf(forDocs)))?.state === 'pending',
    `${wrongQ.status} ${foreign.status}`,
  );

  const forged = `slate-file://storage:public/${F.files}/${randomUUID()}/forged.jpg`;
  const during = await submit(submitApp, { q_big: [forged] });
  const fr = await row(keyOf(forged));
  const [grace] = await q<{ t: Date }>('select public.storage_legacy_until() as t');
  const setGrace = async (at: Date) => {
    const [{ sql }] = await q<{ sql: string }>(
      `select format('create or replace function public.storage_legacy_until() returns timestamptz language sql immutable as $f$ select %L::timestamptz $f$', $1::timestamptz) as sql`,
      [at.toISOString()],
    );
    await q(sql);
  };
  await setGrace(new Date(Date.now() - 1000));
  const forged2 = `slate-file://storage:public/${F.files}/${randomUUID()}/forged.jpg`;
  const after = await submit(submitApp, { q_big: [forged2] }, { submitId: randomUUID() });
  const oldPage = await signUpload(sign(), { questionId: null, size: 1000 });
  await setGrace(new Date(grace!.t));
  check(
    'a key nobody signed: accepted during the grace (claimed, bytes unknown), refused after; old pages are told to reload',
    during.status === 200 &&
      fr?.legacy === true &&
      Number(fr.bytes) === 0 &&
      fr.state === 'claimed' &&
      after.status === 400 &&
      oldPage.status === 400 &&
      oldPage.text.startsWith('This page is out of date'),
    `${during.status} ${after.status} ${oldPage.status}`,
  );

  const file = await uploadFile('q_big');
  const submitId = randomUUID();
  const one = await submit(submitApp, { q_big: [file] }, { submitId });
  const two = await submit(submitApp, { q_big: [file] }, { submitId });
  const [count] = await q<{ n: number }>(
    `select count(*)::int as n from public.submissions where form_id = $1 and submit_key = $2`,
    [F.files, submitId],
  );
  check(
    'a retried submit (same submitId) returns the first response: one row, the file claimed once',
    one.status === 200 &&
      two.status === 200 &&
      one.body.id === two.body.id &&
      count!.n === 1 &&
      (await row(keyOf(file)))?.submission_id === one.body.id,
    `${one.body.id} ${two.body.id} rows=${count!.n}`,
  );

  const dup = await uploadFile('q_big');
  const racers = await Promise.all(
    Array.from({ length: 8 }, () =>
      submit(submitApp, { q_big: [dup] }, { submitId: randomUUID() }),
    ),
  );
  check(
    '8 different fills racing to submit the same file: exactly one stores it',
    racers.filter((x) => x.status === 200).length === 1 &&
      racers.filter((x) => x.status === 400).length === 7,
    racers.map((x) => x.status).join(','),
  );

  const retryKey = randomUUID();
  const twin = await Promise.all(
    Array.from({ length: 4 }, () => submit(submitApp, { q_name: 'Twin' }, { submitId: retryKey })),
  );
  const [tw] = await q<{ n: number }>(
    `select count(*)::int as n from public.submissions where submit_key = $1`,
    [retryKey],
  );
  check(
    'four copies of one retry at once: one response, all four answered with its id',
    twin.every((x) => x.status === 200 && x.body.id === twin[0]!.body.id) && tw!.n === 1,
    twin.map((x) => `${x.status}:${String(x.body.id)}`).join(','),
  );
}

async function quotaUnderConcurrency() {
  // Owner B: the quota minus exactly 10 MiB already used (claimed rows).
  await seedB(QUOTA - 10 * MiB, { state: 'claimed' });
  const t0 = performance.now();
  const results50 = await Promise.all(
    Array.from({ length: 50 }, (_, i) =>
      signUpload(signApps[i % signApps.length]!, {
        formId: F.quota,
        questionId: 'q_big',
        size: MiB,
      }),
    ),
  );
  const ms = performance.now() - t0;
  const ok = results50.filter((r) => r.status === 200).length;
  const full = results50.filter((r) => r.status === 507);
  const used = await usage(B);
  check(
    '50 parallel signs (10 isolates) against 10 MiB left: exactly 10 signed, 40 refused (507)',
    ok === 10 && full.length === 40 && used === QUOTA,
    `ok ${ok}, 507 ${full.length}, used ${used === QUOTA ? `= the quota (${QUOTA / GiB} GiB)` : used}, ${ms.toFixed(0)} ms`,
  );
  check(
    'respondents read the plain sentence, nothing about the owner’s usage',
    full.every((r) => r.text === 'This form can’t accept more files right now.'),
  );
  const owner = await signUpload(sign(), {
    formId: F.quota,
    scope: 'draft',
    questionId: 'q_big',
    size: MiB,
    bearer: userJwt(B),
  });
  const st = await quotaStatus(B);
  check(
    'the owner’s own studio upload says how full; storage_quota_status shows the owner their bytes',
    owner.status === 507 &&
      owner.text.startsWith(
        `Your Slate file storage is full (${QUOTA / GiB} GB of ${QUOTA / GiB} GB)`,
      ) &&
      Number(st.used_bytes) === QUOTA &&
      Number(st.max_bytes) === QUOTA,
    owner.text.slice(0, 60),
  );
  const stA = await quotaStatus(A);
  check(
    'storage_quota_status is per caller: owner A doesn’t see B’s gigabyte',
    Number(stA.used_bytes) < 50 * MiB,
    `${stA.used_bytes}`,
  );
  // The pending-uploads cap: 4,999 tiny pending rows for C's form, then two at once.
  await q(`delete from public.form_uploads where owner_id = $1`, [B]);
  await q(
    `insert into public.form_uploads (key, owner_id, form_id, question_id, scope, bytes, content_type)
     select 'public/${F.quota}/' || gen_random_uuid() || '/p.jpg', $1, $2, 'q_big', 'public', 1, 'image/jpeg'
       from generate_series(1, 4999)`,
    [B, F.quota],
  );
  const two = await Promise.all(
    [0, 1].map((i) => signUpload(signApps[i]!, { formId: F.quota, questionId: 'q_big', size: 10 })),
  );
  check(
    'the 5,000 pending-uploads cap is exact too: of two signs at 4,999, one passes',
    two.filter((r) => r.status === 200).length === 1 &&
      two.filter((r) => r.status === 507).length === 1,
    two.map((r) => r.status).join(','),
  );
  await q(`delete from public.form_uploads where owner_id = $1`, [B]);
}

/* ---------- the flood hardening: 2 h window, per-network share, no-IP share, overrides ---------- */

const resetOwnerB = async () => {
  await q(`delete from public.form_uploads where owner_id = $1`, [B]);
  await q(`delete from public.storage_quota_overrides where owner_id = $1`, [B]);
};
/** Seeds `bytes` for owner B, in rows of at most 1 GiB (021's per-upload cap). Returns their keys. */
async function seedB(
  bytes: number,
  o: { state?: 'pending' | 'claimed'; age?: string; net?: string | null } = {},
): Promise<string[]> {
  const keys: string[] = [];
  for (let left = bytes; left > 0; left -= GiB) {
    const r = await q<{ key: string }>(
      `insert into public.form_uploads
         (key, owner_id, form_id, question_id, scope, bytes, content_type, state, submission_id, created_at, net_key)
       values ($1, $2, $3, 'q_big', 'public', $4, 'image/jpeg', $5, $6, now() - $7::interval, $8)
       returning key`,
      [
        `public/${F.quota}/${randomUUID()}/seed.bin`,
        B,
        F.quota,
        Math.min(left, GiB),
        o.state ?? 'pending',
        o.state === 'claimed' ? 's_s11seed' : null,
        o.age ?? '0 seconds',
        o.net ?? null,
      ],
    );
    keys.push(r[0]!.key);
  }
  return keys;
}

async function countingWindow() {
  await resetOwnerB();
  const aged = await seedB(QUOTA - 5 * MiB, { age: '2 hours 1 minute' });
  const past = await signUpload(sign(), { formId: F.quota, size: 10 * MiB });
  const st = await quotaStatus(B);
  await q(
    `update public.form_uploads set created_at = now() - interval '1 hour 59 minutes' where key = any($1)`,
    [aged],
  );
  const within = await signUpload(sign(), { formId: F.quota, size: 10 * MiB });
  check(
    'an unclaimed upload counts for 2 h: past the window it frees the quota, just inside it still counts',
    past.status === 200 && Number(st.used_bytes) === 10 * MiB && within.status === 507,
    `past ${past.status} (meter ${Number(st.used_bytes) / MiB} MiB), inside ${within.status}`,
  );

  // A slow fill claims an upload older than 2 h only if the owner has room for it again.
  await resetOwnerB();
  const [slow] = await seedB(50 * MiB, { age: '3 hours' });
  const filler = await seedB(QUOTA - 20 * MiB, { state: 'claimed' });
  const refused = await submit(
    submitApp,
    { q_big: [`slate-file://storage:${slow}`] },
    {
      formId: F.quota,
      submitId: randomUUID(),
    },
  );
  await q(`update public.form_uploads set bytes = 1000 where key = any($1)`, [filler]);
  const room = await submit(
    submitApp,
    { q_big: [`slate-file://storage:${slow}`] },
    { formId: F.quota },
  );
  check(
    'claiming an upload past the window: refused (400) while the owner is full, stored once there is room',
    refused.status === 400 &&
      JSON.stringify(refused.body.questions) === '["q_big"]' &&
      room.status === 200 &&
      (await row(slow))?.state === 'claimed',
    `${refused.status} then ${room.status}`,
  );
  await resetOwnerB();
}

async function networkShare() {
  await resetOwnerB();
  const venue = '10.67.250.1';
  // Half the quota (the network's share) minus 10 MiB already unclaimed from the venue's network.
  await seedB(QUOTA / 2 - 10 * MiB, { net: networkKey(venue) });
  const t0 = performance.now();
  const burst = await Promise.all(
    Array.from({ length: 50 }, (_, i) =>
      signUpload(signApps[i % signApps.length]!, { formId: F.quota, size: MiB, ip: venue }),
    ),
  );
  const ms = performance.now() - t0;
  const ok = burst.filter((r) => r.status === 200);
  const refused = burst.filter((r) => r.status === 507);
  const [net] = await q<{ n: string }>(
    `select coalesce(sum(bytes), 0) as n from public.form_uploads where owner_id = $1 and net_key = $2 and state = 'pending'`,
    [B, networkKey(venue)],
  );
  const neighbour = await signUpload(sign(), { formId: F.quota, size: MiB, ip: '10.67.250.2' });
  check(
    '50 parallel signs from one network with 10 MiB of its share left: exactly 10 signed, 40 refused; the next network still signs',
    ok.length === 10 &&
      refused.length === 40 &&
      refused.every((r) => r.text === 'This form can’t accept more files right now.') &&
      Number(net!.n) === QUOTA / 2 &&
      neighbour.status === 200,
    `ok ${ok.length}, 507 ${refused.length}, share used ${Number(net!.n) / MiB} MiB, other network ${neighbour.status}, ${ms.toFixed(0)} ms`,
  );
  const [raw] = await q<{ n: number }>(
    `select count(*)::int as n from public.form_uploads where owner_id = $1 and (net_key like '%10.67.%' or net_key is null and state = 'pending')`,
    [B],
  );
  // A claim clears the network.
  const claimedKey = ok[0]!.key!;
  await putObject(ok[0]!.url!, MiB);
  const r = await submit(
    submitApp,
    { q_big: [`slate-file://storage:${claimedKey}`] },
    { formId: F.quota },
  );
  const after = await row(claimedKey);
  const [{ net_key: cleared }] = await q<{ net_key: string | null }>(
    `select net_key from public.form_uploads where key = $1`,
    [claimedKey],
  );
  check(
    'the network is stored as a hash (no address anywhere), and a claim clears it',
    raw!.n === 0 && r.status === 200 && after?.state === 'claimed' && cleared === null,
    `${r.status}`,
  );
  await resetOwnerB();
}

async function noIpShare() {
  await resetOwnerB();
  const quiet = console.error;
  console.error = () => {}; // the Function logs the missing header once a minute
  const burst = await Promise.all(
    Array.from({ length: 40 }, (_, i) =>
      signUpload(signApps[i % signApps.length]!, { formId: F.quota, size: MiB, ip: null }),
    ),
  );
  console.error = quiet;
  const ok = burst.filter((r) => r.status === 200).length;
  const [keys] = await q<{ n: number }>(
    `select count(*)::int as n from public.form_uploads where owner_id = $1 and net_key = 'noip'`,
    [B],
  );
  check(
    'requests without a client IP share 32 MiB between them: 40 parallel 1 MiB signs, exactly 32 signed',
    ok === 32 && keys!.n === 32,
    `ok ${ok}, 507 ${40 - ok}`,
  );
  await resetOwnerB();
}

async function overrides() {
  await resetOwnerB();
  await seedB(QUOTA, { state: 'claimed' });
  const before = await signUpload(sign(), { formId: F.quota, size: MiB });
  await q(
    `insert into public.storage_quota_overrides (owner_id, bytes, note)
     values ($1, $2, 'harness fair')
     on conflict (owner_id) do update set bytes = excluded.bytes, note = excluded.note, updated_at = now()`,
    [B, 2 * QUOTA],
  );
  const during = await signUpload(sign(), { formId: F.quota, size: MiB });
  const st = await quotaStatus(B);
  await q(`delete from public.storage_quota_overrides where owner_id = $1`, [B]);
  const afterRemoval = await signUpload(sign(), { formId: F.quota, size: MiB });
  check(
    'an override raises one owner’s quota (the meter reports it), and removing it restores the default',
    before.status === 507 &&
      during.status === 200 &&
      Number(st.max_bytes) === 2 * QUOTA &&
      afterRemoval.status === 507,
    `${before.status} → ${during.status} (max ${Number(st.max_bytes) / GiB} GiB) → ${afterRemoval.status}`,
  );
  await resetOwnerB();
}

async function sweep() {
  const put = (key: string, size: number) => s3.objects.set(key, { size, type: 'image/jpeg' });
  const k = (name: string) => `public/${F.files}/${randomUUID()}/${name}`;
  const doomedOld = k('doomed-old.jpg');
  const doomedNew = k('doomed-new.jpg');
  const expired = k('expired.jpg');
  const neverPut = k('never.jpg');
  const landed = k('landed.jpg');
  const young = k('young.jpg');
  for (const [key, state, age, doomedAgo] of [
    [doomedOld, 'doomed', '1 hour', '3 minutes'],
    [doomedNew, 'doomed', '1 hour', '10 seconds'],
    [expired, 'pending', '25 hours', null],
    [neverPut, 'pending', '31 minutes', null],
    [landed, 'pending', '31 minutes', null],
    [young, 'pending', '5 minutes', null],
  ] as const) {
    await q(
      `insert into public.form_uploads (key, owner_id, form_id, question_id, scope, bytes, content_type, state, created_at, doomed_at, submission_id)
       values ($1, $2, $3, 'q_big', 'public', 5000, 'image/jpeg', $4, now() - $5::interval,
               case when $6::text is null then null else now() - $6::interval end,
               case when $4 = 'doomed' then 's_s11gone' end)`,
      [key, A, F.files, state, age, doomedAgo],
    );
  }
  put(doomedOld, 5000);
  put(doomedNew, 5000);
  put(expired, 5000);
  put(landed, 4321);
  put(young, 5000);
  const deletesBefore = s3.deletes.length;
  await q(`update public.storage_sweep_state set next_run_at = now() - interval '1 second'`);
  const t0 = performance.now();
  const s = await signUpload(sign(), { questionId: 'q_big', size: 1000 });
  const ms = performance.now() - t0;
  const deleted = s3.deletes.slice(deletesBefore);
  const [gate] = await q<{ due_in: number; global_bytes: string }>(
    `select extract(epoch from next_run_at - now())::int as due_in, global_bytes from public.storage_sweep_state`,
  );
  check(
    'the gate opens a bounded sweep on the next sign: doomed (2+ min) and expired objects deleted, rows gone',
    s.status === 200 &&
      deleted.includes(doomedOld) &&
      deleted.includes(expired) &&
      !deleted.includes(doomedNew) &&
      !(await row(doomedOld)) &&
      !(await row(expired)) &&
      (await row(doomedNew))?.state === 'doomed',
    `${deleted.length} deletes, sign + sweep ${ms.toFixed(0)} ms`,
  );
  check(
    'one HEAD 30 min after signing: a sign never used stops counting; a real one gets its true size',
    !(await row(neverPut)) &&
      Number((await row(landed))?.bytes) === 4321 &&
      !!(await row(landed))?.verified_at &&
      !s3.heads.includes(young) &&
      !!(await row(young)),
  );
  const heads = s3.heads.length;
  const deletes = s3.deletes.length;
  await signUpload(sign(), { questionId: 'q_big', size: 1000 });
  check(
    'the gate stays shut for about a minute: the next sign runs no sweep; the bucket total was refreshed',
    s3.heads.length === heads &&
      s3.deletes.length === deletes &&
      gate!.due_in > 40 &&
      Number(gate!.global_bytes) > 0,
    `next in ${gate!.due_in}s`,
  );
}

async function deletes() {
  const a = await uploadFile('q_big', 700_000);
  const b = await uploadFile('q_shots', 300_000);
  const r = await submit(submitApp, { q_big: [a], q_shots: { back: b } });
  const id = r.body.id as string;
  const before = Number((await quotaStatus(A)).used_bytes);
  // Trash (deleted_at) keeps the files and their bytes.
  await asRole(
    'authenticated',
    A,
    `update public.submissions set deleted_at = now() where id = $1`,
    [id],
  );
  const trashed = Number((await quotaStatus(A)).used_bytes);
  await asRole('authenticated', A, `delete from public.submissions where id = $1`, [id]);
  const after = Number((await quotaStatus(A)).used_bytes);
  const doomed = await Promise.all([a, b].map((x) => row(keyOf(x))));
  check(
    'deleting a response for good frees its bytes at once (trash doesn’t); its uploads are doomed',
    trashed === before &&
      before - after === 1_000_000 &&
      doomed.every((x) => x?.state === 'doomed'),
    `${before} → ${after}`,
  );
  const n = s3.deletes.length;
  const other = `public/${F.quota}/${randomUUID()}/b-doomed.jpg`;
  await q(
    `insert into public.form_uploads (key, owner_id, form_id, scope, bytes, content_type, state, doomed_at)
     values ($1, $2, $3, 'public', 10, 'image/jpeg', 'doomed', now())`,
    [other, B, F.quota],
  );
  const purge = await post(sign(), { op: 'purge' }, freshIp(), {
    Authorization: `Bearer ${userJwt(A)}`,
  });
  const pb = (await purge.json()) as { deleted?: number };
  check(
    'the studio’s purge deletes the owner’s doomed objects now, and only theirs',
    purge.status === 200 &&
      s3.deletes.slice(n).includes(keyOf(a)) &&
      s3.deletes.slice(n).includes(keyOf(b)) &&
      !s3.deletes.includes(other) &&
      !(await row(keyOf(a))) &&
      !!(await row(other)),
    `deleted ${pb.deleted}`,
  );
  await q(`delete from public.form_uploads where key = $1`, [other]);

  // Backup restore: delete a response, insert it again (Data API, as the owner): its files come back.
  const c = await uploadFile('q_big', 1234);
  const kept = await submit(submitApp, { q_big: [c] });
  const kid = kept.body.id as string;
  const [sub] = await q<{ answers: unknown; meta: unknown }>(
    `select answers, meta from public.submissions where id = $1`,
    [kid],
  );
  await asRole('authenticated', A, `delete from public.submissions where id = $1`, [kid]);
  await asRole(
    'authenticated',
    A,
    `insert into public.submissions (id, form_id, answers, meta) values ($1, $2, $3::jsonb, $4::jsonb)`,
    [kid, F.files, JSON.stringify(sub!.answers), JSON.stringify(sub!.meta)],
  );
  const back = await row(keyOf(c));
  check(
    'a backup restore (delete, then insert again) takes its files back before any sweep',
    back?.state === 'claimed' && back.submission_id === kid && back.verified_at === null,
  );

  // A form deleted for good dooms everything under it, pending included.
  const pending = await signUpload(sign(), { formId: F.doomed, questionId: 'q_big', size: 1000 });
  await uploadFile('q_big', 2000, F.doomed).then((ref) =>
    submit(submitApp, { q_big: [ref] }, { formId: F.doomed }),
  );
  await asRole('authenticated', A, `delete from public.forms where id = $1`, [F.doomed]);
  const left = await q<{ state: string }>(
    `select state from public.form_uploads where form_id = $1`,
    [F.doomed],
  );
  check(
    'deleting a form for good dooms every upload under it (claimed and pending)',
    pending.status === 200 && left.length === 2 && left.every((x) => x.state === 'doomed'),
    left.map((x) => x.state).join(','),
  );
}

async function oldFunctions(label: string, expectRows: boolean) {
  const path = `public/${F.files}/${randomUUID()}/old-fn.jpg`;
  const s = await signUpload(oldSign, { questionId: null, size: 2000, path });
  // With 021 in place, a file the new storagesign signed is claimed by the old Function's insert (trigger).
  const signedByNew = expectRows ? await uploadFile('q_big', 3000) : null;
  const r = await submit(oldSubmit, {
    q_name: 'Old',
    q_big: [`slate-file://storage:${path}`, ...(signedByNew ? [signedByNew] : [])],
  });
  const claimedRow = signedByNew ? await row(keyOf(signedByNew)) : undefined;
  const lookup = await oldSubmit.request(`/?op=form&slug=${SLUG.files}`, {
    method: 'GET',
    headers: { 'X-Forwarded-For': freshIp() },
  });
  check(
    `${label}: the deployed storagesign still signs, and the deployed submitresponse still stores and looks up`,
    s.status === 200 &&
      r.status === 200 &&
      lookup.status === 200 &&
      (!expectRows || (claimedRow?.state === 'claimed' && claimedRow.submission_id === r.body.id)),
    `sign ${s.status}, submit ${r.status}, lookup ${lookup.status}${expectRows ? `, claimed by trigger: ${claimedRow?.state}` : ''}`,
  );
}

async function backfill() {
  // A listing as `neonctl buckets object list` prints it: one referenced object, one orphan, one stray.
  const ref = `draft/${F.files}/${randomUUID()}/backfilled.jpg`;
  const orphan = `public/${F.files}/${randomUUID()}/orphan.jpg`;
  const answers = { q_big: [`slate-file://storage:${ref}`] };
  await asRole(
    'authenticated',
    A,
    `insert into public.submissions (id, form_id, answers, meta) values ('s_s11backfill', $1, $2::jsonb, '{}'::jsonb)`,
    [F.files, JSON.stringify(answers)],
  );
  const state = await loadDbState(db);
  const plan = planBackfill({
    objects: [
      { key: ref, size: 777 },
      { key: orphan, size: 55 },
      { key: 'stray/readme.txt', size: 3 },
    ],
    ...state,
    orphans: 'register',
  });
  const added = await applyBackfill(db, plan);
  const again = await applyBackfill(db, plan);
  const r = await row(ref);
  const o = await row(orphan);
  check(
    'backfill: a referenced object is claimed at its size, an orphan pending; running it twice adds nothing',
    added === 2 &&
      again === 0 &&
      r?.state === 'claimed' &&
      r.submission_id === 's_s11backfill' &&
      Number(r.bytes) === 777 &&
      o?.state === 'pending' &&
      plan.summary.skippedOddKeys === 1,
    `added ${added}, again ${again}`,
  );
}

async function latency() {
  const p50 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
  const time = async (fn: () => Promise<unknown>, n = 15) => {
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      const t = performance.now();
      await fn();
      out.push(performance.now() - t);
    }
    return p50(out);
  };
  const newSign = await time(() => signUpload(sign(), { questionId: 'q_big', size: 450_000 }));
  const oldSignT = await time(() => signUpload(oldSign, { questionId: null, size: 450_000 }));
  const refs: string[] = [];
  for (let i = 0; i < 15; i++) refs.push(await uploadFile('q_big', 1000));
  let i = 0;
  const newSubmit = await time(() => submit(submitApp, { q_name: 'L', q_big: [refs[i++]!] }));
  const oldSubmitT = await time(() => submit(oldSubmit, { q_name: 'L' }));
  const plainNew = await time(() => submit(submitApp, { q_name: 'L' }));
  console.log(
    `\nlatency p50 (laptop → branch): sign new ${newSign.toFixed(0)} ms vs deployed ${oldSignT.toFixed(0)} ms; ` +
      `submit with a file ${newSubmit.toFixed(0)} ms, without ${plainNew.toFixed(0)} ms vs deployed ${oldSubmitT.toFixed(0)} ms`,
  );
}

async function rollbackAndReapply() {
  await db.query(rollbackSql());
  const [gone] = await q<{ t: string | null }>(
    `select to_regclass('public.form_uploads')::text as t`,
  );
  check('021’s rollback block runs', gone!.t === null);
  await oldFunctions('after the rollback', false);
  await db.query(migrationSql());
  const s = await signUpload(sign(), { questionId: 'q_big', size: 1000 });
  check('021 re-applied after the rollback: the new storagesign signs again', s.status === 200);
}

/* ---------- main ---------- */

async function main() {
  let oldDir = '';
  try {
    const url = branchUrl();
    // Before any write, and before anything loads with this URL.
    assertNotProduction(url);
    process.env.DATABASE_URL = url;
    process.env.NEON_AUTH_URL = AUTH_BASE;
    await startS3();
    process.env.AWS_ENDPOINT_URL_S3 = s3.endpoint;
    process.env.AWS_ACCESS_KEY_ID = S3_KEY.accessKeyId;
    process.env.AWS_SECRET_ACCESS_KEY = S3_KEY.secretAccessKey;
    process.env.AWS_REGION = REGION;
    db = new pg.Pool({ connectionString: url, max: 8 });
    const [prod] = await q<{ n: number }>(
      `select count(*)::int as n from pg_proc where proname = 'insert_public_submission'`,
    );
    if (!prod!.n) throw new Error('020 is missing on this branch (production has it).');
    console.log('[harness] applying 021');
    await db.query(migrationSql());
    await migration();
    QUOTA = Number(
      (await q<{ n: string }>(`select public.storage_quota_limit()::text as n`))[0]!.n,
    );
    console.log(`[harness] storage_quota_limit() = ${QUOTA} bytes (${QUOTA / GiB} GiB)`);
    await cleanup();
    await seed();

    const signPath = resolve('neon/functions/storage-sign/index.ts');
    signApps = [];
    for (let i = 0; i < 10; i++) {
      signApps.push((await import(/* @vite-ignore */ `${signPath}?isolate=${i}`)).default as App);
    }
    submitApp = (await import(resolve('neon/functions/submit-response/index.ts'))).default as App;
    oldDir = extractOldFunctions();
    oldSign = (await import(join(oldDir, 'neon/functions/storage-sign/index.ts'))).default as App;
    oldSubmit = (await import(join(oldDir, 'neon/functions/submit-response/index.ts')))
      .default as App;
    console.log(
      `[harness] 10 storagesign isolates, submitresponse, and the ${OLD_REF} builds of both`,
    );

    await grants();
    await signing();
    await claims();
    await quotaUnderConcurrency();
    await countingWindow();
    await networkShare();
    await noIpShare();
    await overrides();
    await sweep();
    await deletes();
    await oldFunctions('with 021 applied', true);
    await backfill();
    await latency();
    await rollbackAndReapply();
    check(
      'the stub bucket refused no PUT the Functions signed for the right length',
      s3.puts.refused === 2,
      `${s3.puts.ok} ok, ${s3.puts.refused} refused (the 2 tampered)`,
    );
    await cleanup();
  } finally {
    await db?.end().catch(() => {});
    s3.server?.close();
    if (oldDir) rmSync(oldDir, { recursive: true, force: true });
    deleteBranch();
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} scenarios passed`);
  process.exit(failed.length || process.exitCode ? 1 : 0);
}

main().catch((err) => {
  console.error('[harness] failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
