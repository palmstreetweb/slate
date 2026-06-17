/** Canonical default when creating a form in the admin. */
export const DEFAULT_FORM_NAME = 'Untitled form';

const DEFAULT_FORM_NAME_VARIANTS = new Set([
  'untitled form',
  'untitled',
  'new form',
]);

/** True when the form still has a placeholder/default name (or is blank). */
export function isDefaultFormName(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  return normalized.length === 0 || DEFAULT_FORM_NAME_VARIANTS.has(normalized);
}

export function normalizeFormNameInput(value: string): string {
  return value.trim();
}
