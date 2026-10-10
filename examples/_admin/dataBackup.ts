/**
 * Export / import all Slate data from localStorage — backup and restore
 * without DevTools. Pure helpers + store writers; no React.
 */

import type { Question } from '@/index.js';
import { isFileUploadRef } from '@/utils/fileUploadRef.js';
import type { FormRecord } from './_formsStore.js';
import type { StoredSubmission } from './_submissionStore.js';
import { normalizeAnswers, normalizeMeta } from './answerShape.js';

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

/**
 * Read a backup file. The shape is checked, not trusted (audit B12): a form
 * needs an id, a name and a schema with questions; a response needs its ids and
 * time, and its answers and meta are read the way the server's rows are, so a
 * response without `meta` can't break the Responses page or the CSV later. In
 * a file answer only a stored file's own ref is kept — a bare URL there would
 * make the owner's browser fetch it (audit F1).
 */
export function parseBackup(raw: string): SlateBackup | null {
  try {
    const parsed = JSON.parse(raw) as Partial<SlateBackup> | null;
    if (parsed?.v !== 1) return null;
    if (!Array.isArray(parsed.forms) || !Array.isArray(parsed.submissions)) return null;
    const forms = parsed.forms.filter(isFormRecordShape);
    const questions = new Map(forms.map((f) => [f.id, f.schema.questions as Question[]]));
    const submissions = parsed.submissions
      .filter(isSubmissionShape)
      .map((s) => normalizeBackupSubmission(s, questions.get(s.formId) ?? []));
    return {
      v: 1,
      exportedAt: typeof parsed.exportedAt === 'string' ? parsed.exportedAt : '',
      forms,
      submissions,
    };
  } catch {
    return null;
  }
}

function isFormRecordShape(f: unknown): f is FormRecord {
  if (!f || typeof f !== 'object') return false;
  const r = f as Record<string, unknown>;
  const schema = r.schema as Record<string, unknown> | null | undefined;
  return (
    typeof r.id === 'string' &&
    typeof r.name === 'string' &&
    Boolean(schema) &&
    typeof schema === 'object' &&
    Array.isArray(schema!.questions)
  );
}

function isSubmissionShape(s: unknown): s is Record<string, unknown> & {
  id: string;
  formId: string;
  receivedAt: string;
} {
  if (!s || typeof s !== 'object') return false;
  const r = s as Record<string, unknown>;
  return (
    typeof r.id === 'string' && typeof r.formId === 'string' && typeof r.receivedAt === 'string'
  );
}

function normalizeBackupSubmission(
  s: Record<string, unknown> & { id: string; formId: string; receivedAt: string },
  questions: ReadonlyArray<Question>,
): StoredSubmission {
  const answers = normalizeAnswers(s.answers);
  for (const q of questions) {
    if (!(q.id in answers)) continue;
    const kept = fileRefsOnly(q, answers[q.id]);
    if (kept === undefined) delete answers[q.id];
    else answers[q.id] = kept as StoredSubmission['answers'][string];
  }
  return {
    id: s.id,
    formId: s.formId,
    receivedAt: s.receivedAt,
    answers,
    meta: normalizeMeta(s.meta),
    ...(typeof s.deletedAt === 'string' ? { deletedAt: s.deletedAt } : {}),
    ...(typeof s.submitKey === 'string' ? { submitKey: s.submitKey } : {}),
  };
}

/**
 * A file answer with only its stored refs: a file upload's items, a voice
 * note's recording, a photo checklist's photos (the shapes `fileRefsOf` reads).
 * Other questions come back as they are. `undefined` drops the answer.
 */
function fileRefsOnly(q: Question, value: unknown): unknown {
  if (q.type === 'file_upload') {
    const items = Array.isArray(value) ? value : [value];
    const refs = items.filter(isFileUploadRef);
    return refs.length ? refs : undefined;
  }
  if (q.type === 'voice_note') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    const { audio, ...rest } = value as Record<string, unknown>;
    return isFileUploadRef(audio) ? { ...rest, audio } : rest;
  }
  if (q.type === 'photo_checklist') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).filter(([, v]) => isFileUploadRef(v)),
    );
  }
  return value;
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
