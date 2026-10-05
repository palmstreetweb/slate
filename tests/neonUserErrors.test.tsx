/**
 * Studio network errors read as plain sentences (QA COPY-01, S20): never a
 * stack trace, Postgres wording, a status page or a code. The raw text stays
 * in the console for debugging.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  upsertError: null as unknown,
  insertError: null as unknown,
  updateError: null as unknown,
  rpcError: null as unknown,
}));

vi.mock('../examples/_admin/neon/client.js', () => ({
  getNeon: () => ({
    from: () => ({
      select: () => ({
        order: async () => ({ data: [ROW], error: null }),
      }),
      upsert: async () => ({ error: db.upsertError }),
      insert: async () => ({ error: db.insertError }),
      update: () => ({
        eq: async () => ({ error: db.updateError }),
      }),
    }),
    rpc: async (fn: string) =>
      fn === 'auth_uid'
        ? { data: 'owner-1', error: null }
        : { data: db.rpcError ? null : true, error: db.rpcError },
  }),
}));
vi.mock('../examples/_admin/neon/ensureAuth.js', () => ({
  ensureAuthForDataApi: async () => ({ accessToken: 't', email: 'o@example.com' }),
  waitForAuthReady: async () => ({ ok: true, authUid: 'owner-1', clientEmail: null }),
}));

const ROW = {
  id: 'f_1',
  name: 'Pool care',
  slug: '23456789',
  schema: { questions: [] },
  published_schema: null,
  status: 'draft',
  deleted_at: null,
  created_at: '2026-09-20T00:00:00Z',
  updated_at: '2026-09-20T00:00:00Z',
  fill_locked: false,
};

import {
  SessionNotReadyError,
  neonFailureKind,
  userNeonError,
  type NeonAction,
} from '../examples/_admin/neon/neonError.js';
import {
  clearFormsRemoteCache,
  hydrateFormsRemote,
  setFormFillPasswordRemote,
  trashFormRemoteSync,
  updateFormRemoteSync,
} from '../examples/_admin/neon/formsRemote.js';
import { PersistErrorToasts, looksTechnical } from '../examples/_admin/shell/PersistErrorToasts.js';
import { ToastProvider } from '../examples/_admin/toast.js';

/** postgrest-js's shape for a failed fetch: the stack rides in `details`. */
const FETCH_FAILED = {
  message: 'TypeError: Failed to fetch',
  details:
    'TypeError: Failed to fetch\n    at http://127.0.0.1:5196/node_modules/.vite/deps/neon-js.js?v=1:23919:10\n    at async write (http://127.0.0.1:5196/_admin/neon/formsRemote.ts:304:21)',
  hint: '',
  code: '',
};
const RLS = {
  code: '42501',
  details: null,
  hint: null,
  message: 'new row violates row-level security policy for table "forms"',
};
const JWT = { code: 'PGRST301', details: null, hint: null, message: 'JWT expired' };
const DUPLICATE = {
  code: '23505',
  details: 'Key (slug)=(23456789) already exists.',
  hint: null,
  message: 'duplicate key value violates unique constraint "forms_slug_key"',
};
const GATEWAY = { message: '<html><body>503 Service Temporarily Unavailable</body></html>' };
const CODE_ONLY = { code: '23514' };
const AUTH_REQUIRED = Object.assign(
  new Error('Authentication required. A valid token is needed to access the resource.'),
  { name: 'AuthRequiredError' },
);
const TIMEOUT = Object.assign(new Error('Neon store hydrate timed out after 25000ms'), {
  name: 'TimeoutError',
});

const ACTIONS: NeonAction[] = [
  'save',
  'delete',
  'load',
  'password',
  'response',
  'move',
  'feedback',
  'restore-backup',
];

/** Words an owner should never read. */
const DEV_WORDS =
  /TypeError|Failed to fetch|http|PGRST|JWT|row-level|violates|constraint|duplicate key|<html|\d{3,}|Neon|cloud|schema|payload|JSON|undefined|NaN|Error:|please.*please/i;

let online = true;
beforeEach(() => {
  online = true;
  vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => online);
});
afterEach(() => vi.restoreAllMocks());

describe('userNeonError', () => {
  it.each([
    ['a failed fetch', FETCH_FAILED, 'offline'],
    ['row-level security', RLS, 'signed-out'],
    ['an expired token', JWT, 'signed-out'],
    ['a duplicate slug', DUPLICATE, 'conflict'],
    ['an HTML gateway page', GATEWAY, 'server'],
    ['a code with no message', CODE_ONLY, 'other'],
    ['no token while online', AUTH_REQUIRED, 'signed-out'],
    ['our own signed-out error', new SessionNotReadyError(), 'signed-out'],
    ['a load that timed out', TIMEOUT, 'offline'],
    ['a thrown TypeError', new TypeError('Load failed'), 'offline'],
  ])('%s', (_label, err, kind) => {
    expect(neonFailureKind(err)).toBe(kind);
    for (const action of ACTIONS) {
      const text = userNeonError(err, action);
      expect(text).not.toMatch(DEV_WORDS);
      expect(looksTechnical(text)).toBe(false);
      expect(text.length).toBeLessThan(110);
    }
  });

  it('no token while the device is offline is a connection problem', () => {
    online = false;
    expect(neonFailureKind(AUTH_REQUIRED)).toBe('offline');
  });

  it('says what to do for the common cases', () => {
    expect(userNeonError(FETCH_FAILED, 'save')).toBe(
      'Check your connection. Your last change isn’t saved yet.',
    );
    expect(userNeonError(RLS, 'save')).toBe(
      'Your sign-in expired. Sign out and back in, then try again.',
    );
    expect(userNeonError(DUPLICATE, 'save')).toBe(
      'This form changed somewhere else. Reload the page and try again.',
    );
    expect(userNeonError(GATEWAY, 'save')).toBe(
      'Slate is having trouble right now. Try again in a minute.',
    );
    expect(userNeonError(CODE_ONLY, 'save')).toBe(
      'Your last change isn’t saved yet. Try again in a moment.',
    );
    expect(userNeonError(TIMEOUT, 'load')).toBe(
      'Couldn’t load your forms — check your connection, then try again.',
    );
    expect(userNeonError(new SessionNotReadyError(), 'load')).toBe(
      'Slate couldn’t confirm it’s you. Try again, or sign out and back in.',
    );
    expect(userNeonError(FETCH_FAILED, 'feedback')).toBe(
      'Couldn’t send — check your connection and try again.',
    );
  });

  it('keeps the form-limit sentence', () => {
    expect(
      userNeonError({ message: 'FORM_QUOTA_EXCEEDED used=50 limit=50', code: 'P0001' }, 'save'),
    ).toMatch(/^This account can keep 50 forms/);
  });
});

describe('form saves report plain words', () => {
  let events: Array<{ kind: string; message: string; title?: string }>;
  const onError = (e: Event) =>
    events.push((e as CustomEvent<{ kind: string; message: string; title?: string }>).detail);

  beforeEach(async () => {
    events = [];
    db.upsertError = null;
    clearFormsRemoteCache();
    await hydrateFormsRemote({ soft: true });
    window.addEventListener('slate-persist-error', onError);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => window.removeEventListener('slate-persist-error', onError));

  it('an editor save that never left the device: no stack trace, the raw text in the console', async () => {
    db.upsertError = FETCH_FAILED;
    updateFormRemoteSync('f_1', { name: 'Pool care 2' });
    await vi.waitFor(() => expect(events).toHaveLength(1));
    expect(events[0]).toEqual({
      kind: 'form',
      message: 'Check your connection. Your last change isn’t saved yet.',
    });
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).toContain('Failed to fetch');
  });

  it('a failed trash says so in its title', async () => {
    db.upsertError = GATEWAY;
    trashFormRemoteSync('f_1');
    await vi.waitFor(() => expect(events).toHaveLength(1));
    expect(events[0]).toEqual({
      kind: 'form',
      title: 'Couldn’t move that form to Trash',
      message: 'Slate is having trouble right now. Try again in a minute.',
    });
  });

  it('a trash that never left the device says to try again, not that an edit is unsaved', async () => {
    db.upsertError = FETCH_FAILED;
    trashFormRemoteSync('f_1');
    await vi.waitFor(() => expect(events).toHaveLength(1));
    expect(events[0]).toEqual({
      kind: 'form',
      title: 'Couldn’t move that form to Trash',
      message: 'Check your connection and try again.',
    });
  });

  it('the password lock: offline and a missing switch, both plain', async () => {
    db.rpcError = FETCH_FAILED;
    await expect(setFormFillPasswordRemote('f_1', 'harvest')).resolves.toEqual({
      ok: false,
      message: 'Couldn’t change the password — check your connection and try again.',
    });
    db.rpcError = { code: 'PGRST202', message: 'Could not find the function' };
    await expect(setFormFillPasswordRemote('f_1', 'harvest')).resolves.toEqual({
      ok: false,
      message: 'Password lock isn’t available yet. Try again later.',
    });
    db.rpcError = null;
  });
});

describe('the toast host', () => {
  function dispatch(detail: Record<string, unknown>) {
    window.dispatchEvent(new CustomEvent('slate-persist-error', { detail }));
  }

  it('uses the sender’s title when there is one', async () => {
    render(
      <ToastProvider>
        <PersistErrorToasts />
      </ToastProvider>,
    );
    dispatch({
      kind: 'form',
      title: 'Couldn’t delete that form',
      message: 'Check your connection and try again.',
    });
    expect(await screen.findByText('Couldn’t delete that form')).toBeInTheDocument();
    expect(screen.getByText('Check your connection and try again.')).toBeInTheDocument();
  });

  it('never shows technical text, even from a sender that forgot to word it', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ToastProvider>
        <PersistErrorToasts />
      </ToastProvider>,
    );
    dispatch({
      kind: 'form',
      message: 'TypeError: Failed to fetch — TypeError: Failed to fetch at http://x/neon.js:1:2',
    });
    expect(await screen.findByText('Couldn’t save your form')).toBeInTheDocument();
    expect(screen.getByText('Check your connection and try again.')).toBeInTheDocument();
    expect(screen.queryByText(/TypeError/)).toBeNull();
    fireEvent.keyDown(window, { key: 'Escape' });
  });

  it.each([
    'new row violates row-level security policy for table "forms"',
    'Could not save form (23514)',
    '<html><body>503</body></html>',
    '{"code":"PGRST301"}',
  ])('flags %s as technical', (text) => {
    expect(looksTechnical(text)).toBe(true);
  });

  it.each([
    'Check your connection. Your last change isn’t saved yet.',
    'This account can keep 50 forms, including ones in Trash. Move a form to Trash, then delete it forever to make room.',
    'network down',
  ])('lets %s through', (text) => {
    expect(looksTechnical(text)).toBe(false);
  });
});
