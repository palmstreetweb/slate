/**
 * App entry (ADR-048). Kept tiny on purpose: it picks the respondent bundle or
 * the studio bundle from the URL, and for a public form it starts fetching the
 * form before either bundle has finished downloading.
 */

import { migrateSlateLocalStorageKeys } from '@/utils/migrateLocalStorage.js';
import { readRoute, syncPathFromHash } from './_admin/_router.js';
import { isNeonConfigured } from './_admin/neon/config.js';
import { loadPublishedForm } from './_admin/neon/publicForm.js';
import { PAGE_DIDNT_LOAD } from './_admin/fillCopy.js';
import { handlePreloadError } from './_admin/preloadError.js';

migrateSlateLocalStorageKeys();
syncPathFromHash();

const route = readRoute();
/** A respondent's page: the public fill link or a portable link. */
const respondent = route.name === 'fill' || route.name === 'respond';

// A redeploy replaces hashed chunks: the studio reloads once to pick up the
// new build. A respondent's page never reloads by itself (X2) — see preloadError.ts.
window.addEventListener('vite:preloadError', (event) => {
  let storage: Storage | null = null;
  try {
    storage = window.sessionStorage;
  } catch {
    /* storage off */
  }
  handlePreloadError(event, respondent, storage, () => window.location.reload());
});

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');

if (route.name === 'fill' && isNeonConfigured()) {
  // Network and JS in parallel: PublicFill awaits this same promise.
  loadPublishedForm(route.slug).catch(() => {
    /* PublicFill retries and shows the message */
  });
}

/** Cross-origin parents make `window.top` access throw — that counts as framed. */
function isFramed(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

/**
 * The page's own code didn't download (nothing has been typed yet): one plain
 * line and a "Try again" that reloads, instead of a blank page.
 */
function showLoadFailed(el: HTMLElement): void {
  const box = document.createElement('main');
  box.style.cssText =
    'max-width:360px;margin:20vh auto 0;padding:0 24px;font:16px/1.5 system-ui,sans-serif;text-align:center';
  const line = document.createElement('p');
  line.textContent = PAGE_DIDNT_LOAD;
  const again = document.createElement('button');
  again.type = 'button';
  again.textContent = 'Try again';
  again.style.cssText = 'font:inherit;padding:10px 20px;cursor:pointer';
  again.addEventListener('click', () => window.location.reload());
  box.append(line, again);
  el.replaceChildren(box);
}

if (respondent) {
  void import('./publicApp.js').then((m) => m.mountPublic(root)).catch(() => showLoadFailed(root));
} else if (route.name === 'motion') {
  // Motion gallery (ADR-059): a dev demo with built-in schemas. Its own
  // chunk — no studio, no auth, no Neon.
  void import('./motionApp.js').then((m) => m.mountMotion(root));
} else if (isFramed()) {
  // Only public forms are embeddable (ADR-054). The studio never runs inside
  // someone else's page — that would allow clickjacking an owner (audit M-FRAME-1).
  const link = document.createElement('a');
  link.href = window.location.origin;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = 'Open Slate in its own tab';
  root.replaceChildren(link);
} else {
  void import('./studioApp.js').then((m) => m.mountStudio(root)).catch(() => showLoadFailed(root));
}
