/** "n / m" badge anchored to the bottom-right corner of the form. */

'use client';

type Props = { current: number; total: number };

export function FooterCounter({ current, total }: Props) {
  if (total <= 0) return null;
  const safeCurrent = Math.max(0, Math.min(current, total));
  return (
    <div className="slate-footer" aria-live="off">
      {safeCurrent} / {total}
    </div>
  );
}
