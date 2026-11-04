/**
 * `GET ?op=qr&code=&count=` (ADR-075 §5–6): where a dynamic QR code goes,
 * asked by the Vercel edge redirect (`api/q.ts`) on every scan.
 *
 * Only the edge may ask: it sends `x-slate-edge-key` (QR_EDGE_KEY, compared
 * in constant time), and only then is its `x-slate-client-ip` trusted for the
 * per-network scan cap. Without the key the Function answers 403 and touches
 * nothing; a wrong key is the same 403, so the header is no oracle.
 *
 * `record_qr_scan` (025) never refuses a code that exists: the cap decides
 * only whether this scan is counted, so a printed code always opens.
 */

import { createHash, timingSafeEqual } from 'node:crypto';
import type { Pool } from 'pg';
import { NO_IP, rateKeyForIp } from './requestIp.js';

/** 025 qr_codes_code_shape: 8 of `abcdefghjkmnpqrstuvwxyz23456789`. */
export const QR_CODE_RE = /^[a-hjkmnp-z2-9]{8}$/;

export type QrScanStatus = 'ok' | 'inactive' | 'not_found';

export type QrScanResult =
  | { kind: 'forbidden' }
  | { kind: 'unavailable' }
  | { kind: 'answer'; status: QrScanStatus; target: string | null; counted: boolean };

function digest(s: string): Buffer {
  return createHash('sha256').update(s, 'utf8').digest();
}

/** True only for the configured key; an unset key refuses everyone (fail closed). */
export function isEdgeKey(sent: string | undefined, expected: string | undefined): boolean {
  if (!expected || expected.length < 32 || !sent) return false;
  return timingSafeEqual(digest(sent), digest(expected));
}

export async function qrScan(
  pool: Pick<Pool, 'query'>,
  input: {
    code: string;
    count: boolean;
    edgeKey: string | undefined;
    clientIp: string | undefined;
  },
): Promise<QrScanResult> {
  if (!isEdgeKey(input.edgeKey, process.env.QR_EDGE_KEY)) return { kind: 'forbidden' };

  const code = input.code.trim().toLowerCase();
  // Malformed: no database read, the same answer as an unknown code.
  if (!QR_CODE_RE.test(code)) {
    return { kind: 'answer', status: 'not_found', target: null, counted: false };
  }
  const ip = input.clientIp?.trim() ? rateKeyForIp(input.clientIp) : NO_IP;
  // A scan with no client IP still opens; it just isn't counted (no key to cap it on).
  const count = input.count && ip !== NO_IP;

  try {
    const { rows } = await pool.query<{
      status: string;
      target_url: string | null;
      counted: boolean | null;
    }>('select status, target_url, counted from public.record_qr_scan($1, $2, $3)', [
      code,
      count ? ip : null,
      count,
    ]);
    const row = rows[0];
    const status: QrScanStatus =
      row?.status === 'ok' || row?.status === 'inactive' ? row.status : 'not_found';
    // The database checks targets on write (025); a bad one here is treated as inactive.
    const target =
      status === 'ok' && typeof row?.target_url === 'string' && /^https?:\/\//i.test(row.target_url)
        ? row.target_url
        : null;
    if (status === 'ok' && !target) {
      return { kind: 'answer', status: 'inactive', target: null, counted: false };
    }
    return { kind: 'answer', status, target, counted: row?.counted === true };
  } catch (err) {
    console.error('[submitresponse] qr scan failed', String(err).slice(0, 200));
    return { kind: 'unavailable' };
  }
}
