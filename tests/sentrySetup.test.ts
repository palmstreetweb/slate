// @vitest-environment node
/**
 * Sentry stays on the deployed site. The published package must not gain it
 * as a dependency, and the engine source must not import it (ADR-069).
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { captureApiException } from '../api/_lib/sentry.js';
import {
  isApiSentryEnabled,
  isClientSentryEnabled,
  SENTRY_DATA_COLLECTION,
  SENTRY_TRACES_SAMPLE_RATE,
} from '../api/_lib/sentryGate.js';

const srcDir = fileURLToPath(new URL('../src', import.meta.url));

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (/\.(ts|tsx|js|mjs|css)$/.test(name)) out.push(path);
  }
  return out;
}

describe('Sentry stays off the published library', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    dependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

  it('is a devDependency, not a dependency consumers install', () => {
    for (const name of ['@sentry/react', '@sentry/node', '@sentry/vite-plugin']) {
      expect(pkg.dependencies?.[name]).toBeUndefined();
      expect(pkg.peerDependencies?.[name]).toBeUndefined();
      expect(pkg.devDependencies?.[name]).toBeTruthy();
    }
  });

  it('is not imported by the engine', () => {
    const hits = walk(srcDir).filter((file) => readFileSync(file, 'utf8').includes('@sentry'));
    expect(hits).toEqual([]);
  });
});

describe('Sentry is production-only', () => {
  it('samples traces modestly and does not send personal data', () => {
    expect(SENTRY_TRACES_SAMPLE_RATE).toBe(0.1);
    expect(SENTRY_DATA_COLLECTION.userInfo).toBe(false);
    expect(SENTRY_DATA_COLLECTION.httpBodies).toEqual([]);
    expect(SENTRY_DATA_COLLECTION.urlQueryParams).toBe(false);
  });

  it('the site reports only from a production build that has a DSN', () => {
    const dsn = 'https://example@o0.ingest.us.sentry.io/1';
    expect(isClientSentryEnabled({ prod: true, dsn, vercelEnv: 'production' })).toBe(true);
    expect(isClientSentryEnabled({ prod: true, dsn, vercelEnv: undefined })).toBe(true);
    expect(isClientSentryEnabled({ prod: true, dsn, vercelEnv: 'preview' })).toBe(false);
    expect(isClientSentryEnabled({ prod: true, dsn, vercelEnv: 'development' })).toBe(false);
    expect(isClientSentryEnabled({ prod: false, dsn, vercelEnv: 'production' })).toBe(false);
    expect(isClientSentryEnabled({ prod: true, dsn: '  ', vercelEnv: 'production' })).toBe(false);
    expect(isClientSentryEnabled({ prod: true, dsn: undefined, vercelEnv: 'production' })).toBe(
      false,
    );
  });

  it('the API reports only in production when SENTRY_DSN is set', () => {
    const dsn = 'https://example@o0.ingest.us.sentry.io/1';
    expect(isApiSentryEnabled({ SENTRY_DSN: dsn, VERCEL_ENV: 'production' })).toBe(true);
    expect(isApiSentryEnabled({ SENTRY_DSN: dsn, NODE_ENV: 'production' })).toBe(true);
    expect(
      isApiSentryEnabled({ SENTRY_DSN: dsn, VERCEL_ENV: 'preview', NODE_ENV: 'production' }),
    ).toBe(false);
    expect(
      isApiSentryEnabled({ SENTRY_DSN: dsn, VERCEL_ENV: 'development', NODE_ENV: 'production' }),
    ).toBe(false);
    expect(isApiSentryEnabled({ SENTRY_DSN: dsn, NODE_ENV: 'test' })).toBe(false);
    expect(isApiSentryEnabled({ NODE_ENV: 'production' })).toBe(false);
  });

  it('does not import the SDK while it is off', async () => {
    await expect(captureApiException(new Error('kept in process'))).resolves.toBeUndefined();
  });
});
