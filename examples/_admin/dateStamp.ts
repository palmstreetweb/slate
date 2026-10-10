/**
 * `YYYY-MM-DD` in the owner's own time zone, for file names. `toISOString()`
 * gave the UTC date, which is tomorrow's for an evening export in the Americas
 * (audit A3).
 */
export function localDateStamp(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
