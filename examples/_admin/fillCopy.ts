/**
 * What respondents read when something goes wrong on a public form (QA pass,
 * COPY-14): one plain sentence per situation, in one voice, for the fill page,
 * the password screen, uploads and portable links. No status codes and never a
 * server's own text — those go to the console for debugging.
 *
 * Respondents press "Retry" on the engine's Thank You screen, so sentences
 * shown there say "Retry"; the page's own buttons say "Try again".
 */

/** The form can't be filled in (gone, unpublished, or no backend here). */
export const FORM_UNAVAILABLE = 'This form isn’t taking responses right now.';

/** The form didn't load because the network failed. */
export const LOAD_OFFLINE = 'We couldn’t load this form. Check your connection and try again.';

/** The form didn't load because the server had a problem. */
export const LOAD_LATER = 'We couldn’t load this form just now. Try again in a moment.';

/** The answers didn't reach the server: offline, or a dropped connection. */
export const SEND_OFFLINE =
  'Your answers weren’t sent. Check your connection and press Retry — your answers are still here.';

/** The server or something in between failed; trying again may work. */
export const SEND_LATER =
  'We couldn’t send your answers just now. Press Retry in a moment — your answers are still here.';

/** 413: the whole response is over the size limit. Shown on the longest answer. */
export const SEND_TOO_LONG_HERE = 'This answer is too long to send. Shorten it, then press OK.';

/** 413 when no single answer can be named. */
export const SEND_TOO_LONG =
  'Your answers are too long to send. Shorten your longest answer, then try again.';

/** The password didn't match. */
export const WRONG_PASSWORD = 'That password didn’t match. Try again.';

/** The password check didn't reach the server. */
export const GATE_OFFLINE = 'We couldn’t check the password. Check your connection and try again.';

/** The password check failed on the server's side. */
export const GATE_LATER = 'We couldn’t check the password just now. Try again in a moment.';

/** A portable link that can't be read (cut short by a text message, or mistyped). */
export const LINK_BROKEN =
  'This link looks broken or incomplete. Ask whoever sent it for a new one.';

/** A portable (preview) link opened on the live site, where it can't send answers anywhere. */
export const LINK_PREVIEW_ONLY =
  'This is a preview link, so it can’t take answers. Ask whoever sent it for the form’s published link.';

/** A 0-byte file: nothing to upload. */
export const FILE_EMPTY = 'That file is empty. Pick a different file.';

/** A page part (a chunk) that didn't download. */
export const PAGE_DIDNT_LOAD = 'This page didn’t load. Check your connection, then try again.';

/** "about 5 minutes", "about an hour", "about 3 hours" — never seconds. */
export function aboutWait(seconds: number): string {
  const s = Number.isFinite(seconds) && seconds > 0 ? seconds : 60;
  if (s < 3600) {
    const m = Math.max(1, Math.ceil(s / 60));
    return `about ${m} minute${m === 1 ? '' : 's'}`;
  }
  const h = Math.round(s / 3600);
  return h <= 1 ? 'about an hour' : `about ${h} hours`;
}

/**
 * The rate-limit sentences below are the Functions' own, word for word, for a
 * 429 that arrives without them (a platform limit in front of the Function):
 * one voice whichever answered.
 */
const OTHER_NETWORK = 'or try from another network (for example mobile data).';

/** Too many submissions from one network. */
export function sendRateLimited(seconds: number): string {
  return `Too many responses from this network right now. Please wait ${aboutWait(seconds)}, ${OTHER_NETWORK}`;
}

/** Too many uploads from one network. */
export function uploadRateLimited(seconds: number): string {
  return `Too many uploads from this network right now. Please wait ${aboutWait(seconds)}, ${OTHER_NETWORK}`;
}

/** Too many password tries from one network. */
export function gateRateLimited(seconds: number): string {
  return `Too many password attempts from this network right now. Please wait ${aboutWait(seconds)}, ${OTHER_NETWORK}`;
}

/**
 * A server's own sentence, when it is one a person can read: a capitalised
 * sentence of sensible length ending in a full stop — never markup, JSON or a
 * bare label like "Sign failed" / "Invalid path shape". Anything else is
 * replaced by `fallback`.
 */
export function readableOr(text: unknown, fallback: string): string {
  if (typeof text !== 'string') return fallback;
  const t = text.trim();
  return /^[A-Z][^<>{}]{10,298}[.!?]$/.test(t) ? t : fallback;
}
