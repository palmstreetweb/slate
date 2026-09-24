/**
 * Answer shape guard for the public submit Function. Mirrors
 * examples/_admin/answerShape.ts, which re-checks every row on load.
 */

const MAX_STRING_CHARS = 10_000;
const MAX_ARRAY_ITEMS = 100;

/**
 * Clamp one answer to a shape the studio renders (audit H1):
 *   string · finite number · boolean · string[] · Record<string, string | string[]>
 * Array items and matrix cells must be scalars (numbers/booleans become text).
 * Nested objects, and keys that shadow Object.prototype (`toString`,
 * `__proto__`, …), are dropped — one such value used to white-screen the studio.
 */
export function clampText(v: unknown): string | undefined {
  if (typeof v === 'string') return v.length > MAX_STRING_CHARS ? v.slice(0, MAX_STRING_CHARS) : v;
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : undefined;
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return undefined;
}

function clampList(v: unknown[]): string[] {
  const out: string[] = [];
  for (const item of v.slice(0, MAX_ARRAY_ITEMS)) {
    const t = clampText(item);
    if (t !== undefined) out.push(t);
  }
  return out;
}

export function isSafeKey(k: string): boolean {
  return k.length > 0 && !(k in Object.prototype);
}

export function clampValue(v: unknown): unknown {
  if (v == null) return undefined;
  if (typeof v === 'string') return clampText(v);
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'boolean') return v;
  if (Array.isArray(v)) return clampList(v);
  if (typeof v === 'object') {
    const out: Record<string, string | string[]> = {};
    for (const [k, cell] of Object.entries(v as Record<string, unknown>).slice(0, 20)) {
      if (!isSafeKey(k)) continue;
      const c = Array.isArray(cell) ? clampList(cell) : clampText(cell);
      if (c !== undefined) out[k.slice(0, 64)] = c;
    }
    return out;
  }
  return undefined;
}
