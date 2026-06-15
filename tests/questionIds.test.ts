import { describe, expect, it } from 'vitest';
import { uniqueQuestionId, slugifyQuestionId } from '../examples/_admin/questionIds.js';
import { completionLabel } from '../examples/_admin/responsesFormat.js';

describe('questionIds', () => {
  it('slugifies titles into readable ids', () => {
    expect(slugifyQuestionId('Pick any')).toBe('pick_any');
    expect(slugifyQuestionId('Which service?')).toBe('which_service');
  });

  it('dedupes colliding ids', () => {
    const existing = new Set(['pick_any']);
    expect(uniqueQuestionId('Pick any', existing)).toBe('pick_any_2');
  });
});

describe('completionLabel', () => {
  it('uses plain language', () => {
    expect(completionLabel(1, 1)).toBe('Answered');
    expect(completionLabel(0, 1)).toBe('Not answered');
    expect(completionLabel(2, 5)).toBe('2 of 5 answered');
    expect(completionLabel(5, 5)).toBe('All 5 answered');
  });
});
