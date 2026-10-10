import type { GeneratedForm } from '../../../api/_lib/generateFormSchema.js';
import { mapGeneratedForm } from '../../../api/_lib/mapGeneratedForm.js';
import type { Schema } from '@/index.js';
import { authHeader } from '../storageUpload.js';
import { looksTechnical } from '../shell/PersistErrorToasts.js';

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
  /** The owner cancelled it; nothing to show. */
  readonly cancelled: boolean;

  constructor(message: string, retryable: boolean, cancelled = false) {
    super(message);
    this.name = 'GenerateRequestError';
    this.retryable = retryable;
    this.cancelled = cancelled;
  }
}

/**
 * How long one generation may take before the modal gives up (audit A2). The
 * route's own limit is shorter; this catches a request that never answers.
 */
export const GENERATE_TIMEOUT_MS = 60_000;

const OFFLINE = 'Can’t reach Slate. Check your connection and try again.';
const CANCELLED = 'Stopped.';
const TOO_SLOW = 'That took too long. Try a shorter description or a smaller PDF.';
const NOT_WORKING = 'Build with AI isn’t working right now. Try again in a minute.';

/** An error the route didn't word for owners: codes, log lines, markup, a model's own words. */
function sentLooksTechnical(message: string): boolean {
  return (
    looksTechnical(message) ||
    /\berror\b|exception|attempts?\b|overloaded|status \d|\b[45]\d\d\b/i.test(message)
  );
}
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
  opts: { signal?: AbortSignal } = {},
): Promise<GeneratedDraft & { sourcePrompt: string }> {
  // One controller ends the request on the owner's Cancel or after the timeout,
  // so a stalled connection never pins the modal (audit A2).
  const ctrl = new AbortController();
  const onCancel = () => ctrl.abort();
  opts.signal?.addEventListener('abort', onCancel, { once: true });
  if (opts.signal?.aborted) ctrl.abort();
  const timer = setTimeout(() => ctrl.abort(), GENERATE_TIMEOUT_MS);
  const cancelled = () => Boolean(opts.signal?.aborted);
  let res: Response;
  let data: {
    form?: GeneratedForm;
    prompt?: string;
    error?: unknown;
    retry?: unknown;
    resetsAt?: unknown;
  } | null;
  try {
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
        signal: ctrl.signal,
      });
    } catch (err) {
      if (cancelled()) throw new GenerateRequestError(CANCELLED, false, true);
      if (ctrl.signal.aborted) {
        console.error('[slate] Build with AI request timed out');
        throw new GenerateRequestError(TOO_SLOW, true);
      }
      console.error('[slate] Build with AI request failed', err);
      throw new GenerateRequestError(OFFLINE, true);
    }
    data = (await res.json().catch(() => null)) as typeof data;
    if (cancelled()) throw new GenerateRequestError(CANCELLED, false, true);
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onCancel);
  }
  if (!res.ok) {
    // Our route always words its `error` for owners (api/generate.ts).
    const raw = typeof data?.error === 'string' ? data.error.trim() : '';
    // Our route words its errors; anything that still reads like a log line
    // ("Failed after 2 attempts. Last error: Overloaded") gets plain words (copy QA).
    if (raw && sentLooksTechnical(raw)) console.error('[slate] Build with AI error', raw);
    const sent = raw && sentLooksTechnical(raw) ? NOT_WORKING : raw;
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
