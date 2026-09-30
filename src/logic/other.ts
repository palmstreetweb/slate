/**
 * "Other: ___" on choice questions (ADR-063). Pure helpers, no React.
 *
 * Storage model (the Google Forms one): the respondent's typed text is
 * stored in place of an option value — `single_choice` / `dropdown` /
 * single `picture_choice` keep a `string`, `multi_choice` / multi
 * `picture_choice` keep a `string[]` with at most one typed entry. So an
 * answer is "Other" exactly when it is a non-empty string that is not one of
 * the question's option values. Text that names an option (its value, or its
 * label ignoring case) is stored as that option instead.
 *
 * Conditions use the `OTHER_VALUE` sentinel to mean "picked Other"; it is
 * never stored.
 */

import type { Option, Question } from '@/types/Question.js';

/** In a condition's value: "the respondent picked Other". Never stored as an answer. */
export const OTHER_VALUE = '__other__';

/** Longest typed Other answer, in characters (the server clamps to the same). */
export const OTHER_MAX = 500;

type OtherCapable = Extract<
  Question,
  { type: 'single_choice' | 'multi_choice' | 'dropdown' | 'picture_choice' }
>;

/** True when this question offers an "Other" choice. */
export function allowsOther(q: Question): q is OtherCapable {
  return (
    (q.type === 'single_choice' ||
      q.type === 'multi_choice' ||
      q.type === 'dropdown' ||
      q.type === 'picture_choice') &&
    q.allowOther === true
  );
}

/** The Other choice's label. */
export function otherLabelOf(q: { otherLabel?: string }): string {
  const label = q.otherLabel?.trim();
  return label ? label : 'Other';
}

/**
 * Split a stored answer into the option values it picks and the typed Other
 * text ('' when none). Unknown non-strings are ignored.
 */
export function splitOther(
  options: ReadonlyArray<Pick<Option, 'value'>>,
  value: unknown,
): { picked: string[]; other: string } {
  const values = new Set(options.map((o) => o.value));
  const items = Array.isArray(value) ? value : [value];
  const picked: string[] = [];
  let other = '';
  for (const item of items) {
    if (typeof item !== 'string' || item === '') continue;
    if (values.has(item)) picked.push(item);
    else if (!other && item.trim() !== '') other = item;
  }
  return { picked, other };
}

/**
 * Typed text → what to store: the option value when the text names an option
 * (value, or label ignoring case and outer spaces), else the trimmed text
 * capped at `OTHER_MAX`.
 */
export function resolveOtherText(
  options: ReadonlyArray<Pick<Option, 'value' | 'label'>>,
  text: string,
): { value: string; isOption: boolean } {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();
  const hit =
    options.find((o) => o.value === trimmed) ??
    options.find((o) => o.label.trim().toLowerCase() === lower);
  if (hit) return { value: hit.value, isOption: true };
  return { value: trimmed.slice(0, OTHER_MAX), isOption: false };
}

/** Question id → its option values, for questions that allow Other. */
export type OtherIndex = ReadonlyMap<string, ReadonlySet<string>>;

const indexCache = new WeakMap<ReadonlyArray<Question>, OtherIndex>();

/**
 * The option values of every question that allows Other, so a condition can
 * tell a typed answer apart from a picked option. Cached per questions array.
 */
export function otherIndex(questions: ReadonlyArray<Question>): OtherIndex {
  const hit = indexCache.get(questions);
  if (hit) return hit;
  const map = new Map<string, ReadonlySet<string>>();
  for (const q of questions) {
    if (allowsOther(q)) map.set(q.id, new Set(q.options.map((o) => o.value)));
  }
  indexCache.set(questions, map);
  return map;
}

/** True when a stored answer includes typed Other text, given the question's option values. */
export function hasOtherAnswer(value: unknown, optionValues: ReadonlySet<string>): boolean {
  const items = Array.isArray(value) ? value : [value];
  return items.some(
    (item) => typeof item === 'string' && item.trim() !== '' && !optionValues.has(item),
  );
}
