/**
 * Client IP for rate-limit keys. Identical copy lives in storage-sign.
 *
 * `X-Forwarded-For` is append-only: proxies add the peer they saw to the END,
 * so the LEFTMOST entry is whatever the client typed. Verified against the
 * live Function: spoofing the first entry bypassed every limit. Use the last
 * entry, which the nearest proxy wrote and the client cannot control.
 */
export function clientIp(header: (name: string) => string | undefined): string {
  const forwarded = header('x-forwarded-for');
  if (forwarded) {
    const parts = forwarded
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const last = parts[parts.length - 1];
    if (last) return last.slice(0, 64);
  }
  const real = header('x-real-ip') || header('cf-connecting-ip') || header('true-client-ip');
  if (real?.trim()) return real.trim().slice(0, 64);
  return 'unknown';
}
