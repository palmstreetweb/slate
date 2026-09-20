/**
 * Keys that should fire a typewriter tick (ADR-034). Printable characters,
 * Backspace, and Delete — not modifiers, Enter, arrows, or IME composition.
 */

export function isTypewriterKey(e: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  isComposing?: boolean;
}): boolean {
  if (e.isComposing) return false;
  if (e.metaKey || e.ctrlKey || e.altKey) return false;
  if (e.key.length === 1) return true;
  return e.key === 'Backspace' || e.key === 'Delete';
}
