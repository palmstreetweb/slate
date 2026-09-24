/**
 * App entry (ADR-048). Kept tiny on purpose: it picks the respondent bundle or
 * the studio bundle from the URL, and for a public form it starts fetching the
 * form before either bundle has finished downloading.
 */

import { migrateSlateLocalStorageKeys } from '@/utils/migrateLocalStorage.js';
import { readRoute, syncPathFromHash } from './_admin/_router.js';
import { isNeonConfigured } from './_admin/neon/config.js';
import { loadPublishedForm } from './_admin/neon/publicForm.js';

migrateSlateLocalStorageKeys();
syncPathFromHash();

// A redeploy replaces hashed chunks; an open tab that lazy-loads an old one
// would white-screen. Reload once to pick up the new build, never loop.
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault();
  try {
    if (sessionStorage.getItem('slate-reloaded-for-deploy') === '1') return;
    sessionStorage.setItem('slate-reloaded-for-deploy', '1');
  } catch {
    /* storage off — still reload once per event */
  }
  window.location.reload();
});

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');

const route = readRoute();

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

if (route.name === 'fill' || route.name === 'respond') {
  void import('./publicApp.js').then((m) => m.mountPublic(root));
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
  void import('./studioApp.js').then((m) => m.mountStudio(root));
}
