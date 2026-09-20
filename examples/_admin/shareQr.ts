/**
 * Share-panel QR styles — canvas-rendered variants (examples/ only).
 */

import QRCode from 'qrcode';
import faviconSvg from '../../brand/favicon.svg?raw';

export const SHARE_QR_STYLE_KEY = 'slate-share-qr-style';
export const SHARE_QR_DISPLAY_PX = 248;

export type ShareQrStyle = 'swiss' | 'soft' | 'branded';

export const SHARE_QR_STYLES: ReadonlyArray<{
  id: ShareQrStyle;
  label: string;
  description: string;
}> = [
  { id: 'swiss', label: 'Swiss', description: 'Square grid with red finder centers' },
  { id: 'soft', label: 'Dots', description: 'Circular modules and ring finders' },
  { id: 'branded', label: 'Mark', description: 'Slate favicon centered in the code' },
];

const RENDER_SIZE = 720;
const QR_COLORS = { dark: '#2A2520', light: '#FAF6EE' };
/** Swiss theme accent — red finder centers. */
const SWISS_ACCENT = '#DC2626';
const BRANDED_CLEAR_RADIUS = 5;
const FAVICON_DATA_URL = `data:image/svg+xml,${encodeURIComponent(faviconSvg)}`;

/** Prefer higher EC for logo overlay, but fall back when the URL is long. */
const EC_LEVELS: Record<ShareQrStyle, ReadonlyArray<'L' | 'M' | 'Q' | 'H'>> = {
  swiss: ['M', 'L'],
  soft: ['M', 'L'],
  branded: ['H', 'Q', 'M', 'L'],
};

const FINDER_CORNERS = (count: number) => [
  { row: 0, col: 0 },
  { row: 0, col: count - 7 },
  { row: count - 7, col: 0 },
];

let logoPromise: Promise<HTMLImageElement> | null = null;

function loadLogo(): Promise<HTMLImageElement> {
  if (!logoPromise) {
    logoPromise = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => {
        logoPromise = null;
        reject(new Error('Failed to load Slate favicon'));
      };
      img.src = FAVICON_DATA_URL;
    });
  }
  return logoPromise;
}

function createQr(url: string, style: ShareQrStyle): ReturnType<typeof QRCode.create> {
  for (const errorCorrectionLevel of EC_LEVELS[style]) {
    try {
      return QRCode.create(url, { errorCorrectionLevel });
    } catch {
      // URL may be too large at this EC level — try the next one down.
    }
  }
  throw new Error('URL too long for QR code');
}

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

function isInLogoClearZone(row: number, col: number, count: number): boolean {
  const center = (count - 1) / 2;
  return (
    Math.abs(row - center) <= BRANDED_CLEAR_RADIUS && Math.abs(col - center) <= BRANDED_CLEAR_RADIUS
  );
}

function isInFinderPattern(row: number, col: number, count: number): boolean {
  return FINDER_CORNERS(count).some(
    ({ row: r, col: c }) => row >= r && row < r + 7 && col >= c && col < c + 7,
  );
}

function drawSwissFinder(
  ctx: CanvasRenderingContext2D,
  offsetX: number,
  offsetY: number,
  cell: number,
): void {
  const size = cell * 7;

  ctx.fillStyle = QR_COLORS.dark;
  ctx.fillRect(offsetX, offsetY, size, size);

  ctx.fillStyle = QR_COLORS.light;
  ctx.fillRect(offsetX + cell, offsetY + cell, cell * 5, cell * 5);

  ctx.fillStyle = SWISS_ACCENT;
  ctx.fillRect(offsetX + cell * 2, offsetY + cell * 2, cell * 3, cell * 3);
}

function drawSwissFinders(
  ctx: CanvasRenderingContext2D,
  count: number,
  cell: number,
  offset: number,
): void {
  for (const { row, col } of FINDER_CORNERS(count)) {
    drawSwissFinder(ctx, offset + col * cell, offset + row * cell, cell);
  }
}

function drawDotFinder(
  ctx: CanvasRenderingContext2D,
  offsetX: number,
  offsetY: number,
  cell: number,
): void {
  const size = cell * 7;
  const cx = offsetX + size / 2;
  const cy = offsetY + size / 2;

  ctx.fillStyle = QR_COLORS.dark;

  const outerR = size * 0.47;
  const ringInnerR = size * 0.33;
  ctx.beginPath();
  ctx.arc(cx, cy, outerR, 0, Math.PI * 2);
  ctx.arc(cx, cy, ringInnerR, 0, Math.PI * 2, true);
  ctx.fill('evenodd');

  ctx.beginPath();
  ctx.arc(cx, cy, size * 0.13, 0, Math.PI * 2);
  ctx.fill();
}

function drawDotFinders(
  ctx: CanvasRenderingContext2D,
  count: number,
  cell: number,
  offset: number,
): void {
  for (const { row, col } of FINDER_CORNERS(count)) {
    drawDotFinder(ctx, offset + col * cell, offset + row * cell, cell);
  }
}

/** Gap between a module and its cell edge, as a fraction of the cell. */
const MODULE_GAP = 0.14;
/** Sub-pixel bleed so merged neighbors render without hairline seams. */
const MODULE_BLEED = 0.6;

/** Trace a rounded rectangle with independent per-corner radii. */
function roundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  tl: number,
  tr: number,
  br: number,
  bl: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + tl, y);
  ctx.lineTo(x + w - tr, y);
  ctx.arcTo(x + w, y, x + w, y + tr, tr);
  ctx.lineTo(x + w, y + h - br);
  ctx.arcTo(x + w, y + h, x + w - br, y + h, br);
  ctx.lineTo(x + bl, y + h);
  ctx.arcTo(x, y + h, x, y + h - bl, bl);
  ctx.lineTo(x, y + tl);
  ctx.arcTo(x, y, x + tl, y, tl);
  ctx.closePath();
}

/**
 * Connected rounded modules: isolated cells render as circles, while runs of
 * adjacent cells merge into smooth rounded blobs. This keeps the modules large
 * and chunky (good scannability) while looking far softer than spaced dots.
 */
function drawRoundedModules(
  ctx: CanvasRenderingContext2D,
  isOn: (row: number, col: number) => boolean,
  count: number,
  cell: number,
  offset: number,
): void {
  const gap = cell * MODULE_GAP;
  const radius = (cell - gap * 2) / 2;

  ctx.fillStyle = QR_COLORS.dark;

  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (!isOn(row, col)) continue;

      const up = isOn(row - 1, col);
      const down = isOn(row + 1, col);
      const left = isOn(row, col - 1);
      const right = isOn(row, col + 1);

      const cellX = offset + col * cell;
      const cellY = offset + row * cell;

      // Drop the gap (and add bleed) on any side that touches a neighbor so
      // the fills overlap and read as one continuous shape.
      const x = cellX + (left ? -MODULE_BLEED : gap);
      const y = cellY + (up ? -MODULE_BLEED : gap);
      const right2 = cellX + cell - (right ? -MODULE_BLEED : gap);
      const bottom = cellY + cell - (down ? -MODULE_BLEED : gap);

      // Round a corner only when both of its sides are open (no neighbor).
      const tl = !up && !left ? radius : 0;
      const tr = !up && !right ? radius : 0;
      const br = !down && !right ? radius : 0;
      const bl = !down && !left ? radius : 0;

      roundedRectPath(ctx, x, y, right2 - x, bottom - y, tl, tr, br, bl);
      ctx.fill();
    }
  }
}

function drawModules(
  ctx: CanvasRenderingContext2D,
  qr: ReturnType<typeof QRCode.create>,
  style: ShareQrStyle,
): void {
  const count = qr.modules.size;
  const margin = 4;
  const cell = (RENDER_SIZE - margin * 2) / count;
  const offset = (RENDER_SIZE - cell * count) / 2;
  const skipCenter = style === 'branded';

  const isOn = (row: number, col: number): boolean => {
    if (row < 0 || col < 0 || row >= count || col >= count) return false;
    if (!qr.modules.get(row, col)) return false;
    if (skipCenter && isInLogoClearZone(row, col, count)) return false;
    if (isInFinderPattern(row, col, count)) return false;
    return true;
  };

  ctx.fillStyle = QR_COLORS.light;
  ctx.fillRect(0, 0, RENDER_SIZE, RENDER_SIZE);

  if (style === 'swiss') {
    ctx.fillStyle = QR_COLORS.dark;
    for (let row = 0; row < count; row++) {
      for (let col = 0; col < count; col++) {
        if (!isOn(row, col)) continue;
        ctx.fillRect(offset + col * cell, offset + row * cell, cell, cell);
      }
    }
    drawSwissFinders(ctx, count, cell, offset);
    return;
  }

  drawRoundedModules(ctx, isOn, count, cell, offset);
  drawDotFinders(ctx, count, cell, offset);
}

function drawLogo(ctx: CanvasRenderingContext2D, logo: HTMLImageElement): void {
  const logoSize = RENDER_SIZE * 0.22;
  const x = (RENDER_SIZE - logoSize) / 2;
  const y = (RENDER_SIZE - logoSize) / 2;
  ctx.drawImage(logo, x, y, logoSize, logoSize);
}

/** Render a share QR as a PNG data URL. */
export async function renderShareQr(url: string, style: ShareQrStyle): Promise<string> {
  const qr = createQr(url, style);

  const canvas = document.createElement('canvas');
  canvas.width = RENDER_SIZE;
  canvas.height = RENDER_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas not supported');

  drawModules(ctx, qr, style);

  if (style === 'branded') {
    try {
      const logo = await loadLogo();
      drawLogo(ctx, logo);
    } catch {
      // QR still scans without the center mark.
    }
  }

  return canvas.toDataURL('image/png');
}
