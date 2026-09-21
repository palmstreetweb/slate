/** Letter-key helpers for choice-type questions. */

/** One key per option, A through Z. Past Z there is no single key, so those stay click-only. */
export const CHOICE_LETTERS = [
  'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M',
  'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z',
] as const;

export type ChoiceLetter = (typeof CHOICE_LETTERS)[number];

/** Returns 0-based index for a letter A–Z, or -1 if not a choice letter. */
export function indexFromLetter(key: string): number {
  const upper = key.toUpperCase();
  return (CHOICE_LETTERS as readonly string[]).indexOf(upper);
}

/** Returns the letter for a 0-based index, or empty string if out of range. */
export function letterFromIndex(i: number): string {
  return CHOICE_LETTERS[i] ?? '';
}
