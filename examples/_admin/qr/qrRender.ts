/**
 * QR geometry shared by the Share panel and Slate · QR codes (ADR-075 §9).
 * One pass turns the modules into shapes; the canvas painter (PNG) and the
 * SVG writer both draw those same shapes, so the two downloads match.
 */

import QRCode from 'qrcode';
import faviconSvg from '../../../brand/favicon.svg?raw';

/** Ink on paper: the Share panel's colors and the QR tool's defaults. */
export const QR_INK = '#2A2520';
export const QR_PAPER = '#FAF6EE';
/** Swiss theme accent — red finder centers. */
export const QR_SWISS_RED = '#DC2626';
/** The Slate mark that Mark draws in the middle. */
export const SLATE_MARK_DATA_URL = `data:image/svg+xml,${encodeURIComponent(faviconSvg)}`;

export type QrPreset = 'swiss' | 'soft' | 'branded';

export const QR_PRESETS: ReadonlyArray<{ id: QrPreset; label: string; description: string }> = [
  { id: 'swiss', label: 'Swiss', description: 'Square grid with red finder centers' },
  { id: 'soft', label: 'Dots', description: 'Circular modules and ring finders' },
  { id: 'branded', label: 'Mark', description: 'Slate favicon centered in the code' },
];
export type QrErrorLevel = 'L' | 'M' | 'Q' | 'H';

export type QrColors = {
  /** Modules and finder rings. */
  dark: string;
  light: string;
  /** Swiss finder centers. */
  accent: string;
};

export type QrShape =
  | { kind: 'rect'; x: number; y: number; w: number; h: number; fill: string }
  | {
      kind: 'rrect';
      x: number;
      y: number;
      w: number;
      h: number;
      /** Corner radii: top-left, top-right, bottom-right, bottom-left. */
      r: [number, number, number, number];
      fill: string;
    }
  | { kind: 'ring'; cx: number; cy: number; outer: number; inner: number; fill: string }
  | { kind: 'circle'; cx: number; cy: number; r: number; fill: string };

export type QrCaption = {
  text: string;
  x: number;
  /** Baseline. */
  y: number;
  size: number;
  fill: string;
};

export type QrGeometry = {
  width: number;
  height: number;
  /** Background; null leaves the image transparent. */
  background: string | null;
  shapes: QrShape[];
  logo: { href: string; x: number; y: number; size: number } | null;
  caption: QrCaption | null;
};

export type QrDrawOptions = {
  preset: QrPreset;
  colors: QrColors;
  /** Width of the code area in px. */
  size: number;
  /** Quiet zone in px around the code. */
  margin: number;
  /** Error correction levels to try, strongest first. */
  levels: ReadonlyArray<QrErrorLevel>;
  /** Center image (data URL). Clears modules under it. */
  logoHref?: string | null;
  /** Fixed cleared square around the logo, in modules from center (default: sized to the logo). */
  logoClearRadius?: number;
  /** Ring finder proportions for Dots and Mark (default: `RING_FINDER`). */
  ringFinder?: RingFinder;
  caption?: string | null;
  captionFont?: string;
};

/** Thrown when the text doesn't fit at any allowed error correction level. */
export class QrTooLongError extends Error {
  constructor() {
    super('URL too long for QR code');
    this.name = 'QrTooLongError';
  }
}

const FINDER_CORNERS = (count: number) => [
  { row: 0, col: 0 },
  { row: 0, col: count - 7 },
  { row: count - 7, col: 0 },
];

/** Gap between a module and its cell edge, as a fraction of the cell. */
const MODULE_GAP = 0.14;
/** Sub-pixel bleed so merged neighbors render without hairline seams. */
const MODULE_BLEED = 0.6;
/** Logo width as a share of the code area. */
const LOGO_SHARE = 0.22;
/** Smallest cleared square around the logo, in modules from center (the Share panel's). */
const MIN_CLEAR_RADIUS = 5;
/** Caption height as a share of the code area. */
const CAPTION_SHARE = 0.075;

export const QR_CAPTION_FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

export function createQrModules(
  text: string,
  levels: ReadonlyArray<QrErrorLevel>,
): ReturnType<typeof QRCode.create> {
  for (const errorCorrectionLevel of levels) {
    try {
      return QRCode.create(text, { errorCorrectionLevel });
    } catch {
      // Too large at this level — try the next one down.
    }
  }
  throw new QrTooLongError();
}

function clearRadius(count: number): number {
  return Math.max(MIN_CLEAR_RADIUS, Math.ceil((count * LOGO_SHARE) / 2) + 1);
}

/** Ring, gap and center dot of a round finder, as fractions of its 7-module width. */
export type RingFinder = { outer: number; inner: number; dot: number };

/**
 * Round finders a phone camera reads: across the middle, ring 1 : gap 1 :
 * dot 3 : gap 1 : ring 1, the pattern scanners look for. The first Dots
 * rings (0.47 / 0.33 / 0.13) were about 1 : 1.4 : 1.9 : 1.4 : 1, and Apple's
 * QR reader, the one behind the iPhone camera, didn't decode them (ADR-075).
 */
export const RING_FINDER: RingFinder = { outer: 0.48, inner: 0.345, dot: 0.215 };

function finderShapes(
  preset: QrPreset,
  ring: RingFinder,
  colors: QrColors,
  x: number,
  y: number,
  cell: number,
): QrShape[] {
  const size = cell * 7;
  if (preset === 'swiss') {
    return [
      { kind: 'rect', x, y, w: size, h: size, fill: colors.dark },
      { kind: 'rect', x: x + cell, y: y + cell, w: cell * 5, h: cell * 5, fill: colors.light },
      {
        kind: 'rect',
        x: x + cell * 2,
        y: y + cell * 2,
        w: cell * 3,
        h: cell * 3,
        fill: colors.accent,
      },
    ];
  }
  const cx = x + size / 2;
  const cy = y + size / 2;
  return [
    { kind: 'ring', cx, cy, outer: size * ring.outer, inner: size * ring.inner, fill: colors.dark },
    { kind: 'circle', cx, cy, r: size * ring.dot, fill: colors.dark },
  ];
}

/**
 * Connected rounded modules: isolated cells render as circles, while runs of
 * adjacent cells merge into smooth rounded blobs. This keeps the modules large
 * and chunky (good scannability) while looking far softer than spaced dots.
 */
function roundedModuleShapes(
  isOn: (row: number, col: number) => boolean,
  count: number,
  cell: number,
  offset: number,
  fill: string,
): QrShape[] {
  const gap = cell * MODULE_GAP;
  const radius = (cell - gap * 2) / 2;
  const shapes: QrShape[] = [];

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
      shapes.push({
        kind: 'rrect',
        x,
        y,
        w: right2 - x,
        h: bottom - y,
        r: [
          !up && !left ? radius : 0,
          !up && !right ? radius : 0,
          !down && !right ? radius : 0,
          !down && !left ? radius : 0,
        ],
        fill,
      });
    }
  }
  return shapes;
}

/** Turn `text` into shapes. Throws QrTooLongError when it can't fit. */
export function buildQrGeometry(text: string, opts: QrDrawOptions): QrGeometry {
  const qr = createQrModules(text, opts.levels);
  const count = qr.modules.size;
  const { size, margin, colors, preset } = opts;
  const full = size + margin * 2;
  // The Share panel's 4 px edge inside its 720 px image, kept for every size.
  const edge = (size * 4) / 720;
  const cell = (size - edge * 2) / count;
  const offset = margin + (size - cell * count) / 2;
  const logoHref = opts.logoHref ?? null;
  const radius = logoHref ? (opts.logoClearRadius ?? clearRadius(count)) : 0;
  const center = (count - 1) / 2;

  const isOn = (row: number, col: number): boolean => {
    if (row < 0 || col < 0 || row >= count || col >= count) return false;
    if (!qr.modules.get(row, col)) return false;
    if (logoHref && Math.abs(row - center) <= radius && Math.abs(col - center) <= radius) {
      return false;
    }
    return !FINDER_CORNERS(count).some(
      ({ row: r, col: c }) => row >= r && row < r + 7 && col >= c && col < c + 7,
    );
  };

  const shapes: QrShape[] = [];
  if (preset === 'swiss') {
    for (let row = 0; row < count; row++) {
      for (let col = 0; col < count; col++) {
        if (!isOn(row, col)) continue;
        shapes.push({
          kind: 'rect',
          x: offset + col * cell,
          y: offset + row * cell,
          w: cell,
          h: cell,
          fill: colors.dark,
        });
      }
    }
  } else {
    shapes.push(...roundedModuleShapes(isOn, count, cell, offset, colors.dark));
  }
  for (const { row, col } of FINDER_CORNERS(count)) {
    shapes.push(
      ...finderShapes(
        preset,
        opts.ringFinder ?? RING_FINDER,
        colors,
        offset + col * cell,
        offset + row * cell,
        cell,
      ),
    );
  }

  const logoSize = size * LOGO_SHARE;
  const logo = logoHref
    ? {
        href: logoHref,
        x: margin + (size - logoSize) / 2,
        y: margin + (size - logoSize) / 2,
        size: logoSize,
      }
    : null;

  const captionText = opts.caption?.trim() ?? '';
  const captionSize = Math.round(size * CAPTION_SHARE);
  const captionBlock = captionText ? Math.round(captionSize * 1.9) : 0;
  const caption = captionText
    ? {
        text: captionText,
        x: full / 2,
        y: margin + size + Math.round(captionSize * 1.25),
        size: captionSize,
        fill: colors.dark,
      }
    : null;

  return {
    width: full,
    height: full + captionBlock,
    background: colors.light,
    shapes,
    logo,
    caption,
  };
}

/** Trace a rounded rectangle with independent per-corner radii. */
function roundedRectPath(
  ctx: CanvasRenderingContext2D,
  s: Extract<QrShape, { kind: 'rrect' }>,
): void {
  const { x, y, w, h } = s;
  const [tl, tr, br, bl] = s.r;
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

/** Decoded logos by href; a failed load is forgotten so the next paint retries. */
const images = new Map<string, Promise<HTMLImageElement>>();

function loadImage(href: string): Promise<HTMLImageElement> {
  let p = images.get(href);
  if (!p) {
    p = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => {
        images.delete(href);
        reject(new Error('Couldn’t load the logo'));
      };
      img.src = href;
    });
    images.set(href, p);
    // Owner logos are up to 100 KB each: keep the last few.
    if (images.size > 8) images.delete(images.keys().next().value as string);
  }
  return p;
}

/** Paint onto a canvas sized to the geometry. The code still scans if the logo fails. */
export async function paintQrCanvas(
  geometry: QrGeometry,
  captionFont = QR_CAPTION_FONT,
): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(geometry.width);
  canvas.height = Math.round(geometry.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas not supported');
  // Load before drawing: waiting mid-paint changed how the browser rasterized the canvas.
  const logo = geometry.logo ? await loadImage(geometry.logo.href).catch(() => null) : null;

  if (geometry.background) {
    ctx.fillStyle = geometry.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  for (const s of geometry.shapes) {
    ctx.fillStyle = s.fill;
    switch (s.kind) {
      case 'rect':
        ctx.fillRect(s.x, s.y, s.w, s.h);
        break;
      case 'rrect':
        roundedRectPath(ctx, s);
        ctx.fill();
        break;
      case 'ring':
        ctx.beginPath();
        ctx.arc(s.cx, s.cy, s.outer, 0, Math.PI * 2);
        ctx.arc(s.cx, s.cy, s.inner, 0, Math.PI * 2, true);
        ctx.fill('evenodd');
        break;
      case 'circle':
        ctx.beginPath();
        ctx.arc(s.cx, s.cy, s.r, 0, Math.PI * 2);
        ctx.fill();
        break;
    }
  }

  // Without the logo the code still scans.
  if (geometry.logo && logo) {
    const { x, y, size } = geometry.logo;
    drawContained(ctx, logo, x, y, size);
  }

  if (geometry.caption) {
    const c = geometry.caption;
    ctx.fillStyle = c.fill;
    ctx.font = `600 ${c.size}px ${captionFont}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(c.text, c.x, c.y, geometry.width * 0.9);
  }

  return canvas;
}

/** Fit an image inside a square, keeping its proportions (logos are rarely square). */
function drawContained(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  size: number,
): void {
  const w = img.naturalWidth || size;
  const h = img.naturalHeight || size;
  const scale = Math.min(size / w, size / h);
  const dw = w * scale;
  const dh = h * scale;
  ctx.drawImage(img, x + (size - dw) / 2, y + (size - dh) / 2, dw, dh);
}

const n = (v: number) => Number(v.toFixed(2)).toString();

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Rounded rectangle as an SVG path; a zero radius is a plain corner. */
function rrectPath(s: Extract<QrShape, { kind: 'rrect' }>): string {
  const { x, y, w, h } = s;
  const [tl, tr, br, bl] = s.r;
  const arc = (r: number, ex: number, ey: number) =>
    r > 0 ? `A${n(r)} ${n(r)} 0 0 1 ${n(ex)} ${n(ey)}` : `L${n(ex)} ${n(ey)}`;
  return [
    `M${n(x + tl)} ${n(y)}`,
    `L${n(x + w - tr)} ${n(y)}`,
    arc(tr, x + w, y + tr),
    `L${n(x + w)} ${n(y + h - br)}`,
    arc(br, x + w - br, y + h),
    `L${n(x + bl)} ${n(y + h)}`,
    arc(bl, x, y + h - bl),
    `L${n(x)} ${n(y + tl)}`,
    arc(tl, x + tl, y),
    'Z',
  ].join('');
}

/** `sweep` sets the winding: a ring's inner circle runs the other way, so nonzero fill leaves a hole. */
function circlePath(cx: number, cy: number, r: number, sweep: 0 | 1 = 1): string {
  return `M${n(cx - r)} ${n(cy)}A${n(r)} ${n(r)} 0 1 ${sweep} ${n(cx + r)} ${n(cy)}A${n(r)} ${n(r)} 0 1 ${sweep} ${n(cx - r)} ${n(cy)}Z`;
}

/**
 * The same shapes as one SVG document. Neighboring shapes of one color share a
 * path; nonzero fill keeps the overlapping module bleed solid.
 */
export function qrGeometryToSvg(geometry: QrGeometry, captionFont = QR_CAPTION_FONT): string {
  // Painter's order matters for Swiss finders (dark, light, accent on top), so
  // a fill that comes back after another starts a new group.
  const groups: Array<{ fill: string; d: string[] }> = [];
  let current: { fill: string; d: string[] } | null = null;
  for (const s of geometry.shapes) {
    let d: string;
    switch (s.kind) {
      case 'rect':
        d = `M${n(s.x)} ${n(s.y)}h${n(s.w)}v${n(s.h)}h${n(-s.w)}Z`;
        break;
      case 'rrect':
        d = rrectPath(s);
        break;
      case 'ring':
        d = `${circlePath(s.cx, s.cy, s.outer)}${circlePath(s.cx, s.cy, s.inner, 0)}`;
        break;
      case 'circle':
        d = circlePath(s.cx, s.cy, s.r);
        break;
    }
    if (!current || current.fill !== s.fill) {
      current = { fill: s.fill, d: [] };
      groups.push(current);
    }
    current.d.push(d);
  }

  const w = n(geometry.width);
  const h = n(geometry.height);
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`,
  ];
  if (geometry.background) {
    parts.push(`<rect width="${w}" height="${h}" fill="${escapeXml(geometry.background)}"/>`);
  }
  for (const g of groups) {
    parts.push(`<path fill="${escapeXml(g.fill)}" d="${g.d.join('')}"/>`);
  }
  if (geometry.logo) {
    const { href, x, y, size } = geometry.logo;
    parts.push(
      `<image href="${escapeXml(href)}" xlink:href="${escapeXml(href)}" x="${n(x)}" y="${n(y)}" width="${n(size)}" height="${n(size)}" preserveAspectRatio="xMidYMid meet"/>`,
    );
  }
  if (geometry.caption) {
    const c = geometry.caption;
    parts.push(
      `<text x="${n(c.x)}" y="${n(c.y)}" fill="${escapeXml(c.fill)}" font-family="${escapeXml(captionFont)}" font-size="${c.size}" font-weight="600" text-anchor="middle">${escapeXml(c.text)}</text>`,
    );
  }
  parts.push('</svg>');
  return parts.join('');
}
