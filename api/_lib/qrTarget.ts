/**
 * A dynamic QR code's destination (ADR-075 §7–8): the server's own copy of
 * the link rules, and the Google Web Risk lookup that every destination
 * passes before `set_qr_target` will store it.
 *
 * Web Risk, not Safe Browsing: Google's Safe Browsing API is "for
 * non-commercial use only" and deprecated, and points commercial products
 * here (checked 2026-11-04). `uris:search` is free for 100,000 calls a month,
 * then $0.50 per 1,000; one call per saved destination.
 */

/** The database's rule (025 qr_codes_target). */
const DB_TARGET_RE = /^https?:\/\/[^\s/?#@]+([/?#][^\s]*)?$/i;
export const QR_URL_MAX = 2048;

export function qrShortOrigin(): string {
  const raw = process.env.QR_SHORT_ORIGIN?.trim() || process.env.VITE_QR_SHORT_ORIGIN?.trim();
  return (raw || 'https://slateforms.vercel.app').replace(/\/$/, '');
}

/** The URL to store, or the plain sentence saying why not. */
export function checkTargetShape(raw: unknown): { url: string } | { problem: string } {
  if (typeof raw !== 'string' || !raw.trim())
    return { problem: 'Paste the link this code should open.' };
  const url = raw.trim();
  if (url.length > QR_URL_MAX) {
    return { problem: `Links can be at most ${QR_URL_MAX.toLocaleString('en-US')} characters.` };
  }
  if (!DB_TARGET_RE.test(url)) {
    return { problem: 'Use a web link that starts with https:// or http://, with no spaces.' };
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { problem: 'That doesn’t look like a web link.' };
  }
  if (parsed.username || parsed.password) {
    return { problem: 'Links can’t include a username or password.' };
  }
  try {
    const short = new URL(qrShortOrigin());
    if (
      parsed.host.toLowerCase() === short.host.toLowerCase() &&
      parsed.pathname.startsWith('/q/')
    ) {
      return { problem: 'A code can’t point at another Slate code. Paste the final link instead.' };
    }
  } catch {
    // A bad QR_SHORT_ORIGIN never blocks a save.
  }
  return { url };
}

export const WEB_RISK_THREATS = ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE'] as const;
const WEB_RISK_TIMEOUT_MS = 5_000;

export type WebRiskVerdict =
  | { kind: 'clean' }
  | { kind: 'flagged'; threats: string[] }
  | { kind: 'unavailable'; reason: string };

/**
 * One `uris:search` call. Anything but a clean or flagged answer is
 * 'unavailable', and the caller refuses the save (fail closed).
 */
export async function webRiskLookup(url: string): Promise<WebRiskVerdict> {
  const key = process.env.WEB_RISK_API_KEY?.trim();
  if (!key) return { kind: 'unavailable', reason: 'WEB_RISK_API_KEY is not set' };
  const qs = new URLSearchParams();
  for (const t of WEB_RISK_THREATS) qs.append('threatTypes', t);
  qs.set('uri', url);
  qs.set('key', key);
  let res: Response;
  try {
    res = await fetch(`https://webrisk.googleapis.com/v1/uris:search?${qs.toString()}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(WEB_RISK_TIMEOUT_MS),
    });
  } catch (err) {
    return { kind: 'unavailable', reason: err instanceof Error ? err.name : 'network' };
  }
  if (!res.ok) return { kind: 'unavailable', reason: `HTTP ${res.status}` };
  let body: { threat?: { threatTypes?: unknown } };
  try {
    body = (await res.json()) as typeof body;
  } catch {
    return { kind: 'unavailable', reason: 'not JSON' };
  }
  const threats = body.threat?.threatTypes;
  if (body.threat === undefined) return { kind: 'clean' };
  return {
    kind: 'flagged',
    threats: Array.isArray(threats)
      ? threats.filter((t): t is string => typeof t === 'string')
      : [],
  };
}
