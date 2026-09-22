/**
 * Studio text/UI size — three steps, current size is the floor (ADR-045).
 * Applied as `data-slate-scale` on <body> by the app root; CSS zooms the
 * studio wrappers only, never public fill pages.
 */

export const UI_SCALE_KEY = 'slate-admin-ui-scale';
export const UI_SCALE_EVENT = 'slate-admin-ui-scale';

export type UiScale = 1 | 2 | 3;

export const UI_SCALE_OPTIONS: ReadonlyArray<{ value: UiScale; label: string; hint: string }> = [
  { value: 1, label: 'A', hint: 'Default' },
  { value: 2, label: 'A', hint: 'Larger' },
  { value: 3, label: 'A', hint: 'Largest' },
];

export function readUiScale(): UiScale {
  if (typeof window === 'undefined') return 1;
  try {
    const raw = window.localStorage.getItem(UI_SCALE_KEY);
    if (raw === '2' || raw === '3') return Number(raw) as UiScale;
  } catch {
    /* ignored */
  }
  return 1;
}

export function writeUiScale(scale: UiScale): void {
  try {
    if (scale === 1) window.localStorage.removeItem(UI_SCALE_KEY);
    else window.localStorage.setItem(UI_SCALE_KEY, String(scale));
  } catch {
    /* ignored */
  }
  applyUiScale(scale);
  window.dispatchEvent(new CustomEvent(UI_SCALE_EVENT));
}

/** Set / clear the body attribute. `null` on public routes so respondents see 1×. */
export function applyUiScale(scale: UiScale | null): void {
  if (typeof document === 'undefined') return;
  if (!scale || scale === 1) delete document.body.dataset.slateScale;
  else document.body.dataset.slateScale = String(scale);
}
