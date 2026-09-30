/**
 * Neon Object Storage uploads for Slate admin + public fill (ADR-029).
 * Uses Neon Function `storage-sign` for presigned PUT/GET URLs.
 */

import { SLATE_FILE_REF_PREFIX } from '@/utils/fileUploadRef.js';
import { hasStorageSignUrl, getStorageSignUrl, isNeonConfigured } from './neon/config.js';
import { getUploadFormId, getUploadScope } from './uploadContext.js';
import { readFillUnlockToken } from './fillUnlock.js';

const STORAGE_PREFIX = 'storage:';

const OFFLINE = 'Couldn’t reach Slate. Check your connection and try again.';

/**
 * Respondent pages never read stored files: storagesign serves them only to the
 * form's owner (ADR-058), so a call from PublicFill would only ever 401.
 */
const respondentPage = () => getUploadScope() === 'public';

function sanitizeFilename(name: string): string {
  return name.replace(/[^\w.\-()+ ]/g, '_').slice(0, 120);
}

const EXT_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  heic: 'image/heic',
  heif: 'image/heif',
  pdf: 'application/pdf',
  txt: 'text/plain',
  csv: 'text/csv',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
};

/** Prefer browser MIME; fall back to extension so empty File.type still signs. */
function normalizeUploadMime(file: File): string {
  const raw = (file.type || '').trim().toLowerCase().split(';')[0]!.trim();
  if (raw && raw !== 'application/octet-stream') return raw;
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return EXT_MIME[ext] || raw || 'application/octet-stream';
}

/** A respondent's upload when the form owner's storage is full (ADR-067). The server says the same. */
export const STORAGE_FULL_COPY = 'This form can’t accept more files right now.';

async function friendlySignError(res: Response): Promise<string> {
  if (res.status === 507) {
    // Plain text from storagesign: the respondent sentence, or the owner's own usage (ADR-067).
    const text = (await res.text().catch(() => '')).trim();
    return text && text.length <= 300 && !text.startsWith('<') ? text : STORAGE_FULL_COPY;
  }
  if (res.status === 429) {
    let retryAfter = Number(res.headers.get('Retry-After') || 60);
    try {
      const body = (await res.json()) as { error?: string; retryAfterSeconds?: number };
      if (body.retryAfterSeconds) retryAfter = body.retryAfterSeconds;
      return (
        body.error || `Too many uploads. Please wait about ${retryAfter} seconds and try again.`
      );
    } catch {
      return `Too many uploads. Please wait about ${retryAfter} seconds and try again.`;
    }
  }
  if (res.status === 413) return 'That file is too large.';
  if (res.status === 404) return 'This form is not accepting uploads.';
  if (res.status === 401) return 'This form is locked. Reload the page and enter the password.';
  const text = await res.text().catch(() => '');
  return text || `Sign failed (${res.status})`;
}

export function isStorageUploadRef(ref: string): boolean {
  const id = ref.startsWith(SLATE_FILE_REF_PREFIX) ? ref.slice(SLATE_FILE_REF_PREFIX.length) : ref;
  return id.startsWith(STORAGE_PREFIX);
}

export function storagePathFromRef(ref: string): string | null {
  const id = ref.startsWith(SLATE_FILE_REF_PREFIX) ? ref.slice(SLATE_FILE_REF_PREFIX.length) : ref;
  if (!id.startsWith(STORAGE_PREFIX)) return null;
  return id.slice(STORAGE_PREFIX.length);
}

/** `Authorization: Bearer <user JWT>` when signed in, else empty. */
export async function authHeader(): Promise<Record<string, string>> {
  if (!isNeonConfigured()) return {};
  try {
    // Lazy: the public fill app must not pull the Neon SDK just to upload (ADR-048).
    const { getNeon } = await import('./neon/env.js');
    const { data } = await getNeon().auth.getSession();
    const session = data?.session as
      | { access_token?: string; accessToken?: string }
      | null
      | undefined;
    const token = session?.access_token || session?.accessToken;
    if (token) return { Authorization: `Bearer ${token}` };
  } catch {
    // anonymous
  }
  return {};
}

/** A key storagesign may hand back for this scope and form: the shape every stored ref has. */
function isKeyFor(key: unknown, scope: string, formId: string): key is string {
  return (
    typeof key === 'string' &&
    key.startsWith(`${scope}/${formId}/`) &&
    /^(public|draft)\/[A-Za-z0-9_-]{4,64}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[^/]{1,120}$/.test(
      key,
    )
  );
}

export async function uploadToNeonStorage(
  file: File,
  opts?: { formId?: string; scope?: 'public' | 'draft'; questionId?: string },
): Promise<string> {
  if (!isNeonConfigured() || !hasStorageSignUrl()) {
    throw new Error('Neon Object Storage is not configured.');
  }
  const resolvedFormId = opts?.formId ?? getUploadFormId();
  if (!resolvedFormId) {
    throw new Error('Upload context missing form id.');
  }
  const scope = opts?.scope ?? 'public';
  // The server picks the real key (ADR-067); this path tells it the scope, form and name,
  // and is what a storagesign from before ADR-067 signs as is.
  const uploadId = crypto.randomUUID();
  const path = `${scope}/${resolvedFormId}/${uploadId}/${sanitizeFilename(file.name)}`;

  const contentType = normalizeUploadMime(file);
  let signRes: Response;
  try {
    signRes = await fetch(getStorageSignUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // public/ ignores a Bearer (ADR-050), so respondents never load the SDK for one.
        ...(scope === 'draft' ? await authHeader() : {}),
      },
      body: JSON.stringify({
        op: 'upload',
        path,
        contentType,
        contentLength: file.size,
        // Locked forms refuse public/ uploads without it (ADR-043).
        unlockToken:
          scope === 'public' ? (readFillUnlockToken(resolvedFormId) ?? undefined) : undefined,
        // Its own size limit, and the server mints the key for it (ADR-067).
        questionId: opts?.questionId || undefined,
      }),
    });
  } catch {
    throw new Error(OFFLINE);
  }
  if (!signRes.ok) {
    throw new Error(await friendlySignError(signRes));
  }
  const {
    url,
    method,
    contentType: signedType,
    key,
  } = (await signRes.json()) as {
    url: string;
    method?: string;
    contentType?: string;
    key?: unknown;
  };
  // Where the object lands: the server's key, or our own path from a storagesign before ADR-067.
  const stored = isKeyFor(key, scope, resolvedFormId) ? key : path;
  let put: Response;
  try {
    put = await fetch(url, {
      method: method || 'PUT',
      headers: {
        // storage-sign may have remapped the type (allowlist); the signature binds it.
        'Content-Type': signedType || contentType,
        'Content-Length': String(file.size),
      },
      body: file,
    });
  } catch {
    throw new Error('Could not reach file storage — check your connection and try again.');
  }
  if (!put.ok) {
    const detail = await put.text().catch(() => '');
    throw new Error(
      detail
        ? `Upload failed (${put.status}): ${detail.slice(0, 120)}`
        : `Upload failed (${put.status}).`,
    );
  }
  const ref = `${SLATE_FILE_REF_PREFIX}${STORAGE_PREFIX}${stored}`;
  // The page already knows what it uploaded: no meta call to show the chip.
  metaCache.set(ref, {
    name: stored.split('/').pop() || sanitizeFilename(file.name),
    size: file.size,
    mime: signedType || contentType,
  });
  return ref;
}

/** @deprecated Use uploadToNeonStorage */
export const uploadToSupabaseStorage = uploadToNeonStorage;

const downloadUrlCache = new Map<string, { url: string; at: number }>();
const metaCache = new Map<string, { name: string; size: number; mime: string }>();
/** Signed GET URLs are typically valid ~1h; refresh a bit early. */
const DOWNLOAD_URL_TTL_MS = 45 * 60 * 1000;

export async function getStorageUploadMeta(ref: string): Promise<{
  name: string;
  size: number;
  mime: string;
} | null> {
  const path = storagePathFromRef(ref);
  if (!path || !isNeonConfigured() || !hasStorageSignUrl()) return null;

  const cached = metaCache.get(ref);
  if (cached) return cached;
  if (respondentPage()) return null;

  const signRes = await fetch(getStorageSignUrl(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(await authHeader()),
    },
    body: JSON.stringify({ op: 'meta', path }),
  });
  if (!signRes.ok) {
    // Don't cache failures — a transient auth blip would poison thumbs for the session.
    return null;
  }
  const meta = (await signRes.json()) as { name: string; size: number; mime: string };
  metaCache.set(ref, meta);
  return meta;
}

export async function getStorageDownloadUrl(ref: string): Promise<string | null> {
  const path = storagePathFromRef(ref);
  if (!path || !isNeonConfigured() || !hasStorageSignUrl()) return null;
  if (respondentPage()) return null;

  const hit = downloadUrlCache.get(ref);
  if (hit && Date.now() - hit.at < DOWNLOAD_URL_TTL_MS) return hit.url;

  const signRes = await fetch(getStorageSignUrl(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(await authHeader()),
    },
    body: JSON.stringify({ op: 'download', path }),
  });
  if (!signRes.ok) return null;
  const { url } = (await signRes.json()) as { url?: string };
  if (!url) return null;
  downloadUrlCache.set(ref, { url, at: Date.now() });
  return url;
}

/**
 * Fetch file bytes via the storagesign Function (CORS-safe).
 * Prefer this for in-app preview / HEIC conversion over the raw signed S3 URL.
 */
export async function getStorageContentBlob(ref: string): Promise<{
  blob: Blob;
  name: string;
  mime: string;
} | null> {
  const path = storagePathFromRef(ref);
  if (!path || !isNeonConfigured() || !hasStorageSignUrl()) return null;
  if (respondentPage()) return null;
  const res = await fetch(getStorageSignUrl(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(await authHeader()),
    },
    body: JSON.stringify({ op: 'content', path }),
  });
  if (!res.ok) return null;
  const blob = await res.blob();
  const name = path.split('/').pop() || 'file';
  const mime = res.headers.get('Content-Type') || blob.type || 'application/octet-stream';
  return { blob, name, mime };
}
