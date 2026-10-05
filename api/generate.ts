/**
 * POST /api/generate — Build with AI (ADR-039).
 * Server-only. ANTHROPIC_API_KEY never reaches the SPA.
 * Spend is capped per user and globally per UTC day in Postgres (ADR-051).
 *
 * Body: { prompt, previous?, instruction? }
 * `previous` + `instruction` revises an existing draft in place.
 */

import { APICallError, RetryError } from 'ai';
import { GenerateTimeoutError, GenerateValidationError, runGenerateForm } from './runGenerate.js';
import {
  generatedFormSchema,
  withDraftDefaults,
  type GeneratedForm,
} from './generateFormSchema.js';
import { clientIp, takeRateLimit } from './rateLimit.js';
import { verifyUserJwt } from './authJwt.js';
import { callDataApiRpc } from './neonDataApi.js';
import {
  DocumentExtractError,
  documentToPrompt,
  extractDocumentText,
  type DocumentPayload,
} from './extractDocument.js';

// Long PDF forms take well over a minute on Haiku. The route answers by its own
// deadline (below), so a slow draft is a clear message, never a Vercel 504.
export const config = { maxDuration: 180 };
const DEADLINE_MS = 165_000;
const MAX_FILENAME = 120;

const MAX_PROMPT = 2000;
const MAX_INSTRUCTION = 800;
const MAX_PREVIOUS_CHARS = 80_000;
const MAX_DOCUMENT_B64 = 4_200_000;

function parseDocument(raw: unknown): { doc?: DocumentPayload; error?: string } {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object') return { error: FILE_MISSING_MESSAGE };
  const rec = raw as Record<string, unknown>;
  const filename = (
    (typeof rec.filename === 'string' ? rec.filename.trim() : '') ||
    (typeof rec.name === 'string' ? rec.name.trim() : '')
  )
    // It lands in the model prompt: one short line, no control characters.
    .replace(/\p{Cc}+/gu, ' ')
    .slice(0, MAX_FILENAME);
  const mime = typeof rec.mime === 'string' ? rec.mime : undefined;
  const base64 = typeof rec.base64 === 'string' ? rec.base64 : undefined;
  if (!filename) return { error: FILE_MISSING_MESSAGE };
  if (!base64?.trim()) return { error: 'Attach a PDF.' };
  if (!filename.toLowerCase().endsWith('.pdf') && mime !== 'application/pdf') {
    return { error: ONLY_PDF_MESSAGE };
  }
  if (base64.length > MAX_DOCUMENT_B64) {
    return { error: 'That PDF is too big. Pick one under 3 MB.' };
  }
  return { doc: { filename, mime: mime ?? 'application/pdf', base64 } };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });

/**
 * Every `error` this route sends is a sentence an owner can act on (ADR-051 (7):
 * the studio shows it as sent). `retry` says whether sending the same request
 * again can help, so the modal only offers Retry when it can.
 */
export const AI_QUOTA_USER_MESSAGE =
  'You’ve used today’s Build with AI drafts. You can make more after the daily reset.';
export const AI_QUOTA_GLOBAL_MESSAGE =
  'Build with AI is fully booked for today. You can make more after the daily reset.';
export const AI_QUOTA_UNAVAILABLE_MESSAGE =
  'Build with AI isn’t available right now. Try again in a few minutes.';
export const AI_BUSY_MESSAGE = 'The AI is busy right now. Try again in a minute.';
export const AI_BROKEN_MESSAGE =
  'Build with AI isn’t working right now. Build the form by hand, or try again later.';
export const AI_FAILED_MESSAGE = 'Something went wrong building your form. Try again.';
const ONLY_PDF_MESSAGE = 'Only PDFs work here for now. Save it as a PDF and try again.';
const FILE_MISSING_MESSAGE = 'That file didn’t come through. Attach it again.';
const DRAFT_LOST_MESSAGE =
  'This draft can’t be changed any more. Start over with a new description.';

type ModelFailure = { status: number; error: string; retry: boolean };

/**
 * Turn a model / SDK failure into owner copy. The raw error is logged by the
 * caller and never sent: it can carry Anthropic's own wording, ids or JSON.
 */
export function classifyGenerateError(err: unknown): ModelFailure {
  const api = APICallError.isInstance(err)
    ? err
    : RetryError.isInstance(err) && APICallError.isInstance(err.lastError)
      ? err.lastError
      : null;
  if (api) {
    const status = api.statusCode ?? 0;
    const text = api.message;
    if (status === 401 || status === 403 || /credit balance|api[-_ ]?key|billing/i.test(text)) {
      return { status: 503, error: AI_BROKEN_MESSAGE, retry: false };
    }
    if (
      status === 0 ||
      status === 408 ||
      status === 429 ||
      status >= 500 ||
      /overloaded/i.test(text)
    ) {
      return { status: 503, error: AI_BUSY_MESSAGE, retry: true };
    }
    // A request Anthropic refuses as built (a schema it can't compile, a
    // retired model) fails the same way every time.
    return { status: 502, error: AI_BROKEN_MESSAGE, retry: false };
  }
  if (RetryError.isInstance(err)) return { status: 503, error: AI_BUSY_MESSAGE, retry: true };
  return { status: 502, error: AI_FAILED_MESSAGE, retry: true };
}

type QuotaVerdict = 'allowed' | 'user' | 'global' | 'unavailable';

/**
 * Durable daily cap (ADR-051): consume_ai_generation (migration 014) as the
 * caller. Anything but a well-formed row is 'unavailable' — the caller fails
 * closed, so a missing migration or a Neon outage can never mean "unlimited".
 */
async function consumeAiQuota(token: string): Promise<QuotaVerdict> {
  // Server-only proof the database checks (migration 014). Missing → fail closed.
  const serverKey = process.env.AI_QUOTA_KEY?.trim();
  if (!serverKey) {
    console.error('[slate] ai quota check failed: AI_QUOTA_KEY is not set');
    return 'unavailable';
  }
  let raw: unknown;
  try {
    raw = await callDataApiRpc('consume_ai_generation', token, { p_server_key: serverKey });
  } catch (err) {
    console.error('[slate] ai quota check failed:', err instanceof Error ? err.message : 'unknown');
    return 'unavailable';
  }
  const row = (Array.isArray(raw) ? raw[0] : raw) as Record<string, unknown> | null | undefined;
  if (!row || typeof row !== 'object' || typeof row.allowed !== 'boolean') {
    console.error('[slate] ai quota check returned an unexpected shape');
    return 'unavailable';
  }
  if (row.allowed) return 'allowed';
  // Under your own cap but refused → the shared ceiling is what's full.
  const used = Number(row.used);
  const cap = Number(row.per_user_daily);
  return Number.isFinite(used) && Number.isFinite(cap) && used < cap ? 'global' : 'user';
}

/** Enough to debug from the logs; never the prompt, the key or the request body. */
function errorSummary(err: unknown): string {
  if (!(err instanceof Error)) return String(err).slice(0, 300);
  const status = (err as { statusCode?: unknown }).statusCode;
  const code = typeof status === 'number' ? ` ${status}` : '';
  return `${err.name}${code}: ${err.message.slice(0, 300)}`;
}

function secondsUntilUtcMidnight(now = Date.now()): number {
  const d = new Date(now);
  const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
  return Math.max(1, Math.ceil((next - now) / 1000));
}

function parsePrevious(raw: unknown): { form?: GeneratedForm; error?: string } {
  if (raw === undefined) return {};
  if (raw === null || typeof raw !== 'object') {
    return { error: DRAFT_LOST_MESSAGE };
  }
  const size = JSON.stringify(raw).length;
  if (size > MAX_PREVIOUS_CHARS) {
    return {
      error: 'This draft is too big to revise here. Open it in the editor, or start over.',
    };
  }
  const parsed = generatedFormSchema.safeParse(withDraftDefaults(raw));
  if (!parsed.success) {
    return { error: DRAFT_LOST_MESSAGE };
  }
  return { form: parsed.data };
}

async function handleGenerate(request: Request): Promise<Response> {
  const startedAt = Date.now();
  const method = request.method.toUpperCase();
  if (method === 'OPTIONS') return new Response(null, { status: 204 });
  if (method !== 'POST') return json({ error: 'Method not allowed', retry: false }, 405);

  // Build with AI is a signed-in studio feature. Anyone on the internet could
  // otherwise spend the Anthropic key. The Vite dev middleware marks its own
  // requests so localStorage-only local dev still works; Vercel never does.
  const devBypass = !process.env.VERCEL && request.headers.get('x-slate-dev') === '1';
  let subject = 'dev';
  let token = '';
  if (!devBypass) {
    token = /^Bearer\s+(\S+)/i.exec(request.headers.get('authorization') ?? '')?.[1] ?? '';
    const claims = token ? await verifyUserJwt(token).catch(() => null) : null;
    if (!claims) {
      return json(
        { error: 'Your sign-in expired. Sign in again to use Build with AI.', retry: false },
        401,
      );
    }
    subject = claims.sub;
  }

  // Burst guard only — per instance, resets on cold start. The durable daily
  // cap is consume_ai_generation, right before the model call below.
  // Per user first (a stolen session can't burn the budget), then per network.
  if (!takeRateLimit(`u:${subject}`) || !takeRateLimit(clientIp(request))) {
    return json(
      { error: 'That’s a lot of drafts at once. Wait a minute, then try again.', retry: false },
      429,
    );
  }

  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    console.error('[slate] generate: ANTHROPIC_API_KEY is not set');
    return json({ error: 'Build with AI isn’t available here.', retry: false }, 503);
  }

  let prompt = '';
  let instruction = '';
  let previousRaw: unknown;
  let documentRaw: unknown;
  try {
    const body: unknown = await request.json();
    if (body && typeof body === 'object') {
      const rec = body as Record<string, unknown>;
      if (typeof rec.prompt === 'string') prompt = rec.prompt.trim();
      if (typeof rec.instruction === 'string') instruction = rec.instruction.trim();
      if ('previous' in rec) previousRaw = rec.previous;
      if ('document' in rec) documentRaw = rec.document;
    }
  } catch {
    return json(
      { error: 'Something went wrong sending that. Reload the page and try again.', retry: false },
      400,
    );
  }

  // The user's own text is capped whether or not a PDF comes with it (audit M-AI-1).
  if (prompt.length > MAX_PROMPT) {
    return json({ error: 'Keep the description under 2,000 characters.', retry: false }, 400);
  }
  if (instruction.length > MAX_INSTRUCTION) {
    return json({ error: 'Keep the change under 800 characters.', retry: false }, 400);
  }

  // A revision never re-reads the PDF, so a document sent with `previous` is ignored.
  const parsedDoc = previousRaw === undefined ? parseDocument(documentRaw) : {};
  if (parsedDoc.error) return json({ error: parsedDoc.error, retry: false }, 400);
  if (!prompt && !parsedDoc.doc) {
    return json({ error: 'Describe the form you want to build.', retry: false }, 400);
  }

  const prev = parsePrevious(previousRaw);
  if (prev.error) return json({ error: prev.error, retry: false }, 400);
  if (prev.form && !instruction) {
    return json({ error: 'Say how to change the draft.', retry: false }, 400);
  }
  if (instruction && !prev.form) {
    return json({ error: DRAFT_LOST_MESSAGE, retry: false }, 400);
  }

  // Last gate before any expensive work — PDF parsing included (audit M-AI-2).
  // A request that was going to 400 never spends a unit. Skipped for the Vite
  // dev bypass, exactly like the JWT check.
  if (!devBypass) {
    const quota = await consumeAiQuota(token);
    if (quota === 'unavailable') {
      return json({ error: AI_QUOTA_UNAVAILABLE_MESSAGE, retry: true }, 503);
    }
    if (quota !== 'allowed') {
      const wait = secondsUntilUtcMidnight();
      return json(
        {
          error: quota === 'global' ? AI_QUOTA_GLOBAL_MESSAGE : AI_QUOTA_USER_MESSAGE,
          retry: false,
          // The studio says when, in the owner's own time zone.
          resetsAt: new Date(Date.now() + wait * 1000).toISOString(),
        },
        429,
        { 'retry-after': String(wait) },
      );
    }
  }

  if (parsedDoc.doc) {
    try {
      const extracted = await extractDocumentText(parsedDoc.doc);
      prompt = documentToPrompt(parsedDoc.doc.filename, extracted, prompt);
    } catch (err) {
      if (!(err instanceof DocumentExtractError)) console.error('[slate] pdf read failed', err);
      const message =
        err instanceof DocumentExtractError
          ? err.message
          : 'We couldn’t open that PDF. Try saving it again, or paste the questions instead.';
      return json({ error: message, retry: false }, 400);
    }
  }

  try {
    const form = await runGenerateForm({
      prompt,
      previous: prev.form,
      instruction: instruction || undefined,
      deadline: startedAt + DEADLINE_MS,
    });
    return json({ form, prompt });
  } catch (err) {
    if (err instanceof GenerateValidationError) {
      console.warn('[slate] generate: draft did not validate', errorSummary(err.cause));
      return json({ error: err.message, retry: true }, 422);
    }
    if (err instanceof GenerateTimeoutError) {
      return json({ error: err.message, retry: true }, 504);
    }
    const failure = classifyGenerateError(err);
    console.error('[slate] generate failed', errorSummary(err));
    return json({ error: failure.error, retry: failure.retry }, failure.status);
  }
}

/**
 * Dual-signature default export (QA GS-026).
 *
 * In production Vercel runs this file as a classic Node serverless function
 * (ADR-039) and invokes it with (IncomingMessage, ServerResponse) — the Web
 * `Request` API is NOT available there (`request.headers.get` crashed with a
 * TypeError). The Vite dev proxy, by contrast, calls it with a real `Request`.
 * This adapter accepts either: web `Request` passes straight through, the
 * Node pair is converted to a `Request` and the `Response` is written back.
 */
type NodeIncoming = AsyncIterable<Buffer> & {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
};
type NodeOutgoing = {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(chunk?: unknown): void;
};

function isWebRequest(value: unknown): value is Request {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { headers?: { get?: unknown } }).headers?.get === 'function'
  );
}

export default async function handler(
  request: Request | NodeIncoming,
  res?: NodeOutgoing,
): Promise<Response | void> {
  if (isWebRequest(request)) return handleGenerate(request);

  const nodeReq = request;
  const method = (nodeReq.method ?? 'GET').toUpperCase();
  const headers = new Headers();
  for (const [key, value] of Object.entries(nodeReq.headers)) {
    if (!value) continue;
    headers.set(key, Array.isArray(value) ? value.join(',') : value);
  }
  const chunks: Buffer[] = [];
  if (method !== 'GET' && method !== 'HEAD') {
    for await (const chunk of nodeReq) chunks.push(Buffer.from(chunk));
  }
  const webRequest = new Request(
    `https://${headers.get('host') ?? 'localhost'}${nodeReq.url ?? '/api/generate'}`,
    {
      method,
      headers,
      body: method === 'GET' || method === 'HEAD' ? undefined : Buffer.concat(chunks),
    },
  );

  const response = await handleGenerate(webRequest);
  if (!res) return response;
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  res.end(Buffer.from(await response.arrayBuffer()));
}
