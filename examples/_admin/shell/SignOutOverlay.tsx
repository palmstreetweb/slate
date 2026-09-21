/**
 * Sign-out farewell — word dissolve (gallery option 7).
 * Letters lift + blur; mark shrinks after. Portal so it survives shell unmount.
 */

'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { SlateLogo } from '../components/SlateLogo.js';
import { detectAdminUiTheme } from '../adminUiTheme.js';
import { readSlateMode } from '../slateMode.js';

/** Match CSS animation length (play once, then clear session). */
export const SIGN_OUT_ANIM_MS = 1600;

type Props = {
  open: boolean;
};

export function SignOutOverlay({ open }: Props) {
  const [mounted, setMounted] = useState(false);
  const mode = readSlateMode();
  const uiTheme = detectAdminUiTheme();

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!open || !mounted || typeof document === 'undefined') return null;

  return createPortal(
    <div
      data-slate-forms=""
      data-theme-name="slate"
      data-admin-ui={uiTheme}
      data-theme={mode}
      className="slate-signout"
      role="status"
      aria-live="polite"
      aria-label="Signing out"
    >
      <div className="slate-signout-lockup" aria-hidden>
        <span className="slate-signout-mark">
          <SlateLogo variant="mark" height={48} />
        </span>
        <span className="slate-signout-word">
          {['S', 'l', 'a', 't', 'e'].map((ch, i) => (
            <span key={`${ch}-${i}`} className="slate-signout-ch" style={{ animationDelay: `${i * 90}ms` }}>
              {ch}
            </span>
          ))}
        </span>
      </div>
    </div>,
    document.body,
  );
}
