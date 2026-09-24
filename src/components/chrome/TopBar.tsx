/** Top chrome row: brand on the left, optional back button + theme toggle on the right. */

'use client';

import { useState, type ReactNode } from 'react';
import { safeLogoSrc } from '@/utils/brandLogo.js';

type Props = {
  brandName: string;
  /** `schema.brand.logo`. Rendered beside the name only when `safeLogoSrc` accepts it. */
  brandLogo?: string;
  showBack: boolean;
  onBack: () => void;
  rightSlot?: ReactNode;
};

export function TopBar({ brandName, brandLogo, showBack, onBack, rightSlot }: Props) {
  const logoSrc = safeLogoSrc(brandLogo);
  // Remember the src that failed, not a boolean — a new URL (live studio
  // edit) gets a fresh attempt without an effect to reset it.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const showLogo = logoSrc !== null && logoSrc !== failedSrc;

  return (
    <div className="slate-topbar">
      {showLogo ? (
        <div className="slate-brand slate-brand--logo">
          <img
            className="slate-brand-logo"
            src={logoSrc}
            alt={brandName}
            loading="eager"
            decoding="async"
            referrerPolicy="no-referrer"
            onError={() => setFailedSrc(logoSrc)}
          />
          {/* The img alt already names the brand; don't announce it twice. */}
          {brandName && (
            <span className="slate-brand-name" aria-hidden="true">
              {brandName}
            </span>
          )}
        </div>
      ) : (
        <div className="slate-brand">{brandName}</div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {showBack && (
          <button type="button" className="slate-back" onClick={onBack}>
            ← back
          </button>
        )}
        {rightSlot}
      </div>
    </div>
  );
}
