/**
 * A dynamic QR code's short link, `/q/{code}` (ADR-075 §5–6). `vercel.json`
 * rewrites it here; the answer is one `302` to the owner's link, with no page
 * or JavaScript before it, so a scan on cafe Wi-Fi is one hop.
 *
 * The lookup is `submitresponse` `GET ?op=qr`, which holds the database pool
 * and the rate core. It trusts the client IP this edge forwards only with
 * QR_EDGE_KEY, so the per-network count cap can't be dodged by typing a
 * header. No database credential lives on Vercel.
 *
 * Counting: a phone that scanned this code in the last 30 minutes carries
 * the `slq` cookie (scoped to this code's path) and isn't counted again.
 * Link-preview bots and HEAD requests are never counted. Nothing personal is
 * stored: the database keeps a per-day number, nothing else.
 */

export const config = { runtime: 'edge' };

const LOOKUP_URL = (
  process.env.QR_LOOKUP_URL ||
  process.env.VITE_SUBMIT_URL ||
  'https://br-calm-darkness-ax6lho6c-submitresponse.compute.c-4.us-east-2.aws.neon.tech'
).replace(/\/$/, '');

/** 025 qr_codes_code_shape. */
const CODE_RE = /^[a-hjkmnp-z2-9]{8}$/;
const COUNT_COOKIE = 'slq';
export const COUNT_WINDOW_SEC = 30 * 60;
const LOOKUP_TIMEOUT_MS = 4_000;

/** Unfurlers and fetchers that open links without a person scanning anything. */
const BOT_UA =
  /bot\b|crawler|spider|preview|facebookexternalhit|whatsapp|slack|discord|telegram|skype|embedly|quora link|pinterest|vkshare|w3c_validator|curl\/|wget\/|python-requests|go-http-client|headless/i;

export const PAGE_COPY = {
  not_found: {
    status: 404,
    title: 'We couldn’t find that code',
    body: 'Check that the whole code scanned, or ask whoever shared it for a new one.',
  },
  inactive: {
    status: 404,
    title: 'This code isn’t active right now',
    body: 'Whoever made it has paused it. Try again later.',
  },
  unavailable: {
    status: 503,
    title: 'Couldn’t open this code right now',
    body: 'Please try again in a moment.',
  },
} as const;

type Page = keyof typeof PAGE_COPY;

/** The code from the rewrite's `?code=`, or from the path when called as `/q/{code}`. */
function codeOf(url: URL): string {
  const fromQuery = url.searchParams.get('code');
  if (fromQuery) return fromQuery;
  const m = /^\/q\/([^/]+)\/?$/.exec(url.pathname);
  return m?.[1] ?? '';
}

/** Vercel writes x-real-ip / x-forwarded-for itself at the edge; a client can't set them. */
function clientIp(request: Request): string {
  const real = request.headers.get('x-real-ip')?.trim();
  if (real) return real;
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '';
}

function hasCountCookie(request: Request): boolean {
  const raw = request.headers.get('cookie') ?? '';
  return raw.split(';').some((part) => part.trim().startsWith(`${COUNT_COOKIE}=`));
}

const BASE_HEADERS = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex',
} as const;

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** A small page with no script and no network requests. */
export function pageHtml(page: Page): string {
  const { title, body } = PAGE_COPY[page];
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)} · Slate</title>
<style>
:root{--bg:#faf6ee;--ink:#2a2520;--muted:#6b6259;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--bg:#15181d;--ink:#f2efe8;--muted:#8a93a1}}
html,body{margin:0;height:100%;background:var(--bg);color:var(--ink)}
body{display:grid;place-items:center;padding:24px;box-sizing:border-box;font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;text-align:center}
main{max-width:360px}
h1{font-size:22px;line-height:1.25;margin:0 0 10px;letter-spacing:-0.01em}
p{margin:0;color:var(--muted)}
.mark{display:inline-grid;gap:5px;width:28px;margin-bottom:22px}
.mark span{height:5px;border-radius:3px;background:var(--ink)}
.mark span:first-child{width:55%;background:#e23b2d}
.mark span:last-child{width:70%}
</style>
</head>
<body>
<main>
<div class="mark" aria-hidden="true"><span></span><span></span><span></span></div>
<h1>${escapeHtml(title)}</h1>
<p>${escapeHtml(body)}</p>
</main>
</body>
</html>`;
}

function pageResponse(page: Page, head: boolean): Response {
  const headers: Record<string, string> = {
    ...BASE_HEADERS,
    'Content-Type': 'text/html; charset=utf-8',
  };
  if (page === 'unavailable') headers['Retry-After'] = '5';
  return new Response(head ? null : pageHtml(page), {
    status: PAGE_COPY[page].status,
    headers,
  });
}

type Lookup = { status: 'ok' | 'inactive' | 'not_found'; target: string | null; counted: boolean };

async function lookup(code: string, count: boolean, ip: string): Promise<Lookup | null> {
  const key = process.env.QR_EDGE_KEY;
  if (!key) {
    console.error('[q] QR_EDGE_KEY is not set');
    return null;
  }
  try {
    const res = await fetch(`${LOOKUP_URL}/?op=qr&code=${code}&count=${count ? '1' : '0'}`, {
      headers: {
        'x-slate-edge-key': key,
        ...(ip ? { 'x-slate-client-ip': ip } : {}),
      },
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error('[q] lookup answered', res.status);
      return null;
    }
    const body = (await res.json()) as Partial<Lookup>;
    if (body.status !== 'ok' && body.status !== 'inactive' && body.status !== 'not_found') {
      return null;
    }
    return {
      status: body.status,
      target: typeof body.target === 'string' ? body.target : null,
      counted: body.counted === true,
    };
  } catch (err) {
    console.error('[q] lookup failed', String(err).slice(0, 200));
    return null;
  }
}

export default async function handler(request: Request): Promise<Response> {
  const method = request.method.toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    return new Response(null, { status: 405, headers: { ...BASE_HEADERS, Allow: 'GET, HEAD' } });
  }
  const head = method === 'HEAD';
  const code = codeOf(new URL(request.url)).trim().toLowerCase();
  // Not a code at all: answer here without spending a lookup.
  if (!CODE_RE.test(code)) return pageResponse('not_found', head);

  const seen = hasCountCookie(request);
  const count = !head && !seen && !BOT_UA.test(request.headers.get('user-agent') ?? '');
  const result = await lookup(code, count, clientIp(request));
  if (!result) return pageResponse('unavailable', head);
  // record_qr_scan only returns http(s) targets (025); anything else is treated as inactive.
  if (result.status === 'ok' && !/^https?:\/\//i.test(result.target ?? '')) {
    return pageResponse('inactive', head);
  }
  if (result.status !== 'ok' || !result.target) {
    return pageResponse(result.status === 'inactive' ? 'inactive' : 'not_found', head);
  }

  const headers = new Headers({ ...BASE_HEADERS, Location: result.target });
  if (!head && !seen) {
    headers.append(
      'Set-Cookie',
      `${COUNT_COOKIE}=1; Max-Age=${COUNT_WINDOW_SEC}; Path=/q/${code}; Secure; HttpOnly; SameSite=Lax`,
    );
  }
  return new Response(null, { status: 302, headers });
}
