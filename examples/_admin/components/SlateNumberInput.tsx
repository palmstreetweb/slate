/**
 * Studio number input — plus/minus stepper (hides native browser spinners).
 */

'use client';

import type { CSSProperties, KeyboardEvent } from 'react';

type Props = {
  value: number | '' | undefined;
  onChange: (next: number | undefined) => void;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  'aria-label'?: string;
  className?: string;
  style?: CSSProperties;
  /** Tighter padding for score / narrow cells. */
  compact?: boolean;
  /** When false, empty blur restores the last numeric value (or min/0). */
  allowEmpty?: boolean;
};

function toNumber(value: number | '' | undefined, fallback: number): number {
  if (value === '' || value === undefined || Number.isNaN(Number(value))) return fallback;
  return Number(value);
}

export function SlateNumberInput({
  value,
  onChange,
  min,
  max,
  step = 1,
  placeholder,
  'aria-label': ariaLabel,
  className,
  style,
  compact = false,
  allowEmpty = true,
}: Props) {
  const display = value === undefined || value === null ? '' : String(value);
  const base = min ?? 0;

  const clamp = (n: number) => {
    let next = n;
    if (min != null && next < min) next = min;
    if (max != null && next > max) next = max;
    return next;
  };

  const bump = (dir: 1 | -1) => {
    const current = toNumber(value, base);
    onChange(clamp(current + dir * step));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      bump(1);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      bump(-1);
    }
  };

  return (
    <div
      className={['slate-number', compact ? 'slate-number--compact' : '', className]
        .filter(Boolean)
        .join(' ')}
      style={style}
    >
      <input
        type="number"
        className="slate-number-input"
        value={display}
        placeholder={placeholder}
        aria-label={ariaLabel}
        min={min}
        max={max}
        step={step}
        onKeyDown={onKeyDown}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === '') {
            if (allowEmpty) onChange(undefined);
            return;
          }
          const n = Number(raw);
          if (!Number.isNaN(n)) onChange(clamp(n));
        }}
        onBlur={() => {
          if (allowEmpty) return;
          if (value === '' || value === undefined || Number.isNaN(Number(value))) {
            onChange(clamp(base));
          }
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
  );
}
