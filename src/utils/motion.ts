/**
 * Small motion helpers for the delight pass (ADR-059). Web Animations API
 * only — no dependencies — and every helper is a no-op when the wrapper
 * asks for calm motion or the browser has no `Element.animate`.
 */

const REDUCE_QUERY = '(prefers-reduced-motion: reduce)';

/**
 * True when motion should stay calm for this element: the respondent's OS
 * asks for reduced motion, or the form wrapper carries `data-reduced-motion`
 * (set by `<Form>` from `useReducedMotion`, which also honours the preview
 * override). Server-side there is nothing to animate, so it reports calm.
 */
export function motionReduced(el: Element | null | undefined): boolean {
  if (typeof window === 'undefined') return true;
  if (el?.closest?.('[data-slate-forms][data-reduced-motion]')) return true;
  return window.matchMedia?.(REDUCE_QUERY).matches ?? false;
}

function canAnimate(el: Element | null | undefined): el is Element {
  return Boolean(el) && typeof (el as Element).animate === 'function';
}

/**
 * The 3px "nope" shake for a failed submit attempt. It runs through the Web
 * Animations API rather than a CSS class so it replays on every attempt, even
 * when the error message itself hasn't changed.
 */
export function shakeInvalid(el: Element | null | undefined): void {
  // Bring the message and OK into view: an error under a long list would
  // otherwise render off-screen and look like nothing happened.
  requestAnimationFrame(() => {
    const s = el?.closest('.slate-stage-content');
    (s?.querySelector('.slate-err ~ .slate-actions') ?? s?.querySelector('.slate-err'))?.scrollIntoView?.({
      block: 'nearest',
    });
  });
  if (!canAnimate(el) || motionReduced(el)) return;
  el.animate(
    [
      { transform: 'translateX(0)' },
      { transform: 'translateX(-3px)' },
      { transform: 'translateX(3px)' },
      { transform: 'translateX(-2px)' },
      { transform: 'translateX(2px)' },
      { transform: 'translateX(0)' },
    ],
    { duration: 320, easing: 'ease-in-out' },
  );
}

/**
 * Brief glow flare for the progress tip when the respondent moves forward.
 * `big` is the finale version used when the bar reaches 100% on a confirmed
 * submit.
 */
export function flareProgressTip(el: Element | null | undefined, big = false): void {
  if (!canAnimate(el) || motionReduced(el)) return;
  el.animate(
    big
      ? [
          { opacity: 0.5, transform: 'scale(1)' },
          { opacity: 1, transform: 'scale(2.6)', offset: 0.25 },
          { opacity: 0, transform: 'scale(1.4)' },
        ]
      : [
          { opacity: 0.5, transform: 'scale(1)' },
          { opacity: 1, transform: 'scale(1.9)', offset: 0.3 },
          { opacity: 0.5, transform: 'scale(1)' },
        ],
    { duration: big ? 1100 : 900, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
  );
}
