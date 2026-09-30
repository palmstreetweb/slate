import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * Public fill, ADR-063: `?src=` rides along as a hidden field, other link
 * parameters prefill questions that allow it, a closed form shows its closed
 * screen before anyone starts, and a form that closes mid-fill says so.
 * The real engine renders; only the network calls are stubbed.
 */

const api = vi.hoisted(() => ({
  fetchPublishedFormBySlug: vi.fn(),
  unlockPublicForm: vi.fn(),
  submitPublicResponse: vi.fn(),
}));

vi.mock('../examples/_admin/neon/publicApi.js', async (importOriginal) => ({
  ...(await importOriginal<typeof PublicApi>()),
  ...api,
}));
vi.mock('../examples/_admin/neon/config.js', () => ({
  isNeonConfigured: () => true,
  getSubmitUrl: () => 'https://submit.invalid',
}));
vi.mock('../examples/_admin/shell/LoadingScreen.js', () => ({
  LoadingScreen: () => <p>loading</p>,
}));
vi.mock('../examples/_admin/hostFileUpload.js', () => ({ hostFileUpload: vi.fn() }));
vi.mock('../examples/_admin/resolveUploadMeta.js', () => ({ resolveUploadMeta: vi.fn() }));

import type * as PublicApi from '../examples/_admin/neon/publicApi.js';
import { PublicFill } from '../examples/_admin/pages/PublicFill.js';
import { FormClosedError } from '../examples/_admin/neon/publicApi.js';

const schema = {
  brand: { name: 'Pool party' },
  theme: 'classic',
  themeMode: 'light',
  questions: [
    { id: 'name', type: 'short_text', title: 'Your name?', prefillKey: 'name', required: true },
    { id: 'done', type: 'thanks', title: 'See you there!' },
  ],
};

const open = { id: 'f_1', name: 'Pool party', slug: '48210377', locked: false, schema };

function at(url: string) {
  window.history.replaceState({}, '', url);
}

beforeEach(() => {
  api.fetchPublishedFormBySlug.mockReset();
  api.unlockPublicForm.mockReset();
  api.submitPublicResponse.mockReset();
});

afterEach(() => {
  at('/');
});

describe('PublicFill — tracked links and prefill (ADR-063)', () => {
  it('sends src / utm_* as hidden fields and prefills the named question', async () => {
    at('/forms/48210377?src=mailbox-flyer&utm_campaign=fall&name=Jane');
    api.fetchPublishedFormBySlug.mockResolvedValue(open);
    api.submitPublicResponse.mockResolvedValue({ id: 's_1' });
    const user = userEvent.setup();
    render(<PublicFill slug="48210377" />);
    const box = await screen.findByRole('textbox');
    expect(box).toHaveValue('Jane');
    await user.click(screen.getByRole('button', { name: /ok/i }));
    await waitFor(() => expect(api.submitPublicResponse).toHaveBeenCalledTimes(1));
    const payload = api.submitPublicResponse.mock.calls[0]![0] as {
      answers: Record<string, unknown>;
      meta: { hiddenFields: Record<string, unknown> };
    };
    expect(payload.answers).toEqual({ name: 'Jane' });
    // Only the tracking parameters ride along — never the prefilled answer.
    expect(payload.meta.hiddenFields).toEqual({ src: 'mailbox-flyer', utm_campaign: 'fall' });
  });

  it('the plain link works exactly as before', async () => {
    at('/forms/48210377');
    api.fetchPublishedFormBySlug.mockResolvedValue(open);
    api.submitPublicResponse.mockResolvedValue({ id: 's_1' });
    const user = userEvent.setup();
    render(<PublicFill slug="48210377" />);
    const box = await screen.findByRole('textbox');
    expect(box).toHaveValue('');
    await user.type(box, 'Ada{Enter}');
    await waitFor(() => expect(api.submitPublicResponse).toHaveBeenCalledTimes(1));
    const payload = api.submitPublicResponse.mock.calls[0]![0] as {
      meta: { hiddenFields: Record<string, unknown> };
    };
    expect(payload.meta.hiddenFields).toEqual({});
  });
});

describe('PublicFill — closed forms (ADR-063)', () => {
  it('shows the closed screen with the owner message before anyone starts', async () => {
    at('/forms/48210377');
    api.fetchPublishedFormBySlug.mockResolvedValue({
      id: 'f_1',
      name: 'Pool party',
      slug: '48210377',
      locked: true,
      schema: null,
      closed: { reason: 'full', message: 'All 20 spots are taken — see you next summer!' },
    });
    render(<PublicFill slug="48210377" />);
    expect(
      await screen.findByRole('heading', { name: /this form is closed/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/all the responses it can take/i)).toBeInTheDocument();
    expect(screen.getByText(/see you next summer/i)).toBeInTheDocument();
    // Closed wins over the password gate.
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
    expect(api.unlockPublicForm).not.toHaveBeenCalled();
  });

  it('a form that closes mid-fill switches to the closed screen', async () => {
    at('/forms/48210377');
    api.fetchPublishedFormBySlug.mockResolvedValue(open);
    api.submitPublicResponse.mockRejectedValue(
      new FormClosedError('This form is closed.', { reason: 'date', message: null }),
    );
    const user = userEvent.setup();
    render(<PublicFill slug="48210377" />);
    await user.type(await screen.findByRole('textbox'), 'Ada{Enter}');
    expect(
      await screen.findByRole('heading', { name: /this form is closed/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/closed before your answers were sent/i)).toBeInTheDocument();
  });
});
