/** Letter-key helpers for choice-type questions. */

export const CHOICE_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'] as const;

export type ChoiceLetter = (typeof CHOICE_LETTERS)[number];

/** Returns 0-based index for a letter A–F, or -1 if not a choice letter. */
export function indexFromLetter(key: string): number {
  const upper = key.toUpperCase();
  return (CHOICE_LETTERS as readonly string[]).indexOf(upper);
}

/** Returns the letter for a 0-based index, or empty string if out of range. */
export function letterFromIndex(i: number): string {
  return CHOICE_LETTERS[i] ?? '';
}
