/**
 * Default Slate admin / public-respond file upload handler.
 * Optimizes images like 805 Sealcoating, then stores locally (IndexedDB) or
 * POSTs to `VITE_UPLOAD_URL` when configured.
 */

import { createFileUploadHandler } from '@/utils/createFileUploadHandler.js';
import type { FileUploadHandler } from '@/utils/createFileUploadHandler.js';
import { saveLocalUpload } from './localFileStore.js';

async function uploadToRemote(
  file: File,
  questionId: string,
  _ctx?: { maxSizeMb?: number },
): Promise<string> {
  const base = import.meta.env.VITE_UPLOAD_URL?.trim();
  if (!base) {
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
