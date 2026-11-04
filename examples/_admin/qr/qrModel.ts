/**
 * Slate · QR codes (ADR-075): the record, its style, and the rules the editor
 * checks before saving. The database checks the same limits again (025).
 */

import { contrastRatio, relativeLuminance } from '@/utils/contrast.js';
import { MAX_LOGO_DATA_URL_LENGTH } from '@/utils/brandLogo.js';
import {
  QR_INK,
  QR_PAPER,
  QR_SWISS_RED,
  type QrColors,
  type QrErrorLevel,
  type QrPreset,
} from './qrRender.js';

export type QrKind = 'static' | 'dynamic';

export type QrStyle = {
  preset: QrPreset;
  /** #rrggbb */
  fg: string;
  /** #rrggbb */
  bg: string;
  /** `data:image/(png|jpeg|webp);base64,…`, at most 100,000 characters. */
  logo?: string;
  /** At most 40 characters. */
  caption?: string;
};

export type QrRecord = {
  id: string;
  name: string;
  kind: QrKind;
  /** Dynamic only; drawn by the database. */
  code: string | null;
  targetUrl: string | null;
  style: QrStyle;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export const QR_QUOTA_MAX = 100;
export const QR_NAME_MAX = 200;
export const QR_CAPTION_MAX = 40;
export const QR_URL_MAX = 2048;
export const QR_LOGO_MAX = MAX_LOGO_DATA_URL_LENGTH;
export const QR_MIN_CONTRAST = 4.5;
/** Download size of the code area. */
export const QR_DOWNLOAD_PX = 1440;

export const DEFAULT_QR_STYLE: QrStyle = {
  preset: 'swiss',
  fg: QR_INK.toLowerCase(),
  bg: QR_PAPER.toLowerCase(),
};

/**
 * Where dynamic codes point while the tool is built (ADR-075 §4). A printed
 * dynamic code binds to this origin for life: settle the domain before launch.
 */
export function qrShortOrigin(): string {
  const raw = import.meta.env.VITE_QR_SHORT_ORIGIN?.trim();
  return (raw || 'https://slateforms.vercel.app').replace(/\/$/, '');
}

export function qrShortUrl(code: string): string {
  return `${qrShortOrigin()}/q/${code}`;
}

/** What the QR holds: the short link for dynamic codes, the link itself for static ones. */
export function qrContent(record: Pick<QrRecord, 'kind' | 'code' | 'targetUrl'>): string | null {
  if (record.kind === 'dynamic') return record.code ? qrShortUrl(record.code) : null;
  return record.targetUrl;
}

const HEX = /^#[0-9a-f]{6}$/;
const LOGO = /^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/]+={0,2}$/i;

/** `#ABC`, `abc123`, `#aabbcc` → `#aabbcc`; anything else → null. */
export function normalizeHex(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let v = raw.trim().toLowerCase();
  if (!v.startsWith('#')) v = `#${v}`;
  if (/^#[0-9a-f]{3}$/.test(v)) {
    v = `#${v
      .slice(1)
      .split('')
      .map((c) => c + c)
      .join('')}`;
  }
  return HEX.test(v) ? v : null;
}

/** Whatever the database holds → a style the renderer can draw. */
export function sanitizeQrStyle(raw: unknown): QrStyle {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const preset: QrPreset =
    o.preset === 'soft' || o.preset === 'branded' || o.preset === 'swiss' ? o.preset : 'swiss';
  let fg = normalizeHex(o.fg) ?? DEFAULT_QR_STYLE.fg;
  let bg = normalizeHex(o.bg) ?? DEFAULT_QR_STYLE.bg;
  if (colorProblem(fg, bg)) {
    fg = DEFAULT_QR_STYLE.fg;
    bg = DEFAULT_QR_STYLE.bg;
  }
  const style: QrStyle = { preset, fg, bg };
  if (typeof o.logo === 'string' && o.logo.length <= QR_LOGO_MAX && LOGO.test(o.logo)) {
    style.logo = o.logo;
  }
  if (typeof o.caption === 'string') {
    const caption = o.caption.replace(/\s+/g, ' ').trim().slice(0, QR_CAPTION_MAX);
    if (caption) style.caption = caption;
  }
  return style;
}

/** Why a color pair won't scan reliably, or null when it's fine. */
export function colorProblem(fg: string, bg: string): string | null {
  // Many phone scanners can't read light codes on dark backgrounds.
  if (relativeLuminance(fg) > relativeLuminance(bg)) {
    return 'Use a darker code color than the background. Many phone cameras can’t read light codes on dark.';
  }
  if (contrastRatio(fg, bg) < QR_MIN_CONTRAST) {
    return 'These colors are too close. Pick a darker code color or a lighter background.';
  }
  return null;
}

/** Renderer colors: Swiss keeps its red centers only while they stand out (3:1). */
export function qrColors(style: QrStyle): QrColors {
  const accent = contrastRatio(QR_SWISS_RED, style.bg) >= 3 ? QR_SWISS_RED : style.fg;
  return { dark: style.fg, light: style.bg, accent };
}

/** Error correction to try: a logo needs H or Q (it hides part of the code). */
export function qrLevels(style: QrStyle): ReadonlyArray<QrErrorLevel> {
  if (style.logo || style.preset === 'branded') return ['H', 'Q'];
  return ['M', 'L'];
}

/**
 * `example.com/menu` → `https://example.com/menu`. Returns null for anything
 * that isn't a link: the caller says why with `destinationProblem`.
 */
export function normalizeDestination(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (!url.hostname.includes('.') && url.hostname !== 'localhost') return null;
  // Keep what the owner typed after the host (URL() would re-encode it).
  const out = withScheme.replace(/^(https?):\/\//i, (_, s: string) => `${s.toLowerCase()}://`);
  return out;
}

/** The plain sentence for a destination the editor refuses, or null when it's fine. */
export function destinationProblem(raw: string): string | null {
  const v = raw.trim();
  if (!v) return 'Paste the link this code should open.';
  if (/\s/.test(v)) return 'Links can’t have spaces in them.';
  if (v.length > QR_URL_MAX)
    return `Links can be at most ${QR_URL_MAX.toLocaleString()} characters.`;
  if (/^[a-z][a-z0-9+.-]*:/i.test(v) && !/^https?:\/\//i.test(v)) {
    return 'Use a web link that starts with https:// or http://.';
  }
  const url = normalizeDestination(v);
  if (!url) return 'That doesn’t look like a web link. Try something like example.com/menu.';
  // The database's own rule (025): no `user:pass@` before the host.
  if (!/^https?:\/\/[^\s/?#@]+([/?#][^\s]*)?$/i.test(url)) {
    return 'Links can’t include a username or password.';
  }
  if (url.length > QR_URL_MAX)
    return `Links can be at most ${QR_URL_MAX.toLocaleString()} characters.`;
  try {
    const origin = new URL(qrShortOrigin());
    const u = new URL(url);
    if (u.host.toLowerCase() === origin.host.toLowerCase() && u.pathname.startsWith('/q/')) {
      return 'A code can’t point at another Slate code. Paste the final link instead.';
    }
  } catch {
    // Unreachable: both parsed above.
  }
  return null;
}

/** "Untitled QR code" until the owner names it: the list shows the link's host instead. */
export function displayName(record: Pick<QrRecord, 'name' | 'targetUrl'>): string {
  const name = record.name.trim();
  if (name) return name;
  if (record.targetUrl) {
    try {
      return new URL(record.targetUrl).host.replace(/^www\./, '');
    } catch {
      // fall through
    }
  }
  return 'Untitled QR code';
}

/** A safe file name for downloads. */
export function downloadBaseName(record: Pick<QrRecord, 'name' | 'targetUrl'>): string {
  const base = displayName(record)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${base || 'qr-code'}-qr`;
}
