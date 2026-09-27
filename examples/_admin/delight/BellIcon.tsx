/**
 * The studio bell (notifications). `swing` rings it once — the arrival
 * moment (ADR-060); re-key the icon to ring it again. Own file so the
 * /motion gallery can show it without the studio's stores.
 */

'use client';

export function IconBell({ swing = false }: { swing?: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      className={`slate-bell${swing ? ' slate-bell--swing' : ''}`}
    >
      <path
        d="M6 9a6 6 0 1 1 12 0c0 7 3 7 3 9H3c0-2 3-2 3-9Z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
      <path
        className="slate-bell-clapper"
        d="M10 20a2 2 0 0 0 4 0"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}
