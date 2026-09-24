/**
 * POST /api/generate — Build with AI (ADR-039).
 * Server-only. ANTHROPIC_API_KEY never reaches the SPA.
 * Spend is capped per user and globally per UTC day in Postgres (ADR-051).
 *
 * Body: { prompt, previous?, instruction? }
 * `previous` + `instruction` revises an existing draft in place.
 */

import { GenerateTimeoutError, GenerateValidationError, runGenerateForm } from './runGenerate.js';
import { generatedFormSchema, type GeneratedForm } from './generateFormSchema.js';
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
  if (typeof raw !== 'object') return { error: 'document must be a file.' };
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
  if (!filename) return { error: 'document needs a filename.' };
  if (!base64?.trim()) return { error: 'Attach a PDF.' };
  if (!filename.toLowerCase().endsWith('.pdf') && mime !== 'application/pdf') {
    return { error: 'Start with a PDF. Word and Pages can come later.' };
  }
  if (base64.length > MAX_DOCUMENT_B64) {
    return { error: 'Keep the PDF under 3 MB.' };
  }
  return { doc: { filename, mime: mime ?? 'application/pdf', base64 } };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });

export const AI_QUOTA_USER_MESSAGE =
  'You’ve used today’s Build with AI limit. It resets at midnight UTC.';
export const AI_QUOTA_GLOBAL_MESSAGE =
  'Build with AI has reached today’s limit. It resets at midnight UTC.';
export const AI_QUOTA_UNAVAILABLE_MESSAGE = 'Build with AI is temporarily unavailable.';

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

function secondsUntilUtcMidnight(now = Date.now()): number {
  const d = new Date(now);
  const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
  return Math.max(1, Math.ceil((next - now) / 1000));
}

function parsePrevious(raw: unknown): { form?: GeneratedForm; error?: string } {
  if (raw === undefined) return {};
  if (raw === null || typeof raw !== 'object') {
    return { error: 'previous must be a form object.' };
  }
  const size = JSON.stringify(raw).length;
  if (size > MAX_PREVIOUS_CHARS) {
    return { error: 'Draft is too large to revise. Start a new generate.' };
  }
  const parsed = generatedFormSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: 'previous is not a valid draft. Generate a new one.' };
  }
  return { form: parsed.data };
}

async function handleGenerate(request: Request): Promise<Response> {
  const startedAt = Date.now();
  const method = request.method.toUpperCase();
  if (method === 'OPTIONS') return new Response(null, { status: 204 });
  if (method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  // Build with AI is a signed-in studio feature. Anyone on the internet could
  // otherwise spend the Anthropic key. The Vite dev middleware marks its own
  // requests so localStorage-only local dev still works; Vercel never does.
  const devBypass = !process.env.VERCEL && request.headers.get('x-slate-dev') === '1';
  let subject = 'dev';
  let token = '';
  if (!devBypass) {
    token = /^Bearer\s+(\S+)/i.exec(request.headers.get('authorization') ?? '')?.[1] ?? '';
    const claims = token ? await verifyUserJwt(token).catch(() => null) : null;
    if (!claims) return json({ error: 'Sign in to use Build with AI.' }, 401);
    subject = claims.sub;
  }

  // Burst guard only — per instance, resets on cold start. The durable daily
  // cap is consume_ai_generation, right before the model call below.
  // Per user first (a stolen session can't burn the budget), then per network.
  if (!takeRateLimit(`u:${subject}`) || !takeRateLimit(clientIp(request))) {
    return json({ error: 'Too many generate requests. Try again in a minute.' }, 429);
  }

  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    return json({ error: 'Generate is not configured on this host.' }, 503);
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
    return json({ error: 'Send JSON: { "prompt": "…" }.' }, 400);
  }

  // The user's own text is capped whether or not a PDF comes with it (audit M-AI-1).
  if (prompt.length > MAX_PROMPT) {
    return json({ error: 'Keep the prompt under 2,000 characters.' }, 400);
  }
  if (instruction.length > MAX_INSTRUCTION) {
    return json({ error: 'Keep the revision under 800 characters.' }, 400);
  }

  // A revision never re-reads the PDF, so a document sent with `previous` is ignored.
  const parsedDoc = previousRaw === undefined ? parseDocument(documentRaw) : {};
  if (parsedDoc.error) return json({ error: parsedDoc.error }, 400);
  if (!prompt && !parsedDoc.doc) {
    return json({ error: 'Describe the form you want to build.' }, 400);
  }

  const prev = parsePrevious(previousRaw);
  if (prev.error) return json({ error: prev.error }, 400);
  if (prev.form && !instruction) {
    return json({ error: 'Say how to change the draft.' }, 400);
  }
  if (instruction && !prev.form) {
    return json({ error: 'Revisions need the current draft.' }, 400);
  }

  // Last gate before any expensive work — PDF parsing included (audit M-AI-2).
  // A request that was going to 400 never spends a unit. Skipped for the Vite
  // dev bypass, exactly like the JWT check.
  if (!devBypass) {
    const quota = await consumeAiQuota(token);
    if (quota === 'unavailable') return json({ error: AI_QUOTA_UNAVAILABLE_MESSAGE }, 503);
    if (quota !== 'allowed') {
      return json(
        { error: quota === 'global' ? AI_QUOTA_GLOBAL_MESSAGE : AI_QUOTA_USER_MESSAGE },
        429,
        { 'retry-after': String(secondsUntilUtcMidnight()) },
      );
    }
  }

  if (parsedDoc.doc) {
    try {
      const extracted = await extractDocumentText(parsedDoc.doc);
      prompt = documentToPrompt(parsedDoc.doc.filename, extracted, prompt);
    } catch (err) {
      const message =
        err instanceof DocumentExtractError ? err.message : 'Could not read that document.';
      return json({ error: message }, 400);
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
      return json({ error: err.message }, 400);
    }
    if (err instanceof GenerateTimeoutError) {
      return json({ error: err.message }, 504);
    }
    const message = err instanceof Error ? err.message : 'Generate failed.';
    console.error('[slate] generate failed', err);
    return json({ error: message.slice(0, 280) }, 502);
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
