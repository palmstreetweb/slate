/**
 * The editor's issue list in the owner's words (S9, S10). The engine's
 * `checkSchema` finds what's wrong, but its messages are for developers (they
 * quote internal ids). This names each question by its title, says what to
 * change, adds the studio's own rule checks (S7), and marks the problems that
 * would stop people finishing the form: only those hold Publish back.
 *
 * Studio only; the engine keeps its developer messages, so this costs no
 * engine bytes. A new `SchemaIssue` kind gets the fallback sentence (its ids
 * swapped for titles) and never blocks until it's listed here.
 */

import type { Question, SchemaIssue } from '@/index.js';
import { checkSchema } from '@/index.js';
import { isValidPrefillKey } from '@/logic/prefill.js';
import { TYPE_LABEL } from './questionTypeMeta.js';
import { answerRemoved, conditionLeaves, indexOf, toLeaf, unfinishedReason } from './logicRules.js';

export type OwnerIssueKind =
  | SchemaIssue['kind']
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

const required = (q: Question) => (q as { required?: boolean }).required === true;

/** Would this stop people finishing the form? */
function blocks(kind: OwnerIssueKind, q: Question | undefined): boolean {
  if (!q) return false;
  switch (kind) {
    // Two questions share one answer slot: answers mix, and Back goes to the wrong one.
    case 'duplicate_id':
      return true;
    // No answer fits (a number, scale or date can never be valid).
    case 'bad_bounds':
      return q.type === 'number' || q.type === 'scale' || q.type === 'date';
    // Nothing to tap, paint or pick, and the question insists.
    case 'no_image':
    case 'bad_grid':
      return required(q);
    case 'no_slots':
      return (q as { required?: boolean }).required !== false;
    default:
      return false;
  }
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
      return `${n} has a price that isn’t a number, is too big, or ends below where it starts.`;
    case 'area_off':
      return `${n} has a rule about the service area, but that question has no service area set up.`;
    case 'bad_service_area':
      return q?.type === 'location'
        ? `${n} needs your business location and a distance to check the service area.`
        : `${n} lists a service area entry that isn’t a ZIP code.`;
    case 'no_fields':
      return `${n} asks for no contact details. Turn on name, email or phone.`;
    case 'no_image':
      return `${n} needs a photo to mark. Upload one or paste an https link.`;
    case 'no_items':
      return `${n} doesn’t list any photos to take. Add at least one.`;
    case 'bad_grid':
      return `${n} has days, times or a slot length the grid can’t use.`;
    case 'swipe_single':
      return `${n} uses swipe cards, which need “Allow multiple selections” turned on.`;
    case 'no_slots':
      return `${n} has no slots to sign up for. Add one with a name and its spots.`;
    case 'bad_slots':
      return `${n} has a slot it can’t offer. Each needs a name, 1 to 1,000 spots, and a real date and time.`;
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
        } else if (leaf && answerRemoved(leaf, questions)) {
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
        } else if (leaf && answerRemoved(leaf, questions)) {
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
      blocking: blocks(issue.kind, q),
    };
  });
  const seen = new Set<string>();
  const unique = [...fromEngine, ...ruleIssues(questions, byId)].filter((i) => {
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
