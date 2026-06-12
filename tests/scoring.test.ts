/** Scoring accumulator (ADR-016). */

import { describe, it, expect } from 'vitest';
import { computeScore } from '@/logic/scoring.js';
import type { Question } from '@/types/Question.js';

const questions: Question[] = [
  {
    id: 'q1',
    type: 'single_choice',
    title: 'Pick one',
    options: [
      { label: 'A', value: 'a', score: 10 },
      { label: 'B', value: 'b', score: 5 },
      { label: 'C', value: 'c' },
    ],
  },
  {
    id: 'q2',
    type: 'multi_choice',
    title: 'Pick many',
    options: [
      { label: 'X', value: 'x', score: 1 },
      { label: 'Y', value: 'y', score: 2 },
      { label: 'Z', value: 'z', score: 4 },
    ],
  },
  {
    id: 'q3',
    type: 'short_text',
    title: 'No options here',
  },
];

describe('computeScore', () => {
  it('zero with no answers', () => {
    expect(computeScore(questions, {})).toBe(0);
  });

  it('sums single_choice option score', () => {
    expect(computeScore(questions, { q1: 'a' })).toBe(10);
  });

  it('unscored options count zero', () => {
    expect(computeScore(questions, { q1: 'c' })).toBe(0);
  });

  it('sums every selected multi_choice option', () => {
    expect(computeScore(questions, { q2: ['x', 'z'] })).toBe(5);
  });

  it('accumulates across questions', () => {
    expect(computeScore(questions, { q1: 'b', q2: ['x', 'y', 'z'] })).toBe(12);
  });

  it('ignores answers that match no option', () => {
    expect(computeScore(questions, { q1: 'nope', q2: ['nah'] })).toBe(0);
  });
});
