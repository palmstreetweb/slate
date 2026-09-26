/**
 * Client IP for rate-limit keys (ADR-046, ADR-058). Identical copy lives in submit-response.
 *
 * `X-Forwarded-For` is append-only: proxies add the peer they saw to the END,
 * so the LEFTMOST entry is whatever the client typed. Verified against the
 * live Function: spoofing the first entry bypassed every limit. Use the last
 * entry, which the nearest proxy wrote and the client cannot control.
 *
 * X-Real-IP, CF-Connecting-IP and True-Client-IP are not trusted: nothing on
 * Neon's path writes them, so a client can type any value. A request without
 * X-Forwarded-For shares the 'noip' key, which rateGate runs at a tenth of
 * every limit (fail closed), and logs loudly at most once a minute.
 */

import { isIPv4, isIPv6 } from 'node:net';

export const NO_IP = 'noip';

let warnedAt = 0;

export function clientIp(header: (name: string) => string | undefined): string {
  const parts = (header('x-forwarded-for') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const last = parts[parts.length - 1];
  if (!last) {
    if (Date.now() - warnedAt > 60_000) {
      warnedAt = Date.now();
      console.error(
        '[rate] no X-Forwarded-For: these requests share the noip bucket at 1/10 limits',
      );
    }
    return NO_IP;
  }
  return rateKeyForIp(last);
}

/**
 * One key per client network: IPv4 as-is (port stripped), IPv6 grouped by /64
 * (a placeholder: the Function hosts are IPv4-only today), ::ffff:a.b.c.d as
 * IPv4. Anything else is 'raw:' plus at most 64 safe characters.
 */
export function rateKeyForIp(raw: string): string {
  let s = raw.trim();
  if (s.startsWith('[')) {
    const end = s.indexOf(']');
    s = s.slice(1, end > 0 ? end : undefined);
  }
  const v4port = /^([0-9]{1,3}(?:[.][0-9]{1,3}){3}):[0-9]+$/.exec(s);
  if (v4port) s = v4port[1]!;
  s = s.split('%')[0]!;
  if (isIPv4(s)) return s;
  if (isIPv6(s)) {
    const mapped = /^::ffff:([0-9.]+)$/i.exec(s);
    if (mapped && isIPv4(mapped[1]!)) return mapped[1]!;
    const [head, tail] = s.split('::');
    const h = head ? head.split(':') : [];
    const t = tail ? tail.split(':') : [];
    const groups =
      tail === undefined
        ? h
        : [...h, ...Array<string>(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t];
    return (
      groups
        .slice(0, 4)
        .map((x) => parseInt(x, 16).toString(16))
        .join(':') + '::/64'
    );
  }
  const safe = s.replace(/[^0-9A-Za-z.:_-]/g, '').slice(0, 64);
  return safe ? `raw:${safe}` : NO_IP;
}
