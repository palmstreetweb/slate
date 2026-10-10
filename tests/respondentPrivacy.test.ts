// @vitest-environment node
/**
 * A respondent's page contacts this origin, the submit Function, and (on an
 * error) Sentry — nothing else (audit 2026-10 F5, ADR-071): fonts are
 * self-hosted, and Sentry on the fill page reports errors only, with no
 * browser tracing and a zero trace sample rate.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

const sentry = vi.hoisted(() => ({
  init: vi.fn(),
  browserTracingIntegration: vi.fn(() => ({ name: 'BrowserTracing' })),
}));
vi.mock('@sentry/react', () => ({
  init: sentry.init,
  browserTracingIntegration: sentry.browserTracingIntegration,
  reactErrorHandler: () => () => undefined,
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  sentry.init.mockClear();
  sentry.browserTracingIntegration.mockClear();
});

async function initWith(opts?: { tracing?: boolean }) {
  vi.stubEnv('PROD', true);
  vi.stubEnv('VITE_SENTRY_DSN', 'https://k@o.ingest.us.sentry.io/1');
  const mod = await import('../examples/sentry.js');
  mod.initSentry(opts);
  return sentry.init.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
}

describe('Sentry on the fill page', () => {
  it('a respondent’s page: errors only, no tracing integration, trace sampling 0', async () => {
    const options = await initWith({ tracing: false });
    expect(options).toBeDefined();
    expect(options!.integrations).toEqual([]);
    expect(options!.tracesSampleRate).toBe(0);
    expect(sentry.browserTracingIntegration).not.toHaveBeenCalled();
  });

  it('the studio keeps browser tracing at the ADR-069 rate', async () => {
    const options = await initWith();
    expect(options!.integrations).toHaveLength(1);
    expect(options!.tracesSampleRate).toBe(0.1);
  });

  it('nothing initialises Sentry on module load; the entry points decide', async () => {
    vi.stubEnv('PROD', true);
    vi.stubEnv('VITE_SENTRY_DSN', 'https://k@o.ingest.us.sentry.io/1');
    await import('../examples/sentry.js');
    expect(sentry.init).not.toHaveBeenCalled();
  });

  it('the public entry points pass tracing: false, the studio path does not', () => {
    expect(read('examples/publicApp.tsx')).toMatch(/initSentry\(\{ tracing: false \}\)/);
    expect(read('examples/main.tsx')).toMatch(/initSentry\(\{ tracing: !respondent \}\)/);
  });
});

describe('fonts are same-origin', () => {
  it('index.html names no Google Fonts host, and the entry imports the self-hosted stylesheet', () => {
    const html = read('examples/index.html');
    expect(html).not.toMatch(/fonts\.googleapis\.com|fonts\.gstatic\.com/);
    expect(read('examples/main.tsx')).toMatch(/^import '\.\/fonts\.css';/m);
  });

  it('fonts.css declares Inter (variable, opsz + wght) and JetBrains Mono 400/500 under the token names', () => {
    const css = read('examples/fonts.css');
    expect(css).not.toMatch(/https?:\/\//);
    const faces = [...css.matchAll(/@font-face\s*\{([^}]+)\}/g)].map((m) => m[1]!);
    expect(faces.length).toBeGreaterThanOrEqual(14);
    const inter = faces.filter((f) => f.includes("font-family: 'Inter';"));
    const mono = faces.filter((f) => f.includes("font-family: 'JetBrains Mono';"));
    expect(inter.length + mono.length).toBe(faces.length);
    expect(inter.every((f) => /font-weight: 100 900;/.test(f) && /opsz/.test(f))).toBe(true);
    expect(new Set(mono.map((f) => /font-weight: (\d+);/.exec(f)?.[1]))).toEqual(
      new Set(['400', '500']),
    );
    expect(faces.every((f) => /\.woff2\)/.test(f) && !/\.woff\)/.test(f))).toBe(true);
    // Every file it names exists in the installed package.
    for (const m of css.matchAll(/url\(([^)]+)\)/g)) {
      expect(() => readFileSync(resolve(__dirname, '..', 'examples', m[1]!)), m[1]).not.toThrow();
    }
  });
});
