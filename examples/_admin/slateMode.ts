/** Read persisted studio chrome theme (matches ConfirmProvider). */
export function readSlateMode(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'dark';
  try {
    const v = window.localStorage.getItem('slate-theme');
    if (v === 'light' || v === 'dark') return v;
  } catch {
    /* ignored */
  }
  if (window.matchMedia?.('(prefers-color-scheme: light)').matches) return 'light';
  return 'dark';
}
