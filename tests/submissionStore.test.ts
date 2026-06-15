import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Answers } from '@/index.js';
import {
  addSubmission,
  countSubmissions,
  countTrashedSubmissions,
  emptyTrash,
  listAllSubmissions,
  listSubmissions,
  listTrashedSubmissions,
  permanentlyDeleteSubmission,
  purgeSubmissions,
  replaceAllSubmissions,
  resetSubmissionsStorage,
  restoreSubmission,
  trashSubmission,
  trashSubmissions,
} from '../examples/_admin/_submissionStore.js';

const FORM_A = 'form_a';
const FORM_B = 'form_b';

const answers: Answers = { q1: 'hello' };

const meta = {
  startedAt: new Date('2026-01-01T00:00:00Z'),
  completedAt: new Date('2026-01-01T00:01:00Z'),
  durationMs: 60_000,
  questionsVisited: ['q1'],
  hiddenFields: [],
  score: 1,
};

describe('submission store trash', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {
      localStorage: {
        store: {} as Record<string, string>,
        getItem(key: string) {
          return this.store[key] ?? null;
        },
        setItem(key: string, value: string) {
          this.store[key] = value;
        },
        removeItem(key: string) {
          delete this.store[key];
        },
      },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    resetSubmissionsStorage();
  });

  it('keeps trashed submissions out of the inbox', () => {
    const sub = addSubmission(FORM_A, answers, meta);
    trashSubmission(sub.id);

    expect(listSubmissions(FORM_A)).toHaveLength(0);
    expect(listTrashedSubmissions(FORM_A)).toHaveLength(1);
    expect(countSubmissions(FORM_A)).toBe(0);
    expect(countTrashedSubmissions(FORM_A)).toBe(1);
    expect(listAllSubmissions()).toHaveLength(1);
  });

  it('restores a trashed submission', () => {
    const sub = addSubmission(FORM_A, answers, meta);
    trashSubmission(sub.id);
    restoreSubmission(sub.id);

    expect(listSubmissions(FORM_A)).toHaveLength(1);
    expect(listTrashedSubmissions(FORM_A)).toHaveLength(0);
    expect(listSubmissions(FORM_A)[0]?.deletedAt).toBeUndefined();
  });

  it('trashes only the target form when scoped', () => {
    const a = addSubmission(FORM_A, answers, meta);
    const b = addSubmission(FORM_B, answers, meta);

    trashSubmissions(FORM_A);

    expect(listSubmissions(FORM_A)).toHaveLength(0);
    expect(listSubmissions(FORM_B)).toHaveLength(1);
    expect(listTrashedSubmissions(FORM_A)).toHaveLength(1);
    expect(listTrashedSubmissions(FORM_B)).toHaveLength(0);
    expect(a.id).not.toBe(b.id);
  });

  it('permanently deletes only from trash when emptying', () => {
    const active = addSubmission(FORM_A, answers, meta);
    const trashed = addSubmission(FORM_A, answers, meta);
    trashSubmission(trashed.id);

    emptyTrash(FORM_A);

    expect(listSubmissions(FORM_A)).toHaveLength(1);
    expect(listSubmissions(FORM_A)[0]?.id).toBe(active.id);
    expect(listTrashedSubmissions(FORM_A)).toHaveLength(0);
    expect(listAllSubmissions()).toHaveLength(1);
  });

  it('purges all submissions for a deleted form', () => {
    const sub = addSubmission(FORM_A, answers, meta);
    trashSubmission(sub.id);
    addSubmission(FORM_B, answers, meta);

    purgeSubmissions(FORM_A);

    expect(listAllSubmissions()).toHaveLength(1);
    expect(listAllSubmissions()[0]?.formId).toBe(FORM_B);
  });

  it('round-trips deletedAt through backup replace', () => {
    const sub = addSubmission(FORM_A, answers, meta);
    trashSubmission(sub.id);
    const snapshot = listAllSubmissions();

    resetSubmissionsStorage();
    expect(listAllSubmissions()).toHaveLength(0);

    replaceAllSubmissions(snapshot);
    expect(listTrashedSubmissions(FORM_A)).toHaveLength(1);
    permanentlyDeleteSubmission(sub.id);
    expect(listAllSubmissions()).toHaveLength(0);
  });
});
