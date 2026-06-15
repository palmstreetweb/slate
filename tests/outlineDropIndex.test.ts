import { describe, expect, it } from 'vitest';
import {
  clampOutlineDropIndex,
  computeOutlineDropIndex,
  measureOutlineDropLineY,
  measureOutlineGapY,
  resolveOutlineInsertIndex,
} from '../examples/_admin/outlineDropIndex.js';

const questions = [
  { type: 'welcome' },
  { type: 'short_text' },
  { type: 'short_text' },
  { type: 'short_text' },
  { type: 'thanks' },
];

describe('clampOutlineDropIndex', () => {
  it('keeps welcome first and thanks last', () => {
    expect(clampOutlineDropIndex(questions, 0)).toBe(1);
    expect(clampOutlineDropIndex(questions, 99)).toBe(4);
  });
});

describe('resolveOutlineInsertIndex', () => {
  it('adjusts insert index when moving down the list', () => {
    expect(resolveOutlineInsertIndex(1, 4)).toBe(3);
  });

  it('keeps insert index when moving up the list', () => {
    expect(resolveOutlineInsertIndex(3, 1)).toBe(1);
  });
});

describe('measureOutlineDropLineY', () => {
  it('returns y at the top edge of the target item', () => {
    const list = document.createElement('ul');
    const a = document.createElement('li');
    const b = document.createElement('li');
    a.className = 'slate-outline-item';
    b.className = 'slate-outline-item';
    Object.defineProperty(a, 'getBoundingClientRect', {
      value: () => ({ top: 100, bottom: 140, left: 0, right: 0, width: 0, height: 40 }),
    });
    Object.defineProperty(b, 'getBoundingClientRect', {
      value: () => ({ top: 142, bottom: 182, left: 0, right: 0, width: 0, height: 40 }),
    });
    Object.defineProperty(list, 'getBoundingClientRect', {
      value: () => ({ top: 80, bottom: 200, left: 0, right: 0, width: 0, height: 120 }),
    });
    list.append(a, b);

    expect(measureOutlineDropLineY(list, 1)).toBe(61);
    expect(measureOutlineDropLineY(list, 2)).toBe(103);
  });
});

describe('measureOutlineGapY', () => {
  it('centers the gap between two items', () => {
    const list = document.createElement('ul');
    const a = document.createElement('li');
    const b = document.createElement('li');
    a.className = 'slate-outline-item';
    b.className = 'slate-outline-item';
    Object.defineProperty(a, 'getBoundingClientRect', {
      value: () => ({ top: 100, bottom: 136, left: 0, right: 0, width: 0, height: 36 }),
    });
    Object.defineProperty(b, 'getBoundingClientRect', {
      value: () => ({ top: 138, bottom: 174, left: 0, right: 0, width: 0, height: 36 }),
    });
    Object.defineProperty(list, 'getBoundingClientRect', {
      value: () => ({ top: 80, bottom: 200, left: 0, right: 0, width: 0, height: 120 }),
    });
    list.append(a, b);

    expect(measureOutlineGapY(list, 1)).toBe(39);
  });
});

describe('computeOutlineDropIndex', () => {
  it('picks insert-before from pointer y', () => {
    const list = document.createElement('ul');
    const a = document.createElement('li');
    a.className = 'slate-outline-item';
    Object.defineProperty(a, 'getBoundingClientRect', {
      value: () => ({ top: 100, bottom: 140, left: 0, right: 0, width: 0, height: 40 }),
    });
    list.append(a);

    expect(computeOutlineDropIndex(list, questions, 110)).toBe(1);
    expect(computeOutlineDropIndex(list, questions, 150)).toBe(1);
  });
});
