/**
 * When Sentry is allowed to send. Shared by the Vite site and `/api/generate`
 * so the two don't drift. No SDK import — safe for the browser bundle and for tests.
 *
 * SDK 11 dropped `sendDefaultPii`. These fields are that switch, plus the
 * request body and query string, which on Slate can be a prompt or a form answer.
 */

export const SENTRY_TRACES_SAMPLE_RATE = 0.1;

export const SENTRY_DATA_COLLECTION = {
  userInfo: false,
  cookies: false,
  httpHeaders: false,
  httpBodies: [] as (
    | 'incomingRequest'
    | 'outgoingRequest'
    | 'incomingResponse'
    | 'outgoingResponse'
  )[],
  urlQueryParams: false,
  stackFrameVariables: false,
};

export function isClientSentryEnabled(input: {
  prod: boolean;
  dsn: string | undefined;
  vercelEnv: string | undefined;
}): boolean {
  if (!input.prod || !input.dsn?.trim()) return false;
  // Preview and `vercel dev` are not production. An unset env (local `vite build`)
  // still counts, so a production build with a DSN reports.
  if (input.vercelEnv === 'preview' || input.vercelEnv === 'development') return false;
  return true;
}

export function isApiSentryEnabled(env: {
  SENTRY_DSN?: string | undefined;
  NODE_ENV?: string | undefined;
  VERCEL_ENV?: string | undefined;
}): boolean {
  if (!env.SENTRY_DSN?.trim()) return false;
  if (env.VERCEL_ENV === 'preview' || env.VERCEL_ENV === 'development') return false;
  if (env.VERCEL_ENV === 'production') return true;
  return env.NODE_ENV === 'production';
}
