/**
 * Neon Function: presign Object Storage upload/download (ADR-029 / ADR-031, limits ADR-058).
 * Deploy: neon functions deploy storagesign --src neon/functions/storage-sign
 * Neon injects DATABASE_URL and S3-compatible Object Storage credentials.
 * Needs migrations 016 (consume_submit_rates) and 021 (reserve_upload, the sweep).
 *
 * Auth model:
 * - public/ upload: anonymous OK when form is published and its published
 *   schema has a file question — a file upload, a voice note or a photo
 *   checklist (ADR-065). The request names its question, and the size is
 *   capped by that question's own limit (ADR-067); an old page's request
 *   without one gets the roomiest question's (ADR-050) during the grace.
 *   Password-locked forms (ADR-043) also need the respondent's unlockToken.
 *   Charged by size to IP + form owner and IP, after the form lookup (ADR-058).
 * - draft/ upload + all download/meta/content + purge: Bearer JWT, signature
 *   verified against the Neon Auth JWKS, whose `sub` matches forms.owner_id.
 *   Charged to the verified account plus an IP backstop, never before a valid Bearer.
 *
 * Storage quotas (ADR-067): the server picks every object key (a fresh uuid
 * under the path's scope and form, the name cleaned), and reserve_upload
 * records it against the form owner's quota — claimed bytes plus unclaimed
 * uploads from the last 2 h, at most 2 GiB (or the owner's override), under a
 * per-owner lock — and against this network's share of those unclaimed bytes
 * (half the quota; 32 MiB for requests with no client IP), before the PUT is
 * signed for exactly that many bytes. A full quota or share is 507:
 * respondents read "This form can't accept more files right now." (nothing
 * about the owner's usage).
 * Until storage_legacy_until() an old page's client-chosen path is signed as
 * is, recorded the same way. About once a minute one sign also runs a bounded
 * sweep (sweep.ts): deleted responses' objects, unclaimed uploads past 24 h,
 * one HEAD per upload. `op: 'purge'` lets the owner's studio delete their own
 * doomed objects right after a permanent delete.
 *
 * Stored objects are only ever served with a type from ALLOWED_TYPES; anything
 * else is stored and served as application/octet-stream, as an attachment.
 * A "pdf" that is really HTML must never reach a frame on the studio origin.
 */

import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { bodyLimit } from 'hono/body-limit';
import { Pool } from 'pg';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  type GetObjectCommandOutput,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { isValidUnlockToken } from './fillLock.js';
import { clientIp } from './requestIp.js';
import { verifyUserJwt } from './authJwt.js';
import { decidePublicUpload, decideQuestionUpload } from './uploadPolicy.js';
import { isQuestionId, mintUploadKey, networkKey } from './uploadKey.js';
import { runSweep, type SweepObjects } from './sweep.js';
import { aboutMinutes, charge, intEnv, ipMax, ownerKey, units, type Bucket } from './rateGate.js';

const BUCKET = process.env.NEON_STORAGE_BUCKET || 'form-uploads';

/**
 * Default 32 MB — matches client prepareFileForUpload non-image cap. An integer from 1 to 1 GiB,
 * else the default: a typo must never remove the cap (audit 2026-10; before, NaN left owner uploads
 * bounded only by reserve_upload's 1 GiB row check).
 */
const MAX_BYTES = intEnv('STORAGE_SIGN_MAX_BYTES', 32 * 1024 * 1024, 1024 * 1024 * 1024);

/** A sign request is a path and a few fields; nothing legitimate comes near this. */
const MAX_BODY_BYTES = 8 * 1024;
/** Uploads are charged by declared size: 1 unit per 256 KiB, at least 1. */
const UPLOAD_UNIT = 256 * 1024;

/** ADR-058 defaults. Env overrides must be integers in range; anything else keeps the default. */
export const LIMITS = {
  ipOwner: intEnv('STORAGE_SIGN_IP_OWNER_MAX', 8192), // 256 KiB units / h: public uploads, IP + owner
  ip: intEnv('STORAGE_SIGN_IP_MAX', 40960), // 256 KiB units / h: public + draft uploads, IP
  draftUser: intEnv('STORAGE_SIGN_DRAFT_USER_MAX', 8192), // 256 KiB units / h: draft uploads, account
  readUser: intEnv('STORAGE_SIGN_READ_USER_MAX', 3000), // reads / 10 min, account
  readIp: intEnv('STORAGE_SIGN_READ_IP_MAX', 15000), // reads / 10 min, IP
  contentMaxBytes: intEnv('STORAGE_SIGN_CONTENT_MAX_BYTES', 10 * 1024 * 1024, 32 * 1024 * 1024),
};
console.info('[storagesign] limits (ADR-058)', LIMITS);

function tooLargeText(maxBytes: number): string {
  return `File too large (max ${+(maxBytes / (1024 * 1024)).toFixed(1)} MB)`;
}

/** "120 MB", "1 GB" (binary, like the studio meter). */
function sizeText(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  if (mb < 1000) return `${mb < 10 ? +mb.toFixed(1) : Math.round(mb)} MB`;
  return `${+(mb / 1024).toFixed(1)} GB`;
}

/**
 * Refusals once a quota is reached (ADR-067), plain text so pages from before
 * this build show them as sent. Respondents never learn the owner's usage.
 */
export const STORAGE_COPY = {
  respondent: 'This form can’t accept more files right now.',
  ownerFull: (used: number, max: number) =>
    `Your Slate file storage is full (${sizeText(used)} of ${sizeText(max)}). Permanently delete responses you no longer need to make room.`,
  ownerPending:
    'Too many uploads from your forms are waiting to be sent. Please try again in a few minutes.',
  unavailable: 'File storage is unavailable right now. Please try again later.',
  stale: 'This page is out of date. Reload it to add files.',
  retry: 'That upload didn’t go through. Please try again.',
} as const;

/** path: public|draft / formId / uuid / filename — case-sensitive, one namespace. */
const PATH_RE =
  /^(public|draft)\/([A-Za-z0-9_-]{4,64})\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/([^/]{1,120})$/;

const OPS = new Set(['upload', 'download', 'meta', 'content', 'purge']);

/** One sweep per open gate (about a minute); an owner's purge after a permanent delete. */
const SWEEP = { batch: 50, budgetMs: 2000 };
const PURGE = { batch: 100, budgetMs: 4000 };

/** Types we will store and echo back as-is. Everything else becomes octet-stream. */
const ALLOWED_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/bmp',
  'image/heic',
  'image/heif',
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'audio/mpeg',
  'audio/mp4',
  'audio/wav',
  // Chrome, Edge, Firefox and Android record voice notes as Opus in WebM (ADR-065).
  'audio/webm',
  'video/mp4',
  'video/quicktime',
  'video/webm',
]);

function safeContentType(raw: string | undefined): string {
  const t = (raw || '').trim().toLowerCase().split(';')[0]!.trim();
  return ALLOWED_TYPES.has(t) ? t : 'application/octet-stream';
}

// Every statement runs as the table owner, whose role has no ceiling (the Data API roles get
// 3 s / 8 s from pg_db_role_setting). Fail fast with a 503 instead of pinning a connection behind
// a slow plan or a stuck lock (audit 2026-10, ADR-071). Neon's proxy drops pg's statement_timeout
// / lock_timeout startup parameters and refuses `options` on a pooled endpoint, so the ceiling is
// SET on each new connection (checked on a branch: reaches the server on direct and pooled
// strings). query_timeout is the client-side backstop that holds whatever the pooler does.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  query_timeout: 10_000,
});
pool.on('connect', (client) => {
  void client
    .query('set statement_timeout = 8000; set lock_timeout = 4000')
    .catch((err: unknown) => console.warn('[pool] timeouts not set', String(err).slice(0, 120)));
});

function s3(): S3Client {
  const endpoint = process.env.AWS_ENDPOINT_URL_S3 || process.env.NEON_STORAGE_ENDPOINT;
  const region = process.env.AWS_REGION || process.env.NEON_STORAGE_REGION || 'us-east-2';
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID || process.env.NEON_STORAGE_ACCESS_KEY_ID;
  const secretAccessKey =
    process.env.AWS_SECRET_ACCESS_KEY || process.env.NEON_STORAGE_SECRET_ACCESS_KEY;

  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error('Object Storage credentials are not configured on this function');
  }

  return new S3Client({
    region,
    endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
  });
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

const app = new Hono();
// One preflight per 2 h instead of one per POST; the 429 wait is readable.
app.use('*', cors({ origin: '*', exposeHeaders: ['Retry-After'], maxAge: 7200 }));
app.options('*', (c) => c.body(null, 204));

type ParsedPath = {
  scope: 'public' | 'draft';
  formId: string;
  uploadId: string;
  filename: string;
};

function parsePath(path: string): ParsedPath | null {
  const m = PATH_RE.exec(path);
  if (!m) return null;
  const scope = m[1] as 'public' | 'draft';
  return {
    scope,
    formId: m[2]!,
    uploadId: m[3]!,
    filename: m[4]!,
  };
}

function bearerToken(authHeader: string): string | null {
  const m = /^Bearer\s+(\S+)/i.exec(authHeader.trim());
  return m?.[1] ?? null;
}

/** Verified subject, or null. A forged or expired token is the same as none. Throws when the JWKS is unreachable. */
async function userIdFromToken(token: string): Promise<string | null> {
  const claims = await verifyUserJwt(token);
  return claims?.sub ?? null;
}

type FormGateRow = {
  id: string;
  status: string;
  deleted_at: string | null;
  owner_id: string | null;
  fill_password_hash: string | null;
  /** The schema itself is only read by the rate statement, after the charge. */
  has_schema: boolean;
};

async function loadForm(formId: string): Promise<FormGateRow | null> {
  const formRes = await pool.query<FormGateRow>(
    `select id, status, deleted_at, owner_id, fill_password_hash,
            published_schema is not null as has_schema
     from public.forms where id = $1 limit 1`,
    [formId],
  );
  return formRes.rows[0] ?? null;
}

function tooMany(c: Context, retryAfter: number, error: string) {
  c.header('Retry-After', String(retryAfter));
  return c.json({ error, retryAfterSeconds: retryAfter }, 429);
}

/** S3 says the object is not there (as opposed to throttling or an outage). */
function isMissing(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } } | null;
  return e?.name === 'NotFound' || e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404;
}

async function presign(
  c: Context,
  key: string,
  contentType: string,
  contentLength: number,
  maxBytes: number,
) {
  try {
    const client = s3();
    // Bind ContentLength so a tiny signed request cannot PUT an oversized body (ADR-031),
    // and the quota counts exactly what can land (ADR-067).
    const command = new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      ContentType: contentType,
      ContentLength: contentLength,
    });
    // Sign Content-Type as well as Content-Length so the uploader can neither
    // oversize the body nor store the object under a type we didn't allow.
    const url = await getSignedUrl(client, command, {
      expiresIn: 600,
      signableHeaders: new Set(['content-type', 'content-length']),
    });
    // The PUT must carry exactly this Content-Type — it is part of the signature.
    // `key` is where it lands: the page stores that, not the path it asked for.
    return c.json({ url, method: 'PUT', maxBytes, contentType, key });
  } catch (err) {
    console.error('[storagesign] presign failed', err);
    return null;
  }
}

/** Object calls for the sweep, each bounded so one slow call can't hold a request. */
function sweepObjects(): SweepObjects {
  const client = s3();
  const opts = () => ({ abortSignal: AbortSignal.timeout(3000) });
  return {
    async remove(key) {
      await client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }), opts());
    },
    async head(key) {
      try {
        const h = await client.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }), opts());
        return typeof h.ContentLength === 'number' ? h.ContentLength : 0;
      } catch (err) {
        if (isMissing(err)) return null;
        throw err;
      }
    },
  };
}

/**
 * One sweep batch, after this request's own work. Where the platform can keep
 * work alive after the response (waitUntil), nobody waits for it; otherwise
 * it is awaited, bounded by SWEEP.budgetMs, about once a minute across all
 * isolates. A sweep that fails only logs: it never changes this answer.
 */
function scheduleSweep(c: Context): Promise<void> {
  const task = (async () => {
    try {
      const r = await runSweep(pool, sweepObjects(), SWEEP);
      if (r.picked) console.info('[storagesign] sweep', r);
    } catch (err) {
      console.error('[storagesign] sweep failed', err);
    }
  })();
  try {
    const ctx = c.executionCtx as { waitUntil?: (p: Promise<unknown>) => void };
    if (typeof ctx.waitUntil === 'function') {
      ctx.waitUntil(task);
      return Promise.resolve();
    }
  } catch {
    // No execution context on this platform: await it below.
  }
  return task;
}

let globalWarnAt = 0;

type ReserveRow = {
  outcome?: unknown;
  used_bytes?: unknown;
  max_bytes?: unknown;
  sweep_due?: unknown;
};

/**
 * Record the upload against its owner's quota (021 reserve_upload: one
 * statement, a per-owner lock), then sign the PUT for exactly `len` bytes.
 * Refusals are plain text: 507 when a quota is full, 400 for an old page past
 * the grace, 409 when an old page's own path is taken.
 */
async function reserveAndPresign(
  c: Context,
  a: {
    key: string;
    owner: string;
    formId: string;
    questionId: string | null;
    len: number;
    contentType: string;
    legacy: boolean;
    maxBytes: number;
    who: 'respondent' | 'owner';
    /** The network's share key (networkKey), for respondents only; null for the owner's own uploads. */
    netKey: string | null;
  },
) {
  let r: ReserveRow | undefined;
  try {
    r = (
      await pool.query<ReserveRow>(
        `select r.outcome, r.used_bytes, r.max_bytes, r.sweep_due
           from public.reserve_upload($1, $2, $3, $4, $5, $6, $7, $8) r`,
        [a.key, a.owner, a.formId, a.questionId, a.len, a.contentType, a.legacy, a.netKey],
      )
    ).rows[0];
  } catch (err) {
    console.error('[storagesign] reserve failed', err);
    return c.text('Temporarily unavailable', 503);
  }
  const sweep = r?.sweep_due === true ? scheduleSweep(c) : Promise.resolve();

  if (r?.outcome !== 'ok') {
    await sweep;
    switch (r?.outcome) {
      case 'quota':
        return c.text(
          a.who === 'owner'
            ? STORAGE_COPY.ownerFull(Number(r.used_bytes) || 0, Number(r.max_bytes) || 0)
            : STORAGE_COPY.respondent,
          507,
        );
      case 'network':
        // This network's share of the owner's unclaimed uploads (ADR-067): only this network waits.
        return c.text(STORAGE_COPY.respondent, 507);
      case 'pending':
        return c.text(a.who === 'owner' ? STORAGE_COPY.ownerPending : STORAGE_COPY.respondent, 507);
      case 'global':
        if (Date.now() - globalWarnAt > 60_000) {
          globalWarnAt = Date.now();
          console.error('[storagesign] GLOBAL STORAGE CEILING REACHED: every upload is refused');
        }
        return c.text(a.who === 'owner' ? STORAGE_COPY.unavailable : STORAGE_COPY.respondent, 507);
      case 'legacy_closed':
        return c.text(STORAGE_COPY.stale, 400);
      case 'exists':
        return c.text(STORAGE_COPY.retry, 409);
      default:
        console.error('[storagesign] reserve: unexpected outcome', r?.outcome);
        return c.text('Temporarily unavailable', 503);
    }
  }

  const res = await presign(c, a.key, a.contentType, a.len, a.maxBytes);
  if (!res) {
    // Nothing can land under this key: give the bytes back now rather than at the sweep's check.
    await pool
      .query(`delete from public.form_uploads where key = $1 and state = 'pending'`, [a.key])
      .catch(() => {});
  }
  await sweep;
  return res ?? c.text('Sign failed', 500);
}

/**
 * draft/ uploads and every read op (ADR-046, ADR-058): Bearer, then verify,
 * then ONE charge to the verified account plus an IP backstop, then the owner
 * check. No Bearer or a forged one costs no DB work at all.
 */
async function ownerPath(
  c: Context,
  a: {
    op: string;
    /** null only for purge, which is about the account, not one object. */
    path: string | null;
    parsed: ParsedPath | null;
    len: number;
    contentType: string | undefined;
    questionId: string | undefined;
    ip: string;
  },
) {
  const token = bearerToken(c.req.header('authorization') || '');
  // Respondents' old meta calls and scrapers stop here, no DB.
  if (!token) return c.text('Unauthorized', 401);
  let uid: string | null;
  try {
    uid = await userIdFromToken(token);
  } catch (err) {
    console.error('[storagesign] token check failed', err);
    return c.text('Temporarily unavailable', 503);
  }
  if (!uid) return c.text('Unauthorized', 401);

  const who = ownerKey(uid);
  const cost = units(a.len, UPLOAD_UNIT);
  const buckets: Bucket[] =
    a.op === 'upload'
      ? [
          { key: `up:draft:${who}`, win: 3600, max: LIMITS.draftUser, cost },
          { key: `up:ip:${a.ip}`, win: 3600, max: ipMax(a.ip, LIMITS.ip), cost },
        ]
      : [
          { key: `read:u:${who}`, win: 600, max: LIMITS.readUser },
          { key: `read:ip:${a.ip}`, win: 600, max: ipMax(a.ip, LIMITS.readIp) },
        ];
  let v: Awaited<ReturnType<typeof charge>>;
  let form: FormGateRow | null = null;
  try {
    v = await charge(pool, buckets);
    if (v.ok && a.parsed) form = await loadForm(a.parsed.formId);
  } catch (err) {
    console.error('[storagesign] owner gate failed', err);
    return c.text('Temporarily unavailable', 503);
  }
  if (!v.ok) {
    return tooMany(
      c,
      v.retryAfter,
      `Too many file requests. Please wait ${aboutMinutes(v.retryAfter)}.`,
    );
  }

  // After a permanent delete (ADR-067): this account's doomed objects, and only those.
  if (a.op === 'purge') {
    try {
      const r = await runSweep(pool, sweepObjects(), { owner: uid, ...PURGE });
      return c.json({ deleted: r.deleted, more: r.picked >= PURGE.batch || r.left + r.failed > 0 });
    } catch (err) {
      console.error('[storagesign] purge failed', err);
      return c.text('Temporarily unavailable', 503);
    }
  }

  // "Not yours" and "does not exist" look identical — no form-id oracle.
  if (!a.path || !a.parsed || !form || form.deleted_at || !form.owner_id || form.owner_id !== uid) {
    return c.text('Form not available', 404);
  }

  if (a.op === 'upload') {
    // draft/ keeps the global cap, and counts against the owner's own quota (ADR-067).
    const legacy = a.questionId === undefined;
    return reserveAndPresign(c, {
      key: legacy ? a.path : mintUploadKey('draft', a.parsed.formId, a.parsed.filename),
      owner: uid,
      formId: a.parsed.formId,
      questionId: legacy ? null : (a.questionId as string),
      len: a.len,
      contentType: safeContentType(a.contentType),
      legacy,
      maxBytes: MAX_BYTES,
      who: 'owner',
      netKey: null,
    });
  }

  let client: S3Client;
  try {
    client = s3();
  } catch (err) {
    console.error('[storagesign] storage not configured', err);
    return c.text('Sign failed', 500);
  }
  const name = (a.path.split('/').pop() || 'file').replace(/["\r\n]/g, '');

  if (a.op === 'download') {
    try {
      // Force the browser to save, not render, whatever the object claims to be.
      const command = new GetObjectCommand({
        Bucket: BUCKET,
        Key: a.path,
        ResponseContentDisposition: `attachment; filename="${name}"`,
        ResponseContentType: safeContentType(undefined),
      });
      const url = await getSignedUrl(client, command, { expiresIn: 3600 });
      return c.json({ url });
    } catch (err) {
      console.error('[storagesign] download sign failed', err);
      return c.text('Sign failed', 500);
    }
  }

  if (a.op === 'meta') {
    try {
      const head = await client.send(new HeadObjectCommand({ Bucket: BUCKET, Key: a.path }));
      return c.json({
        name,
        size: head.ContentLength ?? 0,
        mime: safeContentType(head.ContentType),
      });
    } catch (err) {
      if (isMissing(err)) return c.text('Not found', 404);
      console.error('[storagesign] meta failed', err);
      return c.text('Temporarily unavailable', 503);
    }
  }

  // content: bytes through the Function, capped so one read can't hold 32 MiB in memory.
  let out: GetObjectCommandOutput;
  try {
    out = await client.send(new GetObjectCommand({ Bucket: BUCKET, Key: a.path }));
  } catch (err) {
    if (isMissing(err)) return c.text('Not found', 404);
    console.error('[storagesign] content failed', err);
    return c.text('Temporarily unavailable', 503);
  }
  if (!out.Body) return c.text('Not found', 404);
  if (typeof out.ContentLength !== 'number' || out.ContentLength > LIMITS.contentMaxBytes) {
    (out.Body as { destroy?: () => void }).destroy?.();
    // The studio falls back to the signed download link.
    return c.json({ error: 'too_large_for_preview' }, 413);
  }
  try {
    // Type-only: the SDK says ArrayBufferLike, Response wants ArrayBuffer-backed; it is.
    const bytes = (await out.Body.transformToByteArray()) as Uint8Array<ArrayBuffer>;
    return new Response(bytes, {
      status: 200,
      headers: {
        // Only allow-listed types keep their identity; the studio previews
        // those inline via blob: URLs. Everything else is opaque bytes.
        'Content-Type': safeContentType(out.ContentType),
        'Content-Disposition': `attachment; filename="${name}"`,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, max-age=60',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (err) {
    console.error('[storagesign] content read failed', err);
    return c.text('Temporarily unavailable', 503);
  }
}

app.post(
  '/',
  bodyLimit({ maxSize: MAX_BODY_BYTES, onError: (c) => c.text('Payload too large', 413) }),
  async (c) => {
    let body: unknown;
    try {
      body = JSON.parse(await c.req.text());
    } catch {
      return c.text('Invalid JSON', 400);
    }
    if (!isObj(body)) return c.text('Invalid JSON', 400);

    // Every shape check runs before any DB call (ADR-058).
    const { op, path, contentType, contentLength, unlockToken, questionId } = body;
    if (typeof op !== 'string' || !OPS.has(op)) {
      return c.text('Missing path or op', 400);
    }
    if (op === 'purge') {
      if (!process.env.DATABASE_URL) return c.text('Server misconfigured', 500);
      const ip = clientIp((n) => c.req.header(n));
      return ownerPath(c, {
        op,
        path: null,
        parsed: null,
        len: 0,
        contentType: undefined,
        questionId: undefined,
        ip,
      });
    }
    if (typeof path !== 'string') {
      return c.text('Missing path or op', 400);
    }
    const parsed = parsePath(path);
    if (!parsed) {
      return c.text('Invalid path shape', 400);
    }
    if (
      (contentType !== undefined &&
        (typeof contentType !== 'string' || contentType.length > 255)) ||
      (unlockToken !== undefined &&
        (typeof unlockToken !== 'string' || !/^[0-9a-f]{64}$/.test(unlockToken))) ||
      // ADR-067: a new page names the question it uploads for; an old one sends none.
      (questionId !== undefined && !isQuestionId(questionId))
    ) {
      return c.text('Invalid fields', 400);
    }
    let len = 0;
    if (op === 'upload') {
      if (
        typeof contentLength !== 'number' ||
        !Number.isSafeInteger(contentLength) ||
        contentLength < 1
      ) {
        return c.text('Missing or invalid contentLength', 400);
      }
      if (contentLength > MAX_BYTES) {
        return c.text(tooLargeText(MAX_BYTES), 413);
      }
      len = contentLength;
    }

    if (!process.env.DATABASE_URL) {
      return c.text('Server misconfigured', 500);
    }
    const ip = clientIp((n) => c.req.header(n));
    const type = contentType as string | undefined;

    const question = questionId as string | undefined;

    if (parsed.scope === 'draft' || op !== 'upload') {
      return ownerPath(c, { op, path, parsed, len, contentType: type, questionId: question, ip });
    }

    // public/ upload (ADR-050): a published form that asks for a file. Only
    // the unlock token opens a locked form; a Bearer earns nothing here.
    let form: FormGateRow | null;
    try {
      form = await loadForm(parsed.formId);
    } catch (err) {
      console.error('[storagesign] form check failed', err);
      return c.text('Temporarily unavailable', 503);
    }
    if (!form || form.deleted_at || form.status !== 'published' || !form.has_schema) {
      return c.text('Form not available', 404);
    }
    if (
      form.fill_password_hash &&
      !isValidUnlockToken(form.id, form.fill_password_hash, unlockToken)
    ) {
      return c.json({ error: 'locked' }, 401);
    }

    // IP + form owner, with a whole-IP backstop 5x larger, charged by size (ADR-058).
    const cost = units(len, UPLOAD_UNIT);
    const buckets: Bucket[] = [
      {
        key: `up:ipowner:${ip}:${ownerKey(form.owner_id)}`,
        win: 3600,
        max: ipMax(ip, LIMITS.ipOwner),
        cost,
      },
      { key: `up:ip:${ip}`, win: 3600, max: ipMax(ip, LIMITS.ip), cost },
    ];
    let v: Awaited<ReturnType<typeof charge>>;
    try {
      v = await charge(pool, buckets, form.id);
    } catch (err) {
      console.error('[storagesign] rate limit check failed', err);
      return c.text('Temporarily unavailable', 503);
    }
    if (!v.ok) {
      return tooMany(
        c,
        v.retryAfter,
        `Too many uploads from this network right now. Please wait ${aboutMinutes(v.retryAfter)}, or try from another network (for example mobile data).`,
      );
    }

    // After the lock, so a locked form's questions and limits stay behind the password.
    // A named question sets its own limit (ADR-067); an old page's request, the roomiest's.
    const legacy = question === undefined;
    const decision = legacy
      ? decidePublicUpload(v.schema, len, MAX_BYTES)
      : decideQuestionUpload(v.schema, question, len, MAX_BYTES);
    if (!decision.ok) {
      // No file question looks exactly like an unpublished form: not free storage, no oracle.
      return decision.reason === 'no-file-question'
        ? c.text('Form not available', 404)
        : c.text(tooLargeText(decision.maxBytes), 413);
    }
    // Every upload is charged to an account; a form with none takes no files (fail closed).
    if (!form.owner_id) return c.text(STORAGE_COPY.respondent, 507);
    return reserveAndPresign(c, {
      // The server picks the key; an old page keeps its own path during the grace.
      key: legacy ? path : mintUploadKey('public', parsed.formId, parsed.filename),
      owner: form.owner_id,
      formId: parsed.formId,
      questionId: legacy ? null : question,
      len,
      contentType: safeContentType(type),
      legacy,
      maxBytes: decision.maxBytes,
      who: 'respondent',
      netKey: networkKey(ip),
    });
  },
);

export default app;
