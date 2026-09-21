import type { GeneratedForm } from '../../../api/generateFormSchema.js';
import { mapGeneratedForm } from '../../../api/mapGeneratedForm.js';
import type { Schema } from '@/index.js';

export type GeneratedDraft = {
  name: string;
  schema: Schema;
  form: GeneratedForm;
};

export type GenerateRequest = {
  prompt: string;
  previous?: GeneratedForm;
  instruction?: string;
  document?: {
    filename: string;
    mime?: string;
    base64?: string;
  };
};

export async function requestGeneratedForm(input: GenerateRequest): Promise<GeneratedDraft & { sourcePrompt: string }> {
  const res = await fetch('/api/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      prompt: input.prompt,
      previous: input.previous,
      instruction: input.instruction,
      document: input.document,
    }),
  });
  const data = (await res.json().catch(() => null)) as
    | { form?: GeneratedForm; prompt?: string; error?: string }
    | null;
  if (!res.ok || !data?.form) {
    throw new Error(data?.error || `Generate failed (${res.status}).`);
  }
  const mapped = mapGeneratedForm(data.form);
  return { ...mapped, form: data.form, sourcePrompt: data.prompt?.trim() || input.prompt };
}

export const AI_DRAFT_KEY = 'slate-ai-draft';
export const AI_RECENT_PROMPTS_KEY = 'slate-ai-recent-prompts';

export function markAiDraft(formId: string): void {
  sessionStorage.setItem(AI_DRAFT_KEY, formId);
}

export function isAiDraft(formId: string): boolean {
  return sessionStorage.getItem(AI_DRAFT_KEY) === formId;
}

export function clearAiDraft(): void {
  sessionStorage.removeItem(AI_DRAFT_KEY);
}

export function readRecentPrompts(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(AI_RECENT_PROMPTS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).slice(0, 4);
  } catch {
    return [];
  }
}

export function rememberPrompt(prompt: string): void {
  const trimmed = prompt.trim();
  if (!trimmed) return;
  const next = [trimmed, ...readRecentPrompts().filter((p) => p !== trimmed)].slice(0, 4);
  window.localStorage.setItem(AI_RECENT_PROMPTS_KEY, JSON.stringify(next));
}
