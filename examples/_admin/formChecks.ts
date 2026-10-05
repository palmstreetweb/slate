/**
 * Owner-side form checks (studio only, so no engine bytes). `formIssues` is the
 * engine's `checkSchema` plus checks on settings only the studio edits — pick
 * limits, options, lengths, file limits, the scale, the redirect, the phone
 * country, sign-up slot times. The editor's banner (`ownerIssues` in
 * editorIssues.ts) lists these `studioIssues` too, beside its logic-rule checks.
 *
 * Every issue says whether it is `blocking`: it would trap or break
 * respondents (a pick count nobody can meet, a question with nothing to
 * answer, a redirect to a page that doesn't exist), so publishing should wait
 * until it's fixed. The rest are heads-ups that never block. Messages name the
 * question by its title and say what to do; the inspector shows the same
 * problems in place, worded for the question in front of the owner.
 */

import type {
  MultiChoiceQuestion,
  Option,
  PictureChoiceQuestion,
  Question,
  ScaleQuestion,
  SignupSlot,
} from '@/index.js';
import { checkSchema, type SchemaIssue } from '@/logic/schemaCheck.js';
import { contactMode } from '@/logic/contact.js';
import { acceptTokens } from '@/components/questions/FileUploadField.js';
import { isPhoneCountry } from './phoneCountries.js';

export type StudioIssueKind =
  /** Min / Max selections (or likes) that aren't whole numbers. */
  | 'pick_limits'
  /** More picks asked for than there are choices, or Max below Min. */
  | 'pick_range'
  /** Max above the number of choices: it never comes into play. */
  | 'pick_max_high'
  /** A choice question with no options (a grid with no rows or columns). */
  | 'no_options'
  /** An option, row, column or shot with no name. */
  | 'blank_option'
  /** Two options with the same value: picking one picks both. */
  | 'same_option'
  /** A max length that isn't a whole number of 1 or more (read as no limit, or rounded down). */
  | 'bad_length'
  | 'bad_file_size'
  | 'bad_file_count'
  /** File types in Accept the form can't read (left out of the filter). */
  | 'bad_accept'
  /** A picture option with no picture link, or one that isn't https. */
  | 'picture_src'
  /** A number or scale step that isn't more than 0. */
  | 'bad_step'
  /** A scale with more points than reads well (heads-up), or than the form can draw (blocks). */
  | 'scale_points'
  /** Stars counted from 0: the first star saves 0. */
  | 'stars_from_zero'
  | 'bad_redirect'
  | 'bad_country'
  | 'slot_times'
  | 'slot_past'
  | 'slot_twice';

export type FormIssue = {
  questionId: string;
  kind: SchemaIssue['kind'] | StudioIssueKind;
  /** For the owner: the question's title, what's wrong, what to do. */
  message: string;
  /** Would trap or break respondents: publish only once it's fixed. */
  blocking: boolean;
};

/** More points than this on a drawn scale (numbers, stars, faces) is a lot to tap through: a heads-up. */
export const SCALE_POINTS_MAX = 21;
/** The engine draws at most this many cells (scaleCells.ts MAX_CELLS): past it, top values are missing. */
export const SCALE_CELLS_MAX = 101;
/** A slider draws no cells; past this many stops its step is too fine to land on (a heads-up). */
export const SLIDER_STOPS_MAX = 1001;
/** Uploads stop at this size whatever the question says (storage-sign's cap). */
export const FILE_SIZE_MAX_MB = 32;
/** The server keeps at most this many files per answer. */
export const FILE_COUNT_MAX = 100;

/**
 * Would this engine check stop people finishing the form? Only those hold
 * Publish back (decision 4). A skip to itself falls through to the next
 * question, and an empty checklist or contact block asks for nothing, so those
 * are heads-ups; a photo to mark, a grid or sign-up slots with nothing to use
 * trap people only when the question insists on an answer. Bounds set the wrong
 * way round are a heads-up too (review fixes): the engine ignores a number's or a
 * date's and draws a scale from the lower end, so every answer still goes through.
 */
export function schemaIssueBlocks(kind: SchemaIssue['kind'], q: Question | undefined): boolean {
  if (!q) return false;
  const required = (q as { required?: boolean }).required;
  switch (kind) {
    // Two questions share one answer slot: answers mix, and Back goes to the wrong one.
    case 'duplicate_id':
      return true;
    // Nothing to tap, paint or pick, and the question insists.
    case 'no_image':
    case 'bad_grid':
      return required === true;
    case 'no_slots':
      return required !== false;
    default:
      return false;
  }
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const short = (s: string, max = 40) =>
  s.length > max ? s.slice(0, max + 1).replace(/\s\S*$/, '') + '…' : s;

/** How the owner knows a question: its title in quotes, cut short (as checkSchema words it). */
export function questionName(q: Question, start = true): string {
  const t = 'title' in q && typeof q.title == 'string' ? q.title.replace(/\s+/g, ' ').trim() : '';
  return t ? `“${short(t)}”` : `${start ? 'A' : 'a'} question with no title`;
}

/* ---------- multi-select pick limits ---------- */

export type MultiPick = MultiChoiceQuestion | PictureChoiceQuestion;

export function isSwipe(q: Question): boolean {
  return q.type === 'picture_choice' && q.display === 'swipe';
}

/** Choices a multi-select offers: its options, plus "Other" when it's on (never on swipe cards). */
export function choiceCount(q: MultiPick): number {
  return q.options.length + (q.allowOther && !isSwipe(q) ? 1 : 0);
}

/** "picks" / "choices" — or "likes" / "cards" on swipe cards. */
export function pickWords(q: MultiPick) {
  const swipe = isSwipe(q);
  return {
    picks: swipe ? 'likes' : 'picks',
    choice: swipe ? 'card' : 'choice',
    choices: swipe ? 'cards' : 'choices',
    field: swipe ? 'likes' : 'selections',
    other: q.allowOther && !swipe ? ' (counting “Other”)' : '',
  };
}

export type PickProblem =
  | { kind: 'max_whole'; max: unknown }
  | { kind: 'min_whole'; min: unknown }
  | { kind: 'min_over_choices'; min: number; choices: number }
  | { kind: 'max_under_min'; min: number; max: number }
  | { kind: 'max_over_choices'; max: number; choices: number };

const whole = (v: unknown, from: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= from;

/**
 * What's wrong with a multi-select's Min / Max, worst first; null when they work.
 * Min counts "Other" as a choice (they can type one of their own).
 */
export function pickProblem(q: MultiPick): PickProblem | null {
  const { min, max } = q as { min?: unknown; max?: unknown };
  const choices = choiceCount(q);
  if (max !== undefined && !whole(max, 1)) return { kind: 'max_whole', max };
  if (min !== undefined && !whole(min, 0)) return { kind: 'min_whole', min };
  if (choices === 0) return null; // "has no options" says it better
  if (min !== undefined && min > choices) return { kind: 'min_over_choices', min, choices };
  if (min !== undefined && max !== undefined && max < min) {
    return { kind: 'max_under_min', min, max };
  }
  if (max !== undefined && max > choices) return { kind: 'max_over_choices', max, choices };
  return null;
}

/** A pick-limit problem respondents would get stuck on (anything but a Max that's never reached, or a negative Min). */
export function pickProblemBlocks(p: PickProblem): boolean {
  if (p.kind === 'max_over_choices') return false;
  return !(p.kind === 'min_whole' && typeof p.min === 'number' && p.min < 0);
}

function pickIssue(q: MultiPick, p: PickProblem): FormIssue {
  const name = questionName(q);
  const w = pickWords(q);
  const message = (() => {
    switch (p.kind) {
      case 'max_whole':
        return `${name}: Max ${w.field} has to be a whole number, 1 or more.`;
      case 'min_whole':
        return `${name}: Min ${w.field} has to be a whole number, 0 or more.`;
      case 'min_over_choices':
        return `${name} asks for at least ${p.min} ${w.picks} but has only ${count(p.choices, w.choice, w.choices)}${w.other}.`;
      case 'max_under_min':
        return `${name} asks for at least ${p.min} ${w.picks} but allows at most ${p.max}.`;
      case 'max_over_choices':
        return `${name} allows up to ${p.max} ${w.picks} but has only ${count(p.choices, w.choice, w.choices)}${w.other}.`;
    }
  })();
  return {
    questionId: q.id,
    kind:
      p.kind === 'max_over_choices'
        ? 'pick_max_high'
        : p.kind.endsWith('whole')
          ? 'pick_limits'
          : 'pick_range',
    message,
    blocking: pickProblemBlocks(p),
  };
}

/* ---------- options ---------- */

/** A new option value: `opt_` and six random letters / digits, never one in the list — so two options never tick together, and a removed option's value never comes back. */
export function newOptionValue(options: ReadonlyArray<{ value: string }>): string {
  const taken = new Set(options.map((o) => o.value));
  for (;;) {
    const v = `opt_${Math.random().toString(36).slice(2, 8).padEnd(6, '0')}`;
    if (!taken.has(v)) return v;
  }
}

/** A, B, … Z, AA, AB, … */
function letters(i: number): string {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  }
  return s;
}

/** "Option C" for a third option — the next letter no option uses yet. */
export function newOptionLabel(options: ReadonlyArray<{ label: string }>): string {
  const used = new Set(options.map((o) => (o.label ?? '').trim()));
  for (let i = options.length; ; i++) {
    const label = `Option ${letters(i)}`;
    if (!used.has(label)) return label;
  }
}

/** Some value is used by more than one option. */
export function hasSameValues(options: ReadonlyArray<{ value: string }>): boolean {
  return new Set(options.map((o) => o.value)).size < options.length;
}

/** The options with each repeat (after the first) given a new value; labels, prices and scores stay. */
export function withUniqueValues<T extends { value: string }>(options: ReadonlyArray<T>): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const o of options) {
    const next = seen.has(o.value) ? { ...o, value: newOptionValue([...options, ...out]) } : o;
    seen.add(next.value);
    out.push(next);
  }
  return out;
}

/** The option lists a question has, and what the owner calls one of them. */
function optionLists(
  q: Question,
): Array<{ list: ReadonlyArray<Option>; one: string; many: string }> {
  switch (q.type) {
    case 'single_choice':
    case 'multi_choice':
    case 'dropdown':
    case 'ranking':
    case 'picture_choice':
      return [{ list: Array.isArray(q.options) ? q.options : [], one: 'option', many: 'options' }];
    case 'matrix':
      return [
        { list: Array.isArray(q.rows) ? q.rows : [], one: 'row', many: 'rows' },
        { list: Array.isArray(q.columns) ? q.columns : [], one: 'column', many: 'columns' },
      ];
    case 'photo_checklist':
      return [{ list: Array.isArray(q.items) ? q.items : [], one: 'photo', many: 'photos' }];
    default:
      return [];
  }
}

/* ---------- redirect ---------- */

/**
 * The web address a redirect will use: what the owner typed, with https://
 * added when there's no scheme. Null when it can't be a web page link (no
 * domain, "javascript:", "mailto:", a path on its own).
 */
export function normalizeRedirectUrl(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  const full = /^[a-z][a-z\d+-]*:/i.test(t) ? t : `https://${t.replace(/^\/+/, '')}`;
  try {
    const u = new URL(full);
    const host = u.hostname;
    const webHost = /\./.test(host) && !host.startsWith('.') && !host.endsWith('.');
    return (u.protocol === 'https:' || u.protocol === 'http:') && webHost ? full : null;
  } catch {
    return null;
  }
}

/* ---------- scale ---------- */

/** Points on a scale (min to max by step); NaN when the step can't count. */
export function scalePointCount(q: Pick<ScaleQuestion, 'min' | 'max' | 'step'>): number {
  const step = q.step ?? 1;
  if (!(typeof step === 'number' && Number.isFinite(step) && step > 0)) return Number.NaN;
  return q.max >= q.min ? Math.floor((q.max - q.min) / step + 1e-9) + 1 : 0;
}

/* ---------- pictures ---------- */

/**
 * What's wrong with a picture option's link, in plain words, or null (QA
 * coverage: picture option image link). Only an https link shows for
 * everyone; a blank one shows a broken picture.
 */
export function pictureLinkProblem(src: unknown): string | null {
  const t = typeof src === 'string' ? src.trim() : '';
  if (!t) return 'Add a link to a picture, or this option shows no picture.';
  try {
    const u = new URL(t);
    if (u.protocol === 'https:' && u.hostname.includes('.')) return null;
  } catch {
    /* not a link at all */
  }
  return 'Use a picture link that starts with https://, or the picture won’t show.';
}

/* ---------- file types ---------- */

/** The words in an Accept list the form's file filter can't read (it leaves them out). */
export function unreadableAccept(accept: string | undefined): string[] {
  return (accept ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t && acceptTokens(t).length === 0);
}

/** The Accept list with only what the filter can read, or undefined for "any file". */
export function readableAccept(accept: string | undefined): string | undefined {
  const kept = (accept ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t && acceptTokens(t).length > 0);
  return kept.length ? kept.join(', ') : undefined;
}

/* ---------- sign-up slots ---------- */

export type SlotProblem = { kind: 'times' } | { kind: 'past' } | { kind: 'twice'; first: number };

const clockMinutes = (t: string | undefined) => {
  const m = t ? /^(\d{2}):(\d{2})$/.exec(t) : null;
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** Today on the owner's calendar, YYYY-MM-DD. */
export function localToday(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** What's off about each slot (null when it's fine): ends before it starts, a day gone by, listed twice. */
export function slotProblems(
  slots: ReadonlyArray<SignupSlot>,
  today: string = localToday(),
): Array<SlotProblem | null> {
  const key = (s: SignupSlot) =>
    [(s.label ?? '').trim().toLowerCase(), s.date ?? '', s.start ?? '', s.end ?? ''].join('|');
  return slots.map((s, i) => {
    const start = clockMinutes(s.start);
    const end = clockMinutes(s.end);
    if (start !== null && end !== null && end <= start) return { kind: 'times' };
    if (s.date && /^\d{4}-\d{2}-\d{2}$/.test(s.date) && s.date < today) return { kind: 'past' };
    const first = slots.findIndex((x) => key(x) === key(s));
    if (first < i) return { kind: 'twice', first };
    return null;
  });
}

/** "Morning", or "Slot 2" for a slot with no name. */
export function slotName(s: SignupSlot, i: number): string {
  return (s.label ?? '').trim() || `Slot ${i + 1}`;
}

/* ---------- the checks ---------- */

/** Settings checks only the studio needs, in the owner's words. */
export function studioIssues(
  questions: ReadonlyArray<Question>,
  today: string = localToday(),
): FormIssue[] {
  const out: FormIssue[] = [];
  const add = (q: Question, kind: StudioIssueKind, message: string, blocking: boolean) =>
    out.push({ questionId: q.id, kind, message, blocking });

  for (const q of questions) {
    const name = questionName(q);

    for (const { list, one, many } of optionLists(q)) {
      if (list.length === 0 && q.type !== 'photo_checklist') {
        add(
          q,
          'no_options',
          q.type === 'matrix'
            ? `${name} needs at least one row and one column.`
            : `${name} has no ${many}. Add at least one.`,
          true,
        );
        break;
      }
      if (hasSameValues(list)) {
        add(
          q,
          'same_option',
          `${name} has two ${many} that count as one. Open it and press “Fix”.`,
          true,
        );
      }
      // A checklist with no named shot at all is the engine's "no photos to take".
      const named = list.filter((o) => (o.label ?? '').trim()).length;
      if (named < list.length && (named > 0 || q.type !== 'photo_checklist')) {
        add(
          q,
          'blank_option',
          `${name} has ${one === 'option' ? 'an' : 'a'} ${one} with no name.`,
          false,
        );
      }
    }

    if (q.type === 'multi_choice' || (q.type === 'picture_choice' && q.multiple)) {
      const p = pickProblem(q);
      if (p) out.push(pickIssue(q, p));
    }

    if (q.type === 'picture_choice' && Array.isArray(q.options)) {
      const bad = q.options.filter((o) => pictureLinkProblem(o.src));
      if (bad.length) {
        const first = (bad[0]!.label ?? '').trim();
        add(
          q,
          'picture_src',
          `${name}: ${first ? `“${short(first, 30)}”` : 'an option'}${bad.length > 1 ? ` and ${count(bad.length - 1, 'other', 'others')}` : ''} ${bad.length > 1 ? 'need' : 'needs'} a picture link that starts with https://, or the picture won’t show.`,
          false,
        );
      }
    }

    // The engine reads a max length below 1 as no limit and rounds one down (R23):
    // nobody is trapped, so these are heads-ups.
    if ((q.type === 'short_text' || q.type === 'long_text') && q.maxLength !== undefined) {
      const len = q.maxLength as unknown;
      if (!whole(len, 1)) {
        add(
          q,
          'bad_length',
          typeof len === 'number' && len >= 1
            ? `${name}: Max length ${len} counts as ${Math.floor(len)} characters.`
            : `${name}: Max length ${String(len)} means no limit. Clear it, or use 1 or more.`,
          false,
        );
      }
    }

    if (q.type === 'file_upload') {
      const size = q.maxSizeMb as unknown;
      if (size !== undefined && !(typeof size === 'number' && Number.isFinite(size) && size > 0)) {
        add(
          q,
          'bad_file_size',
          `${name}: Max size ${String(size)} MB means the usual ${FILE_SIZE_MAX_MB} MB limit. Clear it, or use 1 MB or more.`,
          false,
        );
      } else if (typeof size === 'number' && size > FILE_SIZE_MAX_MB) {
        add(
          q,
          'bad_file_size',
          `${name} allows files up to ${size} MB, but uploads stop at ${FILE_SIZE_MAX_MB} MB.`,
          false,
        );
      }
      const files = q.maxFiles as unknown;
      if (q.multiple !== false && files !== undefined) {
        if (!whole(files, 1)) {
          const counted = typeof files === 'number' && files >= 1 ? Math.floor(files) : 10;
          add(
            q,
            'bad_file_count',
            `${name}: Max files ${String(files)} counts as ${counted}. Use a whole number, 1 or more.`,
            false,
          );
        } else if (files > FILE_COUNT_MAX) {
          add(
            q,
            'bad_file_count',
            `${name} allows ${files} files, but only the first ${FILE_COUNT_MAX} are kept.`,
            false,
          );
        }
      }
      const unread = unreadableAccept(q.accept);
      if (unread.length) {
        add(
          q,
          'bad_accept',
          `${name}: ${unread.map((t) => `“${short(t, 24)}”`).join(', ')} ${unread.length === 1 ? 'isn’t a file type' : 'aren’t file types'} the form can read, so ${unread.length === 1 ? 'it’s' : 'they’re'} left out. Use endings like pdf or jpg.`,
          false,
        );
      }
    }

    // A step that can't count is read as 1 by the engine (the stepper, scaleRange), so
    // nobody is trapped: a heads-up, said for what happens (review fixes, STU-3).
    if (q.type === 'number' && q.step !== undefined) {
      const step = q.step as unknown;
      if (!(typeof step === 'number' && Number.isFinite(step) && step > 0)) {
        add(
          q,
          'bad_step',
          `${name}: a step of ${String(step)} can’t be used, so it counts by 1. Clear it, or use more than 0.`,
          false,
        );
      }
    }

    if (q.type === 'scale') {
      const counted = scalePointCount(q);
      if (Number.isNaN(counted)) {
        add(
          q,
          'bad_step',
          `${name} can’t count in steps of ${String(q.step)}, so it counts by 1. Open it and press “Count by 1”.`,
          false,
        );
      }
      // Counted by 1 when the step can't count, as the form draws it.
      const points = Number.isNaN(counted) ? scalePointCount({ ...q, step: 1 }) : counted;
      if (q.display === 'slider') {
        // A slider draws no cells (R4): a 0–100 slider is fine; only a step too fine to land on is said.
        if (points > SLIDER_STOPS_MAX) {
          add(
            q,
            'scale_points',
            `${name}: the slider has ${points.toLocaleString('en-US')} stops, too many to land on. Use a bigger step.`,
            false,
          );
        }
      } else if (points > SCALE_CELLS_MAX) {
        add(
          q,
          'scale_points',
          `${name} has ${points.toLocaleString('en-US')} points, more than the form can show (${SCALE_CELLS_MAX}). Use fewer, or the Slider style.`,
          true,
        );
      } else if (points > SCALE_POINTS_MAX) {
        add(
          q,
          'scale_points',
          `${name} has ${points.toLocaleString('en-US')} points to tap through. ${SCALE_POINTS_MAX} or fewer reads better; the Slider style suits a long range.`,
          false,
        );
      }
      if (q.display === 'stars' && q.min < 1 && q.max >= q.min) {
        add(
          q,
          'stars_from_zero',
          `${name} starts its stars at ${q.min}, so one star saves ${q.min}. Set Min Value to 1.`,
          false,
        );
      }
    }

    if (q.type === 'thanks' && typeof q.redirectUrl === 'string' && q.redirectUrl.trim()) {
      const raw = q.redirectUrl.trim();
      const url = normalizeRedirectUrl(raw);
      if (url === null) {
        add(
          q,
          'bad_redirect',
          `${name} sends people to “${short(raw)}”, which isn’t a web address. Use a full one, like https://yoursite.com/thanks.`,
          true,
        );
      } else if (url !== raw) {
        // The engine opens a bare address as https (R23): a heads-up, not a trap.
        add(
          q,
          'bad_redirect',
          `${name} sends people to “${short(raw)}”, which opens as ${short(url, 60)}. Open it and press “Fix” to save it that way.`,
          false,
        );
      }
    }

    if (
      (q.type === 'phone' || (q.type === 'contact_info' && contactMode(q, 'phone') !== 'off')) &&
      q.defaultCountry !== undefined &&
      !isPhoneCountry(q.defaultCountry)
    ) {
      // The engine reads a local number as a US one until a country is picked (R16).
      add(
        q,
        'bad_country',
        `${name}: a number typed without its country code is read as a US number. Pick a country if most people answering aren’t in the US.`,
        false,
      );
    }

    if (q.type === 'signup_slots' && Array.isArray(q.slots)) {
      const problems = slotProblems(q.slots, today);
      const say = (kind: SlotProblem['kind'], words: (slot: string, more: number) => string) => {
        const hits = problems.flatMap((p, i) => (p?.kind === kind ? [i] : []));
        if (hits.length)
          return words(`“${short(slotName(q.slots[hits[0]!]!, hits[0]!))}”`, hits.length - 1);
        return null;
      };
      const and = (more: number) => (more ? ` (and ${count(more, 'other', 'others')})` : '');
      const times = say('times', (s, more) => `${name}: ${s}${and(more)} ends before it starts.`);
      if (times) add(q, 'slot_times', times, false);
      const past = say(
        'past',
        (s, more) => `${name}: ${s}${and(more)} is on a day that has passed.`,
      );
      if (past) add(q, 'slot_past', past, false);
      const twice = say(
        'twice',
        (s, more) => `${name}: ${s}${and(more)} is listed twice, at the same time.`,
      );
      if (twice) add(q, 'slot_twice', twice, false);
    }
  }
  return out;
}

/**
 * Everything the editor lists, in form order: the engine's checks and the
 * studio's, each marked blocking or not.
 */
export function formIssues(
  questions: ReadonlyArray<Question>,
  today: string = localToday(),
): FormIssue[] {
  const byId = new Map(questions.map((q) => [q.id, q] as const));
  const all: FormIssue[] = [
    ...checkSchema(questions).map((i) => ({
      ...i,
      blocking: schemaIssueBlocks(i.kind, byId.get(i.questionId)),
    })),
    ...studioIssues(questions, today),
  ];
  const order = new Map<string, number>();
  questions.forEach((q, i) => {
    if (!order.has(q.id)) order.set(q.id, i);
  });
  const at = (i: FormIssue) => order.get(i.questionId) ?? questions.length;
  return all
    .map((issue, i) => ({ issue, i }))
    .sort((a, b) => at(a.issue) - at(b.issue) || a.i - b.i)
    .map((x) => x.issue);
}

/** The issues that should hold back publishing. */
export function blockingIssues(issues: ReadonlyArray<FormIssue>): FormIssue[] {
  return issues.filter((i) => i.blocking);
}
