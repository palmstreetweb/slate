/** Top-edge progress bar. Width is the percentage 0–100. */

'use client';

type Props = { value: number };

export function ProgressBar({ value }: Props) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div
      className="slate-progress"
      role="progressbar"
      aria-label="Form progress"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped)}
    >
      <div className="slate-progress-bar" style={{ width: `${clamped}%` }} />
    </div>
  );
}
