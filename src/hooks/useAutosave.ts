/**
 * Save-and-resume (ADR-017).
 *
 * Persists in-progress sessions to `localStorage` under
 * `slate-forms-resume:<formId>` — or, with `tab`, to `sessionStorage`: it
 * survives a reload or back / forward, and goes with the tab when the browser
 * copies it (a duplicated tab, a closed tab reopened, a restored session).
 * A tab's save is offered back only within 30 minutes of the last answer, so
 * on a shared device the next person rarely meets it (ADR-017 addendum). On
 * mount, a previously saved session (if any) is surfaced so the Form can
 * offer a "resume where you left off?" prompt. The save is cleared on
 * successful submit or when the user declines (Start over).
 *
 * The save carries the fill's id (`fill`), so a reload and Resume send the
 * same fill again rather than a second one (ADR-069).
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

/**
 * The save, if it can be offered back. A tab's save is offered for 30 minutes
 * (18e5 ms) after the last answer (SEC-2); after that, or with no time we can
 * read, it is deleted instead.
 */
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
      if (tab && !(Date.now() - Date.parse((parsed as SavedSession).savedAt) < 18e5)) {
        store(tab).removeItem(storageKey(formId));
        return null;
      }
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
  /** This fill's id (`SubmitMeta.fillId`), saved with the answers. */
  fill?: string;
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

export function useAutosave({ enabled, tab, formId, answers, step, visitedIds, fill }: Opts): Api {
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
        fill,
        savedAt: new Date().toISOString(),
      };
      store(tab).setItem(storageKey(formId), JSON.stringify(session));
    } catch {
      // Storage full / blocked — autosave silently degrades.
    }
  }, [enabled, tab, formId, answers, step, visitedIds, fill]);

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
