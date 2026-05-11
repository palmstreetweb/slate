import { describe, it, expect } from 'vitest';
import { evaluate } from '@/logic/conditional.js';
import type { Condition } from '@/types/Question.js';

describe('conditional.evaluate — leaf operators', () => {
  it('equals matches strings and numbers', () => {
    expect(evaluate({ field: 'a', op: 'equals', value: 'x' }, { a: 'x' })).toBe(true);
    expect(evaluate({ field: 'a', op: 'equals', value: 'x' }, { a: 'y' })).toBe(false);
    expect(evaluate({ field: 'n', op: 'equals', value: 5 }, { n: 5 })).toBe(true);
  });

  it('not_equals is the inverse of equals', () => {
    expect(evaluate({ field: 'a', op: 'not_equals', value: 'x' }, { a: 'y' })).toBe(true);
    expect(evaluate({ field: 'a', op: 'not_equals', value: 'x' }, { a: 'x' })).toBe(false);
  });

  it('equals on multi_choice arrays checks membership', () => {
    expect(evaluate({ field: 'tags', op: 'equals', value: 'a' }, { tags: ['a', 'b'] })).toBe(true);
    expect(evaluate({ field: 'tags', op: 'equals', value: 'z' }, { tags: ['a', 'b'] })).toBe(false);
  });

  it('in matches any-of', () => {
    expect(evaluate({ field: 'a', op: 'in', value: ['x', 'y'] }, { a: 'y' })).toBe(true);
    expect(evaluate({ field: 'a', op: 'in', value: ['x', 'y'] }, { a: 'z' })).toBe(false);
  });

  it('in on multi_choice array — any-overlap wins', () => {
    expect(
      evaluate({ field: 'tags', op: 'in', value: ['a', 'z'] }, { tags: ['b', 'a'] }),
    ).toBe(true);
    expect(
      evaluate({ field: 'tags', op: 'in', value: ['a', 'z'] }, { tags: ['b', 'c'] }),
    ).toBe(false);
  });

  it('not_in on multi_choice — empty intersection', () => {
    expect(
      evaluate({ field: 'tags', op: 'not_in', value: ['a', 'z'] }, { tags: ['b', 'c'] }),
    ).toBe(true);
    expect(
      evaluate({ field: 'tags', op: 'not_in', value: ['a', 'z'] }, { tags: ['a', 'c'] }),
    ).toBe(false);
  });

  it('numeric comparisons require number values', () => {
    expect(evaluate({ field: 'n', op: 'gt', value: 10 }, { n: 11 })).toBe(true);
    expect(evaluate({ field: 'n', op: 'gt', value: 10 }, { n: 10 })).toBe(false);
    expect(evaluate({ field: 'n', op: 'gte', value: 10 }, { n: 10 })).toBe(true);
    expect(evaluate({ field: 'n', op: 'lt', value: 10 }, { n: 9 })).toBe(true);
    expect(evaluate({ field: 'n', op: 'lte', value: 10 }, { n: 10 })).toBe(true);
    // Non-number fields fail numeric comparisons.
    expect(evaluate({ field: 's', op: 'gt', value: 0 }, { s: '5' })).toBe(false);
  });

  it('is_empty / is_not_empty cover undefined, "", [], whitespace, null', () => {
    expect(evaluate({ field: 'x', op: 'is_empty' }, {})).toBe(true);
    expect(evaluate({ field: 'x', op: 'is_empty' }, { x: '' })).toBe(true);
    expect(evaluate({ field: 'x', op: 'is_empty' }, { x: '   ' })).toBe(true);
    expect(evaluate({ field: 'x', op: 'is_empty' }, { x: [] })).toBe(true);
    expect(evaluate({ field: 'x', op: 'is_empty' }, { x: 'hi' })).toBe(false);
    expect(evaluate({ field: 'x', op: 'is_not_empty' }, { x: 0 })).toBe(true);
    expect(evaluate({ field: 'x', op: 'is_not_empty' }, { x: ['a'] })).toBe(true);
  });

  it('unknown field is empty', () => {
    expect(evaluate({ field: 'missing', op: 'is_empty' }, {})).toBe(true);
    expect(evaluate({ field: 'missing', op: 'equals', value: 'x' }, {})).toBe(false);
  });
});

describe('conditional.evaluate — composites', () => {
  it('all = AND', () => {
    const c: Condition = {
      all: [
        { field: 'a', op: 'equals', value: 1 },
        { field: 'b', op: 'gt', value: 10 },
      ],
    };
    expect(evaluate(c, { a: 1, b: 11 })).toBe(true);
    expect(evaluate(c, { a: 1, b: 5 })).toBe(false);
    expect(evaluate(c, { a: 2, b: 11 })).toBe(false);
  });

  it('any = OR', () => {
    const c: Condition = {
      any: [
        { field: 'a', op: 'equals', value: 'x' },
        { field: 'b', op: 'equals', value: 'y' },
      ],
    };
    expect(evaluate(c, { a: 'x' })).toBe(true);
    expect(evaluate(c, { b: 'y' })).toBe(true);
    expect(evaluate(c, { a: 'x', b: 'y' })).toBe(true);
    expect(evaluate(c, {})).toBe(false);
  });

  it('nested all + any (infinite composability)', () => {
    const c: Condition = {
      all: [
        { any: [{ field: 'role', op: 'equals', value: 'admin' }, { field: 'role', op: 'equals', value: 'owner' }] },
        { field: 'tier', op: 'gte', value: 2 },
      ],
    };
    expect(evaluate(c, { role: 'admin', tier: 3 })).toBe(true);
    expect(evaluate(c, { role: 'owner', tier: 2 })).toBe(true);
    expect(evaluate(c, { role: 'admin', tier: 1 })).toBe(false);
    expect(evaluate(c, { role: 'guest', tier: 5 })).toBe(false);
  });

  it('empty all is vacuously true; empty any is vacuously false', () => {
    expect(evaluate({ all: [] }, {})).toBe(true);
    expect(evaluate({ any: [] }, {})).toBe(false);
  });
});
