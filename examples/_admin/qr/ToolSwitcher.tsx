/**
 * Forms | QR codes (ADR-075 §1): the studio's two tools, in the header of
 * each tool's library page. Phones get the same switch in the ⋯ sheet.
 */

import { navigate } from '../_router.js';

export type StudioTool = 'forms' | 'qr';

export function ToolSwitcher({ current }: { current: StudioTool }) {
  return (
    <nav className="slate-tool-switch" aria-label="Slate tools">
      <button
        type="button"
        className={`slate-tool-switch-btn${current === 'forms' ? ' slate-tool-switch-btn--on' : ''}`}
        aria-current={current === 'forms' ? 'page' : undefined}
        onClick={() => navigate('/')}
      >
        Forms
      </button>
      <button
        type="button"
        className={`slate-tool-switch-btn${current === 'qr' ? ' slate-tool-switch-btn--on' : ''}`}
        aria-current={current === 'qr' ? 'page' : undefined}
        onClick={() => navigate('/qr')}
      >
        QR codes
      </button>
    </nav>
  );
}

export function IconQr({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M14 14h2v2h-2zM18 14h2M14 18v2M18 18h2v2h-2z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function IconForms({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M6 3h9l4 4v14H6zM9 11h7M9 15h7M9 7h3"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IconDownload() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 3v12M7 10l5 5 5-5M5 21h14"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IconLink() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
