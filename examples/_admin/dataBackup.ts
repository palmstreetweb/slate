/**
 * Export / import all Slate data from localStorage — backup and restore
 * without DevTools. Pure helpers + store writers; no React.
 */

import type { FormRecord } from './_formsStore.js';
import type { StoredSubmission } from './_submissionStore.js';

export type SlateBackup = {
  v: 1;
  exportedAt: string;
  forms: FormRecord[];
  submissions: StoredSubmission[];
};

export function buildBackup(forms: FormRecord[], submissions: StoredSubmission[]): SlateBackup {
  return {
    v: 1,
    exportedAt: new Date().toISOString(),
    forms,
    submissions,
  };
}

export function serializeBackup(backup: SlateBackup): string {
  return JSON.stringify(backup, null, 2);
}

export function parseBackup(raw: string): SlateBackup | null {
  try {
    const parsed = JSON.parse(raw) as SlateBackup;
    if (parsed?.v !== 1) return null;
    if (!Array.isArray(parsed.forms) || !Array.isArray(parsed.submissions)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function downloadBackupJson(backup: SlateBackup, filename = 'slate-backup.json'): void {
  const blob = new Blob([serializeBackup(backup)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function pickBackupFile(): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsText(file);
    };
    input.click();
  });
}
