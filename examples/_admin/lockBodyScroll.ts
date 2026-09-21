/**
 * Lock document scroll without the classic “page jump” when the scrollbar
 * disappears. Compensates with padding-right equal to the gutter width.
 * Returns an unlock function (idempotent-safe restore of prior inline styles).
 */

'use client';

let lockCount = 0;
let savedOverflow = '';
let savedPaddingRight = '';

export function lockBodyScroll(): () => void {
  if (typeof document === 'undefined') return () => {};

  const body = document.body;
  if (lockCount === 0) {
    savedOverflow = body.style.overflow;
    savedPaddingRight = body.style.paddingRight;
    const gutter = Math.max(0, window.innerWidth - document.documentElement.clientWidth);
    body.style.overflow = 'hidden';
    if (gutter > 0) {
      const existing = Number.parseFloat(getComputedStyle(body).paddingRight) || 0;
      body.style.paddingRight = `${existing + gutter}px`;
    }
  }
  lockCount += 1;

  let released = false;
  return () => {
    if (released) return;
    released = true;
    lockCount = Math.max(0, lockCount - 1);
    if (lockCount === 0) {
      body.style.overflow = savedOverflow;
      body.style.paddingRight = savedPaddingRight;
      savedOverflow = '';
      savedPaddingRight = '';
    }
  };
}
