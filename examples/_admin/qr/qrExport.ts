/**
 * Slate · QR codes images (ADR-075 §9): the on-screen preview, the PNG and
 * SVG downloads, and the logo an owner adds. All three images come from one
 * `buildQrGeometry` pass, so what downloads is what the editor showed.
 */

import { convertHeicToJpegFile } from '@/utils/heicToJpeg.js';
import { isHeicLike, withInferredImageMime } from '@/utils/imageFileTypes.js';
import {
  buildQrGeometry,
  paintQrCanvas,
  qrGeometryToSvg,
  QrTooLongError,
  SLATE_MARK_DATA_URL,
  type QrGeometry,
} from './qrRender.js';
import { QR_DOWNLOAD_PX, QR_LOGO_MAX, qrColors, qrLevels, type QrStyle } from './qrModel.js';

/** Mark without a logo of the owner's shows Slate's, like the Share panel. */
function logoFor(style: QrStyle): string | null {
  if (style.logo) return style.logo;
  return style.preset === 'branded' ? SLATE_MARK_DATA_URL : null;
}

export function qrGeometry(text: string, style: QrStyle, size: number): QrGeometry {
  return buildQrGeometry(text, {
    preset: style.preset,
    colors: qrColors(style),
    size,
    // The scanner's quiet zone: about four modules for a short link (29 across).
    margin: Math.round(size * 0.12),
    levels: qrLevels(style),
    logoHref: logoFor(style),
    caption: style.caption ?? null,
  });
}

/** Why `text` can't be drawn with this style, or null. */
export function qrDrawProblem(text: string, style: QrStyle): string | null {
  try {
    qrGeometry(text, style, 100);
    return null;
  } catch (err) {
    if (err instanceof QrTooLongError) {
      return style.logo || style.preset === 'branded'
        ? 'This link is too long to fit with a logo. Remove the logo, pick Swiss or Dots, or use a dynamic code.'
        : 'This link is too long for a QR code. Use a dynamic code: it holds a short link instead.';
    }
    return 'Couldn’t draw this code.';
  }
}

/** A synchronous preview (SVG data URL) for cards and the editor. */
export function qrPreviewSrc(text: string, style: QrStyle, size = 320): string | null {
  try {
    const svg = qrGeometryToSvg(qrGeometry(text, style, size));
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  } catch {
    return null;
  }
}

function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function downloadQrPng(text: string, style: QrStyle, baseName: string): Promise<void> {
  const canvas = await paintQrCanvas(qrGeometry(text, style, QR_DOWNLOAD_PX));
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Couldn’t make the PNG.');
  saveBlob(blob, `${baseName}.png`);
}

export function downloadQrSvg(text: string, style: QrStyle, baseName: string): void {
  const svg = qrGeometryToSvg(qrGeometry(text, style, QR_DOWNLOAD_PX));
  saveBlob(new Blob([svg], { type: 'image/svg+xml' }), `${baseName}.svg`);
}

/** Long edge of a stored logo. It prints at about a fifth of the code. */
const LOGO_EDGE = 360;

function loadFileImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('That image couldn’t be opened. Try a PNG or JPG.'));
    };
    img.src = url;
  });
}

/**
 * An owner's logo → a small `data:` image under the 100,000-character cap.
 * PNG first (keeps transparency), then WebP, then JPEG on the code's background.
 */
export async function prepareQrLogo(input: File, background: string): Promise<string> {
  let file: File = withInferredImageMime(input);
  if (file.type === 'image/svg+xml') {
    throw new Error('SVG logos aren’t supported yet. Export it as a PNG and try again.');
  }
  if (!file.type.startsWith('image/') && !isHeicLike(file)) {
    throw new Error('That file isn’t an image. Try a PNG or JPG.');
  }
  if (file.size > 20 * 1024 * 1024) throw new Error('That image is over 20 MB. Try a smaller one.');
  if (isHeicLike(file)) file = await convertHeicToJpegFile(file);

  const img = await loadFileImage(file);
  for (const edge of [LOGO_EDGE, 240, 160]) {
    const scale = Math.min(1, edge / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Couldn’t read that image.');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const png = canvas.toDataURL('image/png');
    if (png.length <= QR_LOGO_MAX) return png;
    const webp = canvas.toDataURL('image/webp', 0.85);
    if (webp.startsWith('data:image/webp') && webp.length <= QR_LOGO_MAX) return webp;

    const flat = document.createElement('canvas');
    flat.width = canvas.width;
    flat.height = canvas.height;
    const fctx = flat.getContext('2d');
    if (!fctx) continue;
    fctx.fillStyle = background;
    fctx.fillRect(0, 0, flat.width, flat.height);
    fctx.drawImage(canvas, 0, 0);
    const jpeg = flat.toDataURL('image/jpeg', 0.85);
    if (jpeg.length <= QR_LOGO_MAX) return jpeg;
  }
  throw new Error('That image is too detailed to use as a logo. Try a simpler one.');
}
