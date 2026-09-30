import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * Public fill and sign-up slots (ADR-066): spots left arrive with the form,
 * are refreshed when someone reaches a slot question after a while, and a
 * 409 slot_full sends the respondent back to pick again — the message names
 * the slot, the fresh counts show it full, every other answer is kept. The
 * real engine renders; only the network calls are stubbed.
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
import { SlotFullError } from '../examples/_admin/neon/publicApi.js';

const schema = {
  brand: { name: 'Pool party' },
  theme: 'classic',
  themeMode: 'light',
  questions: [
    { id: 'name', type: 'short_text', title: 'Your name?', required: true },
    {
      id: 'swim',
      type: 'signup_slots',
      title: 'Pick a swim time',
      slots: [
        { label: 'Morning swim', value: 's_am', capacity: 8 },
        { label: 'Lunch swim', value: 's_noon', capacity: 4 },
      ],
    },
    { id: 'done', type: 'thanks', title: 'See you there!' },
  ],
};

const open = {
  id: 'f_1',
  name: 'Pool party',
  slug: '48210377',
  locked: false,
  schema,
  slotsLeft: { swim: { s_am: 3, s_noon: 1 } },
};

beforeEach(() => {
  api.fetchPublishedFormBySlug.mockReset();
  api.unlockPublicForm.mockReset();
  api.submitPublicResponse.mockReset();
  api.fetchSlotsLeft.mockReset();
  window.history.replaceState({}, '', '/forms/48210377');
});

async function toSlots(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByRole('textbox'), 'Ada');
  await user.keyboard('{Enter}');
  return screen.findByRole('radiogroup', { name: 'Pick a swim time' });
}

describe('PublicFill — sign-up slots (ADR-066)', () => {
  it('shows the spots left the lookup counted', async () => {
    api.fetchPublishedFormBySlug.mockResolvedValue(open);
    const user = userEvent.setup();
    render(<PublicFill slug="48210377" />);
    await toSlots(user);
    expect(screen.getByRole('radio', { name: /^Lunch swim/ })).toHaveAccessibleName(
      'Lunch swim, 1 spot left',
    );
    // Fresh counts: no refresh within 30 s of the load.
    expect(api.fetchSlotsLeft).not.toHaveBeenCalled();
  });

  it('refreshes the counts when someone reaches the slots a while after loading', async () => {
    api.fetchPublishedFormBySlug.mockResolvedValue(open);
    api.fetchSlotsLeft.mockResolvedValue({ swim: { s_noon: 0 } });
    const user = userEvent.setup();
    const t0 = Date.now();
    render(<PublicFill slug="48210377" />);
    await user.type(await screen.findByRole('textbox'), 'Ada');
    const now = vi.spyOn(Date, 'now').mockReturnValue(t0 + 31_000);
    await user.keyboard('{Enter}');
    await waitFor(() => expect(api.fetchSlotsLeft).toHaveBeenCalledWith('48210377'));
    await waitFor(() =>
      expect(screen.getByRole('radio', { name: /^Lunch swim/ })).toHaveAccessibleName(
        'Lunch swim, Full',
      ),
    );
    expect(screen.getByRole('radio', { name: /^Morning swim/ })).toHaveAccessibleName(
      'Morning swim, 3 of 8 left',
    );
    now.mockRestore();
  });

  it('a slot that filled during the submit: back to the slots, named, with fresh counts', async () => {
    api.fetchPublishedFormBySlug.mockResolvedValue(open);
    api.submitPublicResponse
      .mockRejectedValueOnce(
        new SlotFullError('Lunch swim just filled up.', [{ question: 'swim', slot: 's_noon' }], {
          swim: { s_am: 3, s_noon: 0 },
        }),
      )
      .mockResolvedValueOnce({ id: 's_1' });
    const user = userEvent.setup();
    render(<PublicFill slug="48210377" />);
    await toSlots(user);
    // The last spot: its moment plays (~1.1 s), then the ending sends the response.
    await user.click(screen.getByRole('radio', { name: /^Lunch swim/ }));

    expect(await screen.findByRole('alert', {}, { timeout: 4000 })).toHaveTextContent(
      'Lunch swim just filled up while you were answering. Please pick another — your other answers are saved.',
    );
    expect(screen.getByRole('radio', { name: /^Lunch swim/ })).toHaveAccessibleName(
      'Lunch swim, Just filled up',
    );
    await user.click(screen.getByRole('radio', { name: /^Morning swim/ }));
    await screen.findByRole('heading', { name: 'See you there!' });
    await waitFor(() => expect(api.submitPublicResponse).toHaveBeenCalledTimes(2));
    const second = api.submitPublicResponse.mock.calls[1]![0] as { answers: unknown };
    expect(second.answers).toEqual({ name: 'Ada', swim: { slots: ['s_am'] } });
  });
});
