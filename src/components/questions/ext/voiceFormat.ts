/**
 * Which audio format a voice note records in (ADR-065). Kept out of the
 * field's module so the field stays a components-only module.
 */

/**
 * Recording formats in order of preference: Opus in WebM where the browser
 * records it (Chrome, Edge, Firefox, Android — and it is what they encode
 * reliably), else AAC in MP4 (Safari and iOS). Newer Chrome also *claims*
 * AAC in MP4, but its encoder can fail at runtime ("EncodingError"), so WebM
 * comes first; a format that fails is skipped on the next try.
 */
export const VOICE_MIME_PREFERENCE = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mp4',
] as const;

/** Formats that failed on this page (an encoder error or an empty file); skipped next time. */
export const failedMimes = new Set<string>();

/** The first format this browser records (and hasn't failed here), or '' to let it choose. */
export function pickVoiceMime(): string {
  const MR = (globalThis as { MediaRecorder?: { isTypeSupported?: (t: string) => boolean } })
    .MediaRecorder;
  if (!MR || typeof MR.isTypeSupported !== 'function') return '';
  return VOICE_MIME_PREFERENCE.find((t) => !failedMimes.has(t) && MR.isTypeSupported!(t)) ?? '';
}

