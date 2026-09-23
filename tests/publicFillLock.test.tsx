import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const api = vi.hoisted(() => ({
  fetchPublishedFormBySlug: vi.fn(),
  unlockPublicForm: vi.fn(),
  submitPublicResponse: vi.fn(),
  metaToPayload: vi.fn(),
}));

vi.mock('../examples/_admin/neon/publicApi.js', () => api);
vi.mock('../examples/_admin/neon/config.js', () => ({ isNeonConfigured: () => true }));
vi.mock('../examples/_admin/shell/LoadingScreen.js', () => ({
  LoadingScreen: () => <p>loading</p>,
}));
vi.mock('../examples/_admin/hostFileUpload.js', () => ({ hostFileUpload: vi.fn() }));
vi.mock('../examples/_admin/resolveUploadMeta.js', () => ({ resolveUploadMeta: vi.fn() }));
vi.mock('@/index.js', () => ({
  Form: ({ schema }: { schema: { marker: string } }) => <p>form:{schema.marker}</p>,
}));

import { PublicFill } from '../examples/_admin/pages/PublicFill.js';

const TOKEN = 'cd'.repeat(32);
const locked = { id: 'f_1', name: 'Crew sign-up', slug: '48210377', locked: true, schema: null };
const opened = { ...locked, locked: false, schema: { marker: 'welcome' } };

beforeEach(() => {
  window.sessionStorage.clear();
  Object.values(api).forEach((fn) => fn.mockReset());
});

describe('PublicFill password gate', () => {
  it('open form renders straight away, no gate', async () => {
    api.fetchPublishedFormBySlug.mockResolvedValue(opened);
    render(<PublicFill slug="48210377" />);
    expect(await screen.findByText('form:welcome')).toBeTruthy();
    expect(api.unlockPublicForm).not.toHaveBeenCalled();
  });

  it('locked form shows name + password + Continue, and no studio links', async () => {
    api.fetchPublishedFormBySlug.mockResolvedValue(locked);
    render(<PublicFill slug="48210377" />);
    expect(await screen.findByRole('heading', { name: 'Crew sign-up' })).toBeTruthy();
    expect(screen.getByLabelText(/password/i).getAttribute('type')).toBe('password');
    expect(screen.getByRole('button', { name: 'Continue' })).toBeTruthy();
    expect(screen.queryByText(/dashboard/i)).toBeNull();
    expect(screen.queryByText(/^form:/)).toBeNull();
  });

  it('wrong password → try again; right password → form, token saved (not the password)', async () => {
    const user = userEvent.setup();
    api.fetchPublishedFormBySlug.mockResolvedValue(locked);
    api.unlockPublicForm
      .mockResolvedValueOnce({
        ok: false,
        reason: 'wrong_password',
        message: 'That password didn’t match. Try again.',
      })
      .mockResolvedValueOnce({ ok: true, form: opened, unlockToken: TOKEN });
    render(<PublicFill slug="48210377" />);

    const input = await screen.findByLabelText(/password/i);
    await user.type(input, 'nope{Enter}');
    expect((await screen.findByRole('alert')).textContent).toMatch(/didn’t match/);
    expect((input as HTMLInputElement).value).toBe('');

    await user.type(input, 'harvest{Enter}');
    expect(await screen.findByText('form:welcome')).toBeTruthy();
    expect(api.unlockPublicForm).toHaveBeenLastCalledWith('48210377', { password: 'harvest' });
    expect(window.sessionStorage.getItem('slate-fill-unlock:f_1')).toBe(TOKEN);
    expect(JSON.stringify({ ...window.sessionStorage })).not.toContain('harvest');
  });

  it('reload in the same tab resumes with the token — no retyping', async () => {
    window.sessionStorage.setItem('slate-fill-unlock:f_1', TOKEN);
    api.fetchPublishedFormBySlug.mockResolvedValue(locked);
    api.unlockPublicForm.mockResolvedValue({ ok: true, form: opened, unlockToken: TOKEN });
    render(<PublicFill slug="48210377" />);
    expect(await screen.findByText('form:welcome')).toBeTruthy();
    expect(api.unlockPublicForm).toHaveBeenCalledWith('48210377', { token: TOKEN });
  });

  it('stale token (password changed) → gate again, token dropped', async () => {
    window.sessionStorage.setItem('slate-fill-unlock:f_1', TOKEN);
    api.fetchPublishedFormBySlug.mockResolvedValue(locked);
    api.unlockPublicForm.mockResolvedValue({ ok: false, reason: 'wrong_password', message: 'x' });
    render(<PublicFill slug="48210377" />);
    expect(await screen.findByRole('button', { name: 'Continue' })).toBeTruthy();
    await waitFor(() => expect(window.sessionStorage.getItem('slate-fill-unlock:f_1')).toBeNull());
  });

  it('missing form shows a respondent notice with no way into the studio', async () => {
    api.fetchPublishedFormBySlug.mockResolvedValue(null);
    render(<PublicFill slug="gone" />);
    expect(await screen.findByRole('status')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByText(/dashboard/i)).toBeNull();
  });
});
