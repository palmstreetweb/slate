/**
 * Answer shape guard for the public submit Function. Mirrors
 * examples/_admin/answerShape.ts, which re-checks every row on load.
 */

import { SIG_TYPED_MAX, parseSignaturePathCore } from './signature.js';
import { locationStoredCore } from './geo.js';
import { pinAnswerCore } from './pins.js';
import { availabilityAnswerCore } from './availability.js';
import { signupAnswerCore } from './signup.js';

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

/** Contact parts and their caps (ADR-064). Mirrors src/logic/contact.ts CONTACT_MAX. */
export const CONTACT_PART_MAX: Record<string, number> = { name: 120, email: 254, phone: 40 };
/** Address parts and their caps (ADR-064). Mirrors src/logic/address.ts ADDRESS_MAX. */
export const ADDRESS_PART_MAX: Record<string, number> = {
  street: 200,
  line2: 120,
  city: 100,
  region: 100,
  postal: 20,
  country: 80,
};

/** Known parts only, trimmed, each capped; undefined when nothing is left. */
function clampParts(
  v: unknown,
  limits: Record<string, number>,
): Record<string, string> | undefined {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const out: Record<string, string> = {};
  for (const [key, max] of Object.entries(limits)) {
    const raw = (v as Record<string, unknown>)[key];
    if (typeof raw !== 'string') continue;
    const t = raw.trim();
    if (t) out[key] = t.slice(0, max);
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * A signature (ADR-064): `{ path }` only when the path parses exactly as the
 * engine writes it, or `{ typed }` (a typed name, capped) unless the owner
 * turned typing off. Anything else is dropped.
 */
function clampSignature(
  q: Record<string, unknown>,
  v: unknown,
): Record<string, string> | undefined {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const a = v as Record<string, unknown>;
  if (typeof a.path === 'string') {
    return parseSignaturePathCore(a.path) ? { path: a.path } : undefined;
  }
  if (typeof a.typed === 'string' && q.allowTyped !== false) {
    const t = a.typed.trim();
    return t ? { typed: t.slice(0, SIG_TYPED_MAX) } : undefined;
  }
  return undefined;
}

/** Voice notes (ADR-065). Mirrors src/logic/media.ts. */
export const VOICE_TYPED_MAX = 1000;
const VOICE_SECONDS_MAX = 300;

/** This form's own storage ref, or undefined (the file-answer rule, ADR-058). */
function ownRef(v: unknown, formId: string | undefined): string | undefined {
  if (typeof v !== 'string' || !formId) return undefined;
  return STORAGE_REF_RE.exec(v)?.[1] === formId ? v : undefined;
}

/**
 * A voice note (ADR-065): `{ audio, sec? }` with this form's own storage ref
 * and a whole number of seconds up to the question's cap, or `{ typed }`
 * unless the owner turned typing off.
 */
function clampVoice(
  q: Record<string, unknown>,
  v: unknown,
  formId: string | undefined,
): Record<string, string> | undefined {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const a = v as Record<string, unknown>;
  const audio = ownRef(a.audio, formId);
  if (audio) {
    const cap =
      typeof q.maxSeconds === 'number' && Number.isFinite(q.maxSeconds)
        ? Math.min(VOICE_SECONDS_MAX, Math.max(5, Math.round(q.maxSeconds)))
        : 60;
    const sec = typeof a.sec === 'string' && /^\d{1,4}$/.test(a.sec) ? Number(a.sec) : NaN;
    return Number.isFinite(sec) && sec >= 1
      ? { audio, sec: String(Math.min(sec, cap)) }
      : { audio };
  }
  if (typeof a.typed === 'string' && q.allowTyped !== false) {
    const t = a.typed.trim();
    return t ? { typed: t.slice(0, VOICE_TYPED_MAX) } : undefined;
  }
  return undefined;
}

/**
 * A photo checklist (ADR-065): only the published items, each with this
 * form's own storage ref (one photo per item).
 */
function clampPhotos(
  q: Record<string, unknown>,
  v: unknown,
  formId: string | undefined,
): Record<string, string> | undefined {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const items = (Array.isArray(q.items) ? q.items : [])
    .map((o) => (o && typeof o === 'object' ? (o as { value?: unknown }).value : undefined))
    .filter((x): x is string => typeof x === 'string' && isSafeKey(x));
  const out: Record<string, string> = {};
  for (const item of items.slice(0, 50)) {
    const ref = ownRef((v as Record<string, unknown>)[item], formId);
    if (ref) out[item.slice(0, 64)] = ref;
  }
  return Object.keys(out).length ? out : undefined;
}

/** What `clampForQuestion` needs to know about the form beyond the question itself. */
export type ClampContext = {
  /** The form's id: file-like answers keep only its own storage refs. */
  formId?: string;
  /** Every ZIP prefix the published address questions serve (a ZIP typed on a location). */
  zipAreas?: ReadonlyArray<string>;
};

/**
 * Per-type shapes for the question kinds whose answer shape ADR-063 widened
 * or pinned down. Lenient on purpose — a respondent whose page has an older
 * published schema must not lose a real answer — so it only trims what the
 * engine never sends:
 *   - number / scale / nps: a finite number (numeric text becomes a number);
 *   - date: a string of at most 40 characters;
 *   - choices with `allowOther`: typed text (anything that isn't an option
 *     value) is capped at 500 characters, and a list keeps one typed entry;
 *   - contact_info / address (ADR-064): known parts only, trimmed and capped;
 *   - signature (ADR-064): a path the engine could have written, or a typed name;
 *   - image_pin / location / availability (ADR-065): re-derived from the
 *     published question by the engine's own shared code (pins in range and
 *     under the limit; coordinates re-rounded and in / out recomputed; slots
 *     re-encoded on the grid); a location then keeps only its verdict,
 *     `{ area?, via }`, unless the question has `keepLocation: true` (ADR-068);
 *   - voice_note / photo_checklist (ADR-065): this form's own storage refs only;
 *   - signup_slots (ADR-066): the engine's canonical answer — published slot
 *     values only, each once, at most the question's picks, waitlists only when
 *     it has one. Spots are taken by the insert itself (migration 020).
 * Everything else goes through `clampValue` as before.
 */
export function clampForQuestion(
  q: Record<string, unknown>,
  v: unknown,
  ctx: ClampContext = {},
): unknown {
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
    case 'contact_info':
      return clampParts(v, CONTACT_PART_MAX);
    case 'address':
      return clampParts(v, ADDRESS_PART_MAX);
    case 'signature':
      return clampSignature(q, v);
    case 'image_pin':
      return pinAnswerCore(q, v);
    case 'location':
      // Checked, then only the verdict kept unless the owner kept the location (ADR-068).
      return locationStoredCore(q, v, ctx.zipAreas ?? []);
    case 'availability':
      return availabilityAnswerCore(q, v);
    case 'voice_note':
      return clampVoice(q, v, ctx.formId);
    case 'photo_checklist':
      return clampPhotos(q, v, ctx.formId);
    case 'signup_slots':
      return signupAnswerCore(q, v);
    default:
      return clampValue(v);
  }
}
