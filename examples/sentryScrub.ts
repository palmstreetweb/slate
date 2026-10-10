/**
 * What leaves for Sentry never carries a URL's query string (audit F4).
 * `dataCollection.urlQueryParams: false` covers request and span URLs, but the
 * browser SDK's fetch/XHR breadcrumbs record the URL as fetched — and in the
 * studio that can be a presigned storage URL (`?X-Amz-Signature=…`), good for
 * an hour to anyone who can read the project. Pure; no SDK import, so tests
 * and the public bundle stay light.
 */

type Crumb = {
  category?: string;
  message?: string;
  data?: Record<string, unknown>;
};

type Event = {
  request?: { url?: string; query_string?: unknown };
  breadcrumbs?: Crumb[];
};

const URL_KEYS = ['url', 'from', 'to'] as const;

/** The URL up to its query string or fragment. */
export function stripQuery(url: string): string {
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : url.slice(0, cut);
}

/** The breadcrumb with its URL-shaped fields cut at the query string. */
export function scrubBreadcrumb<B extends Crumb>(crumb: B): B {
  let data: Record<string, unknown> | null = null;
  for (const key of URL_KEYS) {
    const value = crumb.data?.[key];
    if (typeof value !== 'string' || !/[?#]/.test(value)) continue;
    data ??= { ...crumb.data };
    data[key] = stripQuery(value);
  }
  const message =
    typeof crumb.message === 'string' && /https?:\/\/\S*[?#]/.test(crumb.message)
      ? scrubMessage(crumb.message)
      : null;
  if (!data && message === null) return crumb;
  return { ...crumb, ...(data ? { data } : {}), ...(message !== null ? { message } : {}) };
}

/** Every `http(s)://…?…` in free text loses its query string. */
function scrubMessage(text: string): string {
  return text.replace(/(https?:\/\/[^\s?#]+)[?#]\S*/g, '$1');
}

/** The event with its request URL and every breadcrumb scrubbed. */
export function scrubEvent<E extends Event>(event: E): E {
  let next: E = event;
  if (event.request && (typeof event.request.url === 'string' || 'query_string' in event.request)) {
    const { query_string: _dropped, ...rest } = event.request;
    next = {
      ...next,
      request: {
        ...rest,
        ...(typeof rest.url === 'string' ? { url: stripQuery(rest.url) } : {}),
      },
    };
  }
  if (Array.isArray(event.breadcrumbs)) {
    next = { ...next, breadcrumbs: event.breadcrumbs.map(scrubBreadcrumb) };
  }
  return next;
}
