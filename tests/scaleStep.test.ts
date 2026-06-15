import { describe, it, expect } from 'vitest';
import { isScaleStepValue } from '@/utils/scaleStep.js';

describe('isScaleStepValue', () => {
  it('accepts values on the step grid', () => {
    expect(isScaleStepValue(0, 0, 10, 2)).toBe(true);
    expect(isScaleStepValue(4, 0, 10, 2)).toBe(true);
    expect(isScaleStepValue(10, 0, 10, 2)).toBe(true);
  });

  it('rejects off-step values', () => {
    expect(isScaleStepValue(5, 0, 10, 2)).toBe(false);
    expect(isScaleStepValue(3, 0, 10, 2)).toBe(false);
  });
});
