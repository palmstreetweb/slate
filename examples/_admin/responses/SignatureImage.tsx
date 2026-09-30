/**
 * A drawn signature in Responses (ADR-064): the stored vector path redrawn as
 * an inline SVG in the studio's ink colour. The path is checked with the same
 * strict parser the submit Function uses before it reaches `d`, so only
 * `M x y l dx dy …` with whole numbers is ever rendered.
 */

'use client';

import { SIG_H, SIG_W, parseSignaturePath } from '@/logic/signature.js';

export function SignatureImage({ path, label }: { path: string; label: string }) {
  if (!parseSignaturePath(path)) return <span>Signed (drawing unreadable)</span>;
  return (
    <svg
      className="rsp-signature"
      viewBox={`0 0 ${SIG_W} ${SIG_H}`}
      role="img"
      aria-label={label}
      preserveAspectRatio="xMinYMid meet"
    >
      <path
        d={path}
        fill="none"
        stroke="currentColor"
        strokeWidth={3.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
