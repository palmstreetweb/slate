import type { GeneratedForm } from '../../../api/generateFormSchema.js';
import { mapGeneratedForm } from '../../../api/mapGeneratedForm.js';
import type { Schema } from '@/index.js';
import { authHeader } from '../storageUpload.js';

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

/**
 * A Build with AI failure, worded for the owner. `retryable` is true only when
 * sending the same request again can help (offline, busy, slow), so the modal
 * offers Retry only then.
 */
export class GenerateRequestError extends Error {
  readonly retryable: boolean;

  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = 'GenerateRequestError';
    this.retryable = retryable;
  }
}

const OFFLINE = 'Can’t reach Slate. Check your connection and try again.';
const TOO_SLOW = 'That took too long. Try a shorter description or a smaller PDF.';
const NOT_WORKING = 'Build with AI isn’t working right now. Try again in a minute.';
const NO_FORM = 'Couldn’t build a form from that. Try describing it differently.';
const DAILY_RESET = 'after the daily reset';

/** "after 5:00 PM today" / "tomorrow after 9:00 AM", in the owner's own time zone. */
export function localResetPhrase(resetsAt: unknown, now = new Date()): string | null {
  if (typeof resetsAt !== 'string') return null;
  const at = new Date(resetsAt);
  if (Number.isNaN(at.getTime()) || at.getTime() <= now.getTime()) return null;
  const time = at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (at.toDateString() === now.toDateString()) return `after ${time} today`;
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  return at.toDateString() === tomorrow.toDateString() ? `tomorrow after ${time}` : null;
}

export async function requestGeneratedForm(
  input: GenerateRequest,
): Promise<GeneratedDraft & { sourcePrompt: string }> {
  let res: Response;
  try {
    res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await authHeader()) },
      body: JSON.stringify({
        prompt: input.prompt,
        previous: input.previous,
        instruction: input.instruction,
        document: input.document,
      }),
    });
  } catch (err) {
    console.error('[slate] Build with AI request failed', err);
    throw new GenerateRequestError(OFFLINE, true);
  }
  const data = (await res.json().catch(() => null)) as {
    form?: GeneratedForm;
    prompt?: string;
    error?: unknown;
    retry?: unknown;
    resetsAt?: unknown;
  } | null;
  if (!res.ok) {
    // Our route always words its `error` for owners (api/generate.ts).
    const sent = typeof data?.error === 'string' ? data.error.trim() : '';
    if (sent) {
      const when = localResetPhrase(data?.resetsAt);
      const message = when && sent.includes(DAILY_RESET) ? sent.replace(DAILY_RESET, when) : sent;
      const retryable = typeof data?.retry === 'boolean' ? data.retry : res.status >= 500;
      throw new GenerateRequestError(message, retryable);
    }
    // Anything else is the hosting platform's page (a timeout, a crash).
    console.error('[slate] Build with AI failed with status', res.status);
    if (res.status === 504 || res.status === 408) throw new GenerateRequestError(TOO_SLOW, true);
    if (res.status === 413) {
      throw new GenerateRequestError('That PDF is too big. Pick one under 3 MB.', false);
    }
    if (res.status >= 500 || res.status === 429) throw new GenerateRequestError(NOT_WORKING, true);
    throw new GenerateRequestError('Something went wrong. Reload the page and try again.', false);
  }
  if (!data?.form) {
    console.error('[slate] Build with AI answered without a form');
    throw new GenerateRequestError(NO_FORM, true);
  }
  let mapped: ReturnType<typeof mapGeneratedForm>;
  try {
    mapped = mapGeneratedForm(data.form);
  } catch (err) {
    console.error('[slate] Build with AI draft did not map', err);
    throw new GenerateRequestError(NO_FORM, true);
  }
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
    return parsed
      .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      .slice(0, 4);
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
