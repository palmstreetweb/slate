/**
 * Plain helpers for the studio's logic editor (LogicEditor.tsx) and the
 * editor's issue list (editorIssues.ts): which answers a rule can test,
 * whether a rule row is finished, where a rule may point, and which rules
 * use a question that is about to be deleted. Studio only — nothing here
 * ships in the engine.
 */

import type { Condition, LogicRule, Question } from '@/index.js';
import { OTHER_VALUE } from '@/index.js';
import { allowsOther, otherLabelOf } from '@/logic/other.js';
import { IN_AREA_VALUE, OUT_OF_AREA_VALUE, checksArea, hasServiceArea } from '@/logic/address.js';
import { WAITLIST_VALUE } from '@/logic/signupAnswer.js';
import { offeredSlots, slotName } from '@/logic/signupView.js';

export type LeafOp =
  | 'equals'
  | 'not_equals'
  | 'gt'
  | 'lt'
  | 'gte'
  | 'lte'
  | 'is_empty'
  | 'is_not_empty';

/** One editable rule row. `value` is the text as typed, so "2." and "-" survive typing. */
export type Leaf = { field: string; op: LeafOp; value: string };

export const OP_LABEL: Record<LeafOp, string> = {
  equals: 'is',
  not_equals: 'is not',
  gt: 'is greater than',
  lt: 'is less than',
  gte: 'is at least',
  lte: 'is at most',
  is_empty: 'is blank',
  is_not_empty: 'has an answer',
};

export const NUMERIC_OPS: ReadonlySet<LeafOp> = new Set<LeafOp>(['gt', 'lt', 'gte', 'lte']);
export const VALUELESS_OPS: ReadonlySet<LeafOp> = new Set<LeafOp>(['is_empty', 'is_not_empty']);
const NUMERIC_TYPES = new Set(['number', 'scale', 'nps']);

/** Answers that are a group of parts (ADR-064, ADR-065): only "blank" / "has an answer" apply. */
const PART_TYPES = new Set([
  'contact_info',
  'address',
  'signature',
  'image_pin',
  'voice_note',
  'location',
  'photo_checklist',
  'availability',
]);

/** `form` is every question: a ZIP typed on a location is checked against the address lists. */
export function opsForQuestion(
  q: Question | undefined,
  form: ReadonlyArray<Question> = [],
): LeafOp[] {
  if (!q) return ['equals', 'not_equals', 'is_empty', 'is_not_empty'];
  // An address with a service area, or a location with a radius (ADR-065),
  // can also be tested in / out of the area.
  if (
    (q.type === 'address' && hasServiceArea(q)) ||
    (q.type === 'location' && checksArea(q, form))
  ) {
    return ['equals', 'not_equals', 'is_empty', 'is_not_empty'];
  }
  if (PART_TYPES.has(q.type)) return ['is_empty', 'is_not_empty'];
  if (NUMERIC_TYPES.has(q.type)) {
    return ['equals', 'not_equals', 'gt', 'lt', 'gte', 'lte', 'is_empty', 'is_not_empty'];
  }
  return ['equals', 'not_equals', 'is_empty', 'is_not_empty'];
}

export function isAnswerBearing(q: Question): boolean {
  return q.type !== 'welcome' && q.type !== 'statement' && q.type !== 'thanks';
}

/** Human-readable name for a question — its title, never the internal id. */
export function displayName(q: Question): string {
  const title = 'title' in q && typeof q.title === 'string' ? q.title.trim() : '';
  const base = title || `Untitled ${q.type.replace(/_/g, ' ')}`;
  return base.length > 44 ? `${base.slice(0, 43)}…` : base;
}

/**
 * The selectable answers for a question, so logic conditions can be picked by
 * label instead of forcing the author to know the internal option value.
 * Returns null for free-form/numeric/other types (those use a plain input).
 */
export function optionsFor(
  q: Question | undefined,
  form: ReadonlyArray<Question> = [],
): ReadonlyArray<{ label: string; value: string }> | null {
  if (!q) return null;
  switch (q.type) {
    case 'single_choice':
    case 'multi_choice':
    case 'dropdown':
    case 'ranking':
    case 'picture_choice': {
      const opts = (q.options as ReadonlyArray<{ label: string; value: string }>).map((o) => ({
        label: o.label,
        value: o.value,
      }));
      // "Picked Other" (ADR-063): matches any typed answer, never a listed option.
      return allowsOther(q)
        ? [...opts, { label: `${otherLabelOf(q)} (anything typed)`, value: OTHER_VALUE }]
        : opts;
    }
    case 'yes_no':
      return [
        { label: q.yesLabel ?? 'Yes', value: 'yes' },
        { label: q.noLabel ?? 'No', value: 'no' },
      ];
    case 'legal':
      return [
        { label: q.acceptLabel ?? 'I accept', value: 'accept' },
        { label: q.declineLabel ?? "I don't accept", value: 'decline' },
      ];
    case 'signup_slots': {
      // "Took this slot" per slot, and "joined a waitlist" when there is one (ADR-066).
      const slots = offeredSlots(q).map((s) => ({ label: `Took: ${slotName(s)}`, value: s.value }));
      return q.waitlist ? [...slots, { label: 'Joined a waitlist', value: WAITLIST_VALUE }] : slots;
    }
    case 'address':
    case 'location':
      // The service-area check (ADR-064, ADR-065): the ZIP against the owner's
      // list, or the respondent's position against the radius.
      return checksArea(q, form)
        ? [
            { label: 'Outside the service area', value: OUT_OF_AREA_VALUE },
            { label: 'Inside the service area', value: IN_AREA_VALUE },
          ]
        : null;
    default:
      return null;
  }
}

export function isLeafCondition(c: Condition): c is Extract<Condition, { field: string }> {
  return 'field' in c;
}

/** Leaf Condition → editable row. Returns null for shapes the UI can't edit. */
export function toLeaf(c: Condition): Leaf | null {
  if (!isLeafCondition(c)) return null;
  if (c.op === 'in' || c.op === 'not_in') return null; // code-only
  if (c.op === 'is_empty' || c.op === 'is_not_empty') {
    return { field: c.field, op: c.op, value: '' };
  }
  // `op` isn't a unit-type discriminant, so TS can't narrow away the
  // valueless variants above — assert the remaining shape.
  const leaf = c as { field: string; op: LeafOp; value: string | number };
  return { field: leaf.field, op: leaf.op, value: String(leaf.value) };
}

/** A whole number as typed ("3", "2.5", "-1", "2."); null for "", "-", "abc". */
export function numberOf(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** What a row's value box holds: nothing, a number, one of the answers, or free text. */
export function valueKind(
  leaf: Leaf,
  questions: ReadonlyArray<Question>,
): 'none' | 'number' | 'choice' | 'text' {
  if (VALUELESS_OPS.has(leaf.op)) return 'none';
  if (NUMERIC_OPS.has(leaf.op)) return 'number';
  const target = questions.find((q) => q.id === leaf.field);
  if (optionsFor(target, questions) !== null) return 'choice';
  if (target !== undefined && NUMERIC_TYPES.has(target.type)) return 'number';
  return 'text';
}

/**
 * Why a row isn't a working rule yet, in the owner's words; null once it is.
 * Unfinished rows stay in the editor as drafts and never reach the form.
 */
export function unfinishedReason(leaf: Leaf, questions: ReadonlyArray<Question>): string | null {
  if (!leaf.field) return 'Pick a question to finish this rule.';
  if (!questions.some((q) => q.id === leaf.field)) {
    return 'The question this rule used was deleted. Pick another one.';
  }
  switch (valueKind(leaf, questions)) {
    case 'none':
      return null;
    case 'number':
      if (!leaf.value.trim()) return 'Type a number to finish this rule.';
      return numberOf(leaf.value) === null ? 'Use a number, like 3 or 2.5.' : null;
    case 'choice':
      return leaf.value ? null : 'Pick an answer to finish this rule.';
    case 'text':
      return leaf.value.trim() ? null : 'Type a value to finish this rule.';
  }
}

export function isCompleteLeaf(leaf: Leaf, questions: ReadonlyArray<Question>): boolean {
  return unfinishedReason(leaf, questions) === null;
}

/** A finished row → leaf Condition, typing the value off the target question. */
export function fromLeaf(leaf: Leaf, questions: ReadonlyArray<Question>): Condition {
  const kind = valueKind(leaf, questions);
  if (kind === 'none') {
    return { field: leaf.field, op: leaf.op as 'is_empty' | 'is_not_empty' };
  }
  if (NUMERIC_OPS.has(leaf.op)) {
    return {
      field: leaf.field,
      op: leaf.op as 'gt' | 'lt' | 'gte' | 'lte',
      value: numberOf(leaf.value) ?? 0,
    };
  }
  return {
    field: leaf.field,
    op: leaf.op as 'equals' | 'not_equals',
    value: kind === 'number' ? (numberOf(leaf.value) ?? 0) : leaf.value,
  };
}

/** The answer a row tests, by its label when it's one of the choices. */
export function valueLabel(leaf: Leaf, questions: ReadonlyArray<Question>): string {
  if (VALUELESS_OPS.has(leaf.op)) return '';
  const target = questions.find((q) => q.id === leaf.field);
  const choices = optionsFor(target, questions);
  const match = choices?.find((o) => o.value === leaf.value);
  return match?.label ?? (leaf.value.trim() || '…');
}

/** Plain-language summary of one finished rule row. */
export function describeLeaf(leaf: Leaf, questions: ReadonlyArray<Question>): string | null {
  if (!isCompleteLeaf(leaf, questions)) return null;
  const target = questions.find((q) => q.id === leaf.field);
  const name = target ? displayName(target) : 'a question';
  const op = OP_LABEL[leaf.op];
  if (VALUELESS_OPS.has(leaf.op)) return `${name} ${op}`;
  return `${name} ${op} “${valueLabel(leaf, questions)}”`;
}

/** A finished row whose answer isn't one of the question's choices any more. */
export function answerRemoved(leaf: Leaf, questions: ReadonlyArray<Question>): boolean {
  if (valueKind(leaf, questions) !== 'choice' || !leaf.value) return false;
  const target = questions.find((q) => q.id === leaf.field);
  return !(optionsFor(target, questions) ?? []).some((o) => o.value === leaf.value);
}

/** Every leaf of a condition, nested groups included. */
export function conditionLeaves(c: Condition): Array<Extract<Condition, { field: string }>> {
  if ('all' in c) return c.all.flatMap(conditionLeaves);
  if ('any' in c) return c.any.flatMap(conditionLeaves);
  return [c];
}

/**
 * Where a rule on `currentId` may look and point (S7): a "when to show" rule
 * reads answers given before the question; a skip rule also reads the answer
 * to the question itself, and only skips ahead.
 */
export function ruleReach(questions: ReadonlyArray<Question>, currentId: string | undefined) {
  const at = currentId === undefined ? -1 : questions.findIndex((q) => q.id === currentId);
  const before = at === -1 ? questions : questions.slice(0, at);
  return {
    /** Answers a "when to show" rule may test. */
    visibilityFields: before.filter(isAnswerBearing),
    /** Answers a skip rule may test: earlier ones and this one. */
    jumpFields:
      at === -1
        ? questions.filter(isAnswerBearing)
        : questions.slice(0, at + 1).filter(isAnswerBearing),
    /** Where a skip rule may go. */
    jumpTargets:
      at === -1
        ? questions.filter((q) => q.id !== currentId && q.type !== 'welcome')
        : questions.slice(at + 1).filter((q) => q.type !== 'welcome'),
  };
}

/** Position of a question in the form, or -1. */
export function indexOf(questions: ReadonlyArray<Question>, id: string): number {
  return questions.findIndex((q) => q.id === id);
}

/**
 * Questions (other than the ones in `ids`) with a rule that uses one of `ids`:
 * a "when to show" rule reading its answer, or a skip rule reading it or
 * skipping to it (S8).
 */
export function questionsUsing(
  questions: ReadonlyArray<Question>,
  ids: ReadonlySet<string>,
): Question[] {
  return questions.filter((q) => {
    if (ids.has(q.id)) return false;
    if (
      'visibleIf' in q &&
      q.visibleIf &&
      conditionLeaves(q.visibleIf).some((l) => ids.has(l.field))
    ) {
      return true;
    }
    const logic: ReadonlyArray<LogicRule> = ('logic' in q && q.logic) || [];
    return logic.some(
      (r) => ids.has(r.goTo) || conditionLeaves(r.if).some((l) => ids.has(l.field)),
    );
  });
}

/** `c` without the leaves that read `ids`; undefined when nothing is left. */
function conditionWithout(c: Condition, ids: ReadonlySet<string>): Condition | undefined {
  if ('all' in c || 'any' in c) {
    const list = 'all' in c ? c.all : c.any;
    const kept = list
      .map((x) => conditionWithout(x, ids))
      .filter((x): x is Condition => x !== undefined);
    if (kept.length === list.length && kept.every((x, i) => x === list[i])) return c;
    if (kept.length === 0) return undefined;
    if (kept.length === 1) return kept[0];
    return 'all' in c ? { all: kept } : { any: kept };
  }
  return ids.has(c.field) ? undefined : c;
}

/**
 * Remove the rules that use questions about to be deleted (S8): "when to show"
 * rows that read them, and skip rules that read them or skip to them. Other
 * rows on the same question stay.
 */
export function dropRulesUsing(
  questions: ReadonlyArray<Question>,
  ids: ReadonlySet<string>,
): Question[] {
  return questions.map((q) => {
    let next = q;
    if ('visibleIf' in q && q.visibleIf) {
      const visibleIf = conditionWithout(q.visibleIf, ids);
      if (visibleIf !== q.visibleIf) {
        const { visibleIf: _drop, ...rest } = next as Question & { visibleIf?: Condition };
        next = (visibleIf ? { ...rest, visibleIf } : rest) as Question;
      }
    }
    if ('logic' in q && q.logic) {
      const logic = q.logic.filter(
        (r) => !ids.has(r.goTo) && !conditionLeaves(r.if).some((l) => ids.has(l.field)),
      );
      if (logic.length !== q.logic.length) {
        const { logic: _drop, ...rest } = next as Question & { logic?: LogicRule[] };
        next = (logic.length ? { ...rest, logic } : rest) as Question;
      }
    }
    return next;
  });
}
