/**
 * Tiny pathname router (ADR-044). No external deps. The host must serve
 * `index.html` for every path — `vercel.json` rewrites do that in
 * production and Vite does it in dev.
 *
 * Routes:
 *   /                            → dashboard
 *   /settings                    → site settings
 *   /forms/new                   → editor (creating)
 *   /forms/:slug                 → public fill (8-digit slug; the link on the flyer)
 *   /forms/:id/preview           → admin preview
 *   /forms/:id/edit              → editor (editing)
 *   /forms/:id/submissions       → submissions list
 *   /r?d=…                       → portable (schema-in-URL) respond
 */

import { useEffect, useState } from 'react';

export type Route =
  | { name: 'dashboard' }
  | { name: 'settings' }
  | { name: 'editor'; formId: string | null }
  | { name: 'preview'; formId: string }
  | { name: 'submissions'; formId: string }
  | { name: 'respond'; token: string }
  | { name: 'fill'; slug: string }
  | { name: 'dropLab' }
  | { name: 'notfound'; path: string };

const NAVIGATE_EVENT = 'slate-navigate';

/**
 * Old `#/path?query` links become `/path?query` on first load. Cheap
 * insurance for anything bookmarked before ADR-044.
 */
export function syncPathFromHash(): void {
  if (typeof window === 'undefined') return;
  const { hash, search } = window.location;
  if (!hash.startsWith('#/')) return;
  const inner = hash.slice(1);
  const q = inner.indexOf('?');
  const path = q === -1 ? inner : inner.slice(0, q);
  const hashQuery = q === -1 ? '' : inner.slice(q + 1);
  const merged = new URLSearchParams(search);
  new URLSearchParams(hashQuery).forEach((v, k) => merged.set(k, v));
  const qs = merged.toString();
  window.history.replaceState({}, '', `${path}${qs ? `?${qs}` : ''}`);
}

function normalizePath(): string {
  if (typeof window === 'undefined') return '/';
  const p = window.location.pathname;
  if (!p || p === '/index.html') return '/';
  return p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p;
}

/** Query string of the current URL (`/r?d=…`, `/?otp=…`). */
export function routeSearchParams(): URLSearchParams {
  if (typeof window === 'undefined') return new URLSearchParams();
  return new URLSearchParams(window.location.search);
}

function matchRoute(path: string): Route {
  if (path === '/') return { name: 'dashboard' };
  if (path === '/settings') return { name: 'settings' };
  if (path === '/lab/drop') return { name: 'dropLab' };
  if (path === '/forms/new') return { name: 'editor', formId: null };

  if (path === '/r') {
    const token = routeSearchParams().get('d')?.trim();
    if (token) return { name: 'respond', token };
    return { name: 'notfound', path };
  }

  const submissionsMatch = /^\/forms\/([^/]+)\/submissions$/.exec(path);
  if (submissionsMatch && submissionsMatch[1]) {
    return { name: 'submissions', formId: submissionsMatch[1] };
  }

  const editMatch = /^\/forms\/([^/]+)\/edit$/.exec(path);
  if (editMatch && editMatch[1]) {
    return { name: 'editor', formId: editMatch[1] };
  }

  const previewMatch = /^\/forms\/([^/]+)\/preview$/.exec(path);
  if (previewMatch && previewMatch[1]) {
    return { name: 'preview', formId: previewMatch[1] };
  }

  // Public link. Anything else under /forms/:x is the respondent's form.
  const fillMatch = /^\/forms\/([^/]+)$/.exec(path);
  if (fillMatch && fillMatch[1]) {
    return { name: 'fill', slug: decodeURIComponent(fillMatch[1]) };
  }

  return { name: 'notfound', path };
}

/** Stable key for page transition animations. */
export function routeKey(route: Route): string {
  switch (route.name) {
    case 'dashboard':
      return '/';
    case 'settings':
      return '/settings';
    case 'editor':
      return route.formId ? `/forms/${route.formId}/edit` : '/forms/new';
    case 'preview':
      return `/forms/${route.formId}/preview`;
    case 'submissions':
      return `/forms/${route.formId}/submissions`;
    case 'respond':
      return '/r';
    case 'fill':
      return `/forms/${route.slug}`;
    case 'dropLab':
      return '/lab/drop';
    case 'notfound':
      return route.path;
  }
}

export function useRoute(): Route {
  const [path, setPath] = useState<string>(() => normalizePath());

  useEffect(() => {
    const handler = () => {
      // A hash-only change never reloads the page, so upgrade `#/…` here too.
      syncPathFromHash();
      setPath(normalizePath());
    };
    window.addEventListener('popstate', handler);
    window.addEventListener(NAVIGATE_EVENT, handler);
    return () => {
      window.removeEventListener('popstate', handler);
      window.removeEventListener(NAVIGATE_EVENT, handler);
    };
  }, []);

  return matchRoute(path);
}

export function navigate(path: string): void {
  if (typeof window === 'undefined') return;
  const target = hrefFor(path);
  if (`${window.location.pathname}${window.location.search}` === target) return;
  window.history.pushState({}, '', target);
  window.dispatchEvent(new Event(NAVIGATE_EVENT));
}

export function hrefFor(path: string): string {
  return path.startsWith('/') ? path : `/${path}`;
}
