/**
 * Publish ignition (ADR-060). Publishing is a moment, so the button tells it
 * in three beats: a spinner while it works, then the spinner closes into a
 * self-drawing check with "Live", then the button bows out.
 *
 * The publish itself runs at once, on click — the beats are only what the
 * author sees, so leaving the page mid-spin never loses a publish. `onLive`
 * (toast, sound) fires on the check beat even if the button has unmounted by
 * then. Calm motion skips the spinner and the bow: the check shows at once
 * and holds.
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
  /** Fires on the check beat (or at once with calm motion). */
  onLive?: () => void;
  /** Element whose wrapper decides calm motion (defaults to the OS setting). */
  scope?: Element | null;
};

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
   * Runs `publish` now. Returns its result; on success the beats play and
   * `onLive` follows on the check.
   */
  const start = useCallback((publish: () => boolean, opts: StartOptions = {}): boolean => {
    timers.current.splice(0).forEach((t) => window.clearTimeout(t));
    const ok = publish();
    if (!ok) {
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
    };
    if (spin > 0) {
      set('working');
      // Not tracked in `timers`: the toast must still say "You're live" if
      // the panel closes during the spinner.
      window.setTimeout(fireLive, spin);
    } else {
      fireLive();
    }
    beat(spin + IGNITION_HOLD_MS, () => set(calm ? 'idle' : 'leaving'));
    if (!calm) beat(spin + IGNITION_HOLD_MS + IGNITION_LEAVE_MS, () => set('idle'));
    return true;
  }, []);

  return { phase, start };
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
