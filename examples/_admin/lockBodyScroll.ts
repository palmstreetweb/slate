/**
 * Lock document scroll without the page jumping sideways.
 * One compensation only: the live scrollbar width, applied when that bar
 * is about to disappear. Do not also set scrollbar-gutter (that double-counts).
 */

'use client';

let lockCount = 0;
let savedOverflow = '';
let savedPaddingRight = '';

export function lockBodyScroll(): () => void {
  if (typeof document === 'undefined') return () => {};

  const root = document.documentElement;
  if (lockCount === 0) {
    savedOverflow = root.style.overflow;
    savedPaddingRight = root.style.paddingRight;
    const gutter = Math.max(0, window.innerWidth - root.clientWidth);
    root.style.overflow = 'hidden';
    if (gutter > 0) {
      const existing = Number.parseFloat(getComputedStyle(root).paddingRight) || 0;
      root.style.paddingRight = `${existing + gutter}px`;
    }
  }
  lockCount += 1;

  let released = false;
  return () => {
    if (released) return;
    released = true;
    lockCount = Math.max(0, lockCount - 1);
    if (lockCount === 0) {
      root.style.overflow = savedOverflow;
      root.style.paddingRight = savedPaddingRight;
      savedOverflow = '';
      savedPaddingRight = '';
    }
  };
}
