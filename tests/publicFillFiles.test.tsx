import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * Public fill and storage quotas (ADR-067): one retry key per fill, kept
 * across Retry so a lost reply can't store a second response; and a file the
 * submit refused sends the respondent back to its question with the message,
 * every other answer kept. The real engine renders; only the network is stubbed.
 */

const api = vi.hoisted(() => ({
  fetchPublishedFormBySlug: vi.fn(),
  unlockPublicForm: vi.fn(),
  submitPublicResponse: vi.fn(),
  fetchSlotsLeft: vi.fn(),
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
import { FilesRejectedError } from '../examples/_admin/neon/publicApi.js';

const schema = {
  brand: { name: 'Roof check' },
  theme: 'classic',
  themeMode: 'light',
  questions: [
    { id: 'name', type: 'short_text', title: 'Your name?', required: true },
    { id: 'done', type: 'thanks', title: 'Thanks, we’ll be in touch.' },
  ],
};

const open = { id: 'f_1', name: 'Roof check', slug: '48210378', locked: false, schema };

beforeEach(() => {
  api.fetchPublishedFormBySlug.mockReset();
  api.submitPublicResponse.mockReset();
  window.history.replaceState({}, '', '/forms/48210378');
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('PublicFill — storage quotas (ADR-067)', () => {
  it('Retry after a lost reply sends the same submitId, so the server can return what it stored', async () => {
    api.fetchPublishedFormBySlug.mockResolvedValue(open);
    api.submitPublicResponse
      .mockRejectedValueOnce(
        new Error('Couldn’t reach Slate. Check your connection and press Retry.'),
      )
      .mockResolvedValueOnce({ id: 's_1' });
    const user = userEvent.setup();
    render(<PublicFill slug="48210378" />);
    await user.type(await screen.findByRole('textbox'), 'Ada');
    await user.keyboard('{Enter}');
    await user.click(await screen.findByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(api.submitPublicResponse).toHaveBeenCalledTimes(2));
    const [first, second] = api.submitPublicResponse.mock.calls.map(
      (c) => (c[0] as { submitId?: string }).submitId,
    );
    expect(first).toMatch(UUID);
    expect(second).toBe(first);
  });

  it('a file the submit refused: back to its question with the message, answers kept', async () => {
    api.fetchPublishedFormBySlug.mockResolvedValue(open);
    const message =
      'A file you added expired or didn’t finish uploading. Please remove it and add it again — your other answers are still here.';
    api.submitPublicResponse
      .mockRejectedValueOnce(new FilesRejectedError(message, ['name']))
      .mockResolvedValueOnce({ id: 's_1' });
    const user = userEvent.setup();
    render(<PublicFill slug="48210378" />);
    await user.type(await screen.findByRole('textbox'), 'Ada');
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('alert', {}, { timeout: 4000 })).toHaveTextContent(message);
    expect(screen.getByRole('textbox')).toHaveValue('Ada');
    await user.keyboard('{Enter}');
    await screen.findByRole('heading', { name: 'Thanks, we’ll be in touch.' });
    const ids = api.submitPublicResponse.mock.calls.map(
      (c) => (c[0] as { submitId?: string }).submitId,
    );
    // Nothing was stored the first time, so the same key is fine to reuse.
    expect(ids[1]).toBe(ids[0]);
  });
});
