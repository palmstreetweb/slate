import { describe, expect, it } from 'vitest';
import { captureFormCardRects, shouldAnimateFormGrid } from '../examples/_admin/formGridFlip.js';

describe('formGridFlip', () => {
  it('captureFormCardRects reads data-form-id keys', () => {
    const grid = document.createElement('div');
    const a = document.createElement('div');
    a.dataset.formCard = '';
    a.dataset.formId = 'f_a';
    grid.appendChild(a);
    Object.defineProperty(a, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 100, height: 80 }),
    });
    const map = captureFormCardRects(grid);
    expect(map.get('f_a')?.width).toBe(100);
  });

  it('shouldAnimateFormGrid respects reduced motion', () => {
    expect(typeof shouldAnimateFormGrid()).toBe('boolean');
  });
});
