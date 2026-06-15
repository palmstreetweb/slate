/**
 * Tiny hash-based router. No external deps; works in any static host
 * without server-side fallback config.
 *
 * Routes (each as `#/path`):
 *   /                            → dashboard
 *   /forms/new                   → editor (creating)
 *   /forms/:id                   → preview
 *   /forms/:id/edit              → editor (editing)
 *   /forms/:id/submissions       → submissions list
 */

import { useEffect, useState } from 'react';

export type Route =
  | { name: 'dashboard' }
  | { name: 'editor'; formId: string | null }
  | { name: 'preview'; formId: string }
  | { name: 'submissions'; formId: string }
  | { name: 'respond'; token: string }
  | { name: 'notfound'; path: string };

function normalizePath(): string {
  if (typeof window === 'undefined') return '/';
  const h = window.location.hash;
  if (!h || h === '#' || h === '#/') return '/';
  const raw = h.replace(/^#\/?/, '/');
  const q = raw.indexOf('?');
  return q === -1 ? raw : raw.slice(0, q);
}

/** Query string embedded in the hash route (`#/r?d=…`). */
export function hashSearchParams(): URLSearchParams {
  if (typeof window === 'undefined') return new URLSearchParams();
  const h = window.location.hash;
  const q = h.indexOf('?');
  if (q === -1) return new URLSearchParams();
  return new URLSearchParams(h.slice(q + 1));
}

function matchRoute(path: string): Route {
  if (path === '/') return { name: 'dashboard' };
  if (path === '/forms/new') return { name: 'editor', formId: null };

  if (path === '/r') {
    const token = hashSearchParams().get('d')?.trim();
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

  const previewMatch = /^\/forms\/([^/]+)$/.exec(path);
  if (previewMatch && previewMatch[1]) {
    return { name: 'preview', formId: previewMatch[1] };
  }

  return { name: 'notfound', path };
}

/** Stable key for page transition animations. */
export function routeKey(route: Route): string {
  switch (route.name) {
    case 'dashboard':
      return '/';
    case 'editor':
      return route.formId ? `/forms/${route.formId}/edit` : '/forms/new';
    case 'preview':
      return `/forms/${route.formId}`;
    case 'submissions':
      return `/forms/${route.formId}/submissions`;
    case 'respond':
      return '/r';
    case 'notfound':
      return route.path;
  }
}

export function useRoute(): Route {
  const [path, setPath] = useState<string>(() => normalizePath());

  useEffect(() => {
    const handler = () => setPath(normalizePath());
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  }, []);

  return matchRoute(path);
}

export function navigate(path: string): void {
  if (typeof window === 'undefined') return;
  const target = path.startsWith('/') ? `#${path}` : `#/${path}`;
  if (window.location.hash !== target) {
    window.location.hash = target;
  }
}

export function hrefFor(path: string): string {
  return path.startsWith('/') ? `#${path}` : `#/${path}`;
}
