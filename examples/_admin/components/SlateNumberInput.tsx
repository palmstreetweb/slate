/**
 * Studio number input — plus/minus stepper (hides native browser spinners).
 *
 * While the field has focus it keeps what the owner typed as a draft, so an
 * emptied field, a half-typed "0.0" or a first digit below the minimum is
 * never rewritten under the caret. Every complete number is saved as it is
 * typed, as leaving the field would save it: one that fits as it is, one that
 * doesn't rounded and pulled into range (150 in a 1–100 field saves 100) while
 * the typed text stays on screen with a short line saying what fits. So the
 * form never holds a part of what was typed ("15" of "150") when the editor
 * closes, Publish runs or another question opens (STU-4). Leaving the field
 * (or Enter) only tidies what is shown: it settles at once, with the field's
 * current props, and again if the field goes away with a draft. The one wait
 * is a focus the live preview takes and may hand straight back (S4): that
 * isn't leaving, so it settles a frame later, only if focus didn't come back.
 */

'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent } from 'react';
import './inspectorGuards.css';

type Props = {
  value: number | '' | undefined;
  onChange: (next: number | undefined) => void;
  min?: number;
  max?: number;
  step?: number;
  /** Whole numbers only: a typed decimal is rounded when the field is left. */
  integer?: boolean;
  /** The number has to be more than this (not equal to it), e.g. 0 for a step size. */
  above?: number;
  placeholder?: string;
  'aria-label'?: string;
  className?: string;
  style?: CSSProperties;
  /** Tighter padding for score / narrow cells (no note under the field). */
  compact?: boolean;
  /** When false, an emptied field gets its last number back when it is left. */
  allowEmpty?: boolean;
};

type Limits = Pick<Props, 'min' | 'max' | 'integer' | 'above'>;

const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 6 });

/** What the field takes, in plain words: "A whole number from 1 to 20". */
export function allowedText({ min, max, integer, above }: Limits): string {
  const kind = integer ? 'A whole number' : 'A number';
  if (above !== undefined) {
    return max !== undefined
      ? `More than ${fmt(above)}, up to ${fmt(max)}`
      : `More than ${fmt(above)}`;
  }
  if (min !== undefined && max !== undefined) return `${kind} from ${fmt(min)} to ${fmt(max)}`;
  if (min !== undefined) return `${kind}, ${fmt(min)} or more`;
  if (max !== undefined) return `${kind}, ${fmt(max)} or less`;
  return integer ? 'Whole numbers only' : 'A number';
}

/** The number can be saved as typed. */
export function fitsLimits(n: number, { min, max, integer, above }: Limits): boolean {
  return (
    Number.isFinite(n) &&
    (min === undefined || n >= min) &&
    (max === undefined || n <= max) &&
    (above === undefined || n > above) &&
    (!integer || Number.isInteger(n))
  );
}

/** Round and pull into range; null when nothing nearby fits (e.g. 0 for "more than 0"). */
export function settleNumber(n: number, { min, max, integer, above }: Limits): number | null {
  if (!Number.isFinite(n)) return null;
  let next = integer ? Math.round(n) : n;
  if (min !== undefined && next < min) next = integer ? Math.ceil(min) : min;
  if (max !== undefined && next > max) next = integer ? Math.floor(max) : max;
  if (above !== undefined && next <= above) return null;
  return next;
}

function numberOrUndefined(value: number | '' | undefined): number | undefined {
  if (value === '' || value === undefined || value === null) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export function SlateNumberInput({
  value,
  onChange,
  min,
  max,
  step = 1,
  integer = false,
  above,
  placeholder,
  'aria-label': ariaLabel,
  className,
  style,
  compact = false,
  allowEmpty = true,
}: Props) {
  const limits: Limits = { min, max, integer, above };
  const saved = numberOrUndefined(value);
  /** What the owner is typing, while the field has focus; null shows the saved value. */
  const [draft, setDraftState] = useState<string | null>(null);
  /** The browser holds text it can't read as a number yet ("-", "1e"). */
  const [partial, setPartialState] = useState(false);
  /** The same two, read by a settle that runs after this render (blur, unmount). */
  const draftRef = useRef<string | null>(null);
  const partialRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const noteId = useId();

  const setDraft = (next: string | null) => {
    draftRef.current = next;
    setDraftState(next);
  };
  const setPartial = (next: boolean) => {
    partialRef.current = next;
    setPartialState(next);
  };

  const display = draft ?? (saved === undefined ? '' : String(saved));
  const base = min ?? (above !== undefined ? above + step : 0);

  const commit = (n: number | undefined) => {
    if (n !== saved) onChange(n);
  };

  /**
   * Leave the draft: save what fits, round or pull it into range, or put the saved
   * value back. Typing has already saved any complete number this way, so this
   * mostly tidies the box; it still saves an emptied field that needs a number.
   */
  const finish = () => {
    const typed = draftRef.current;
    if (typed === null) return;
    const text = typed.trim();
    if (text === '') {
      if (partialRef.current) {
        // "-" on its own: nothing to save, and the box shouldn't keep showing it.
        if (inputRef.current && saved === undefined) inputRef.current.value = '';
      } else if (allowEmpty) commit(undefined);
      else if (saved === undefined) commit(settleNumber(base, limits) ?? undefined);
    } else {
      const settled = settleNumber(Number(text), limits);
      if (settled !== null) commit(settled);
    }
    setDraft(null);
    setPartial(false);
  };
  /** The settle with this render's props: what a later frame or the unmount calls. */
  const finishRef = useRef(finish);
  finishRef.current = finish;

  // Going away with a draft (the editor closes, a question with other fields opens):
  // settle with the props it last had, so nothing typed is lost or half-saved.
  useEffect(
    () => () => {
      if (draftRef.current !== null) finishRef.current();
    },
    [],
  );

  const bump = (dir: 1 | -1) => {
    const typed = draft !== null && draft.trim() !== '' ? Number(draft) : NaN;
    const current = Number.isFinite(typed) ? typed : (saved ?? base - dir * step);
    const raw = Number((current + dir * step).toFixed(10));
    const settled = settleNumber(raw, limits);
    if (settled !== null) commit(settled);
    setDraft(null);
    setPartial(false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      bump(1);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      bump(-1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      finish();
    } else if (e.key === 'Escape' && draft !== null) {
      setDraft(null);
      setPartial(false);
    }
  };

  const typedNumber = draft !== null && draft.trim() !== '' ? Number(draft) : null;
  const showNote =
    !compact &&
    draft !== null &&
    ((typedNumber !== null && !fitsLimits(typedNumber, limits)) ||
      (typedNumber === null && !partial && !allowEmpty));
  const note = showNote ? allowedText(limits) : null;

  return (
    <>
      <div
        className={['slate-number', compact ? 'slate-number--compact' : '', className]
          .filter(Boolean)
          .join(' ')}
        style={style}
      >
        <input
          ref={inputRef}
          type="number"
          className="slate-number-input"
          value={display}
          placeholder={placeholder}
          aria-label={ariaLabel}
          aria-describedby={note ? noteId : undefined}
          aria-invalid={note ? true : undefined}
          min={min}
          max={max}
          step={step}
          onKeyDown={onKeyDown}
          onChange={(e) => {
            const raw = e.target.value;
            const unreadable = raw === '' && e.target.validity?.badInput === true;
            setDraft(raw);
            setPartial(unreadable);
            if (unreadable) return;
            if (raw.trim() === '') {
              if (allowEmpty) commit(undefined);
              return;
            }
            // Saved as leaving would save it; what was typed stays on screen (STU-4).
            const n = Number(raw);
            const settled = fitsLimits(n, limits) ? n : settleNumber(n, limits);
            if (settled !== null) commit(settled);
          }}
          onBlur={(e) => {
            const to = e.relatedTarget as Element | null;
            if (to?.closest?.('[data-slate-preview]')) {
              // The live preview took focus; it may hand it straight back (S4).
              requestAnimationFrame(() => {
                if (document.activeElement !== inputRef.current) finishRef.current();
              });
              return;
            }
            finish();
          }}
        />
        <div className="slate-number-step" aria-hidden={false}>
          <button type="button" tabIndex={-1} aria-label="Decrease" onClick={() => bump(-1)}>
            −
          </button>
          <button type="button" tabIndex={-1} aria-label="Increase" onClick={() => bump(1)}>
            +
          </button>
        </div>
      </div>
      {note ? (
        <span id={noteId} className="slate-number-note" role="status">
          {note}
        </span>
      ) : null}
    </>
  );
}
