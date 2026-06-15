/**
 * Site-wide admin preferences and storage helpers (examples/ only).
 */

export const WORKFLOW_TIP_KEY = 'slate-workflow-tip-dismissed';

const TRACKED_KEYS = ['slate-forms', 'slate-submissions', 'slate-theme', WORKFLOW_TIP_KEY] as const;

export type SiteStorageStats = {
  formCount: number;
  submissionCount: number;
  approxBytes: number;
};

export function isWorkflowTipDismissed(): boolean {
  if (typeof window === 'undefined') return true;
  return window.localStorage.getItem(WORKFLOW_TIP_KEY) === '1';
}

export function dismissWorkflowTip(): void {
  window.localStorage.setItem(WORKFLOW_TIP_KEY, '1');
}

export function resetWorkflowTip(): void {
  window.localStorage.removeItem(WORKFLOW_TIP_KEY);
}

/** Rough UTF-16 byte estimate for tracked Slate keys. */
export function estimateSiteStorageBytes(): number {
  if (typeof window === 'undefined') return 0;
  let total = 0;
  for (const key of TRACKED_KEYS) {
    const raw = window.localStorage.getItem(key);
    if (raw) total += raw.length * 2;
  }
  return total;
}

export function formatByteSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
