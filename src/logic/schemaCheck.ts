/**
 * Schema sanity checker (roadmap Phase 6) — pure, no React. Catches authoring
 * mistakes that the type system can't: duplicate ids, `visibleIf` conditions
 * referencing unknown questions, and logic jumps targeting unknown ids or
 * the carrying question itself.
 *
 * The engine stays forgiving at runtime (dangling refs fall through to
 * normal flow); this is for builders/CI to surface problems early. Messages
 * are written for the form's owner: they name a question by its title (never
 * its internal id) and say what to do (QA 2026-10).
 */

import type { Condition, Question } from '@/types/Question.js';
import { OTHER_VALUE, allowsOther } from './other.js';
import { canPrefill, isValidPrefillKey } from './prefill.js';
import { IN_AREA_VALUE, OUT_OF_AREA_VALUE, checksArea, serviceAreaPrefixes } from './address.js';
import { geoCenter, geoRadiusKm } from './geo.js';
import { safeImageSrc, PIN_IMAGE_DATA_MAX } from '@/utils/brandLogo.js';
import { contactShown } from './contact.js';
import { PRICE_MAX } from './estimate.js';
import { isValidIsoDate, isValidTime } from './dateValue.js';

export type SchemaIssue = {
  /** The question carrying the problem. */
  questionId: string;
  kind:
    | 'duplicate_id'
    | 'dangling_condition'
    | 'dangling_jump'
    | 'self_jump'
    /** A condition asks for "Other" on a question that doesn't offer it (ADR-063). */
    | 'other_off'
    /** A prefill key is malformed, reserved, or used twice (ADR-063). */
    | 'bad_prefill_key'
    /** `min` is above `max` (number, scale, date): a number or date ignores both, a scale runs low to high. */
    | 'bad_bounds'
    /** A price is not a number, too large, or its high end is below its low end (ADR-064). */
    | 'bad_price'
    /** A condition asks for in / out of area on an address without a service area (ADR-064). */
    | 'area_off'
    /** A service-area entry isn't a ZIP code or prefix; a location center without a usable radius (ADR-064). */
    | 'bad_service_area'
    /** A contact block with every part turned off (ADR-064). */
    | 'no_fields'
    /** A pin question without a photo the engine will show (ADR-065). */
    | 'no_image'
    /** A photo checklist without any shots listed (ADR-065). */
    | 'no_items'
    /** An availability grid with days, times or a slot length it can't use (ADR-065). */
    | 'bad_grid'
    /** Swipe cards on a picture choice that isn't multi-select (ADR-065). */
    | 'swipe_single'
    /** A sign-up question with no slot it can offer (ADR-066). */
    | 'no_slots'
    /** A slot without a name, 1–1,000 spots, its own key or a real date and time; or over 50 slots (ADR-066). */
    | 'bad_slots';
  /** For the form's owner: names the question by its title and says what to do. */
  message: string;
};

type Leaf = Extract<Condition, { field: string }>;

/** A number's, a scale's or a date's limits (a date's are ISO strings, which compare in order). */
type Bounds = { min: number | string; max: number | string };

/** Every leaf of a condition, through `all` / `any`. */
function leaves(c: Condition): Leaf[] {
  return 'all' in c ? c.all.flatMap(leaves) : 'any' in c ? c.any.flatMap(leaves) : [c];
}

/** How the owner knows a question: its title in quotes, cut short. */
function named(q: Question, start = true): string {
  const t = typeof q.title == 'string' ? q.title.replace(/\s+/g, ' ').trim() : '';
  return t
    ? `“${t.length > 40 ? t.slice(0, 41).replace(/\s\S*$/, '') + '…' : t}”`
    : `${start ? 'A' : 'a'} question with no title`;
}

/** A price pair is usable: finite, within the cap, and high ≥ low. */
function badPrice(low: unknown, high: unknown): boolean {
  if (low === undefined && high === undefined) return false;
  // Number.isFinite is false for anything that isn't a number.
  const ok = (v: unknown) => Number.isFinite(v) && Math.abs(v as number) <= PRICE_MAX;
  if (!ok(low)) return true;
  if (high === undefined) return false;
  return !ok(high) || (high as number) < (low as number);
}

/** Validate a questions list. Returns an empty array when the schema is clean. */
export function checkSchema(questions: ReadonlyArray<Question>): SchemaIssue[] {
  const issues: SchemaIssue[] = [];
  const add = (q: Question, kind: SchemaIssue['kind'], message: string) =>
    issues.push({ questionId: q.id, kind, message });
  const byId = new Map<string, Question>();
  const dup = new Set<string>();

  for (const q of questions) {
    // One issue per id, however many share it.
    if (byId.has(q.id) && !dup.has(q.id)) {
      dup.add(q.id);
      add(q, 'duplicate_id', `${named(q)} and another question save to the same answer. Delete one and add it back.`);
    }
    byId.set(q.id, q);
  }

  const prefillKeys = new Map<string, Question>();
  for (const q of questions) {
    if (
      q.type === 'single_choice' ||
      q.type === 'multi_choice' ||
      q.type === 'dropdown' ||
      q.type === 'picture_choice'
    ) {
      const o = q.options.find((o) => badPrice(o.price, o.priceMax));
      if (o) add(q, 'bad_price', `${named(q)}: fix the price${o.label?.trim() ? ` on “${o.label.trim()}”` : ''}.`);
    }
    if (q.type === 'number' && badPrice(q.unitPrice, q.unitPriceMax)) {
      add(q, 'bad_price', `${named(q)}: fix the price per unit.`);
    }
    if (q.type === 'address' && Array.isArray(q.serviceArea)) {
      // Fewer usable prefixes than entries given: one of them isn't a ZIP.
      if (
        serviceAreaPrefixes(q.serviceArea).length <
        q.serviceArea.filter((z) => typeof z === 'string' && z.trim()).length
      ) {
        add(q, 'bad_service_area', `${named(q)} has a service area entry that isn’t a ZIP or postal code.`);
      }
    }
    if (q.type === 'image_pin' && safeImageSrc(q.image, PIN_IMAGE_DATA_MAX) === null) {
      add(q, 'no_image', `${named(q)} needs a photo to mark. Upload one or paste an https link.`);
    }
    if (q.type === 'photo_checklist' && !(q.items ?? []).some((i) => i.label?.trim())) {
      add(q, 'no_items', `${named(q)} has no photos to take. Add at least one.`);
    }
    if (q.type === 'availability') {
      // Mirrors logic/availability.ts (kept out of the engine's core, ADR-065).
      const mins = (t: string | undefined, d: number) => {
        if (t === undefined) return d;
        const m = /^(\d{2}):(\d{2})$/.exec(t);
        const v = m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
        return m && Number(m[2]) < 60 && v <= 1440 ? v : NaN;
      };
      const slot = q.slotMinutes ?? 60;
      if (
        (q.days ?? []).some((d) => !'mon tue wed thu fri sat sun'.split(' ').includes(d)) ||
        ![15, 30, 60, 120].includes(slot) ||
        !(mins(q.endTime, 1080) - mins(q.startTime, 480) >= slot)
      ) {
        // The studio's own controls can only get the hours wrong; imports can get any of them.
        add(q, 'bad_grid', `${named(q)} has days or hours the grid can’t use. Check From, Until and Each slot.`);
      }
    }
    if (q.type === 'location' && (q.center !== undefined || q.radius !== undefined)) {
      const rec = q as unknown as Record<string, unknown>;
      if (geoCenter(rec) === null || geoRadiusKm(rec) === null) {
        add(q, 'bad_service_area', `${named(q)}: set both your business location and a radius, or clear both.`);
      }
    }
    if (q.type === 'picture_choice' && q.display === 'swipe' && !q.multiple) {
      add(q, 'swipe_single', `${named(q)}: swipe cards need more than one pick. Choose Swipe cards again.`);
    }
    if (q.type === 'signup_slots') {
      // The rule of signupSlotsOf (logic/signup.ts, kept out of the core; a test checks they agree).
      const keys = new Set<string>();
      const list = Array.isArray(q.slots) ? q.slots : [];
      const usable = list.slice(0, 50).filter((x) => {
        const ok =
          /^[\w-]{1,64}$/.test(x.value) &&
          !keys.has(x.value) &&
          Number.isInteger(x.capacity) &&
          x.capacity >= 1 &&
          x.capacity <= 1000;
        if (ok) keys.add(x.value);
        return ok;
      }).length;
      const bad =
        usable < list.length ||
        list.some(
          (x) =>
            !(x.label?.trim() || x.date) ||
            (x.date !== undefined && !isValidIsoDate(x.date)) ||
            [x.start, x.end].some((t) => t !== undefined && !isValidTime(t)),
        );
      if (!usable) add(q, 'no_slots', `${named(q)} has no slots. Add one with a name and its spots.`);
      else if (bad) {
        add(q, 'bad_slots', `${named(q)} has a slot to fix: each needs a name, 1 to 1,000 spots and a real day and time.`);
      }
    }
    if (q.type === 'contact_info' && !contactShown(q).length) {
      add(q, 'no_fields', `${named(q)} asks for nothing. Turn on name, email or phone.`);
    }
    const key = (q as { prefillKey?: string }).prefillKey?.trim();
    if (key && canPrefill(q)) {
      const lower = key.toLowerCase();
      const other = prefillKeys.get(lower);
      if (!isValidPrefillKey(key)) {
        add(q, 'bad_prefill_key', `${named(q)} has a link name that can’t be used. Fix it under Fill from link.`);
      } else if (other) {
        add(q, 'bad_prefill_key', `${named(q)} and ${named(other, false)} use the same link name, “${key}”. Rename one.`);
      } else {
        prefillKeys.set(lower, q);
      }
    }
    // What the engine does with bounds set the wrong way round (ADR-069): a number or
    // date ignores both, a scale runs from the lower to the higher. A missing bound
    // compares false either way, so there's no check for undefined.
    if (
      (q.type === 'number' || q.type === 'scale' || q.type === 'date') &&
      (q as Bounds).min > (q as Bounds).max
    ) {
      add(q, 'bad_bounds', `${named(q)} has a minimum above its maximum, so ${q.type == 'scale' ? 'it runs low to high' : 'neither is used'}. Swap them.`);
    }
  }

  for (const q of questions) {
    const rules: Array<[Condition, string]> = [];
    if ('visibleIf' in q && q.visibleIf) rules.push([q.visibleIf, 'When to show']);
    for (const rule of ('logic' in q && q.logic) || []) rules.push([rule.if, 'Skip ahead']);
    for (const [c, where] of rules) {
      for (const leaf of leaves(c)) {
        const target = byId.get(leaf.field);
        const values = 'value' in leaf ? [leaf.value].flat() : [];
        if (!target) {
          add(q, 'dangling_condition', `${named(q)} has a “${where}” rule that uses a deleted question. Change or remove it.`);
        } else if (values.includes(OTHER_VALUE) && !allowsOther(target)) {
          add(q, 'other_off', `${named(q)} has a rule about “Other” on ${named(target, false)}, but that choice is off.`);
        } else if (
          (values.includes(IN_AREA_VALUE) || values.includes(OUT_OF_AREA_VALUE)) &&
          !checksArea(target, questions)
        ) {
          add(q, 'area_off', `${named(q)} has a rule about the service area on ${named(target, false)}, which has none set up.`);
        }
      }
    }
    for (const rule of ('logic' in q && q.logic) || []) {
      if (!byId.has(rule.goTo)) {
        add(q, 'dangling_jump', `${named(q)} skips to a deleted question. Pick a new place to skip to.`);
      } else if (rule.goTo === q.id) {
        add(q, 'self_jump', `${named(q)} skips to itself. Pick a new place to skip to.`);
      }
    }
  }

  return issues;
}
