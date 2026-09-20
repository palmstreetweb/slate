/**
 * POST /api/generate — Build with AI (ADR-039).
 * Server-only. ANTHROPIC_API_KEY never reaches the SPA.
 */

import { GenerateValidationError, runGenerateForm } from './runGenerate.js';
import { clientIp, takeRateLimit } from './rateLimit.js';

export const config = { maxDuration: 60 };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });

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
  try {
    const body: unknown = await request.json();
    if (body && typeof body === 'object' && 'prompt' in body && typeof body.prompt === 'string') {
      prompt = body.prompt.trim();
    }
  } catch {
    return json({ error: 'Send JSON: { "prompt": "…" }.' }, 400);
  }

  if (!prompt) return json({ error: 'Describe the form you want to build.' }, 400);
  if (prompt.length > 2000) return json({ error: 'Keep the prompt under 2,000 characters.' }, 400);

  try {
    const form = await runGenerateForm(prompt);
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
