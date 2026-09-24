/**
 * Default Slate admin / public-respond file upload handler.
 * Optimizes images, then stores in IndexedDB, Neon Object Storage, or
 * POSTs to `VITE_UPLOAD_URL` when configured.
 */

import { createFileUploadHandler } from '@/utils/createFileUploadHandler.js';
import type { FileUploadHandler } from '@/utils/createFileUploadHandler.js';
import { saveLocalUpload } from './localFileStore.js';
import { hasStorageSignUrl, isNeonConfigured } from './neon/config.js';
import { authHeader, uploadToNeonStorage } from './storageUpload.js';
import { getUploadFormId, getUploadScope } from './uploadContext.js';

async function uploadToRemote(
  file: File,
  questionId: string,
  _ctx?: { maxSizeMb?: number },
): Promise<string> {
  const formId = getUploadFormId();
  // Portable share links and missing context use local storage — Neon paths need a real form id.
  const portable = !formId || formId.startsWith('portable_') || formId.startsWith('local_');

  if (isNeonConfigured() && hasStorageSignUrl() && !portable) {
    // The page decides first (PublicFill pins 'public'). Otherwise a signed-in
    // owner previewing their own form → draft/; everyone else → public/.
    // Only draft/ passes the owner gate server-side, so a stray session can't widen anything.
    const scope = getUploadScope() ?? ((await authHeader()).Authorization ? 'draft' : 'public');
    return uploadToNeonStorage(file, { scope, formId });
  }

  const base = import.meta.env.VITE_UPLOAD_URL?.trim();
  if (!base || portable) {
    return saveLocalUpload(file);
  }

  const fd = new FormData();
  fd.append('file', file, file.name);
  fd.append('questionId', questionId);

  const res = await fetch(base, { method: 'POST', body: fd });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `Upload failed (${res.status})`);
  }

  const data = (await res.json()) as { url?: string; key?: string };
  const out = data.url ?? data.key;
  if (!out || typeof out !== 'string') {
    throw new Error('Upload response missing url or key.');
  }
  return out;
}

/** Always IndexedDB — for portable share links that aren't Neon-backed forms. */
export const localHostFileUpload: FileUploadHandler = (file, questionId, ctx) =>
  createFileUploadHandler({
    maxSizeMb: ctx?.maxSizeMb,
    upload: (f) => saveLocalUpload(f),
  })(file, questionId, ctx);

/** Shared handler for preview, public share links, and canvas. */
export function createHostFileUploadHandler(maxSizeMb?: number): FileUploadHandler {
  return createFileUploadHandler({
    maxSizeMb,
    upload: uploadToRemote,
  });
}

/** Singleton — passes per-question `maxSizeMb` via optional third argument. */
export const hostFileUpload: FileUploadHandler = (file, questionId, ctx) =>
  createHostFileUploadHandler(ctx?.maxSizeMb)(file, questionId, ctx);
