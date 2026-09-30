import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Schema } from '../src/index.js';

/**
 * Share panel, ADR-063: tracked links (name a flyer → its own link and QR,
 * base link untouched) and the closing row (one line; live the moment it's
 * saved, no Republish).
 */

const state = vi.hoisted(() => ({
  form: null as Record<string, unknown> | null,
  updates: [] as Array<Record<string, unknown>>,
  count: 0,
  qrUrls: [] as string[],
}));

vi.mock('../examples/_admin/_formsStore.js', () => ({
  getForm: () => state.form,
  publishForm: vi.fn(),
  unpublishForm: vi.fn(),
  subscribe: () => () => {},
  hasUnpublishedChanges: () => false,
  setFormFillPassword: vi.fn(),
  updateForm: (_id: string, patch: Record<string, unknown>) => {
    state.updates.push(patch);
    state.form = { ...state.form, ...patch };
    return [state.form, true];
  },
}));
vi.mock('../examples/_admin/_submissionStore.js', () => ({
  countSubmissions: () => state.count,
  subscribe: () => () => {},
}));
vi.mock('../examples/_admin/neon/env.js', () => ({ isNeonConfigured: () => true }));
vi.mock('../examples/_admin/neon/publicApi.js', () => ({
  publicFillUrl: (slug: string) => `https://slate.test/forms/${slug}`,
}));
vi.mock('../examples/_admin/shareQr.js', () => ({
  readShareQrStyle: () => 'swiss',
  writeShareQrStyle: vi.fn(),
  renderShareQr: (url: string) => {
    state.qrUrls.push(url);
    return Promise.resolve('data:image/png;base64,AAAA');
  },
  SHARE_QR_DISPLAY_PX: 196,
  SHARE_QR_STYLES: [{ id: 'swiss', label: 'Swiss', description: '' }],
}));
vi.mock('../examples/_admin/uiSounds.js', () => ({ playUiSound: vi.fn() }));
vi.mock('../examples/_admin/toast.js', () => ({ useToast: () => ({ push: vi.fn() }) }));
vi.mock('../examples/_admin/useFocusTrap.js', () => ({ useFocusTrap: vi.fn() }));
vi.mock('../examples/_admin/lockBodyScroll.js', () => ({ lockBodyScroll: () => () => {} }));

import { SharePanel } from '../examples/_admin/components/SharePanel.js';

const schema = {
  brand: { name: 'T' },
  theme: 'classic',
  questions: [{ id: 't', type: 'thanks', title: 'Done' }],
} as unknown as Schema;

function open() {
  return render(
    <SharePanel open onClose={() => {}} formId="f_1" formName="Pool party" schema={schema} />,
  );
}

beforeEach(() => {
  state.form = {
    id: 'f_1',
    name: 'Pool party',
    slug: '48210377',
    status: 'published',
    schema,
    publishedSchema: schema,
  };
  state.updates = [];
  state.count = 0;
  state.qrUrls = [];
});

describe('tracked links', () => {
  it('naming a flyer saves it and switches the link and QR to ?src=', async () => {
    const user = userEvent.setup();
    open();
    expect(screen.getByLabelText('Share URL')).toHaveValue('slate.test/forms/48210377');
    await user.click(screen.getByRole('button', { name: /track a flyer/i }));
    await user.type(
      screen.getByRole('textbox', { name: /name this link/i }),
      'Mailbox flyer{Enter}',
    );
    expect(state.updates.at(-1)).toMatchObject({
      trackedSources: [{ name: 'Mailbox flyer', src: 'mailbox-flyer' }],
    });
    expect(screen.getByLabelText('Share URL')).toHaveValue(
      'slate.test/forms/48210377?src=mailbox-flyer',
    );
    expect(screen.getByRole('radio', { name: 'Mailbox flyer' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await vi.waitFor(() =>
      expect(state.qrUrls.at(-1)).toBe('https://slate.test/forms/48210377?src=mailbox-flyer'),
    );
    // Back to the main link: the base link never changed.
    await user.click(screen.getByRole('radio', { name: 'Main link' }));
    expect(screen.getByLabelText('Share URL')).toHaveValue('slate.test/forms/48210377');
  });

  it('removing one only takes it off the list', async () => {
    state.form = {
      ...state.form,
      trackedSources: [{ name: 'Door hanger', src: 'door-hanger', createdAt: '' }],
    };
    const user = userEvent.setup();
    open();
    await user.click(screen.getByRole('radio', { name: 'Door hanger' }));
    await user.click(screen.getByRole('button', { name: /remove door hanger/i }));
    expect(state.updates.at(-1)).toEqual({ trackedSources: undefined });
  });

  it('a draft (unpublished) form has no tracked links yet', () => {
    state.form = { ...state.form, status: 'draft' };
    open();
    expect(screen.queryByRole('button', { name: /track a flyer/i })).not.toBeInTheDocument();
  });
});

describe('closing row', () => {
  it('one line while open; Close now closes at once', async () => {
    const user = userEvent.setup();
    open();
    const row = screen.getByRole('region', { name: 'Closing' });
    expect(within(row).getByText('Open')).toBeInTheDocument();
    await user.click(within(row).getByRole('button', { name: 'Close now' }));
    const patch = state.updates.at(-1)!;
    expect(Date.parse(patch.closesAt as string)).toBeLessThanOrEqual(Date.now());
  });

  it('Schedule saves a date, a cap and a message', async () => {
    const user = userEvent.setup();
    open();
    await user.click(screen.getByRole('button', { name: 'Schedule' }));
    const row = screen.getByRole('region', { name: 'Closing' });
    const when = row.querySelector('input[type="datetime-local"]') as HTMLInputElement;
    await user.type(when, '2030-10-05T18:30');
    await user.type(within(row).getByRole('spinbutton'), '20');
    await user.type(within(row).getByRole('textbox'), 'All spots are taken!');
    await user.click(within(row).getByRole('button', { name: 'Save' }));
    const patch = state.updates.at(-1)!;
    expect(patch.maxResponses).toBe(20);
    expect(patch.closedMessage).toBe('All spots are taken!');
    expect(new Date(patch.closesAt as string).getFullYear()).toBe(2030);
  });

  it('refuses a cap outside 1–10,000', async () => {
    const user = userEvent.setup();
    open();
    await user.click(screen.getByRole('button', { name: 'Schedule' }));
    const row = screen.getByRole('region', { name: 'Closing' });
    await user.type(within(row).getByRole('spinbutton'), '0');
    await user.click(within(row).getByRole('button', { name: 'Save' }));
    expect(within(row).getByRole('alert')).toHaveTextContent(/1 to 10,000/);
    expect(state.updates).toHaveLength(0);
  });

  it('at the cap it reads Closed and offers Reopen', async () => {
    state.form = { ...state.form, maxResponses: 20 };
    state.count = 20;
    const user = userEvent.setup();
    open();
    const row = screen.getByRole('region', { name: 'Closing' });
    expect(within(row).getByText(/Closed · 20 of 20 responses/)).toBeInTheDocument();
    await user.click(within(row).getByRole('button', { name: 'Reopen' }));
    expect(state.updates.at(-1)).toMatchObject({ maxResponses: undefined });
  });
});
