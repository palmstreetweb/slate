/**
 * Save-and-resume (ADR-017).
 *
 * Persists in-progress sessions to `localStorage` under
 * `slate-forms-resume:<formId>` — or, with `tab`, to `sessionStorage`: this
 * tab only, surviving a reload or back / forward but never reaching another
 * tab or a later visit (ADR-017 addendum). On mount, a previously saved
 * session (if any) is surfaced so the Form can offer a "resume where you left
 * off?" prompt. The save is cleared on successful submit or when the user
 * declines.
 *
 * `File` answers can't be serialized — they're stripped from the snapshot
 * (the question will simply be unanswered after resuming).
 */

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { LooseAnswers } from '@/types/Answers.js';
import type { ResumeSnapshot } from './useFormState.js';

const KEY_PREFIX = 'slate-forms-resume:';

type SavedSession = ResumeSnapshot & { savedAt: string };

function storageKey(formId: string): string {
  return `${KEY_PREFIX}${formId}`;
}

/** This tab's storage, or the browser's. */
const store = (tab?: boolean): Storage => (tab ? window.sessionStorage : window.localStorage);

function readSession(formId: string, tab?: boolean): SavedSession | null {
  try {
    const raw = store(tab).getItem(storageKey(formId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      'answers' in parsed &&
      'step' in parsed &&
      'visitedIds' in parsed
    ) {
      return parsed as SavedSession;
    }
    return null;
  } catch {
    return null;
  }
}

function serializableAnswers(answers: LooseAnswers): LooseAnswers {
  const out: LooseAnswers = {};
  for (const [k, v] of Object.entries(answers)) {
    if (typeof File !== 'undefined' && v instanceof File) continue;
    if (Array.isArray(v)) {
      const kept = v.filter((item) => !(typeof File !== 'undefined' && item instanceof File));
      if (kept.length === 0) continue;
      out[k] = kept as typeof v;
      continue;
    }
    out[k] = v;
  }
  return out;
}

type Opts = {
  /** Off unless the host opted in AND provided a form id. */
  enabled: boolean;
  /** Keep the save in this tab only (`sessionStorage`). */
  tab?: boolean;
  formId: string;
  answers: LooseAnswers;
  step: number;
  visitedIds: string[];
};

type Api = {
  /** Saved session from a previous visit, if one exists and wasn't handled yet. */
  savedSession: ResumeSnapshot | null;
  /** Consume the prompt (the caller hydrates state itself). */
  acceptSaved: () => ResumeSnapshot | null;
  /** Dismiss the prompt and delete the save. */
  discardSaved: () => void;
  /** Delete the save (e.g. after successful submit). */
  clear: () => void;
};

export function useAutosave({ enabled, tab, formId, answers, step, visitedIds }: Opts): Api {
  const [savedSession, setSavedSession] = useState<ResumeSnapshot | null>(() => {
    if (!enabled || typeof window === 'undefined') return null;
    return readSession(formId, tab);
  });

  // While the resume prompt is open we must not overwrite the saved session
  // with the fresh (empty) state.
  const holdWrites = useRef(savedSession !== null);

  useEffect(() => {
    if (!enabled || holdWrites.current || typeof window === 'undefined') return;
    if (Object.keys(answers).length === 0 && step === 0) return;
    try {
      const session: SavedSession = {
        answers: serializableAnswers(answers),
        step,
        visitedIds,
        savedAt: new Date().toISOString(),
      };
      store(tab).setItem(storageKey(formId), JSON.stringify(session));
    } catch {
      // Storage full / blocked — autosave silently degrades.
    }
  }, [enabled, tab, formId, answers, step, visitedIds]);

  const clear = useCallback(() => {
    try {
      store(tab).removeItem(storageKey(formId));
    } catch {
      // ignored
    }
  }, [tab, formId]);

  const acceptSaved = useCallback(() => {
    holdWrites.current = false;
    setSavedSession(null);
    return savedSession;
  }, [savedSession]);

  const discardSaved = useCallback(() => {
    holdWrites.current = false;
    setSavedSession(null);
    clear();
  }, [clear]);

  return { savedSession, acceptSaved, discardSaved, clear };
}
