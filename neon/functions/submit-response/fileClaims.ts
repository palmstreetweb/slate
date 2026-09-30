/**
 * The file keys a response claims (ADR-067). Pure — no DB, no Hono.
 *
 * storagesign records every object it signs; a response may only reference
 * keys minted for its own form and question that nobody has claimed, and it
 * claims them in the same transaction as the insert (migration 021). This
 * module turns the sanitized answers into the list that insert checks, and
 * finds storage refs to other forms in the raw answers, which are refused
 * (400) instead of silently dropped.
 */

import { STORAGE_REF_RE } from './answerShape.js';

const PREFIX = 'slate-file://storage:';

/** File-taking question types: their answers hold storage refs. */
const FILE_TYPES = new Set(['file_upload', 'voice_note', 'photo_checklist']);

function strings(v: unknown, out: string[] = [], depth = 0): string[] {
  if (depth > 4) return out;
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) for (const x of v.slice(0, 200)) strings(x, out, depth + 1);
  else if (v && typeof v === 'object') {
    for (const x of Object.values(v).slice(0, 200)) strings(x, out, depth + 1);
  }
  return out;
}

export type FileClaim = { key: string; question: string };

/**
 * Every storage ref of this form in the sanitized answers, with the question it
 * answers — the exact set the claim trigger will claim, so the insert checks
 * all of it. Deduplicated per question.
 */
export function fileClaimsOf(clean: Record<string, unknown>, formId: string): FileClaim[] {
  const out: FileClaim[] = [];
  const seen = new Set<string>();
  for (const [question, v] of Object.entries(clean)) {
    for (const s of strings(v)) {
      if (!s.startsWith(PREFIX) || STORAGE_REF_RE.exec(s)?.[1] !== formId) continue;
      const key = s.slice(PREFIX.length);
      const id = `${question}\u0000${key}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ key, question });
    }
  }
  return out;
}

/**
 * File questions whose raw answer carries a storage ref that isn't this
 * form's (another form's, or not a shape we mint). The page never sends one,
 * so it is refused rather than dropped: a crafted client learns nothing and
 * stores nothing.
 */
export function foreignRefQuestions(
  raw: Record<string, unknown>,
  schema: unknown,
  formId: string,
): string[] {
  const questions = (schema as { questions?: unknown } | null)?.questions;
  const fileQs = new Set<string>();
  if (Array.isArray(questions)) {
    for (const q of questions) {
      const r = q as { id?: unknown; type?: unknown } | null;
      if (r && typeof r.id === 'string' && FILE_TYPES.has(String(r.type))) fileQs.add(r.id);
    }
  }
  const bad: string[] = [];
  for (const [question, v] of Object.entries(raw)) {
    if (!fileQs.has(question)) continue;
    if (strings(v).some((s) => s.startsWith(PREFIX) && STORAGE_REF_RE.exec(s)?.[1] !== formId)) {
      bad.push(question);
    }
    if (bad.length >= 50) break;
  }
  return bad;
}
