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

/** slate-file://storage:{public|draft}/{formId}/{uuid}/{name}, as uploadToNeonStorage builds it. */
const STORAGE_REF_RE =
  /^slate-file:[/][/]storage:(?:public|draft)[/]([A-Za-z0-9_-]{4,64})[/][0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[/][^/]{1,120}$/;

/**
 * File answers keep only this form's own storage refs (ADR-058, file-fanout-dos):
 * deduplicated, capped at the question's maxFiles (default 10, at most 100), and
 * a single ref when `multiple: false`. Other forms' refs, URLs, local refs and
 * non-strings are dropped, so a crafted response can't make the owner's studio
 * fetch hundreds of objects. draft/ stays: old tabs and the stored refs use it.
 */
export function keepFileRefs(
  v: unknown,
  formId: string,
  q: { multiple?: unknown; maxFiles?: unknown },
): string | string[] | undefined {
  const items = (Array.isArray(v) ? v.slice(0, MAX_ARRAY_ITEMS) : [v]).filter(
    (x): x is string => typeof x === 'string',
  );
  const refs = [...new Set(items.filter((x) => STORAGE_REF_RE.exec(x)?.[1] === formId))];
  if (q.multiple === false) return refs[0];
  const cap =
    typeof q.maxFiles === 'number' && Number.isFinite(q.maxFiles) && q.maxFiles >= 1
      ? Math.min(Math.floor(q.maxFiles), MAX_ARRAY_ITEMS)
      : 10;
  return refs.length ? refs.slice(0, cap) : undefined;
}

/** Typed "Other" answers on choice questions (ADR-063). Mirrors src/logic/other.ts OTHER_MAX. */
export const OTHER_MAX = 500;
/** The longest date answer the engine writes: `YYYY-MM-DDTHH:MM/YYYY-MM-DDTHH:MM` (ADR-063). */
const DATE_MAX = 40;

const optionValues = (q: Record<string, unknown>): Set<string> =>
  new Set(
    (Array.isArray(q.options) ? q.options : [])
      .map((o) => (o && typeof o === 'object' ? (o as { value?: unknown }).value : undefined))
      .filter((v): v is string => typeof v === 'string'),
  );

/**
 * Per-type shapes for the question kinds whose answer shape ADR-063 widened
 * or pinned down. Lenient on purpose — a respondent whose page has an older
 * published schema must not lose a real answer — so it only trims what the
 * engine never sends:
 *   - number / scale / nps: a finite number (numeric text becomes a number);
 *   - date: a string of at most 40 characters;
 *   - choices with `allowOther`: typed text (anything that isn't an option
 *     value) is capped at 500 characters, and a list keeps one typed entry.
 * Everything else goes through `clampValue` as before.
 */
export function clampForQuestion(q: Record<string, unknown>, v: unknown): unknown {
  switch (q.type) {
    case 'number':
    case 'scale':
    case 'nps': {
      if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
      if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim())) return Number(v.trim());
      return undefined;
    }
    case 'date':
      return typeof v === 'string' && v.length <= DATE_MAX ? v : undefined;
    case 'single_choice':
    case 'dropdown':
    case 'multi_choice':
    case 'picture_choice': {
      const c = clampValue(v);
      if (q.allowOther !== true) return c;
      const values = optionValues(q);
      if (typeof c === 'string') return values.has(c) ? c : c.slice(0, OTHER_MAX);
      if (Array.isArray(c)) {
        const out: string[] = [];
        let typed = false;
        for (const item of c as string[]) {
          if (values.has(item)) out.push(item);
          else if (!typed) {
            typed = true;
            out.push(item.slice(0, OTHER_MAX));
          }
        }
        return out;
      }
      return c;
    }
    default:
      return clampValue(v);
  }
}
