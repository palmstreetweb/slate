/**
 * One-time migration for rebranded localStorage keys (psw-* → slate-*).
 * Copies legacy → new when new is absent; leaves legacy keys in place.
 *
 * TODO(remove after ~2026-07-15): drop psw-* localStorage migration shim
 */

export function migrateLocalStorageKey(oldKey: string, newKey: string): void {
  if (typeof window === 'undefined') return;
  try {
    if (window.localStorage.getItem(newKey) != null) return;
    const legacy = window.localStorage.getItem(oldKey);
    if (legacy != null) {
      window.localStorage.setItem(newKey, legacy);
    }
  } catch {
    // localStorage unavailable in some test/SSR contexts — ignore.
  }
}

/** Migrate every key starting with `oldPrefix` to the same suffix under `newPrefix`. */
export function migrateLocalStoragePrefix(oldPrefix: string, newPrefix: string): void {
  if (typeof window === 'undefined') return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key?.startsWith(oldPrefix)) keys.push(key);
    }
    for (const key of keys) {
      const newKey = newPrefix + key.slice(oldPrefix.length);
      if (window.localStorage.getItem(newKey) != null) continue;
      const legacy = window.localStorage.getItem(key);
      if (legacy != null) {
        window.localStorage.setItem(newKey, legacy);
      }
    }
  } catch {
    // ignore
  }
}

/** Engine + Slate admin keys renamed in the Slate rebrand (ADR-025). */
export function migrateSlateLocalStorageKeys(): void {
  migrateLocalStorageKey('psw-forms-theme', 'slate-forms-theme');
  migrateLocalStoragePrefix('psw-forms-resume:', 'slate-forms-resume:');
  migrateLocalStorageKey('psw-studio-theme', 'slate-theme');
  migrateLocalStorageKey('psw-studio-forms', 'slate-forms');
  migrateLocalStorageKey('psw-studio-submissions', 'slate-submissions');
}
