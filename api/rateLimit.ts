/** In-memory sliding window. Fine for a single serverless instance (ADR-039). */

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 10;

const hits = new Map<string, number[]>();

export function clientIp(request: Request): string {
  // Rightmost X-Forwarded-For entry: written by the edge, not by the client.
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const parts = forwarded
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const last = parts[parts.length - 1];
    if (last) return last;
  }
  return request.headers.get('x-real-ip')?.trim() || 'local';
}

export function takeRateLimit(ip: string, now = Date.now()): boolean {
  const next = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (next.length >= MAX_PER_WINDOW) {
    hits.set(ip, next);
    return false;
  }
  next.push(now);
  hits.set(ip, next);
  return true;
}

/** Test-only. */
export function resetRateLimit(): void {
  hits.clear();
}
