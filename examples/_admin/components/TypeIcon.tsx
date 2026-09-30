/**
 * One line icon per question type for the Add-to-form palette, the outline
 * rows, the inspector chip and the drop lab (ADR-063). Same drawing rules as
 * the Responses icons (responses/icons.tsx): 16×16 grid, 1.6 stroke,
 * `currentColor`, round caps — so they read at 14–16 px where the old
 * Unicode glyphs (☏ ⇪ ◈ …) came out tiny or as emoji. Always decorative.
 *
 * Keyed by `Question['type']`, so a new question type doesn't compile until
 * it has an icon.
 */

'use client';

import type { ReactNode } from 'react';
import type { Question } from '@/index.js';

const PATHS: Record<Question['type'], ReactNode> = {
  welcome: (
    <>
      <rect x="2.5" y="3" width="11" height="10" rx="1.6" />
      <path d="M7 6.2 10 8l-3 1.8z" fill="currentColor" />
    </>
  ),
  statement: (
    <>
      <circle cx="8" cy="8" r="5.6" />
      <path d="M8 7.3v3.4M8 5h.01" />
    </>
  ),
  thanks: (
    <>
      <rect x="2.5" y="3" width="11" height="10" rx="1.6" />
      <path d="M5.6 8.1 7.3 9.8 10.5 6.3" />
    </>
  ),
  review: (
    <>
      <rect x="3.5" y="2.5" width="9" height="11" rx="1.4" />
      <path d="M5.8 6h4.4M5.8 8.6h4.4M5.8 11.2h2.4" />
    </>
  ),
  short_text: <path d="M3.5 4.5h9M8 4.5v7.5M6 12h4" />,
  long_text: <path d="M3 4h10M3 7h10M3 10h10M3 13h6" />,
  email: (
    <>
      <rect x="2.5" y="4" width="11" height="8" rx="1.5" />
      <path d="m3 5 5 3.6L13 5" />
    </>
  ),
  phone: (
    <path d="M5.2 2.6h1.6l1 2.6-1.2 1a7 7 0 0 0 3.2 3.2l1-1.2 2.6 1v1.6a1.5 1.5 0 0 1-1.6 1.5A10.4 10.4 0 0 1 3.7 4.2a1.5 1.5 0 0 1 1.5-1.6z" />
  ),
  url: (
    <path d="M7 9.1a2.5 2.5 0 0 0 3.5 0l2-2A2.5 2.5 0 0 0 9 3.6l-.7.7M9 6.9a2.5 2.5 0 0 0-3.5 0l-2 2A2.5 2.5 0 0 0 7 12.4l.7-.7" />
  ),
  number: <path d="M6.3 3 5.2 13M10.8 3 9.7 13M3.2 6h10M2.8 10h10" />,
  date: (
    <>
      <rect x="2.5" y="3.5" width="11" height="10" rx="1.5" />
      <path d="M2.5 6.8h11M5.5 2v3M10.5 2v3" />
    </>
  ),
  file_upload: (
    <path d="M8 10.5V3M5.2 5.6 8 2.8l2.8 2.8M3 10v2.4a1.1 1.1 0 0 0 1.1 1.1h7.8a1.1 1.1 0 0 0 1.1-1.1V10" />
  ),
  single_choice: (
    <>
      <circle cx="8" cy="8" r="5.6" />
      <circle cx="8" cy="8" r="2.4" fill="currentColor" stroke="none" />
    </>
  ),
  multi_choice: (
    <>
      <rect x="2.6" y="2.6" width="10.8" height="10.8" rx="2" />
      <path d="M5.4 8.2 7.2 10l3.4-3.8" />
    </>
  ),
  dropdown: (
    <>
      <rect x="2" y="4" width="12" height="8" rx="1.5" />
      <path d="M4.5 8h3.5M10 7.2l1.2 1.2 1.2-1.2" />
    </>
  ),
  picture_choice: (
    <>
      <rect x="2.5" y="3" width="11" height="10" rx="1.5" />
      <circle cx="6" cy="6.5" r="1.1" />
      <path d="m3 12 3.3-3.3 2.4 2.4 1.5-1.5L13 12.4" />
    </>
  ),
  ranking: <path d="M6 4.2h7.5M6 8h5M6 11.8h2.5M2.8 4.2h.01M2.8 8h.01M2.8 11.8h.01" />,
  matrix: (
    <>
      <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" />
      <path d="M2.5 6.2h11M2.5 9.8h11M6.2 2.5v11M9.8 2.5v11" />
    </>
  ),
  yes_no: (
    <>
      <rect x="1.8" y="4.5" width="12.4" height="7" rx="3.5" />
      <circle cx="10.7" cy="8" r="2" fill="currentColor" stroke="none" />
    </>
  ),
  legal: (
    <>
      <path d="M8 2.2 13 4v3.6c0 3-2.1 5.1-5 6.2-2.9-1.1-5-3.2-5-6.2V4z" />
      <path d="M5.8 8 7.3 9.5 10.3 6.4" />
    </>
  ),
  scale: (
    <>
      <path d="M2.8 11.5a5.2 5.2 0 0 1 10.4 0" />
      <path d="M8 11.5 10.4 8" />
    </>
  ),
  nps: <path d="M3.5 13v-2.5M6.5 13V8.5M9.5 13V6M12.5 13V3.5" />,
};

export function TypeIcon({
  type,
  size = 16,
  className,
}: {
  type: Question['type'];
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className ? `slate-type-icon ${className}` : 'slate-type-icon'}
    >
      {PATHS[type] ?? PATHS.short_text}
    </svg>
  );
}
