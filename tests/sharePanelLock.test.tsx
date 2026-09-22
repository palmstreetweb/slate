import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Schema } from '../src/index.js';

const state = vi.hoisted(() => ({
  cloud: true,
  form: null as Record<string, unknown> | null,
  setFormFillPassword: vi.fn(),
}));

vi.mock('../examples/_admin/_formsStore.js', () => ({
  getForm: () => state.form,
  publishForm: vi.fn(),
  unpublishForm: vi.fn(),
  subscribe: () => () => {},
  hasUnpublishedChanges: () => false,
  setFormFillPassword: state.setFormFillPassword,
}));
vi.mock('../examples/_admin/neon/env.js', () => ({ isNeonConfigured: () => state.cloud }));
vi.mock('../examples/_admin/neon/publicApi.js', () => ({
  publicFillUrl: (slug: string) => `https://slate.test/forms/${slug}`,
}));
vi.mock('../examples/_admin/shareQr.js', () => ({
  readShareQrStyle: () => 'swiss',
  writeShareQrStyle: vi.fn(),
  renderShareQr: () => Promise.resolve('data:image/png;base64,AAAA'),
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
  theme: 'editorial',
  questions: [
    { id: 'w', type: 'welcome', title: 'Hi', cta: 'Go' },
    { id: 't', type: 'thanks', title: 'Done' },
  ],
} as unknown as Schema;

const published = {
  id: 'f_1',
  name: 'Crew',
  slug: '48210377',
  status: 'published',
  schema,
  publishedSchema: schema,
};

function open() {
  return render(
    <SharePanel open onClose={() => {}} formId="f_1" formName="Crew" schema={schema} />,
  );
}

beforeEach(() => {
  state.cloud = true;
  state.form = { ...published };
  state.setFormFillPassword.mockReset();
});

describe('Share panel password lock (ADR-043)', () => {
  it('off by default: a switch, no field', () => {
    open();
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('false');
    expect(screen.queryByLabelText('Form password')).toBeNull();
  });

  it('turning it on sets the password through the store and keeps the same URL', async () => {
    const user = userEvent.setup();
    state.setFormFillPassword.mockResolvedValue({ ok: true, locked: true });
    open();
    const urlBefore = (screen.getByLabelText('Share URL') as HTMLInputElement).value;

    await user.click(screen.getByRole('switch'));
    const set = screen.getByRole('button', { name: 'Set' }) as HTMLButtonElement;
    await user.type(screen.getByLabelText('Form password'), 'abc');
    expect(set.disabled).toBe(true); // under 4 chars
    await user.type(screen.getByLabelText('Form password'), 'd');
    await user.click(set);

    expect(state.setFormFillPassword).toHaveBeenCalledWith('f_1', 'abcd');
    expect((screen.getByLabelText('Share URL') as HTMLInputElement).value).toBe(urlBefore);
    expect(urlBefore).not.toContain('abcd');
    // Display drops the scheme; the value itself is still the public link.
    expect(urlBefore).toBe('slate.test/forms/48210377');
  });

  it('locked: Change / Remove; Remove clears with an empty string', async () => {
    const user = userEvent.setup();
    state.form = { ...published, fillLocked: true };
    state.setFormFillPassword.mockResolvedValue({ ok: true, locked: false });
    open();
    expect(screen.getByText('Locked')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Change' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    expect(state.setFormFillPassword).toHaveBeenCalledWith('f_1', '');
  });

  it('server refusal shows inline and stays in the field', async () => {
    const user = userEvent.setup();
    state.setFormFillPassword.mockResolvedValue({
      ok: false,
      message: 'Could not update the password.',
    });
    open();
    await user.click(screen.getByRole('switch'));
    await user.type(screen.getByLabelText('Form password'), 'harvest');
    await user.click(screen.getByRole('button', { name: 'Set' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Could not update/);
    expect(screen.getByLabelText('Form password')).toBeTruthy();
  });

  it('locked draft never offers the portable link (schema-in-URL would skip the password)', () => {
    state.form = { ...published, status: 'draft', fillLocked: true };
    open();
    expect(screen.queryByLabelText('Share URL')).toBeNull();
    expect(screen.getByText('Locked')).toBeTruthy();
  });

  it('localStorage / offline mode hides the row entirely', () => {
    state.cloud = false;
    open();
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.queryByText('Password')).toBeNull();
  });
});
