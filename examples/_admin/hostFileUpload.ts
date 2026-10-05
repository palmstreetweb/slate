/**
 * Default Slate admin / public-respond file upload handler.
 * Optimizes images, then stores in IndexedDB, Neon Object Storage, or
 * POSTs to `VITE_UPLOAD_URL` when configured.
 */

import { createFileUploadHandler } from '@/utils/createFileUploadHandler.js';
import type { FileUploadHandler } from '@/utils/createFileUploadHandler.js';
import { saveLocalUpload } from './localFileStore.js';
import { hasStorageSignUrl, isNeonConfigured } from './neon/config.js';
import { UPLOAD_COPY, authHeader, uploadToNeonStorage } from './storageUpload.js';
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
    // The question sets the size limit, and the server mints the key for it (ADR-067).
    return uploadToNeonStorage(file, { scope, formId, questionId });
  }

  const base = import.meta.env.VITE_UPLOAD_URL?.trim();
  if (!base || portable) {
    return saveLocalUpload(file);
  }

  const fd = new FormData();
  fd.append('file', file, file.name);
  fd.append('questionId', questionId);

  let res: Response;
  try {
    res = await fetch(base, { method: 'POST', body: fd });
  } catch {
    throw new Error(UPLOAD_COPY.offline);
  }
  if (!res.ok) {
    // Never the upload server's own text (QA pass, COPY-03): the console has it.
    console.error('[slate] upload failed', res.status, (await res.text().catch(() => '')).slice(0, 200));
    throw new Error(UPLOAD_COPY.later);
  }

  const data = (await res.json().catch(() => null)) as { url?: string; key?: string } | null;
  const out = data?.url ?? data?.key;
  if (!out || typeof out !== 'string') {
    console.error('[slate] upload: the reply had no url or key');
    throw new Error(UPLOAD_COPY.later);
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
