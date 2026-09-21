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

export const config = { maxDuration: 60 };

const MAX_PROMPT = 2000;
const MAX_INSTRUCTION = 800;
const MAX_PREVIOUS_CHARS = 80_000;

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

export default async function handler(request: Request): Promise<Response> {
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
  try {
    const body: unknown = await request.json();
    if (body && typeof body === 'object') {
      const rec = body as Record<string, unknown>;
      if (typeof rec.prompt === 'string') prompt = rec.prompt.trim();
      if (typeof rec.instruction === 'string') instruction = rec.instruction.trim();
      if ('previous' in rec) previousRaw = rec.previous;
    }
  } catch {
    return json({ error: 'Send JSON: { "prompt": "…" }.' }, 400);
  }

  if (!prompt) return json({ error: 'Describe the form you want to build.' }, 400);
  if (prompt.length > MAX_PROMPT) {
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
    return json({ form });
  } catch (err) {
    if (err instanceof GenerateValidationError) {
      return json({ error: err.message }, 400);
    }
    const message = err instanceof Error ? err.message : 'Generate failed.';
    console.error('[slate] generate failed', err);
    return json({ error: message.slice(0, 280) }, 502);
  }
}
