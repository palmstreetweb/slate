/**
 * Schema sanity checker (roadmap Phase 6) — pure, no React. Catches authoring
 * mistakes that the type system can't: duplicate ids, `visibleIf` conditions
 * referencing unknown questions, and logic jumps targeting unknown ids or
 * the carrying question itself.
 *
 * The engine stays forgiving at runtime (dangling refs fall through to
 * normal flow); this is for builders/CI to surface problems early.
 */

import type { Condition, Question } from '@/types/Question.js';
import { OTHER_VALUE, allowsOther } from './other.js';
import { canPrefill, isValidPrefillKey } from './prefill.js';
import { IN_AREA_VALUE, OUT_OF_AREA_VALUE, checksArea, serviceAreaPrefixes } from './address.js';
import { geoCenter, geoRadiusKm } from './geo.js';
import { safeImageSrc, PIN_IMAGE_DATA_MAX } from '@/utils/brandLogo.js';
import { contactShown } from './contact.js';
import { PRICE_MAX } from './estimate.js';

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
    /** `min` is above `max` (number, scale, date). */
    | 'bad_bounds'
    /** A price is not a number, too large, or its high end is below its low end (ADR-064). */
    | 'bad_price'
    /** A condition asks for in / out of area on an address without a service area (ADR-064). */
    | 'area_off'
    /** A service-area entry isn't a ZIP code or prefix (ADR-064). */
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
    | 'swipe_single';
  message: string;
};

function conditionFields(c: Condition): string[] {
  if ('all' in c) return c.all.flatMap(conditionFields);
  if ('any' in c) return c.any.flatMap(conditionFields);
  return [c.field];
}

/** Fields whose leaf condition targets OTHER_VALUE. */
function otherFields(c: Condition): string[] {
  if ('all' in c) return c.all.flatMap(otherFields);
  if ('any' in c) return c.any.flatMap(otherFields);
  if (!('value' in c)) return [];
  const values = Array.isArray(c.value) ? c.value : [c.value];
  return values.includes(OTHER_VALUE) ? [c.field] : [];
}

/** Fields whose leaf condition targets IN_AREA_VALUE / OUT_OF_AREA_VALUE. */
function areaFields(c: Condition): string[] {
  if ('all' in c) return c.all.flatMap(areaFields);
  if ('any' in c) return c.any.flatMap(areaFields);
  if (!('value' in c)) return [];
  const values = Array.isArray(c.value) ? c.value : [c.value];
  return values.includes(IN_AREA_VALUE) || values.includes(OUT_OF_AREA_VALUE) ? [c.field] : [];
}

/** A price pair is usable: finite, within the cap, and high ≥ low. */
function badPrice(low: unknown, high: unknown): boolean {
  if (low === undefined && high === undefined) return false;
  const ok = (v: unknown) =>
    typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= PRICE_MAX;
  if (!ok(low)) return true;
  if (high === undefined) return false;
  return !ok(high) || (high as number) < (low as number);
}

/** Validate a questions list. Returns an empty array when the schema is clean. */
export function checkSchema(questions: ReadonlyArray<Question>): SchemaIssue[] {
  const issues: SchemaIssue[] = [];
  const ids = new Set<string>();
  const seenDuplicates = new Set<string>();

  for (const q of questions) {
    if (ids.has(q.id) && !seenDuplicates.has(q.id)) {
      seenDuplicates.add(q.id);
      issues.push({
        questionId: q.id,
        kind: 'duplicate_id',
        message: `Duplicate question id "${q.id}"`,
      });
    }
    ids.add(q.id);
  }

  const byId = new Map(questions.map((q) => [q.id, q] as const));
  const checkOther = (q: Question, c: Condition) => {
    for (const field of otherFields(c)) {
      const target = byId.get(field);
      if (target && !allowsOther(target)) {
        issues.push({
          questionId: q.id,
          kind: 'other_off',
          message: `"${q.id}" checks for Other on "${field}", which has no Other choice`,
        });
      }
    }
  };

  const checkArea = (q: Question, c: Condition) => {
    for (const field of areaFields(c)) {
      const target = byId.get(field);
      if (target && !checksArea(target, questions)) {
        issues.push({
          questionId: q.id,
          kind: 'area_off',
          message:
            target.type === 'location'
              ? `"${q.id}" checks the service area of "${field}", which has no center and radius`
              : `"${q.id}" checks the service area of "${field}", which doesn't list any ZIP codes`,
        });
      }
    }
  };

  const prefillKeys = new Map<string, string>();
  for (const q of questions) {
    if (
      (q.type === 'single_choice' ||
        q.type === 'multi_choice' ||
        q.type === 'dropdown' ||
        q.type === 'picture_choice') &&
      q.options.some((o) => badPrice(o.price, o.priceMax))
    ) {
      issues.push({
        questionId: q.id,
        kind: 'bad_price',
        message: `"${q.id}" has a price that isn't a number, is too large, or ends below where it starts`,
      });
    }
    if (q.type === 'number' && badPrice(q.unitPrice, q.unitPriceMax)) {
      issues.push({
        questionId: q.id,
        kind: 'bad_price',
        message: `"${q.id}" has a price per unit that isn't a number, is too large, or ends below where it starts`,
      });
    }
    if (q.type === 'address' && Array.isArray(q.serviceArea)) {
      const kept = serviceAreaPrefixes(q.serviceArea).length;
      const given = q.serviceArea.filter((z) => typeof z === 'string' && z.trim()).length;
      if (kept < given) {
        issues.push({
          questionId: q.id,
          kind: 'bad_service_area',
          message: `"${q.id}" lists a service area entry that isn't a ZIP code or prefix`,
        });
      }
    }
    if (q.type === 'image_pin' && safeImageSrc(q.image, PIN_IMAGE_DATA_MAX) === null) {
      issues.push({
        questionId: q.id,
        kind: 'no_image',
        message: `"${q.id}" has no photo to mark — add one (an upload or an https image link)`,
      });
    }
    if (q.type === 'photo_checklist' && !(q.items ?? []).some((i) => i.label?.trim())) {
      issues.push({
        questionId: q.id,
        kind: 'no_items',
        message: `"${q.id}" lists no photos to take`,
      });
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
        issues.push({
          questionId: q.id,
          kind: 'bad_grid',
          message: `"${q.id}" has days, times or a slot length the grid can't use`,
        });
      }
    }
    if (q.type === 'location' && (q.center !== undefined || q.radius !== undefined)) {
      const rec = q as unknown as Record<string, unknown>;
      if (geoCenter(rec) === null || geoRadiusKm(rec) === null) {
        issues.push({
          questionId: q.id,
          kind: 'bad_service_area',
          message: `"${q.id}" needs both a center (latitude, longitude) and a radius to check the service area`,
        });
      }
    }
    if (q.type === 'picture_choice' && q.display === 'swipe' && !q.multiple) {
      issues.push({
        questionId: q.id,
        kind: 'swipe_single',
        message: `"${q.id}" uses swipe cards, which need "Allow multiple selections" on`,
      });
    }
    if (q.type === 'contact_info' && contactShown(q).length === 0) {
      issues.push({
        questionId: q.id,
        kind: 'no_fields',
        message: `"${q.id}" asks for no contact details — turn on name, email or phone`,
      });
    }
    const key = (q as { prefillKey?: string }).prefillKey?.trim();
    if (key && canPrefill(q)) {
      const lower = key.toLowerCase();
      if (!isValidPrefillKey(key)) {
        issues.push({
          questionId: q.id,
          kind: 'bad_prefill_key',
          message: `"${q.id}" has a link name "${key}" that can't be used (letters, numbers, - and _; not src, embed or utm_…)`,
        });
      } else if (prefillKeys.has(lower)) {
        issues.push({
          questionId: q.id,
          kind: 'bad_prefill_key',
          message: `"${q.id}" and "${prefillKeys.get(lower)}" share the link name "${key}"`,
        });
      } else {
        prefillKeys.set(lower, q.id);
      }
    }
    if (q.type === 'number' || q.type === 'scale' || q.type === 'date') {
      const { min, max } = q as { min?: number | string; max?: number | string };
      if (min !== undefined && max !== undefined && min > max) {
        issues.push({
          questionId: q.id,
          kind: 'bad_bounds',
          message: `"${q.id}" has a minimum above its maximum`,
        });
      }
    }
  }

  for (const q of questions) {
    if ('visibleIf' in q && q.visibleIf) checkOther(q, q.visibleIf);
    if ('logic' in q && q.logic) for (const rule of q.logic) checkOther(q, rule.if);
    if ('visibleIf' in q && q.visibleIf) checkArea(q, q.visibleIf);
    if ('logic' in q && q.logic) for (const rule of q.logic) checkArea(q, rule.if);
    if ('visibleIf' in q && q.visibleIf) {
      for (const field of conditionFields(q.visibleIf)) {
        if (!ids.has(field)) {
          issues.push({
            questionId: q.id,
            kind: 'dangling_condition',
            message: `"${q.id}" has a visibleIf referencing unknown question "${field}"`,
          });
        }
      }
    }

    if ('logic' in q && q.logic) {
      for (const rule of q.logic) {
        for (const field of conditionFields(rule.if)) {
          if (!ids.has(field)) {
            issues.push({
              questionId: q.id,
              kind: 'dangling_condition',
              message: `"${q.id}" has a jump condition referencing unknown question "${field}"`,
            });
          }
        }
        if (!ids.has(rule.goTo)) {
          issues.push({
            questionId: q.id,
            kind: 'dangling_jump',
            message: `"${q.id}" jumps to unknown question "${rule.goTo}"`,
          });
        } else if (rule.goTo === q.id) {
          issues.push({
            questionId: q.id,
            kind: 'self_jump',
            message: `"${q.id}" jumps to itself`,
          });
        }
      }
    }
  }

  return issues;
}
