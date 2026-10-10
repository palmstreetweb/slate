/**
 * Browser error reporting for the deployed Vite site (ADR-069).
 * Not part of the published library. `main.tsx` calls `initSentry` after it
 * has started the public-form fetch; a respondent's page passes
 * `{ tracing: false }` so it reports errors only (ADR-071).
 */

import { browserTracingIntegration, init, reactErrorHandler } from '@sentry/react';
import {
  isClientSentryEnabled,
  SENTRY_DATA_COLLECTION,
  SENTRY_TRACES_SAMPLE_RATE,
} from '../api/_lib/sentryGate.js';
import { scrubBreadcrumb, scrubEvent } from './sentryScrub.js';

declare const __SLATE_SENTRY_RELEASE__: string | undefined;
declare const __SLATE_VERCEL_ENV__: string | undefined;

function definedString(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function releaseName(): string | undefined {
  return definedString(
    typeof __SLATE_SENTRY_RELEASE__ === 'string' ? __SLATE_SENTRY_RELEASE__ : undefined,
  );
}

function vercelEnv(): string | undefined {
  return definedString(typeof __SLATE_VERCEL_ENV__ === 'string' ? __SLATE_VERCEL_ENV__ : undefined);
}

function clientEnabled(): boolean {
  return isClientSentryEnabled({
    prod: import.meta.env.PROD,
    dsn: import.meta.env.VITE_SENTRY_DSN,
    vercelEnv: vercelEnv(),
  });
}

let started = false;

export function initSentry(opts: { tracing?: boolean } = {}): void {
  if (started) return;
  started = true;
  const dsn = import.meta.env.VITE_SENTRY_DSN?.trim();
  if (!dsn || !clientEnabled()) return;
  const release = releaseName();
  const tracing = opts.tracing !== false;
  init({
    dsn,
    environment: vercelEnv() || 'production',
    ...(release ? { release } : {}),
    integrations: tracing ? [browserTracingIntegration()] : [],
    tracesSampleRate: tracing ? SENTRY_TRACES_SAMPLE_RATE : 0,
    // Same-origin only. Neon and other hosts must not see sentry-trace (CORS).
    tracePropagationTargets: [/^\//],
    dataCollection: SENTRY_DATA_COLLECTION,
    // No query strings anywhere in an event: a fetch breadcrumb's URL can be a
    // presigned storage link, good for an hour to anyone reading the project (audit F4).
    beforeBreadcrumb: (crumb) => scrubBreadcrumb(crumb),
    beforeSend: (event) => scrubEvent(event),
  });
}

/**
 * React 19 reports render errors through `createRoot`, including ones an
 * ErrorBoundary already handled. `Sentry.ErrorBoundary` would report those
 * a second time, so the site keeps its own fallback UI.
 */
export function sentryRootOptions(): {
  onUncaughtError?: (error: unknown, errorInfo: { componentStack?: string }) => void;
  onCaughtError?: (
    error: unknown,
    errorInfo: { componentStack?: string; errorBoundary?: unknown },
  ) => void;
  onRecoverableError?: (error: unknown, errorInfo: { componentStack?: string }) => void;
} {
  if (!clientEnabled()) return {};
  const report = reactErrorHandler();
  return {
    onUncaughtError: report,
    onCaughtError: report,
    onRecoverableError: report,
  };
}
