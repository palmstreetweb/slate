/**
 * Publish ignition (ADR-060). Publishing is a moment, so the button tells it
 * in three beats: a spinner while it works, then the spinner closes into a
 * self-drawing check with "Live", then the button bows out.
 *
 * The publish itself starts at once, on click, so leaving the page mid-spin
 * never loses a publish. A cloud publish hands back a promise for its write:
 * the button reads "Publishing…" until that write has landed (and at least the
 * spinner beat has played), and only then does the check — and `onLive`, the
 * toast and the sound — follow; a write that fails goes back to Publish and
 * calls `onFailed` instead, so "You're live" never comes before a publish that
 * didn't happen (STU-5). `onLive` fires even if the button has unmounted by
 * then. Calm motion never spins: "Publishing…" holds still, the check shows as
 * soon as the write lands, and there is no bow.
 */

'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { motionReduced } from '@/utils/motion.js';

export type IgnitionPhase = 'idle' | 'working' | 'done' | 'leaving';

/** Spinner beat. Long enough to read, short enough to never feel like waiting. */
export const IGNITION_SPIN_MS = 420;
/** The check + "Live" hold. */
export const IGNITION_HOLD_MS = 1100;
/** The bow-out. */
export const IGNITION_LEAVE_MS = 220;

type StartOptions = {
  /** Fires on the check beat: once the publish has landed. */
  onLive?: () => void;
  /**
   * The publish's write didn't reach the server: no check and no `onLive`, and
   * the button goes back to Publish (the shell has said what went wrong).
   */
  onFailed?: () => void;
  /** Element whose wrapper decides calm motion (defaults to the OS setting). */
  scope?: Element | null;
};

/**
 * What a publish hands back: `false` when it couldn't start, `true` when it is
 * already done (this device only), or a promise that settles when its write
 * lands — or rejects when it doesn't.
 */
export type PublishStart = boolean | PromiseLike<unknown>;

export function usePublishIgnition() {
  const [phase, setPhase] = useState<IgnitionPhase>('idle');
  const mounted = useRef(true);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    mounted.current = true;
    const pending = timers.current;
    return () => {
      mounted.current = false;
      // Beats stop with the button; a pending onLive still runs (see start).
      pending.splice(0).forEach((t) => window.clearTimeout(t));
    };
  }, []);

  /**
   * Runs `publish` now. Returns whether it started; the beats play, and `onLive`
   * follows on the check once the publish has landed.
   */
  const start = useCallback((publish: () => PublishStart, opts: StartOptions = {}): boolean => {
    timers.current.splice(0).forEach((t) => window.clearTimeout(t));
    const result = publish();
    if (!result) {
      setPhase('idle');
      return false;
    }
    const calm = motionReduced(opts.scope ?? null);
    const spin = calm ? 0 : IGNITION_SPIN_MS;
    const set = (p: IgnitionPhase) => {
      if (mounted.current) setPhase(p);
    };
    const beat = (ms: number, fn: () => void) => {
      timers.current.push(window.setTimeout(fn, ms));
    };
    const fireLive = () => {
      set('done');
      opts.onLive?.();
      beat(IGNITION_HOLD_MS, () => set(calm ? 'idle' : 'leaving'));
      if (!calm) beat(IGNITION_HOLD_MS + IGNITION_LEAVE_MS, () => set('idle'));
    };
    if (result === true) {
      // Already done: the spinner beat, then the check (at once with calm motion).
      // Not tracked in `timers`: the toast must still say "You're live" if the
      // panel closes during the spinner.
      if (spin > 0) {
        set('working');
        window.setTimeout(fireLive, spin);
      } else fireLive();
      return true;
    }
    // In flight: "Publishing…" until the write lands, and for the spinner beat at least.
    set('working');
    const beatDone = new Promise<void>((resolve) => window.setTimeout(resolve, spin));
    Promise.all([result, beatDone]).then(fireLive, () => {
      set('idle');
      opts.onFailed?.();
    });
    return true;
  }, []);

  return { phase, start };
}

/**
 * A publish's write, as a promise for `start`: pass `callbacks` to publishForm
 * and hand `landed` back. It settles when the write lands, or fails.
 */
export function publishLanding(): {
  landed: Promise<void>;
  callbacks: { onLanded: () => void; onFail: () => void };
} {
  let onLanded = () => {};
  let onFail = () => {};
  const landed = new Promise<void>((resolve, reject) => {
    onLanded = resolve;
    onFail = () => reject(new Error('publish did not land'));
  });
  // Nobody may be waiting by then (the publish never started): never an unhandled rejection.
  landed.catch(() => {});
  return { landed, callbacks: { onLanded, onFail } };
}

/**
 * The publish couldn't start: the form isn't in this browser's list any more
 * (deleted or signed out elsewhere). Not a connection problem, so it doesn't say
 * one; a republish's earlier version is whatever the server still has.
 */
export function publishMissingCopy(republish: boolean): { title: string; detail: string } {
  return {
    title: republish ? 'Couldn’t republish' : 'Couldn’t publish',
    detail: 'This form couldn’t be found here. Go back to your forms and open it again.',
  };
}

function IgnitionGlyph() {
  return (
    <svg className="slate-ignite-glyph" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <circle className="slate-ignite-ring" cx="10" cy="10" r="7.25" />
      <path className="slate-ignite-check" d="M6.2 10.4l2.6 2.6 5-5.4" />
    </svg>
  );
}

type ButtonProps = {
  phase: IgnitionPhase;
  /** Idle label: "Publish" / "Republish". */
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  compact?: boolean;
  className?: string;
};

/** The primary Publish button, with the ignition beats built in. */
export function PublishButton({
  phase,
  children,
  onClick,
  disabled,
  compact,
  className,
}: ButtonProps) {
  const busy = phase !== 'idle';
  return (
    <button
      type="button"
      className={[
        'slate-btn',
        'slate-btn--primary',
        compact ? 'slate-btn--compact' : '',
        'slate-ignite',
        `slate-ignite--${phase}`,
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={onClick}
      disabled={disabled || busy}
      aria-busy={phase === 'working' || undefined}
      // The click sound is the ignition's own (the check beat plays success).
      data-slate-sound="confirm"
    >
      {busy ? <IgnitionGlyph /> : null}
      <span className="slate-ignite-label">
        {phase === 'working' ? 'Publishing…' : busy ? 'Live' : children}
      </span>
    </button>
  );
}

/**
 * A status pill that flips over (like a split-flap sign) when its label
 * changes after mount — Draft → Live. The first render never flips.
 */
export function FlipPill({
  label,
  className,
  title,
}: {
  label: string;
  className: string;
  title?: string;
}) {
  const prev = useRef(label);
  const [flip, setFlip] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    if (prev.current === label) return;
    prev.current = label;
    if (!motionReduced(ref.current)) setFlip((n) => n + 1);
  }, [label]);

  return (
    <span ref={ref} className={className} title={title}>
      <span key={flip} className={flip > 0 ? 'slate-flip-in' : undefined}>
        {label}
      </span>
    </span>
  );
}
