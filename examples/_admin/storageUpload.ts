/**
 * Supabase Storage uploads for Slate admin + public fill (ADR-028).
 */

import { SLATE_FILE_REF_PREFIX } from '@/utils/fileUploadRef.js';
import { getSupabase, isSupabaseConfigured } from './supabase/env.js';
import { getUploadFormId } from './uploadContext.js';

const STORAGE_PREFIX = 'storage:';
const BUCKET = 'form-uploads';

function sanitizeFilename(name: string): string {
  return name.replace(/[^\w.\-()+ ]/g, '_').slice(0, 120);
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

export async function uploadToSupabaseStorage(
  file: File,
  opts?: { formId?: string; scope?: 'public' | 'draft' },
): Promise<string> {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase is not configured.');
  }
  const resolvedFormId = opts?.formId ?? getUploadFormId();
  if (!resolvedFormId) {
    throw new Error('Upload context missing form id.');
  }
  const scope = opts?.scope ?? 'public';
  const uploadId = crypto.randomUUID();
  const path = `${scope}/${resolvedFormId}/${uploadId}/${sanitizeFilename(file.name)}`;
  const supabase = getSupabase();
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: file.type || 'application/octet-stream',
    upsert: false,
  });
  if (error) throw error;
  return `${SLATE_FILE_REF_PREFIX}${STORAGE_PREFIX}${path}`;
}

export async function getStorageUploadMeta(ref: string): Promise<{
  name: string;
  size: number;
  mime: string;
} | null> {
  const path = storagePathFromRef(ref);
  if (!path || !isSupabaseConfigured()) return null;
  const supabase = getSupabase();
  const parts = path.split('/');
  const name = parts[parts.length - 1] ?? 'file';
  const { data, error } = await supabase.storage.from(BUCKET).list(parts.slice(0, -1).join('/'), {
    search: name,
  });
  if (error || !data?.[0]) {
    return { name, size: 0, mime: 'application/octet-stream' };
  }
  const row = data[0];
  return {
    name,
    size: row.metadata?.size ? Number(row.metadata.size) : 0,
    mime: row.metadata?.mimetype ?? 'application/octet-stream',
  };
}

export async function getStorageDownloadUrl(ref: string): Promise<string | null> {
  const path = storagePathFromRef(ref);
  if (!path || !isSupabaseConfigured()) return null;
  const supabase = getSupabase();
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}
