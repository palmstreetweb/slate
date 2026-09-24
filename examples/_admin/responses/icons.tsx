/**
 * Line icons for the Responses views (ADR-055), ported from the approved
 * prototypes. 16×16 grid, 1.6 stroke, `currentColor`; always decorative —
 * the control that holds one carries the accessible name.
 */

'use client';

import type { ReactNode } from 'react';

type IconProps = { size?: number; className?: string };

function Svg({ size = 16, className, children }: IconProps & { children: ReactNode }) {
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
      className={className ? `rsp-icon ${className}` : 'rsp-icon'}
    >
      {children}
    </svg>
  );
}

export function IconSearch(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5 14 14" />
    </Svg>
  );
}

export function IconX(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
    </Svg>
  );
}

export function IconCheck(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3 8.5 6.5 12 13 4.5" />
    </Svg>
  );
}

/** Double check — "Mark all read". */
export function IconCheckAll(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M1.5 8.5 4.5 11.5 10.5 5M7.5 11.5l6-6.5" />
    </Svg>
  );
}

export function IconChevronUp(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 10l4-4 4 4" />
    </Svg>
  );
}

export function IconChevronDown(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 6l4 4 4-4" />
    </Svg>
  );
}

export function IconChevronLeft(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M10 4 6 8l4 4" />
    </Svg>
  );
}

export function IconChevronRight(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M6 4l4 4-4 4" />
    </Svg>
  );
}

export function IconArrowLeft(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12.5 8h-9M7 4.5 3.5 8 7 11.5" />
    </Svg>
  );
}

export function IconArrowUp(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M8 12.5v-9M4.5 7 8 3.5 11.5 7" />
    </Svg>
  );
}

export function IconArrowDown(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M8 3.5v9M4.5 9 8 12.5 11.5 9" />
    </Svg>
  );
}

export function IconReply(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M6 3.5 2 7.5l4 4" />
      <path d="M2 7.5h7a5 5 0 0 1 5 5" />
    </Svg>
  );
}

export function IconTrash(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M2.5 4.5h11" />
      <path d="M6.25 4.5V3.25a1 1 0 0 1 1-1h1.5a1 1 0 0 1 1 1V4.5" />
      <path d="M4 4.5l.6 8.1A1.5 1.5 0 0 0 6.1 14h3.8a1.5 1.5 0 0 0 1.5-1.4l.6-8.1" />
    </Svg>
  );
}

/** Counter-clockwise arrow — "Restore". */
export function IconRestore(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3 3.5v3h3" />
      <path d="M3.3 6.5A5 5 0 1 1 3 8" />
    </Svg>
  );
}

/** Paperclip — the response has files. */
export function IconClip(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M13 7.5 8.1 12.4a3 3 0 0 1-4.3-4.3l5.2-5.2a2 2 0 0 1 2.9 2.9L6.7 11a1 1 0 0 1-1.4-1.4L10 4.9" />
    </Svg>
  );
}

export function IconImage(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="2.5" y="3" width="11" height="10" rx="1.5" />
      <circle cx="6" cy="6.5" r="1.1" />
      <path d="M13.5 10.5 10.5 7.5 3.5 13" />
    </Svg>
  );
}

export function IconFile(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M9 2H4.5A1.5 1.5 0 0 0 3 3.5v9A1.5 1.5 0 0 0 4.5 14h7a1.5 1.5 0 0 0 1.5-1.5V6z" />
      <path d="M9 2v4h4" />
    </Svg>
  );
}

/** Funnel — a tile or bar that filters the list. */
export function IconFilter(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M2.5 3.5h11l-4.25 5v3.75l-2.5 1.25v-5z" />
    </Svg>
  );
}

/** Tray — the Inbox view. */
export function IconInbox(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M2 9.5 3.6 3.9A1.5 1.5 0 0 1 5 2.8h6a1.5 1.5 0 0 1 1.4 1.1L14 9.5" />
      <path d="M2 9.5v2.7A1.8 1.8 0 0 0 3.8 14h8.4a1.8 1.8 0 0 0 1.8-1.8V9.5h-3.5l-1 1.5h-3l-1-1.5z" />
    </Svg>
  );
}

/** Bars — the Summary view. */
export function IconSummary(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3 13.5V9M8 13.5V3M13 13.5V6.5" />
    </Svg>
  );
}

/** Horizontal ellipsis — "More actions". */
export function IconMore(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="3.5" cy="8" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="8" cy="8" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="12.5" cy="8" r="1.1" fill="currentColor" stroke="none" />
    </Svg>
  );
}

/** Hollow dot — "Mark unread". */
export function IconUnread(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="8" cy="8" r="3.5" />
    </Svg>
  );
}

export function IconEye(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8s-2.4 4.5-6.5 4.5S1.5 8 1.5 8z" />
      <circle cx="8" cy="8" r="2" />
    </Svg>
  );
}

export function IconDownload(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M8 2.5v8M4.5 7 8 10.5 11.5 7" />
      <path d="M2.5 13.5h11" />
    </Svg>
  );
}

export function IconShare(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M8 10V2.5M5 5.5 8 2.5l3 3" />
      <path d="M3 9v3.5A1.5 1.5 0 0 0 4.5 14h7a1.5 1.5 0 0 0 1.5-1.5V9" />
    </Svg>
  );
}

/** Pencil — "Open editor". */
export function IconEdit(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M10.5 2.5l3 3L6 13H3v-3z" />
    </Svg>
  );
}
