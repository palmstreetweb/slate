import type { FileUploadMeta } from '@/utils/fileUploadRef.js';
import { getLocalUploadMeta } from './localFileStore.js';
import { getStorageUploadMeta } from './storageUpload.js';

/** Resolve upload metadata from IndexedDB or Supabase Storage refs. */
export async function resolveUploadMeta(ref: string): Promise<FileUploadMeta | null> {
  const local = await getLocalUploadMeta(ref);
  if (local) return local;
  return getStorageUploadMeta(ref);
}
