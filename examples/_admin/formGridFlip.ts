/**
 * FLIP animation when a form card is duplicated — existing cards slide,
 * the copy enters from the source card's position.
 */

const DURATION_MS = 320;
const EASING = 'cubic-bezier(0.16, 1, 0.3, 1)';

function cardEls(grid: HTMLElement): HTMLElement[] {
  return [...grid.querySelectorAll<HTMLElement>('[data-form-card]')];
}

export function captureFormCardRects(grid: HTMLElement): Map<string, DOMRect> {
  const map = new Map<string, DOMRect>();
  for (const el of cardEls(grid)) {
    const id = el.dataset.formId;
    if (id) map.set(id, el.getBoundingClientRect());
  }
  return map;
}

export function animateFormGridDuplicate(
  grid: HTMLElement,
  sourceId: string,
  newId: string,
  before: Map<string, DOMRect>,
): void {
  const sourceEl = grid.querySelector<HTMLElement>(`[data-form-id="${sourceId}"]`);
  const newEl = grid.querySelector<HTMLElement>(`[data-form-id="${newId}"]`);
  const sourceRect = before.get(sourceId);

  for (const el of cardEls(grid)) {
    const id = el.dataset.formId;
    if (!id || id === newId) continue;

    const first = before.get(id);
    if (!first) continue;

    const last = el.getBoundingClientRect();
    const dx = first.left - last.left;
    const dy = first.top - last.top;
    if (dx === 0 && dy === 0) continue;

    el.animate(
      [
        { transform: `translate(${dx}px, ${dy}px)` },
        { transform: 'translate(0, 0)' },
      ],
      { duration: DURATION_MS, easing: EASING },
    );
  }

  if (newEl && sourceRect) {
    newEl.classList.add('slate-card--skip-enter');
    const last = newEl.getBoundingClientRect();
    const dx = sourceRect.left - last.left;
    const dy = sourceRect.top - last.top;
    const sx = sourceRect.width / Math.max(last.width, 1);
    const sy = sourceRect.height / Math.max(last.height, 1);

    newEl.animate(
      [
        {
          transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`,
          opacity: 0.55,
        },
        { transform: 'translate(0, 0) scale(1, 1)', opacity: 1 },
      ],
      { duration: DURATION_MS, easing: EASING, fill: 'both' },
    );
  } else if (newEl) {
    newEl.classList.add('slate-card--skip-enter');
    newEl.animate(
      [
        { opacity: 0, transform: 'translateY(-10px) scale(0.97)' },
        { opacity: 1, transform: 'translateY(0) scale(1)' },
      ],
      { duration: DURATION_MS, easing: EASING, fill: 'both' },
    );
  }

  if (sourceEl) {
    sourceEl.animate(
      [
        { transform: 'scale(1)' },
        { transform: 'scale(0.97)' },
        { transform: 'scale(1)' },
      ],
      { duration: DURATION_MS, easing: EASING },
    );
  }
}

export function shouldAnimateFormGrid(): boolean {
  if (typeof window === 'undefined') return false;
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
