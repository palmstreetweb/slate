import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Neon client fake for formsRemote
// ---------------------------------------------------------------------------
const db = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  authUid: 'owner-1' as string | null,
  upsert: vi.fn(),
  selects: 0,
}));

vi.mock('../examples/_admin/neon/client.js', () => ({
  getNeon: () => ({
    from: () => ({
      select: () => ({
        order: async () => {
          db.selects += 1;
          return { data: db.rows, error: null };
        },
      }),
      upsert: db.upsert,
    }),
    rpc: async (fn: string) =>
      fn === 'auth_uid' ? { data: db.authUid, error: null } : { data: null, error: null },
  }),
}));
vi.mock('../examples/_admin/neon/ensureAuth.js', () => ({
  ensureAuthForDataApi: async () => ({ accessToken: 't', email: 'o@example.com' }),
  waitForAuthReady: async () => ({ ok: true, authUid: 'owner-1', clientEmail: null }),
}));

import {
  clearFormsRemoteCache,
  hydrateFormsRemote,
  listAllFormsRemote,
  listFormsRemote,
  trashFormRemoteSync,
} from '../examples/_admin/neon/formsRemote.js';
import { PersistErrorToasts } from '../examples/_admin/shell/PersistErrorToasts.js';
import { ToastProvider } from '../examples/_admin/toast.js';

const row = (id: string) => ({
  id,
  name: 'Pool care',
  slug: id,
  schema: { questions: [] },
  published_schema: null,
  status: 'draft',
  deleted_at: null,
  created_at: '2026-09-20T00:00:00Z',
  updated_at: '2026-09-20T00:00:00Z',
  fill_locked: false,
});

beforeEach(() => {
  clearFormsRemoteCache();
  db.rows = [];
  db.authUid = 'owner-1';
  db.selects = 0;
  db.upsert.mockReset();
});

afterEach(() => vi.restoreAllMocks());

describe('empty dashboard after sign-in (owner report)', () => {
  it('an empty first read run as the anonymous role is an error, not "no forms"', async () => {
    db.authUid = null;
    await expect(hydrateFormsRemote({ soft: true })).rejects.toThrow(/No auth session/);
  });

  it('re-reads once the database confirms the user, and shows their forms', async () => {
    let first = true;
    db.rows = [];
    const original = db.rows;
    // First select returns nothing (token race), the confirmed re-read returns the form.
    Object.defineProperty(db, 'rows', {
      configurable: true,
      get: () => (first ? ((first = false), original) : [row('f_1')]),
    });
    await hydrateFormsRemote({ soft: true });
    expect(listFormsRemote().map((f) => f.id)).toEqual(['f_1']);
    Object.defineProperty(db, 'rows', { configurable: true, writable: true, value: [] });
  });

  it('a genuinely new account still gets an empty library', async () => {
    await hydrateFormsRemote({ soft: true });
    expect(listFormsRemote()).toEqual([]);
    expect(db.selects).toBe(2);
  });
});

describe('a failed trash is put back and reported', () => {
  it('rolls the form back to active and fires one persist error', async () => {
    db.rows = [row('f_1')];
    await hydrateFormsRemote({ soft: true });
    db.upsert.mockResolvedValue({ error: { code: '08006', message: 'network down' } });
    const errors: string[] = [];
    const onError = (e: Event) => errors.push((e as CustomEvent<{ kind: string }>).detail.kind);
    window.addEventListener('slate-persist-error', onError);

    expect(trashFormRemoteSync('f_1')).toBe(true);
    expect(listAllFormsRemote()[0]?.deletedAt).toBeTruthy();

    await vi.waitFor(() => expect(errors).toEqual(['form']));
    expect(listAllFormsRemote()[0]?.deletedAt).toBeUndefined();
    expect(listFormsRemote().map((f) => f.id)).toEqual(['f_1']);
    window.removeEventListener('slate-persist-error', onError);
  });

  it('keeps the trash when the save succeeds', async () => {
    db.rows = [row('f_1')];
    await hydrateFormsRemote({ soft: true });
    db.upsert.mockResolvedValue({ error: null });
    trashFormRemoteSync('f_1');
    await vi.waitFor(() => expect(db.upsert).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(listAllFormsRemote()[0]?.deletedAt).toBeTruthy();
  });
});

describe('save failures are visible everywhere', () => {
  it('shows one toast per burst, outside the editor too', async () => {
    render(
      <ToastProvider>
        <PersistErrorToasts />
      </ToastProvider>,
    );
    for (let i = 0; i < 3; i++) {
      window.dispatchEvent(
        new CustomEvent('slate-persist-error', {
          detail: { kind: 'submission', message: 'network down' },
        }),
      );
    }
    expect(await screen.findAllByText('Couldn’t update that response')).toHaveLength(1);
  });
});

describe('pasting the sign-in code', () => {
  it.each([
    ['482913', '482913'],
    ['482 913', '482913'],
    ['Code: 482913', '482913'],
    ['4\t8\t2\t9\t1\t3', '482913'],
  ])('%j fills all six digits', async (pasted, expected) => {
    vi.doMock('../examples/_admin/neon/AuthProvider.js', () => ({
      useAuth: () => ({
        signInWithEmail: async () => ({ error: null, magicLinkSent: true }),
        verifyEmailOtp: verify,
        signInWithGoogle: async () => ({ error: null }),
        authError: null,
        clearAuthError: () => {},
      }),
    }));
    const verify = vi.fn(async () => ({ error: null }));
    const { Login } = await import('../examples/_admin/pages/Login.js');
    render(<Login />);
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'o@example.com' } });
    fireEvent.submit(screen.getByLabelText(/email/i).closest('form')!);
    const input = await screen.findByLabelText('Sign-in code');
    expect(input.getAttribute('maxlength')).toBeNull();
    fireEvent.paste(input, { clipboardData: { getData: () => pasted } });
    await vi.waitFor(() => expect(verify).toHaveBeenCalledWith('o@example.com', expected));
    vi.doUnmock('../examples/_admin/neon/AuthProvider.js');
    vi.resetModules();
  });
});
