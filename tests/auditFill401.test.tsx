/**
 * Audit fix (2026-10-09, bug 14): a 401 on submit — the password changed
 * mid-fill — brings the password screen back with a plain line, instead of a
 * Retry that can only fail again. The tab keeps the answers for Resume.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const api = vi.hoisted(() => ({
  fetchPublishedFormBySlug: vi.fn(),
  unlockPublicForm: vi.fn(),
  submitPublicResponse: vi.fn(),
  metaToPayload: vi.fn(() => ({ hiddenFields: {} })),
  newSubmitId: vi.fn(() => 'sub_1'),
}));

vi.mock('../examples/_admin/neon/publicApi.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...api,
}));
vi.mock('../examples/_admin/neon/config.js', () => ({ isNeonConfigured: () => true }));
vi.mock('../examples/_admin/shell/LoadingScreen.js', () => ({
  LoadingScreen: () => <p>loading</p>,
}));
vi.mock('../examples/_admin/hostFileUpload.js', () => ({ hostFileUpload: vi.fn() }));
vi.mock('../examples/_admin/resolveUploadMeta.js', () => ({ resolveUploadMeta: vi.fn() }));
// A stand-in form with one button that sends, and shows what the page answered.
vi.mock('@/index.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  Form: ({ onSubmit }: { onSubmit: (answers: unknown, meta: unknown) => Promise<unknown> }) => {
    const send = () =>
      onSubmit({}, { startedAt: new Date(), questionsVisited: [], hiddenFields: {} }).then(
        () => undefined,
        (e: Error) => {
          document.body.dataset.rejected = e.message;
        },
      );
    return (
      <button type="button" onClick={() => void send()}>
        send
      </button>
    );
  },
}));

import { PasswordChangedError } from '../examples/_admin/neon/publicApi.js';
import { PublicFill } from '../examples/_admin/pages/PublicFill.js';

const opened = {
  id: 'f_1',
  name: 'Crew sign-up',
  slug: '48210377',
  locked: false,
  schema: { brand: { name: 'x' }, theme: 'classic', themeMode: 'light', questions: [] },
};

beforeEach(() => {
  window.sessionStorage.clear();
  delete document.body.dataset.rejected;
  api.fetchPublishedFormBySlug.mockReset();
  api.unlockPublicForm.mockReset();
  api.submitPublicResponse.mockReset();
});

describe('PublicFill: the password changed mid-fill', () => {
  it('a 401 on submit brings the password screen back, with the reason, not a Retry', async () => {
    const user = userEvent.setup();
    api.fetchPublishedFormBySlug.mockResolvedValue(opened);
    api.submitPublicResponse.mockRejectedValueOnce(new PasswordChangedError());
    api.unlockPublicForm.mockResolvedValue({
      ok: true,
      form: opened,
      unlockToken: 'ab'.repeat(32),
    });
    render(<PublicFill slug="48210377" />);
    await user.click(await screen.findByRole('button', { name: 'send' }));
    expect(await screen.findByRole('heading', { name: 'Crew sign-up' })).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      'This form’s password changed. Enter the new one to send your answers.',
    );
    // The form is gone from the page (its rejection keeps the tab's save): no Retry anywhere.
    expect(screen.queryByRole('button', { name: 'send' })).toBeNull();
    expect(screen.queryByRole('button', { name: /retry/i })).toBeNull();
    // The new password opens the form again, and the line is gone.
    await user.type(screen.getByLabelText(/password/i), 'newword{Enter}');
    expect(await screen.findByRole('button', { name: 'send' })).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
  });
});
