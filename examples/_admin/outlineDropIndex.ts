/**
 * Clamp a drag-drop insert index to valid slots (welcome pinned first, thanks last).
 */
export function clampOutlineDropIndex(
  questions: ReadonlyArray<{ type: string }>,
  insertBefore: number,
): number {
  const min = questions[0]?.type === 'welcome' ? 1 : 0;
  const thanksIdx = questions.findIndex((q) => q.type === 'thanks');
  const max = thanksIdx === -1 ? questions.length : thanksIdx;
  return Math.max(min, Math.min(insertBefore, max));
}

/** Map a visual “insert before N” index to a splice index after the dragged item is removed. */
export function resolveOutlineInsertIndex(from: number, insertBefore: number): number {
  return from < insertBefore ? insertBefore - 1 : insertBefore;
}

/** Y offset (px from list top) for a 2px drop line at `insertBefore`. */
export function measureOutlineDropLineY(list: HTMLElement, insertBefore: number): number {
  const items = list.querySelectorAll(':scope > li.slate-outline-item');
  if (items.length === 0) return 0;

  const listTop = list.getBoundingClientRect().top;

  if (insertBefore <= 0) {
    return items[0]!.getBoundingClientRect().top - listTop - 1;
  }

  if (insertBefore >= items.length) {
    return items[items.length - 1]!.getBoundingClientRect().bottom - listTop + 1;
  }

  return items[insertBefore]!.getBoundingClientRect().top - listTop - 1;
}

export const OUTLINE_GAP_HEIGHT = 36;

/** Left inset when rows show a drag grip (grip width + inner gap). */
export const OUTLINE_GRIP_WIDTH = 22;
export const OUTLINE_INNER_GAP = 3;
export const OUTLINE_ROW_INSET = OUTLINE_GRIP_WIDTH + OUTLINE_INNER_GAP;

/**
 * Y offset (px from list top) for the floating gap slot at `insertBefore`.
 * Overlay only — does not reflow the list.
 */
export function measureOutlineGapY(
  list: HTMLElement,
  insertBefore: number,
  gapHeight = OUTLINE_GAP_HEIGHT,
): number {
  const items = list.querySelectorAll(':scope > li.slate-outline-item');
  if (items.length === 0) return 0;

  const listTop = list.getBoundingClientRect().top;

  if (insertBefore <= 0) {
    const first = items[0]!.getBoundingClientRect();
    return first.top - listTop - gapHeight - 1;
  }

  if (insertBefore >= items.length) {
    const last = items[items.length - 1]!.getBoundingClientRect();
    return last.bottom - listTop + 1;
  }

  const prev = items[insertBefore - 1]!.getBoundingClientRect();
  const next = items[insertBefore]!.getBoundingClientRect();
  const mid = (prev.bottom + next.top) / 2;
  return mid - listTop - gapHeight / 2;
}

/** Viewport position for settling the ghost into the destination row slot. */
export function measureOutlineRowTarget(
  list: HTMLElement,
  insertBefore: number,
): { x: number; y: number; width: number } {
  const items = list.querySelectorAll(':scope > li.slate-outline-item');
  const listRect = list.getBoundingClientRect();

  const rowViewportRect = (item: Element): DOMRect => {
    const row = item.querySelector('.slate-outline-row');
    return (row ?? item).getBoundingClientRect();
  };

  if (items.length === 0) {
    return {
      x: listRect.left + OUTLINE_ROW_INSET,
      y: listRect.top,
      width: listRect.width - OUTLINE_ROW_INSET,
    };
  }

  if (insertBefore >= items.length) {
    const rect = rowViewportRect(items[items.length - 1]!);
    return {
      x: listRect.left + OUTLINE_ROW_INSET,
      y: rect.bottom + 2,
      width: listRect.width - OUTLINE_ROW_INSET,
    };
  }

  const rect = rowViewportRect(items[insertBefore]!);
  return {
    x: listRect.left + OUTLINE_ROW_INSET,
    y: rect.top,
    width: listRect.width - OUTLINE_ROW_INSET,
  };
}

/** Viewport position for settling the ghost at the drop line. */
export function measureOutlineLineTarget(
  list: HTMLElement,
  wrap: HTMLElement,
  insertBefore: number,
): { x: number; y: number; width: number } {
  const lineY = measureOutlineDropLineY(list, insertBefore);
  const listRect = list.getBoundingClientRect();
  const wrapRect = wrap.getBoundingClientRect();
  return {
    x: listRect.left + OUTLINE_ROW_INSET,
    y: wrapRect.top + lineY + 1,
    width: listRect.width - OUTLINE_ROW_INSET,
  };
}

/** Viewport rect for settling the ghost into the gap slot. */
export function measureOutlineGapTarget(
  list: HTMLElement,
  wrap: HTMLElement,
  insertBefore: number,
  gapHeight = OUTLINE_GAP_HEIGHT,
): { x: number; y: number; width: number } {
  const gapY = measureOutlineGapY(list, insertBefore, gapHeight);
  const listRect = list.getBoundingClientRect();
  const wrapRect = wrap.getBoundingClientRect();
  return {
    x: listRect.left + OUTLINE_ROW_INSET,
    y: wrapRect.top + gapY,
    width: listRect.width - OUTLINE_ROW_INSET,
  };
}

/** Insert-before index from a pointer Y (viewport). */
export function computeOutlineDropIndex(
  list: HTMLElement,
  questions: ReadonlyArray<{ type: string }>,
  clientY: number,
): number {
  const items = list.querySelectorAll(':scope > li.slate-outline-item');
  for (let i = 0; i < items.length; i++) {
    const rect = items[i]!.getBoundingClientRect();
    if (clientY < rect.top + rect.height / 2) {
      return clampOutlineDropIndex(questions, i);
    }
  }
  return clampOutlineDropIndex(questions, items.length);
}
