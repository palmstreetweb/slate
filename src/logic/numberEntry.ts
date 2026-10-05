/**
 * Reading a typed number (F16), shared by the number box and the stepper.
 * Pure, no React. On demand only: nothing the engine's core imports may
 * import this (a core module's exports all ship up front, AGENTS.md).
 *
 * Numbers as people type them are read: "1,000", "$150", "1 500", "2,5",
 * full-width digits, "−5" with a typographic minus, and the question's own
 * prefix or unit ("$", "sq ft"). Forms a person wouldn't mean are not:
 * "0x0A", "1e1", "Infinity", "5abc".
 */

/** The message for anything that isn't a number. */
export const NOT_A_NUMBER = 'Please use numbers only, like 1500';

/** '' → undefined, junk → NaN, else the number. */
export function parseTypedNumber(text: string, prefix = '', unit = ''): number | undefined {
  let t = text.normalize('NFKC').replace(/[−–]/g, '-').trim();
  if (t === '') return undefined;
  let negative = false;
  // A sign, the question's prefix or a currency sign, in either order: "-$5", "$-5".
  for (;;) {
    if (t[0] === '-' || t[0] === '+') {
      negative ||= t[0] === '-';
      t = t.slice(1).trim();
    } else if (prefix && t.startsWith(prefix)) {
      t = t.slice(prefix.length).trim();
    } else if (/^[$€£¥₹]/.test(t)) {
      t = t.slice(1).trim();
    } else break;
  }
  if (unit && t.toLowerCase().endsWith(unit.toLowerCase())) t = t.slice(0, -unit.length).trim();
  // Thousands in groups of three ("1,000", "1 500"); a decimal comma ("2,5", "1,25").
  if (/^\d{1,3}([, ]\d{3})+(\.\d+)?$/.test(t)) t = t.replace(/[, ]/g, '');
  else if (/^\d+,\d{1,2}$/.test(t)) t = t.replace(',', '.');
  if (!/^(\d+\.?\d*|\.\d+)$/.test(t)) return Number.NaN;
  const n = Number(t);
  return negative ? -n : n;
}
