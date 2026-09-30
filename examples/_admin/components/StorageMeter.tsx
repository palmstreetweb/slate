/**
 * The account's file storage on the dashboard (ADR-067): a small meter under
 * the forms count ("120 MB of 1 GB"), and a banner once it is nearly or
 * completely full. Hidden until the database has answered (offline mode, or
 * before migration 021, it never shows).
 */

import { useEffect, useState } from 'react';
import {
  storagePendingText,
  storageBannerCopy,
  storageLevel,
  storageMeterText,
  storagePercent,
  type StorageQuota,
} from '../storageQuota.js';
import {
  getStorageQuota,
  refreshStorageQuota,
  subscribeStorageQuota,
} from '../neon/storageQuotaRemote.js';

/** The cached numbers, refreshed on mount and whenever the tab comes back. */
export function useStorageQuota(): StorageQuota | null {
  const [quota, setQuota] = useState(getStorageQuota);
  useEffect(() => {
    const off = subscribeStorageQuota(() => setQuota(getStorageQuota()));
    void refreshStorageQuota();
    const onVis = () => {
      if (document.visibilityState === 'visible') void refreshStorageQuota();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      off();
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);
  return quota;
}

export function StorageMeter({ quota }: { quota: StorageQuota }) {
  const text = storageMeterText(quota);
  const level = storageLevel(quota);
  const pct = storagePercent(quota);
  const pending = storagePendingText(quota);
  return (
    <div
      className="slate-storage-meter"
      data-level={level}
      role="meter"
      aria-label="File storage"
      aria-valuemin={0}
      aria-valuemax={quota.max}
      aria-valuenow={Math.min(quota.used, quota.max)}
      aria-valuetext={`${text} used${pending ? `, ${pending}` : ''}`}
      title={`Files sent through your forms count here, including responses in Trash and your own test runs.${
        pending
          ? ' “Still uploading” is files in fills people haven’t sent yet; they stop counting after 2 hours.'
          : ''
      }`}
    >
      <span className="slate-storage-meter-label">Storage</span>
      <span className="slate-storage-meter-track" aria-hidden="true">
        <span className="slate-storage-meter-fill" style={{ width: `${pct}%` }} />
      </span>
      <span className="slate-storage-meter-text">{text}</span>
      {pending ? <span className="slate-storage-meter-pending">{pending}</span> : null}
    </div>
  );
}

export function StorageBanner({ quota }: { quota: StorageQuota }) {
  const copy = storageBannerCopy(quota);
  if (!copy) return null;
  const full = storageLevel(quota) === 'full';
  return (
    <div
      className={`slate-storage-banner${full ? ' slate-storage-banner--full' : ''}`}
      role={full ? 'alert' : 'status'}
    >
      <p className="slate-storage-banner-title">{copy.title}</p>
      <p className="slate-storage-banner-body">{copy.body}</p>
    </div>
  );
}
