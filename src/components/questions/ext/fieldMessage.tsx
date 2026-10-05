/**
 * A field's message slot (GAP-21), for the on-demand fields; the core's typed
 * fields render the same markup in TextAnswer.tsx. The element is always in
 * the page, so a screen reader announces a message when it appears (a live
 * region created together with its text often isn't), and the input points at
 * it with `aria-describedby`. While empty it takes no space (questions.css).
 * On demand only: nothing the engine's core imports may import this.
 */

'use client';

export function FieldError({ id, error }: { id?: string; error: string | null }) {
  return (
    <p id={id} className="slate-err" aria-live="polite">
      {error}
    </p>
  );
}

/**
 * The next text for a message slot or live region (COPY-R8): the same
 * sentence again ends in a no-break space, so a screen reader says it again
 * (a region speaks only when its text changes) — a second tap on a full slot
 * is answered too. Use as a state updater: `setSaid(sayAgain(text))`.
 */
export const sayAgain =
  (text: string) =>
  (cur: string | null): string =>
    cur === text ? `${text} ` : text;
