/** True when `value` sits on the scale grid defined by min + step. */
export function isScaleStepValue(value: number, min: number, max: number, step: number): boolean {
  if (value < min || value > max) return false;
  if (step <= 0) return true;
  const offset = value - min;
  return Math.abs(offset / step - Math.round(offset / step)) < 1e-9;
}
