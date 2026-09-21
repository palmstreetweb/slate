/**
 * POST /api/generate — Build with AI (ADR-039).
 * Server-only. ANTHROPIC_API_KEY never reaches the SPA.
 *
 * Body: { prompt, previous?, instruction? }
 * `previous` + `instruction` revises an existing draft in place.
 */

import { GenerateValidationError, runGenerateForm } from './runGenerate.js';
import { generatedFormSchema, type GeneratedForm } from './generateFormSchema.js';
import { clientIp, takeRateLimit } from './rateLimit.js';
import {
  DocumentExtractError,
  documentToPrompt,
  extractDocumentText,
  type DocumentPayload,
} from './extractDocument.js';

export const config = { maxDuration: 60 };

const MAX_PROMPT = 2000;
const MAX_INSTRUCTION = 800;
const MAX_PREVIOUS_CHARS = 80_000;
const MAX_DOCUMENT_B64 = 4_200_000;

function parseDocument(raw: unknown): { doc?: DocumentPayload; error?: string } {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object') return { error: 'document must be a file.' };
  const rec = raw as Record<string, unknown>;
  const filename =
    (typeof rec.filename === 'string' ? rec.filename.trim() : '') ||
    (typeof rec.name === 'string' ? rec.name.trim() : '');
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

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });

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
  const method = request.method.toUpperCase();
  if (method === 'OPTIONS') return new Response(null, { status: 204 });
  if (method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  if (!takeRateLimit(clientIp(request))) {
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

  const parsedDoc = parseDocument(documentRaw);
  if (parsedDoc.error) return json({ error: parsedDoc.error }, 400);

  if (parsedDoc.doc && !previousRaw) {
    try {
      const extracted = await extractDocumentText(parsedDoc.doc);
      prompt = documentToPrompt(parsedDoc.doc.filename, extracted, prompt);
    } catch (err) {
      const message =
        err instanceof DocumentExtractError
          ? err.message
          : 'Could not read that document.';
      return json({ error: message }, 400);
    }
  }

  if (!prompt) return json({ error: 'Describe the form you want to build.' }, 400);
  if (!parsedDoc.doc && prompt.length > MAX_PROMPT) {
    return json({ error: 'Keep the prompt under 2,000 characters.' }, 400);
  }
  if (instruction.length > MAX_INSTRUCTION) {
    return json({ error: 'Keep the revision under 800 characters.' }, 400);
  }

  const prev = parsePrevious(previousRaw);
  if (prev.error) return json({ error: prev.error }, 400);
  if (prev.form && !instruction) {
    return json({ error: 'Say how to change the draft.' }, 400);
  }
  if (instruction && !prev.form) {
    return json({ error: 'Revisions need the current draft.' }, 400);
  }

  try {
    const form = await runGenerateForm({
      prompt,
      previous: prev.form,
      instruction: instruction || undefined,
    });
    return json({ form, prompt });
  } catch (err) {
    if (err instanceof GenerateValidationError) {
      return json({ error: err.message }, 400);
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
