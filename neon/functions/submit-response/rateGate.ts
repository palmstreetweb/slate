/**
 * Rate-limit helpers for the public Functions (ADR-058). Identical copy lives
 * in storage-sign (each Function deploys from its own folder).
 */

import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import { NO_IP } from './requestIp.js';

export type Bucket = { key: string; win: number; max: number; cost?: number };
export type Verdict =
  | { ok: true; schema?: unknown }
  | { ok: false; index: number; retryAfter: number };

/** An integer env value in 1..hi, else the default ('' → 0 and 'abc' → NaN used to slip through). */
export function intEnv(name: string, dflt: number, hi = 1_000_000): number {
  const v = Number(process.env[name]);
  return Number.isInteger(v) && v >= 1 && v <= hi ? v : dflt;
}

/** The form owner's id as a key part: as stored when it is a plain id, else a short hash. */
export function ownerKey(id: unknown): string {
  if (typeof id !== 'string' || id === '') return 'none';
  return /^[A-Za-z0-9_-]{1,64}$/.test(id)
    ? id
    : `h${createHash('sha256').update(id).digest('hex').slice(0, 32)}`;
}

/** Requests without a client IP share one key at a tenth of every limit (fail closed). */
export const ipMax = (ip: string, max: number): number =>
  ip === NO_IP ? Math.max(1, Math.floor(max / 10)) : max;

/** Size charge: ceil(bytes / unit), at least 1. */
export const units = (bytes: number, unit: number): number => Math.max(1, Math.ceil(bytes / unit));

/** "about N minutes" for 429 copy. */
export function aboutMinutes(s: number): string {
  const m = Math.max(1, Math.ceil(s / 60));
  return `about ${m} minute${m === 1 ? '' : 's'}`;
}

const RATE_SQL = `select r.allowed, r.denied_index, r.retry_after_seconds
  from public.consume_submit_rates($1::text[], $2::int[], $3::int[], $4::int[]) r`;
const RATE_SCHEMA_SQL = `select r.allowed, r.denied_index, r.retry_after_seconds,
    (select f.published_schema from public.forms f where r.allowed and f.id = $5) as published_schema
  from public.consume_submit_rates($1::text[], $2::int[], $3::int[], $4::int[]) r`;

/**
 * One statement: every bucket charged, or none (016). A denial writes nothing.
 * With schemaOf, the same statement returns that form's published_schema, read
 * only when the charge went through. Throws on a malformed result (callers 503).
 */
export async function charge(pool: Pool, b: Bucket[], schemaOf?: string): Promise<Verdict> {
  const params: unknown[] = [
    b.map((x) => x.key),
    b.map((x) => x.win),
    b.map((x) => x.max),
    b.map((x) => x.cost ?? 1),
  ];
  if (schemaOf !== undefined) params.push(schemaOf);
  const r = (await pool.query(schemaOf === undefined ? RATE_SQL : RATE_SCHEMA_SQL, params))
    .rows[0] as
    | {
        allowed?: unknown;
        denied_index?: unknown;
        retry_after_seconds?: unknown;
        published_schema?: unknown;
      }
    | undefined;
  if (!r || typeof r.allowed !== 'boolean') throw new Error('rate: bad result');
  if (r.allowed) return { ok: true, schema: r.published_schema };
  const index = Number(r.denied_index) - 1;
  if (!Number.isInteger(index) || index < 0 || index >= b.length) {
    throw new Error('rate: bad index');
  }
  return { ok: false, index, retryAfter: Math.max(1, Number(r.retry_after_seconds) || 60) };
}
