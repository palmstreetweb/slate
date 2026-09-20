import type { GeneratedForm } from '../../../api/generateFormSchema.js';
import { mapGeneratedForm } from '../../../api/mapGeneratedForm.js';
import type { Schema } from '@/index.js';

export type GeneratedDraft = { name: string; schema: Schema };

export async function requestGeneratedForm(prompt: string): Promise<GeneratedDraft> {
  const res = await fetch('/api/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt }),
  });
  const data = (await res.json().catch(() => null)) as
    | { form?: GeneratedForm; error?: string }
    | null;
  if (!res.ok || !data?.form) {
    throw new Error(data?.error || `Generate failed (${res.status}).`);
  }
  return mapGeneratedForm(data.form);
}

export const AI_DRAFT_KEY = 'slate-ai-draft';

export function markAiDraft(formId: string): void {
  sessionStorage.setItem(AI_DRAFT_KEY, formId);
}

export function isAiDraft(formId: string): boolean {
  return sessionStorage.getItem(AI_DRAFT_KEY) === formId;
}

export function clearAiDraft(): void {
  sessionStorage.removeItem(AI_DRAFT_KEY);
}
