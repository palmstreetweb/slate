/**
 * Dual-signature handler for Node serverless functions (QA GS-026).
 *
 * In production Vercel runs `api/*.ts` (without `runtime: 'edge'`) as a
 * classic Node function and calls it with (IncomingMessage, ServerResponse):
 * the Web `Request` API is NOT there, and `request.headers.get` throws.
 * Tests and the Vite dev proxy call with a real `Request`. `nodeOrWeb` takes
 * a Web-style handler and accepts either: a `Request` passes straight
 * through; the Node pair becomes a `Request`, and the `Response` is written
 * back. (`api/generate.ts` carries its own copy of this adapter.)
 */

type NodeIncoming = AsyncIterable<Buffer> & {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
};
type NodeOutgoing = {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(chunk?: unknown): void;
};

function isWebRequest(value: unknown): value is Request {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { headers?: { get?: unknown } }).headers?.get === 'function'
  );
}

export function nodeOrWeb(
  handle: (request: Request) => Promise<Response>,
  fallbackPath: string,
): (request: Request | NodeIncoming, res?: NodeOutgoing) => Promise<Response | void> {
  return async (request, res) => {
    if (isWebRequest(request)) return handle(request);

    const method = (request.method ?? 'GET').toUpperCase();
    const headers = new Headers();
    for (const [key, value] of Object.entries(request.headers)) {
      if (!value) continue;
      headers.set(key, Array.isArray(value) ? value.join(',') : value);
    }
    const chunks: Buffer[] = [];
    if (method !== 'GET' && method !== 'HEAD') {
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
    }
    const webRequest = new Request(
      `https://${headers.get('host') ?? 'localhost'}${request.url ?? fallbackPath}`,
      {
        method,
        headers,
        body: method === 'GET' || method === 'HEAD' ? undefined : Buffer.concat(chunks),
      },
    );

    const response = await handle(webRequest);
    if (!res) return response;
    res.statusCode = response.status;
    response.headers.forEach((value, key) => res.setHeader(key, value));
    res.end(Buffer.from(await response.arrayBuffer()));
  };
}
