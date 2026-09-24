/**
 * `schema.brand.logo` → an `<img src>` the chrome is willing to render, or
 * null. Schemas arrive from hosts, the studio, and (sanitized) portable
 * links, so the engine checks again at the point of use. Allowed:
 *
 *   - absolute `https:` URLs without embedded credentials
 *   - same-origin paths (`/logo.svg`) — not `//host` or `/\host`, which
 *     browsers resolve to another origin
 *   - base64 `data:` PNG / JPEG / WebP / GIF, size-capped
 *
 * Everything else (`http:`, `javascript:`, `data:image/svg+xml`, `blob:`,
 * bare relative paths) is refused and the chrome shows the text name alone.
 */

/** Stand-in origin for resolving paths without touching `window` (SSR-safe). */
const PROBE_ORIGIN = 'https://slate.invalid';

/** ~75 KB decoded. A 24px-tall mark needs far less, and every respondent downloads the schema. */
export const MAX_LOGO_DATA_URL_LENGTH = 100_000;

const DATA_IMAGE_URL = /^data:image\/(?:png|jpeg|webp|gif);base64,[a-z0-9+/]+={0,2}$/i;

export function safeLogoSrc(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (!value) return null;

  if (value.startsWith('/')) {
    // The URL parser folds `\` into `/` and drops tabs/newlines exactly as the
    // browser will for `src`, so an origin check here matches what loads.
    try {
      return new URL(value, PROBE_ORIGIN).origin === PROBE_ORIGIN ? value : null;
    } catch {
      return null;
    }
  }

  if (/^data:/i.test(value)) {
    return value.length <= MAX_LOGO_DATA_URL_LENGTH && DATA_IMAGE_URL.test(value) ? value : null;
  }

  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}
