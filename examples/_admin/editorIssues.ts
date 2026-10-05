/**
 * The editor's issue list in the owner's words (S9, S10). The engine's
 * `checkSchema` finds what's wrong; this words each of its issues for the
 * banner (naming the question by its title, or "Untitled Location", and saying
 * what to change), adds the studio's settings checks (`studioIssues`,
 * formChecks.ts) and its own rule checks (S7), and marks the problems that
 * would stop people finishing the form: only those hold Publish back.
 *
 * Studio only, so this costs no engine bytes. A new `SchemaIssue` kind gets
 * the engine's own message (its ids swapped for titles) and never blocks until
 * `schemaIssueBlocks` lists it.
 */

import type { Option, Question, SchemaIssue, SignupSlot } from '@/index.js';
import { OTHER_VALUE, checkSchema } from '@/index.js';
import { isValidPrefillKey } from '@/logic/prefill.js';
import { geoCenter, geoRadiusKm } from '@/logic/geo.js';
import { PRICE_MAX } from '@/logic/estimate.js';
import { TYPE_LABEL } from './questionTypeMeta.js';
import { answerRemoved, conditionLeaves, indexOf, toLeaf, unfinishedReason } from './logicRules.js';
import { schemaIssueBlocks, slotName, studioIssues, type StudioIssueKind } from './formChecks.js';

export type OwnerIssueKind =
  | SchemaIssue['kind']
  /** A setting only the studio checks: pick limits, options, lengths, files, the redirect… */
  | StudioIssueKind
  /** A "when to show" rule that waits for the question's own answer. */
  | 'rule_self'
  /** A rule that reads a question asked later. */
  | 'rule_later'
  /** A rule saved before it was finished (an answer never picked). */
  | 'rule_unfinished'
  /** A rule that tests an answer the question no longer offers. */
  | 'answer_removed'
  /** A skip rule that goes back to an earlier question. */
  | 'jump_back';

export type OwnerIssue = {
  /** The question to open when the owner taps the issue. */
  questionId: string;
  kind: OwnerIssueKind;
  /** One plain sentence naming the question by its title. */
  text: string;
  /** People couldn't finish the form as it is: Publish waits until it's fixed. */
  blocking: boolean;
};

/** “Title”, or “Untitled Location” — never the internal id. */
export function ownerName(q: Question | undefined): string {
  if (!q) return '“A question”';
  const raw =
    'title' in q && typeof q.title === 'string' ? q.title.replace(/\s+/g, ' ').trim() : '';
  const base = raw || `Untitled ${TYPE_LABEL[q.type] ?? 'question'}`;
  return `“${base.length > 60 ? `${base.slice(0, 59)}…` : base}”`;
}

const priceOk = (v: unknown) =>
  typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= PRICE_MAX;

/** Why a low / high price can't be used, as the inspector says it under the inputs; null when it can. */
function priceWhy(low: unknown, high: unknown): string | null {
  if (low === undefined && high === undefined) return null;
  if (low === undefined) return 'Add the low price too, or clear the high end.';
  if (!priceOk(low) || (high !== undefined && !priceOk(high))) {
    return `Use a number up to ${PRICE_MAX.toLocaleString('en-US')}.`;
  }
  if (high !== undefined && (high as number) < (low as number)) {
    return 'The high end has to be at least the low price.';
  }
  return null;
}

/** "“Gold”: the high end has to be at least the low price." — the option and the reason (copy QA). */
function priceSentence(n: string, q: Question | undefined): string {
  if (q?.type === 'number') {
    const why = priceWhy(q.unitPrice, q.unitPriceMax);
    return `${n}: fix the price per unit. ${why ?? ''}`.trim();
  }
  const options = (q && 'options' in q && Array.isArray(q.options) ? q.options : []) as Option[];
  const at = options.findIndex((o) => priceWhy(o.price, o.priceMax));
  const o = options[at];
  if (!o) return `${n}: fix a price on one of its options.`;
  const label = o.label?.trim() ? `“${o.label.trim()}”` : `option ${at + 1}`;
  return `${n}: fix the price on ${label}. ${priceWhy(o.price, o.priceMax)}`;
}

/** What the availability grid can't use, in the inspector's own words (copy QA). */
function gridSentence(n: string, q: Question | undefined): string {
  const g = (q ?? {}) as {
    days?: string[];
    slotMinutes?: number;
    startTime?: string;
    endTime?: string;
  };
  const mins = (t: string | undefined, d: number) => {
    if (t === undefined) return d;
    const m = /^(\d{2}):(\d{2})$/.exec(t);
    return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
  };
  const slot = g.slotMinutes ?? 60;
  if ((g.days ?? []).some((d) => !['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].includes(d))) {
    return `${n} has a day the grid can’t show. Pick its days again.`;
  }
  if (![15, 30, 60, 120].includes(slot)) {
    return `${n} has a slot length the grid can’t use. Pick one under Each slot.`;
  }
  const from = mins(g.startTime, 480);
  const until = mins(g.endTime, 1080);
  if (Number.isNaN(from) || Number.isNaN(until)) {
    return `${n} has a time the grid can’t read. Pick From and Until again.`;
  }
  if (until <= from) return `${n}: “Until” has to be after “From”.`;
  return `${n}: From to Until is shorter than one slot. Pick a later Until or a shorter slot.`;
}

/** The first slot a sign-up can't offer, by name, and why — as the inline note says it (copy QA). */
function slotSentence(n: string, q: Question | undefined): string {
  const slots = (q && 'slots' in q && Array.isArray(q.slots) ? q.slots : []) as SignupSlot[];
  const seen = new Set<string>();
  for (const [i, x] of slots.entries()) {
    const name = `“${slotName(x, i)}”`;
    const value = typeof x.value === 'string' ? x.value : '';
    if (!(x.label?.trim() || x.date)) return `${n}: give ${name} a name or a day.`;
    if (!(Number.isInteger(x.capacity) && x.capacity >= 1 && x.capacity <= 1000)) {
      return `${n}: ${name} needs 1 to 1,000 spots.`;
    }
    if (x.date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(x.date)) {
      return `${n}: ${name} has a day that doesn’t exist. Pick it again.`;
    }
    if ([x.start, x.end].some((t) => t !== undefined && !/^([01]\d|2[0-3]):[0-5]\d$/.test(t))) {
      return `${n}: ${name} has a time that can’t be used. Pick it again.`;
    }
    if (!/^[\w-]{1,64}$/.test(value) || seen.has(value)) {
      return `${n}: ${name} can’t be told apart from another slot. Delete it and add it again.`;
    }
    seen.add(value);
  }
  return slots.length > 50
    ? `${n} has more than 50 slots. Only the first 50 can be offered.`
    : `${n} has a slot it can’t offer. Check each one’s name, day and spots.`;
}

function sentence(
  issue: SchemaIssue,
  q: Question | undefined,
  byId: Map<string, Question>,
): string {
  const n = ownerName(q);
  switch (issue.kind) {
    case 'duplicate_id':
      return `${n} shares its hidden name with another question, so their answers would mix. Delete one and add it again.`;
    case 'dangling_condition': {
      const inVisibility =
        q !== undefined &&
        'visibleIf' in q &&
        q.visibleIf !== undefined &&
        conditionLeaves(q.visibleIf).some((l) => !byId.has(l.field));
      return inVisibility
        ? `${n} has a “when to show” rule that uses a deleted question. Change or remove that rule.`
        : `${n} has a skip rule that uses a deleted question. Change or remove that rule.`;
    }
    case 'dangling_jump':
      return `${n} has a skip rule that goes to a deleted question. Pick where it should go.`;
    case 'self_jump':
      return `${n} has a skip rule that goes to itself, so it does nothing. Pick a later question.`;
    case 'other_off':
      return `${n} has a rule that checks for “Other”, but that question doesn’t offer Other.`;
    case 'bad_prefill_key': {
      const key = (q as { prefillKey?: string } | undefined)?.prefillKey?.trim() ?? '';
      return isValidPrefillKey(key)
        ? `${n} uses the same link name as another question. Give each one its own.`
        : `${n} has a link name that can’t be used. Use letters, numbers, - or _.`;
    }
    case 'bad_bounds':
      if (q?.type === 'number') {
        return `${n} has a lowest number above its highest, so no answer fits. Swap them.`;
      }
      if (q?.type === 'scale')
        return `${n} starts above where it ends, so there’s nothing to pick.`;
      if (q?.type === 'date') {
        return `${n} has an earliest date after its latest date, so no date fits.`;
      }
      return `${n} has a minimum above its maximum, so no answer fits.`;
    case 'bad_price':
      return priceSentence(n, q);
    case 'area_off':
      return `${n} has a rule about the service area, but that question has no service area set up.`;
    case 'bad_service_area': {
      if (q?.type !== 'location') return `${n} lists a service area entry that isn’t a ZIP code.`;
      // Say only what's missing (copy QA): the location, the distance, or both.
      const rec = q as unknown as Record<string, unknown>;
      const center = geoCenter(rec) !== null;
      const radius = geoRadiusKm(rec) !== null;
      return center && !radius
        ? `${n} needs a distance to check the service area, or clear your business location.`
        : !center && radius
          ? `${n} needs your business location to check the service area, or clear the distance.`
          : `${n} needs your business location and a distance to check the service area.`;
    }
    case 'no_fields':
      return `${n} asks for no contact details. Turn on name, email or phone.`;
    case 'no_image':
      return `${n} needs a photo to mark. Upload one, or paste a link to a photo.`;
    case 'no_items':
      // A checklist whose photos are all unnamed isn't empty (copy QA).
      return q?.type === 'photo_checklist' && (q.items ?? []).length > 0
        ? `${n} has photos to take with no names. Name each one, so people know what to shoot.`
        : `${n} doesn’t list any photos to take. Add at least one.`;
    case 'bad_grid':
      return gridSentence(n, q);
    case 'swipe_single':
      return `${n} uses swipe cards, which need “Allow multiple selections” turned on.`;
    case 'no_slots':
      return `${n} has no slots to sign up for. Add one with a name and its spots.`;
    case 'bad_slots':
      return slotSentence(n, q);
    default:
      // A check this list doesn't know yet: its message, with titles for ids.
      return issue.message.replace(/"([^"]+)"/g, (whole, id: string) =>
        byId.has(id) ? ownerName(byId.get(id)) : whole,
      );
  }
}

/** The studio's own rule checks (S7): what the logic editor flags, form-wide. */
function ruleIssues(questions: ReadonlyArray<Question>, byId: Map<string, Question>): OwnerIssue[] {
  const out: OwnerIssue[] = [];
  const add = (q: Question, kind: OwnerIssueKind, text: string) =>
    out.push({ questionId: q.id, kind, text, blocking: false });

  questions.forEach((q, at) => {
    const n = ownerName(q);
    if ('visibleIf' in q && q.visibleIf) {
      for (const c of conditionLeaves(q.visibleIf)) {
        const used = byId.get(c.field);
        if (!used) continue; // checkSchema: dangling_condition
        const leaf = toLeaf(c);
        if (c.field === q.id) {
          add(
            q,
            'rule_self',
            `${n} only shows once it’s answered, so it never shows. Change its “when to show” rule.`,
          );
        } else if (indexOf(questions, c.field) > at) {
          add(
            q,
            'rule_later',
            `${n} waits for ${ownerName(used)}, which comes after it, so it may never show.`,
          );
        } else if (leaf && unfinishedReason(leaf, questions)) {
          add(
            q,
            'rule_unfinished',
            `${n} has an unfinished “when to show” rule. Finish it or remove it.`,
          );
        } else if (leaf && leaf.value !== OTHER_VALUE && answerRemoved(leaf, questions)) {
          // "Other" switched off is the engine's own issue (other_off): said once (R25).
          add(
            q,
            'answer_removed',
            `${n} has a rule that uses an answer ${ownerName(used)} no longer offers.`,
          );
        }
      }
    }
    const logic = ('logic' in q && q.logic) || [];
    for (const rule of logic) {
      const to = indexOf(questions, rule.goTo);
      if (to !== -1 && to < at) {
        add(
          q,
          'jump_back',
          `${n} skips back to ${ownerName(byId.get(rule.goTo))}, so people could go round in circles.`,
        );
      }
      for (const c of conditionLeaves(rule.if)) {
        const used = byId.get(c.field);
        if (!used) continue;
        const leaf = toLeaf(c);
        if (indexOf(questions, c.field) > at) {
          add(
            q,
            'rule_later',
            `${n} has a skip rule that uses ${ownerName(used)}, which comes after it.`,
          );
        } else if (leaf && unfinishedReason(leaf, questions)) {
          add(q, 'rule_unfinished', `${n} has an unfinished skip rule. Finish it or remove it.`);
        } else if (leaf && leaf.value !== OTHER_VALUE && answerRemoved(leaf, questions)) {
          add(
            q,
            'answer_removed',
            `${n} has a rule that uses an answer ${ownerName(used)} no longer offers.`,
          );
        }
      }
    }
  });
  return out;
}

/**
 * Everything worth the owner's attention, in plain sentences: blocking ones
 * first, then in form order, each sentence once.
 */
export function ownerIssues(questions: ReadonlyArray<Question>): OwnerIssue[] {
  const byId = new Map(questions.map((q) => [q.id, q] as const));
  const fromEngine = checkSchema(questions).map((issue): OwnerIssue => {
    const q = byId.get(issue.questionId);
    return {
      questionId: issue.questionId,
      kind: issue.kind,
      text: sentence(issue, q, byId),
      blocking: schemaIssueBlocks(issue.kind, q),
    };
  });
  // Settings only the studio checks (pick limits, options, the redirect…), already in plain words.
  const fromSettings = studioIssues(questions).map(
    (i): OwnerIssue => ({
      questionId: i.questionId,
      kind: i.kind,
      text: i.message,
      blocking: i.blocking,
    }),
  );
  const seen = new Set<string>();
  const unique = [...fromEngine, ...fromSettings, ...ruleIssues(questions, byId)].filter((i) => {
    const key = `${i.questionId}\u0000${i.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return sortIssues(unique, questions);
}

/** Blocking issues first, then in the order the questions appear. */
export function sortIssues(
  issues: ReadonlyArray<OwnerIssue>,
  questions: ReadonlyArray<Question>,
): OwnerIssue[] {
  const order = (id: string) => {
    const i = indexOf(questions, id);
    return i === -1 ? questions.length : i;
  };
  return [...issues].sort(
    (a, b) => Number(b.blocking) - Number(a.blocking) || order(a.questionId) - order(b.questionId),
  );
}

const things = (n: number) => `${n} ${n === 1 ? 'thing' : 'things'}`;

/** "2 things to fix before you publish · 1 to check" */
export function issuesHeading(issues: ReadonlyArray<OwnerIssue>, cloud: boolean): string {
  const block = issues.filter((i) => i.blocking).length;
  const check = issues.length - block;
  const fix = `${things(block)} to fix before you ${cloud ? 'publish' : 'share'}`;
  if (block && check) return `${fix} · ${check} to check`;
  return block ? fix : `${things(check)} to check`;
}

/** Title and lines for "can't publish yet" (the editor's dialog, the Share panel). */
export function publishBlockedCopy(blocking: ReadonlyArray<OwnerIssue>): {
  title: string;
  lead: string;
  lines: string[];
} {
  const shown = blocking.slice(0, 3).map((i) => i.text);
  if (blocking.length > 3)
    shown.push(`And ${blocking.length - 3} more, listed at the top of the editor.`);
  return {
    title:
      blocking.length === 1
        ? 'Fix this before you publish'
        : `Fix these ${blocking.length} things before you publish`,
    lead: 'People couldn’t finish your form as it is.',
    lines: shown,
  };
}
