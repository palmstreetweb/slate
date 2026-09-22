/**
 * Neon Function: presign Object Storage upload/download (ADR-029 / ADR-031).
 * Deploy: neon functions deploy storagesign --src neon/functions/storage-sign
 * Neon injects DATABASE_URL and S3-compatible Object Storage credentials.
 *
 * Auth model:
 * - public/ upload: anonymous OK when form is published (rate-limited).
 *   Password-locked forms (ADR-043) also need the respondent's unlockToken.
 * - draft/ upload + all download/meta/content: Bearer JWT whose `sub` matches forms.owner_id.
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

const BUCKET = process.env.NEON_STORAGE_BUCKET || 'form-uploads';

/** Default 32 MB — matches client prepareFileForUpload non-image cap. */
const MAX_BYTES = Number(process.env.STORAGE_SIGN_MAX_BYTES ?? 32 * 1024 * 1024);

/** Anonymous sign: 20 / 10 min per IP + form. */
const PER_IP_FORM_MAX = Number(process.env.STORAGE_SIGN_IP_FORM_MAX ?? 20);
const PER_IP_FORM_WINDOW_SEC = Number(process.env.STORAGE_SIGN_IP_FORM_WINDOW_SEC ?? 600);

/** Anonymous sign: 60 / hour per IP. */
const PER_IP_MAX = Number(process.env.STORAGE_SIGN_IP_MAX ?? 60);
const PER_IP_WINDOW_SEC = Number(process.env.STORAGE_SIGN_IP_WINDOW_SEC ?? 3600);

/** path: public|draft / formId / uuid / filename */
const PATH_RE =
  /^(public|draft)\/([A-Za-z0-9_-]{4,64})\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/([^/]{1,120})$/i;

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

function clientIp(c: { req: { header: (name: string) => string | undefined } }): string {
  const forwarded = c.req.header('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first.slice(0, 64);
  }
  const real =
    c.req.header('cf-connecting-ip') || c.req.header('x-real-ip') || c.req.header('true-client-ip');
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

function parsePath(path: string): {
  scope: 'public' | 'draft';
  formId: string;
  uploadId: string;
  filename: string;
} | null {
  const m = PATH_RE.exec(path);
  if (!m) return null;
  const scope = m[1]!.toLowerCase() as 'public' | 'draft';
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

/** Decode JWT payload (structure + exp). Signature verify needs JWKS (optional later). */
function decodeJwtPayload(token: string): { sub?: string; id?: string; exp?: number } | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1]!.replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
    const json = Buffer.from(b64 + pad, 'base64').toString('utf8');
    const payload = JSON.parse(json) as { sub?: string; id?: string; exp?: number };
    if (typeof payload.exp === 'number' && payload.exp * 1000 < Date.now()) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

function userIdFromToken(token: string): string | null {
  const payload = decodeJwtPayload(token);
  if (!payload) return null;
  const uid = payload.sub || payload.id;
  return typeof uid === 'string' && uid.length > 0 ? uid : null;
}

async function loadForm(formId: string): Promise<{
  id: string;
  status: string;
  deleted_at: string | null;
  owner_id: string | null;
  fill_password_hash: string | null;
} | null> {
  const formRes = await pool.query<{
    id: string;
    status: string;
    deleted_at: string | null;
    owner_id: string | null;
    fill_password_hash: string | null;
  }>(
    `select id, status, deleted_at, owner_id, fill_password_hash
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
  | { ok: false; status: 401 | 403 | 404; message: string }
> {
  const token = bearerToken(authHeader);
  if (!token) return { ok: false, status: 401, message: 'Unauthorized' };
  const uid = userIdFromToken(token);
  if (!uid) return { ok: false, status: 401, message: 'Unauthorized' };

  const form = await loadForm(formId);
  if (!form || form.deleted_at) return { ok: false, status: 404, message: 'Form not available' };
  if (!form.owner_id || form.owner_id !== uid) {
    return { ok: false, status: 403, message: 'Forbidden' };
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

    const contentType =
      (body.contentType || '').trim().toLowerCase().split(';')[0]!.trim() ||
      'application/octet-stream';

    const contentLength = Number(body.contentLength);
    if (!Number.isFinite(contentLength) || contentLength < 1) {
      return c.text('Missing or invalid contentLength', 400);
    }
    if (contentLength > MAX_BYTES) {
      return c.text(`File too large (max ${Math.floor(MAX_BYTES / (1024 * 1024))} MB)`, 413);
    }

    const hasBearer = Boolean(bearerToken(authHeader));

    try {
      const ip = clientIp(c);
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

    // public/ upload: published form only (draft already gated by owner above).
    if (parsed.scope === 'public') {
      try {
        const form = await loadForm(parsed.formId);
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
      const url = await getSignedUrl(client, command, { expiresIn: 600 });
      return c.json({ url, method: 'PUT', maxBytes: MAX_BYTES });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sign failed';
      return c.text(message, 500);
    }
  }

  try {
    const client = s3();

    if (body.op === 'download') {
      const command = new GetObjectCommand({ Bucket: BUCKET, Key: body.path });
      const url = await getSignedUrl(client, command, { expiresIn: 3600 });
      return c.json({ url });
    }

    if (body.op === 'content') {
      const out = await client.send(new GetObjectCommand({ Bucket: BUCKET, Key: body.path }));
      if (!out.Body) return c.text('Not found', 404);
      const bytes = await out.Body.transformToByteArray();
      const name = body.path.split('/').pop() || 'file';
      const contentType = out.ContentType || 'application/octet-stream';
      return new Response(bytes, {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Content-Disposition': `inline; filename="${name.replace(/"/g, '')}"`,
          'Cache-Control': 'private, max-age=60',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    if (body.op === 'meta') {
      try {
        const head = await client.send(new HeadObjectCommand({ Bucket: BUCKET, Key: body.path }));
        const name = body.path.split('/').pop() || 'file';
        return c.json({
          name,
          size: head.ContentLength ?? 0,
          mime: head.ContentType || 'application/octet-stream',
        });
      } catch {
        return c.text('Not found', 404);
      }
    }

    return c.text('Unknown op', 400);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Sign failed';
    return c.text(message, 500);
  }
});

export default app;
