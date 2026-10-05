/**
 * Thank-you redirects on Slate's own pages (ADR-069, review fixes: CON-06,
 * ENG-10, SEC-5). Studio only, so no engine bytes, and small enough for the
 * public bundle (no studio imports).
 *
 * The engine follows a redirect the way a link on the page does, as it did
 * before the QA pass, so an npm host's "thanks", "/thanks", "?done" or "#done"
 * stays on its own site. A Slate form's page is ours, not the owner's, so on
 * our pages an address typed without a scheme means that site:
 * `withWebRedirects` hands the engine the full address — the one the editor's
 * heads-up names — before the form is shown.
 */

import type { Schema } from '@/index.js';

const SCHEME = /^[a-z][a-z\d+-]*:/i;

/**
 * The web address a redirect will use: what the owner typed, with https://
 * added when there's no scheme, and a scheme typed without "//"
 * ("https:example.com/thanks") read the way a browser reads it
 * (https://example.com/thanks). Null when it can't be a web page link (no
 * domain, "javascript:", "mailto:", a path on its own).
 */
export function normalizeRedirectUrl(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  const full = SCHEME.test(t) ? t : `https://${t.replace(/^\/+/, '')}`;
  try {
    const u = new URL(full);
    const host = u.hostname;
    const webHost = /\./.test(host) && !host.startsWith('.') && !host.endsWith('.');
    if (!(u.protocol === 'https:' || u.protocol === 'http:') || !webHost) return null;
    return /^[a-z][a-z\d+-]*:\/\//i.test(full) ? full : u.href;
  } catch {
    return null;
  }
}

/**
 * The schema with each ending's redirect as the web address it opens. One
 * that can't be a web address is left as typed (the editor blocks publishing
 * it; the engine refuses anything that isn't http or https). The same object
 * when nothing changes.
 */
export function withWebRedirects<S extends Schema>(schema: S): S {
  if (!Array.isArray(schema?.questions)) return schema;
  let changed = false;
  const questions = schema.questions.map((q) => {
    if (q?.type !== 'thanks' || typeof q.redirectUrl !== 'string') return q;
    const url = normalizeRedirectUrl(q.redirectUrl);
    if (!url || url === q.redirectUrl) return q;
    changed = true;
    return { ...q, redirectUrl: url };
  });
  return changed ? { ...schema, questions } : schema;
}
