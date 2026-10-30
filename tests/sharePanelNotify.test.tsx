import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Schema } from '../src/index.js';

const state = vi.hoisted(() => ({
  cloud: true,
  form: null as Record<string, unknown> | null,
  setFormFillPassword: vi.fn(),
  notify: true,
  setFormNotifyEmail: vi.fn(),
  push: vi.fn(),
}));

vi.mock('../examples/_admin/_formsStore.js', () => ({
  getForm: () => state.form,
  publishForm: vi.fn(),
  unpublishForm: vi.fn(),
  subscribe: () => () => {},
  hasUnpublishedChanges: () => false,
  setFormFillPassword: state.setFormFillPassword,
  supportsCloseSettings: () => true,
  supportsNotifyEmail: () => state.notify,
  setFormNotifyEmail: state.setFormNotifyEmail,
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
vi.mock('../examples/_admin/toast.js', () => ({ useToast: () => ({ push: state.push }) }));
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
  state.setFormNotifyEmail.mockReset();
  state.push.mockReset();
  state.notify = true;
});

const emailSwitch = () => screen.getByRole('switch', { name: 'Email me new responses' });

describe('Share panel: Email me new responses (ADR-072)', () => {
  it('off by default', () => {
    open();
    expect(emailSwitch().getAttribute('aria-checked')).toBe('false');
  });

  it('shows on when the form has emails on', () => {
    state.form = { ...published, notifyEmail: true };
    open();
    expect(emailSwitch().getAttribute('aria-checked')).toBe('true');
  });

  it('turns emails on through the store and says where they go', async () => {
    const user = userEvent.setup();
    state.setFormNotifyEmail.mockResolvedValue({ ok: true, on: true });
    open();
    await user.click(emailSwitch());
    expect(state.setFormNotifyEmail).toHaveBeenCalledWith('f_1', true);
    expect(state.push).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Emails on',
        detail: expect.stringMatching(/sign-in email/),
      }),
    );
  });

  it('turns them off', async () => {
    const user = userEvent.setup();
    state.form = { ...published, notifyEmail: true };
    state.setFormNotifyEmail.mockResolvedValue({ ok: true, on: false });
    open();
    await user.click(emailSwitch());
    expect(state.setFormNotifyEmail).toHaveBeenCalledWith('f_1', false);
  });

  it('a refusal shows inline', async () => {
    const user = userEvent.setup();
    state.setFormNotifyEmail.mockResolvedValue({ ok: false, message: 'Couldn’t change emails.' });
    open();
    await user.click(emailSwitch());
    expect((await screen.findByRole('alert')).textContent).toBe('Couldn’t change emails.');
    expect(state.push).not.toHaveBeenCalled();
  });

  it('hidden before migration 023 and on this device alone', () => {
    state.notify = false;
    const { unmount } = open();
    expect(screen.queryByRole('switch', { name: 'Email me new responses' })).toBeNull();
    unmount();
    state.notify = true;
    state.cloud = false;
    open();
    expect(screen.queryByRole('switch', { name: 'Email me new responses' })).toBeNull();
  });
});
