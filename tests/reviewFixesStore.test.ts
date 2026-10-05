/**
 * Review fixes of 2026-10-05 (ENG-03, SEC-1): the offline store keys a fill
 * the way the submit Function does (ADR-067), so the offline studio's
 * portable links and test runs store a fill sent again once.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import type { SubmitMeta } from '@/index.js';
import {
  addSubmission,
  listSubmissions,
  resetSubmissionsStorage,
} from '../examples/_admin/_submissionStore.js';

const meta = (fillId?: string): SubmitMeta => ({
  startedAt: new Date('2026-10-05T10:00:00Z'),
  completedAt: new Date('2026-10-05T10:01:00Z'),
  durationMs: 60_000,
  questionsVisited: ['q1'],
  hiddenFields: {},
  score: 0,
  ...(fillId ? { fillId } : {}),
});

const FILL = '6f1c2a54-0b3e-4c8e-9d2a-1b7e5c4a9f01';

beforeEach(() => resetSubmissionsStorage());

describe('the offline store keys a fill like the submit Function (ENG-03)', () => {
  it('the same fill sent again is the response already stored', () => {
    const first = addSubmission('local_f', { q1: 'Ada' }, meta(FILL));
    const again = addSubmission('local_f', { q1: 'Ada' }, meta(FILL));
    expect(again.id).toBe(first.id);
    expect(listSubmissions('local_f')).toHaveLength(1);
    expect(listSubmissions('local_f')[0]!.submitKey).toBe(FILL);
  });

  it('another fill, another form, or no key is a new response', () => {
    addSubmission('local_f', { q1: 'Ada' }, meta(FILL));
    addSubmission('local_f', { q1: 'Bea' }, meta('0e9d8c7b-6a5f-4e3d-8c2b-1a0f9e8d7c6b'));
    addSubmission('local_g', { q1: 'Ada' }, meta(FILL));
    addSubmission('local_f', { q1: 'Cy' }, meta());
    addSubmission('local_f', { q1: 'Cy' }, meta());
    expect(listSubmissions('local_f')).toHaveLength(4);
    expect(listSubmissions('local_g')).toHaveLength(1);
  });
});
