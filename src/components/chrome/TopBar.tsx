/** Top chrome row: brand on the left, optional back button + theme toggle on the right. */

'use client';

import type { ReactNode } from 'react';

type Props = {
  brandName: string;
  showBack: boolean;
  onBack: () => void;
  rightSlot?: ReactNode;
};

export function TopBar({ brandName, showBack, onBack, rightSlot }: Props) {
  return (
    <div className="psw-topbar">
      <div className="psw-brand">{brandName}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {showBack && (
          <button type="button" className="psw-back" onClick={onBack}>
            ← back
          </button>
        )}
        {rightSlot}
      </div>
    </div>
  );
}
