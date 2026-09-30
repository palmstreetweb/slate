/**
 * Voice notes and photo checklists (ADR-065) — pure, no React.
 *
 * Both upload through the host's `onFileUpload` (Slate: the public storage
 * path, ADR-050/058) and store the returned refs. The server keeps only this
 * form's own storage refs (the file-answer rule, ADR-058), and signs an
 * upload only as large as the form's roomiest file, voice or photo question
 * allows — `voiceMaxBytes` and `PHOTO_MAX_BYTES` are mirrored in
 * neon/functions/storage-sign/uploadPolicy.ts (a test compares them).
 */

import type { PhotoChecklistQuestion, VoiceNoteQuestion } from '@/types/Question.js';

/** Recording length when the owner doesn't say, and its bounds, in seconds. */
export const VOICE_SECONDS_DEFAULT = 60;
export const VOICE_SECONDS_MIN = 5;
export const VOICE_SECONDS_MAX = 300;
/** Longest typed answer on a voice note ("Type instead"), in characters. */
export const VOICE_TYPED_MAX = 1000;
/** Largest photo one checklist item uploads (after the usual compression it is far smaller). */
export const PHOTO_MAX_BYTES = 12 * 1024 * 1024;

const MIB = 1024 * 1024;

/** The longest recording this question allows, in whole seconds. */
export function voiceMaxSeconds(q: Pick<VoiceNoteQuestion, 'maxSeconds'>): number {
  const s = q.maxSeconds;
  if (typeof s !== 'number' || !Number.isFinite(s)) return VOICE_SECONDS_DEFAULT;
  return Math.min(VOICE_SECONDS_MAX, Math.max(VOICE_SECONDS_MIN, Math.round(s)));
}

/**
 * The biggest file a recording of `seconds` may be: 40 kB a second (320 kbps,
 * several times what phones record speech at) plus 64 KiB of container, and
 * never under 1 MiB. 60 s → 2.5 MB; 300 s → 12 MB.
 */
export function voiceMaxBytes(seconds: number): number {
  return Math.max(MIB, Math.round(seconds) * 40_000 + 64 * 1024);
}

/** The stored recording ref, or null. */
export function voiceAudioOf(answer: unknown): string | null {
  if (answer === null || typeof answer !== 'object' || Array.isArray(answer)) return null;
  const a = (answer as { audio?: unknown }).audio;
  return typeof a === 'string' && a.trim() !== '' ? a : null;
}

/** Typed text on a voice note, or null. */
export function voiceTypedOf(answer: unknown): string | null {
  if (answer === null || typeof answer !== 'object' || Array.isArray(answer)) return null;
  const t = (answer as { typed?: unknown }).typed;
  return typeof t === 'string' && t.trim() !== '' ? t.trim() : null;
}

/** A recording's length in seconds, or null when unknown. */
export function voiceSecondsOf(answer: unknown): number | null {
  if (answer === null || typeof answer !== 'object' || Array.isArray(answer)) return null;
  const s = (answer as { sec?: unknown }).sec;
  const n = typeof s === 'string' && /^\d{1,4}$/.test(s) ? Number(s) : Number.NaN;
  return Number.isFinite(n) ? n : null;
}

/** "0:42", "1:05". */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r < 10 ? '0' : ''}${r}`;
}

/** "Voice note (0:42)" or the typed text — for piping, Responses and CSV. */
export function formatVoiceNote(answer: unknown): string {
  const typed = voiceTypedOf(answer);
  if (typed) return typed;
  if (!voiceAudioOf(answer)) return '';
  const sec = voiceSecondsOf(answer);
  return sec !== null ? `Voice note (${formatClock(sec)})` : 'Voice note';
}

/** Items of a checklist that have a photo in this answer. */
export function photosTaken(q: Pick<PhotoChecklistQuestion, 'items'>, answer: unknown): string[] {
  if (answer === null || typeof answer !== 'object' || Array.isArray(answer)) return [];
  const a = answer as Record<string, unknown>;
  return (q.items ?? [])
    .map((i) => i.value)
    .filter((v) => typeof a[v] === 'string' && (a[v] as string).trim() !== '');
}

/** "3 of 5 photos". */
export function formatPhotoCount(
  q: Pick<PhotoChecklistQuestion, 'items'>,
  answer: unknown,
): string {
  const n = photosTaken(q, answer).length;
  const total = (q.items ?? []).length;
  return n === 0 ? '' : `${n} of ${total} ${total === 1 ? 'photo' : 'photos'}`;
}
