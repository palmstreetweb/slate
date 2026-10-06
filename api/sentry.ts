/**
 * Error reporting for the Node `/api/generate` function (ADR-069).
 * Loaded only after `isApiSentryEnabled` — a missing DSN never imports the SDK,
 * so a too-old Node or a Sentry outage cannot take down Build with AI.
 * The auth-email route is the Edge runtime; `@sentry/node` does not run there.
 */

import {
  isApiSentryEnabled,
  SENTRY_DATA_COLLECTION,
  SENTRY_TRACES_SAMPLE_RATE,
} from './sentryGate.js';

let starting: Promise<boolean> | null = null;

function start(): Promise<boolean> {
  if (!isApiSentryEnabled(process.env)) return Promise.resolve(false);
  starting ??= import('@sentry/node')
    .then((Sentry) => {
      if (Sentry.getClient()) return true;
      const dsn = process.env.SENTRY_DSN?.trim();
      if (!dsn) return false;
      const release = process.env.VERCEL_GIT_COMMIT_SHA?.trim();
      Sentry.init({
        dsn,
        environment: process.env.VERCEL_ENV || 'production',
        ...(release ? { release } : {}),
        tracesSampleRate: SENTRY_TRACES_SAMPLE_RATE,
        // Don't attach sentry-trace to Anthropic or Neon. Nothing there reads it.
        tracePropagationTargets: [],
        dataCollection: SENTRY_DATA_COLLECTION,
      });
      return true;
    })
    .catch((err: unknown) => {
      console.error('[slate] sentry init failed', err);
      return false;
    });
  return starting;
}

/** Report an unexpected server failure. Validation and quota responses are not errors. */
export async function captureApiException(error: unknown): Promise<void> {
  if (!isApiSentryEnabled(process.env)) return;
  try {
    const ready = await start();
    if (!ready) return;
    const Sentry = await import('@sentry/node');
    if (!Sentry.getClient()) return;
    Sentry.captureException(error);
    await Sentry.flush(2000);
  } catch (err) {
    console.error('[slate] sentry capture failed', err);
  }
}
