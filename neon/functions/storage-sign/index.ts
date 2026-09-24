/**
 * Neon Function: presign Object Storage upload/download (ADR-029 / ADR-031).
 * Deploy: neon functions deploy storagesign --src neon/functions/storage-sign
 * Neon injects DATABASE_URL and S3-compatible Object Storage credentials.
 *
 * Auth model:
 * - public/ upload: anonymous OK when form is published (rate-limited) and its
 *   published schema has a file question; size capped by that question (ADR-050).
 *   Password-locked forms (ADR-043) also need the respondent's unlockToken.
 * - draft/ upload + all download/meta/content: Bearer JWT, signature verified
 *   against the Neon Auth JWKS, whose `sub` matches forms.owner_id.
 *
 * Stored objects are only ever served with a type from ALLOWED_TYPES; anything
 * else is stored and served as application/octet-stream, as an attachment.
 * A "pdf" that is really HTML must never reach a frame on the studio origin.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { Pool } from 'pg';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { isValidUnlockToken } from './fillLock.js';
import { clientIp } from './requestIp.js';
import { verifyUserJwt } from './authJwt.js';
import { decidePublicUpload } from './uploadPolicy.js';

const BUCKET = process.env.NEON_STORAGE_BUCKET || 'form-uploads';

/** Default 32 MB — matches client prepareFileForUpload non-image cap. */
const MAX_BYTES = Number(process.env.STORAGE_SIGN_MAX_BYTES ?? 32 * 1024 * 1024);

function tooLargeText(maxBytes: number): string {
  return `File too large (max ${+(maxBytes / (1024 * 1024)).toFixed(1)} MB)`;
}

/** Anonymous sign: 20 / 10 min per IP + form. */
const PER_IP_FORM_MAX = Number(process.env.STORAGE_SIGN_IP_FORM_MAX ?? 20);
const PER_IP_FORM_WINDOW_SEC = Number(process.env.STORAGE_SIGN_IP_FORM_WINDOW_SEC ?? 600);

/** Anonymous sign: 60 / hour per IP. */
const PER_IP_MAX = Number(process.env.STORAGE_SIGN_IP_MAX ?? 60);
const PER_IP_WINDOW_SEC = Number(process.env.STORAGE_SIGN_IP_WINDOW_SEC ?? 3600);

/** path: public|draft / formId / uuid / filename — case-sensitive, one namespace. */
const PATH_RE =
  /^(public|draft)\/([A-Za-z0-9_-]{4,64})\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/([^/]{1,120})$/;

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
  'video/mp4',
  'video/quicktime',
  'video/webm',
]);

function safeContentType(raw: string | undefined): string {
  const t = (raw || '').trim().toLowerCase().split(';')[0]!.trim();
  return ALLOWED_TYPES.has(t) ? t : 'application/octet-stream';
}

/** Read-op guard: 120 / 10 min per IP. Owners page through files; scrapers don't. */
const READ_PER_IP_MAX = Number(process.env.STORAGE_SIGN_READ_IP_MAX ?? 120);
const READ_PER_IP_WINDOW_SEC = Number(process.env.STORAGE_SIGN_READ_IP_WINDOW_SEC ?? 600);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
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

type SignBody = {
  op: 'upload' | 'download' | 'meta' | 'content';
  path: string;
  contentType?: string;
  contentLength?: number;
  /** public/ uploads on a password-locked form (ADR-043). */
  unlockToken?: string;
};

const app = new Hono();
app.use('*', cors({ origin: '*' }));
app.options('*', (c) => c.body(null, 204));

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

function parsePath(path: string): {
  scope: 'public' | 'draft';
  formId: string;
  uploadId: string;
  filename: string;
} | null {
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

/** Verified subject, or null. A forged or expired token is the same as none. */
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
  /** Only selected for the public/ upload gate (ADR-050); owner read ops skip it. */
  published_schema?: unknown;
};

async function loadForm(
  formId: string,
  opts: { withPublishedSchema?: boolean } = {},
): Promise<FormGateRow | null> {
  const cols = 'id, status, deleted_at, owner_id, fill_password_hash';
  const formRes = await pool.query<FormGateRow>(
    `select ${opts.withPublishedSchema ? `${cols}, published_schema` : cols}
     from public.forms where id = $1 limit 1`,
    [formId],
  );
  return formRes.rows[0] ?? null;
}

/** Draft + read ops require a Bearer whose subject owns the form. */
async function requireFormOwner(
  authHeader: string,
  formId: string,
): Promise<
  | { ok: true; form: NonNullable<Awaited<ReturnType<typeof loadForm>>> }
  | { ok: false; status: 401 | 404; message: string }
> {
  const token = bearerToken(authHeader);
  if (!token) return { ok: false, status: 401, message: 'Unauthorized' };
  const uid = await userIdFromToken(token);
  if (!uid) return { ok: false, status: 401, message: 'Unauthorized' };

  const form = await loadForm(formId);
  // "Not yours" and "does not exist" look identical — no form-id oracle.
  if (!form || form.deleted_at || !form.owner_id || form.owner_id !== uid) {
    return { ok: false, status: 404, message: 'Form not available' };
  }
  return { ok: true, form };
}

app.post('/', async (c) => {
  let body: SignBody;
  try {
    body = (await c.req.json()) as SignBody;
  } catch {
    return c.text('Invalid JSON', 400);
  }

  if (!body.path || !body.op) {
    return c.text('Missing path or op', 400);
  }

  const parsed = parsePath(body.path);
  if (!parsed) {
    return c.text('Invalid path shape', 400);
  }

  const authHeader = c.req.header('authorization') || '';
  const needsOwner =
    parsed.scope === 'draft' ||
    body.op === 'download' ||
    body.op === 'meta' ||
    body.op === 'content';

  if (needsOwner) {
    if (!process.env.DATABASE_URL) {
      return c.text('Server misconfigured', 500);
    }
    // Meter reads BEFORE the owner check so a forged-token loop can't turn
    // the DB pool or the bucket into a free resource. Fail closed.
    try {
      const perIp = await consumeRate(
        `sign:read:${clientIp((n) => c.req.header(n))}`,
        READ_PER_IP_WINDOW_SEC,
        READ_PER_IP_MAX,
      );
      if (!perIp.allowed) {
        c.header('Retry-After', String(perIp.retryAfterSeconds));
        return c.json({ error: 'Too many requests. Please wait and try again.' }, 429);
      }
    } catch (err) {
      console.error('[storagesign] read rate limit check failed', err);
      return c.text('Temporarily unavailable', 503);
    }
    try {
      const gate = await requireFormOwner(authHeader, parsed.formId);
      if (!gate.ok) return c.text(gate.message, gate.status);
    } catch (err) {
      console.error('[storagesign] owner check failed', err);
      return c.text('Temporarily unavailable', 503);
    }
  }

  // Upload guards (ADR-031)
  if (body.op === 'upload') {
    if (!process.env.DATABASE_URL) {
      return c.text('Server misconfigured', 500);
    }

    const contentType = safeContentType(body.contentType);

    const contentLength = Number(body.contentLength);
    if (!Number.isFinite(contentLength) || contentLength < 1) {
      return c.text('Missing or invalid contentLength', 400);
    }
    if (contentLength > MAX_BYTES) {
      return c.text(tooLargeText(MAX_BYTES), 413);
    }
    // Tightened per form below for public/ (ADR-050); draft/ keeps the global cap.
    let maxBytes = MAX_BYTES;

    // Only draft/ uploads passed the verified owner gate; a bare Bearer on a
    // public/ upload earns nothing (it could be forged).
    const hasBearer = parsed.scope === 'draft';

    try {
      const ip = clientIp((n) => c.req.header(n));
      if (!hasBearer) {
        const perForm = await consumeRate(
          `sign:ipform:${ip}:${parsed.formId}`,
          PER_IP_FORM_WINDOW_SEC,
          PER_IP_FORM_MAX,
        );
        if (!perForm.allowed) {
          c.header('Retry-After', String(perForm.retryAfterSeconds));
          return c.json(
            {
              error: 'Too many uploads from this network. Please wait and try again.',
              retryAfterSeconds: perForm.retryAfterSeconds,
            },
            429,
          );
        }
        const perIp = await consumeRate(`sign:ip:${ip}`, PER_IP_WINDOW_SEC, PER_IP_MAX);
        if (!perIp.allowed) {
          c.header('Retry-After', String(perIp.retryAfterSeconds));
          return c.json(
            {
              error: 'Too many uploads from this network. Please wait and try again.',
              retryAfterSeconds: perIp.retryAfterSeconds,
            },
            429,
          );
        }
      } else {
        const perIp = await consumeRate(`sign:auth:${ip}`, PER_IP_WINDOW_SEC, PER_IP_MAX * 2);
        if (!perIp.allowed) {
          c.header('Retry-After', String(perIp.retryAfterSeconds));
          return c.json(
            {
              error: 'Too many uploads from this network. Please wait and try again.',
              retryAfterSeconds: perIp.retryAfterSeconds,
            },
            429,
          );
        }
      }
    } catch (err) {
      console.error('[storagesign] rate limit check failed', err);
      return c.text('Temporarily unavailable', 503);
    }

    // public/ upload: published form that asks for a file (draft already gated by owner above).
    if (parsed.scope === 'public') {
      try {
        // One query: the gate columns plus the published questions the policy reads.
        const form = await loadForm(parsed.formId, { withPublishedSchema: true });
        if (!form || form.deleted_at) {
          return c.text('Form not available', 404);
        }
        if (form.status !== 'published') {
          return c.text('Form not available', 404);
        }
        // Locked form: a Bearer does not help here — only the unlock token does,
        // otherwise any signed-in stranger could still drop files on it.
        if (
          form.fill_password_hash &&
          !isValidUnlockToken(form.id, form.fill_password_hash, body.unlockToken)
        ) {
          return c.json({ error: 'locked' }, 401);
        }
        // After the lock, so a locked form's questions and limits stay behind the password.
        const decision = decidePublicUpload(form.published_schema, contentLength, MAX_BYTES);
        if (!decision.ok) {
          // No file question looks exactly like an unpublished form: not free storage, no oracle.
          if (decision.reason === 'no-file-question') {
            return c.text('Form not available', 404);
          }
          return c.text(tooLargeText(decision.maxBytes), 413);
        }
        maxBytes = decision.maxBytes;
      } catch (err) {
        console.error('[storagesign] form check failed', err);
        return c.text('Temporarily unavailable', 503);
      }
    }

    try {
      const client = s3();
      // Bind ContentLength so a tiny signed request cannot PUT an oversized body (ADR-031).
      const command = new PutObjectCommand({
        Bucket: BUCKET,
        Key: body.path,
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
      return c.json({ url, method: 'PUT', maxBytes, contentType });
    } catch (err) {
      console.error('[storagesign] presign failed', err);
      return c.text('Sign failed', 500);
    }
  }

  try {
    const client = s3();

    const name = (body.path.split('/').pop() || 'file').replace(/["\r\n]/g, '');

    if (body.op === 'download') {
      // Force the browser to save, not render, whatever the object claims to be.
      const command = new GetObjectCommand({
        Bucket: BUCKET,
        Key: body.path,
        ResponseContentDisposition: `attachment; filename="${name}"`,
        ResponseContentType: safeContentType(undefined),
      });
      const url = await getSignedUrl(client, command, { expiresIn: 3600 });
      return c.json({ url });
    }

    if (body.op === 'content') {
      const out = await client.send(new GetObjectCommand({ Bucket: BUCKET, Key: body.path }));
      if (!out.Body) return c.text('Not found', 404);
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
    }

    if (body.op === 'meta') {
      try {
        const head = await client.send(new HeadObjectCommand({ Bucket: BUCKET, Key: body.path }));
        return c.json({
          name,
          size: head.ContentLength ?? 0,
          mime: safeContentType(head.ContentType),
        });
      } catch {
        return c.text('Not found', 404);
      }
    }

    return c.text('Unknown op', 400);
  } catch (err) {
    console.error('[storagesign] read op failed', err);
    return c.text('Sign failed', 500);
  }
});

export default app;
