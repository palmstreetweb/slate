/**
 * Neon Object Storage uploads for Slate admin + public fill (ADR-029).
 * Uses Neon Function `storage-sign` for presigned PUT/GET URLs.
 */

import { SLATE_FILE_REF_PREFIX } from '@/utils/fileUploadRef.js';
import {
  getNeon,
  hasStorageSignUrl,
  getStorageSignUrl,
  isNeonConfigured,
} from './neon/env.js';
import { getUploadFormId } from './uploadContext.js';

const STORAGE_PREFIX = 'storage:';

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

async function friendlySignError(res: Response): Promise<string> {
  if (res.status === 429) {
    let retryAfter = Number(res.headers.get('Retry-After') || 60);
    try {
      const body = (await res.json()) as { error?: string; retryAfterSeconds?: number };
      if (body.retryAfterSeconds) retryAfter = body.retryAfterSeconds;
      return (
        body.error ||
        `Too many uploads. Please wait about ${retryAfter} seconds and try again.`
      );
    } catch {
      return `Too many uploads. Please wait about ${retryAfter} seconds and try again.`;
    }
  }
  if (res.status === 413) return 'That file is too large.';
  if (res.status === 404) return 'This form is not accepting uploads.';
  const text = await res.text().catch(() => '');
  return text || `Sign failed (${res.status})`;
}

export function isStorageUploadRef(ref: string): boolean {
  const id = ref.startsWith(SLATE_FILE_REF_PREFIX)
    ? ref.slice(SLATE_FILE_REF_PREFIX.length)
    : ref;
  return id.startsWith(STORAGE_PREFIX);
}

export function storagePathFromRef(ref: string): string | null {
  const id = ref.startsWith(SLATE_FILE_REF_PREFIX)
    ? ref.slice(SLATE_FILE_REF_PREFIX.length)
    : ref;
  if (!id.startsWith(STORAGE_PREFIX)) return null;
  return id.slice(STORAGE_PREFIX.length);
}

async function authHeader(): Promise<Record<string, string>> {
  if (!isNeonConfigured()) return {};
  try {
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

export async function uploadToNeonStorage(
  file: File,
  opts?: { formId?: string; scope?: 'public' | 'draft' },
): Promise<string> {
  if (!isNeonConfigured() || !hasStorageSignUrl()) {
    throw new Error('Neon Object Storage is not configured.');
  }
  const resolvedFormId = opts?.formId ?? getUploadFormId();
  if (!resolvedFormId) {
    throw new Error('Upload context missing form id.');
  }
  const scope = opts?.scope ?? 'public';
  const uploadId = crypto.randomUUID();
  const path = `${scope}/${resolvedFormId}/${uploadId}/${sanitizeFilename(file.name)}`;

  const contentType = normalizeUploadMime(file);
  const signRes = await fetch(getStorageSignUrl(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(await authHeader()),
    },
    body: JSON.stringify({
      op: 'upload',
      path,
      contentType,
      contentLength: file.size,
    }),
  });
  if (!signRes.ok) {
    throw new Error(await friendlySignError(signRes));
  }
  const { url, method } = (await signRes.json()) as { url: string; method?: string };
  let put: Response;
  try {
    put = await fetch(url, {
      method: method || 'PUT',
      headers: {
        'Content-Type': contentType,
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
  return `${SLATE_FILE_REF_PREFIX}${STORAGE_PREFIX}${path}`;
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
  const mime =
    res.headers.get('Content-Type') ||
    blob.type ||
    'application/octet-stream';
  return { blob, name, mime };
}
