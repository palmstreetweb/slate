/**
 * Per-account file storage (ADR-067). The database is the hard stop
 * (021 reserve_upload); this module is display and copy for the studio meter.
 * Sizes are binary (1 GB = 1,024 MB), like the per-question "Max size (MB)".
 */

export type StorageQuota = {
  /** Claimed bytes plus uploads from the last 2 h that no response has claimed yet. */
  used: number;
  /** The effective limit: the account's override, else the default (021 storage_quota_for). */
  max: number;
  /** The unclaimed part of `used`: fills in progress (and abandoned ones, for 2 h). */
  pending: number;
  files: number;
};

export type StorageLevel = 'ok' | 'near' | 'full';

/** The banner appears at 80 %: about 200 MB, or ~450 checklist photos, before uploads stop. */
export const STORAGE_NEAR = 0.8;

const KB = 1024;
const MB = KB * 1024;

export function formatStorage(bytes: number): string {
  const b = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  if (b < MB) return `${Math.max(0, Math.round(b / KB))} KB`;
  if (b < 1000 * MB) {
    const mb = b / MB;
    return `${mb < 10 ? +mb.toFixed(1) : Math.round(mb)} MB`;
  }
  return `${+(b / (1024 * MB)).toFixed(1)} GB`;
}

export function storageLevel(q: StorageQuota): StorageLevel {
  if (!(q.max > 0)) return 'ok';
  if (q.used >= q.max) return 'full';
  return q.used >= q.max * STORAGE_NEAR ? 'near' : 'ok';
}

/** "120 MB of 1 GB" */
export function storageMeterText(q: StorageQuota): string {
  return `${formatStorage(q.used)} of ${formatStorage(q.max)}`;
}

/**
 * "12 MB still uploading": files from fills in progress (uploaded, not yet
 * sent with a response), which count for 2 h. Null when there are none.
 */
export function storagePendingText(q: StorageQuota): string | null {
  return q.pending > 0 ? `${formatStorage(q.pending)} still uploading` : null;
}

/** 0–100, never 0 for a non-empty account, so a first photo shows. */
export function storagePercent(q: StorageQuota): number {
  if (!(q.max > 0) || !(q.used > 0)) return 0;
  return Math.min(100, Math.max(1, Math.round((q.used / q.max) * 100)));
}

/** The dashboard banner near or at the limit; null while there's room. */
export function storageBannerCopy(q: StorageQuota): { title: string; body: string } | null {
  const level = storageLevel(q);
  if (level === 'ok') return null;
  const how =
    'To make room, permanently delete responses you don’t need (responses in Trash count until you empty it). Download any files you want to keep first.';
  if (level === 'full') {
    return {
      title: 'File storage is full',
      body: `Your forms can’t take new files: people who add a file, voice note or photo see “This form can’t accept more files right now.” ${how}`,
    };
  }
  return {
    title: 'File storage is almost full',
    body: `${storageMeterText(q)} used. When it’s full, your forms stop taking new files. ${how}`,
  };
}
