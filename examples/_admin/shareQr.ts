/**
 * Share-panel QR styles — canvas-rendered variants (examples/ only). The
 * geometry lives in qr/qrRender.ts, shared with Slate · QR codes (ADR-075).
 */

import {
  buildQrGeometry,
  paintQrCanvas,
  QR_INK,
  QR_PAPER,
  QR_PRESETS,
  QR_SWISS_RED,
  SLATE_MARK_DATA_URL,
  type QrColors,
  type QrErrorLevel,
  type QrPreset,
} from './qr/qrRender.js';

export const SHARE_QR_STYLE_KEY = 'slate-share-qr-style';
export const SHARE_QR_DISPLAY_PX = 248;

export type ShareQrStyle = QrPreset;

export const SHARE_QR_STYLES = QR_PRESETS;

const RENDER_SIZE = 720;
const BRANDED_CLEAR_RADIUS = 5;

/** Prefer higher EC for logo overlay, but fall back when the URL is long. */
const EC_LEVELS: Record<ShareQrStyle, ReadonlyArray<QrErrorLevel>> = {
  swiss: ['M', 'L'],
  soft: ['M', 'L'],
  branded: ['H', 'Q', 'M', 'L'],
};

const SHARE_COLORS: QrColors = { dark: QR_INK, light: QR_PAPER, accent: QR_SWISS_RED };

export function isShareQrStyle(value: string): value is ShareQrStyle {
  return value === 'swiss' || value === 'soft' || value === 'branded';
}

export function readShareQrStyle(): ShareQrStyle {
  if (typeof window === 'undefined') return 'swiss';
  try {
    const stored = window.localStorage.getItem(SHARE_QR_STYLE_KEY);
    if (stored === 'classic') return 'swiss';
    if (stored && isShareQrStyle(stored)) return stored;
  } catch {
    // ignored
  }
  return 'swiss';
}

export function writeShareQrStyle(style: ShareQrStyle): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SHARE_QR_STYLE_KEY, style);
  } catch {
    // ignored
  }
}

/** Render a share QR as a PNG data URL. */
export async function renderShareQr(url: string, style: ShareQrStyle): Promise<string> {
  const geometry = buildQrGeometry(url, {
    preset: style,
    colors: SHARE_COLORS,
    size: RENDER_SIZE,
    margin: 0,
    levels: EC_LEVELS[style],
    logoHref: style === 'branded' ? SLATE_MARK_DATA_URL : null,
    logoClearRadius: BRANDED_CLEAR_RADIUS,
  });
  const canvas = await paintQrCanvas(geometry);
  return canvas.toDataURL('image/png');
}
