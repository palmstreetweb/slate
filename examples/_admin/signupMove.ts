/**
 * The roster's move between sign-up slots (ADR-066), studio-only: out of
 * `from` (a slot someone holds or waits for) and into `to`, refused when `to`
 * is at `capacity` unless `force`. Cloud: migration 020's owner-checked
 * move_signup_slot, which counts under the form's lock (the database is the
 * judge; the cached row follows it). Local: the same rule over the responses
 * in this browser. Kept out of the stores so the respondent's bundle, which
 * shares them, doesn't carry it.
 */

import { signupPicks } from '@/logic/signupAnswer.js';
import { getSubmission, listSubmissions, patchSubmissionAnswer } from './_submissionStore.js';
import { isNeonConfigured } from './neon/env.js';
import { isStoresHydrated } from './neon/hydrate.js';
import { getNeon } from './neon/client.js';
import { ensureAuthForDataApi } from './neon/ensureAuth.js';
import { formatNeonError } from './neon/neonError.js';

export type MoveSignupResult =
  | { ok: true }
  | { ok: false; reason: 'full'; taken: number; capacity: number }
  | { ok: false; reason: 'gone' | 'error'; message: string };

export type MoveSignupArgs = {
  submissionId: string;
  questionId: string;
  from: string;
  to: string;
  /** The slot's spots (local mode; the database reads its own). */
  capacity: number;
  force?: boolean;
};

/**
 * The answer after a move: `from` and `to` leave both lists, and `to` is added
 * last to the taken slots. `from === to` takes a waitlisted person into that
 * slot. move_signup_slot makes the same change in SQL.
 */
export function moveSignupAnswer(
  v: unknown,
  from: string,
  to: string,
): { slots: string[]; wait?: string[] } {
  const { slots, wait } = signupPicks(v);
  const nextSlots = [...slots.filter((s) => s !== from && s !== to), to];
  const nextWait = wait.filter((s) => s !== from && s !== to);
  return nextWait.length ? { slots: nextSlots, wait: nextWait } : { slots: nextSlots };
}

async function moveRemote(args: MoveSignupArgs): Promise<MoveSignupResult> {
  try {
    await ensureAuthForDataApi();
    const { data, error } = await getNeon().rpc('move_signup_slot', {
      p_submission_id: args.submissionId,
      p_question_id: args.questionId,
      p_from: args.from,
      p_to: args.to,
      p_force: args.force === true,
    });
    if (error) throw error;
    const row = (Array.isArray(data) ? data[0] : data) as
      | { outcome?: unknown; taken?: unknown; capacity?: unknown }
      | null
      | undefined;
    if (row?.outcome === 'full') {
      return {
        ok: false,
        reason: 'full',
        taken: Number(row.taken) || 0,
        capacity: Number(row.capacity) || 0,
      };
    }
    if (row?.outcome !== 'ok') {
      return {
        ok: false,
        reason: 'gone',
        message:
          row?.outcome === 'bad_slot'
            ? 'That slot isn’t on the published form. Publish your changes first.'
            : 'That response changed or is gone. Refresh and try again.',
      };
    }
    const sub = getSubmission(args.submissionId);
    if (sub) {
      patchSubmissionAnswer(
        sub.id,
        args.questionId,
        moveSignupAnswer(sub.answers[args.questionId], args.from, args.to),
      );
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: 'error', message: formatNeonError(err, 'Could not move them') };
  }
}

export async function moveSignupSlot(args: MoveSignupArgs): Promise<MoveSignupResult> {
  if (isNeonConfigured()) {
    if (!isStoresHydrated()) {
      return {
        ok: false,
        reason: 'error',
        message: 'Cloud sync is not ready — try again in a moment.',
      };
    }
    return moveRemote(args);
  }
  const sub = getSubmission(args.submissionId);
  const picks = signupPicks(sub?.answers[args.questionId]);
  if (
    !sub ||
    sub.deletedAt ||
    !(picks.slots.includes(args.from) || picks.wait.includes(args.from))
  ) {
    return { ok: false, reason: 'gone', message: 'That response changed or is gone.' };
  }
  const taken = listSubmissions(sub.formId).filter(
    (s) => s.id !== sub.id && signupPicks(s.answers[args.questionId]).slots.includes(args.to),
  ).length;
  if (taken >= args.capacity && !args.force) {
    return { ok: false, reason: 'full', taken, capacity: args.capacity };
  }
  patchSubmissionAnswer(
    sub.id,
    args.questionId,
    moveSignupAnswer(sub.answers[args.questionId], args.from, args.to),
  );
  return { ok: true };
}
