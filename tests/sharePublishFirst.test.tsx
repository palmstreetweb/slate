/**
 * An unpublished cloud form has no shareable link until it's published
 * (QA COPY-05 / GAPV-X2). The portable link it used to hand out stored
 * answers on the respondent's device only, so in the cloud every submit
 * ended in an error and the answers were lost.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Schema } from '../src/index.js';

const state = vi.hoisted(() => ({
  cloud: true,
  form: null as Record<string, unknown> | null,
  renderShareQr: vi.fn(),
}));

vi.mock('../examples/_admin/_formsStore.js', () => ({
  getForm: () => state.form,
  publishForm: vi.fn(),
  unpublishForm: vi.fn(),
  subscribe: () => () => {},
  hasUnpublishedChanges: () => false,
  setFormFillPassword: vi.fn(),
  supportsCloseSettings: () => true,
}));
vi.mock('../examples/_admin/neon/env.js', () => ({ isNeonConfigured: () => state.cloud }));
vi.mock('../examples/_admin/neon/config.js', () => ({ isNeonConfigured: () => state.cloud }));
vi.mock('../examples/_admin/neon/publicApi.js', () => ({
  publicFillUrl: (slug: string) => `https://slate.test/forms/${slug}`,
}));
vi.mock('../examples/_admin/shareQr.js', () => ({
  readShareQrStyle: () => 'swiss',
  writeShareQrStyle: vi.fn(),
  renderShareQr: state.renderShareQr,
  SHARE_QR_DISPLAY_PX: 196,
  SHARE_QR_STYLES: [{ id: 'swiss', label: 'Swiss', description: '' }],
}));
vi.mock('../examples/_admin/uiSounds.js', () => ({ playUiSound: vi.fn() }));
vi.mock('../examples/_admin/toast.js', () => ({ useToast: () => ({ push: vi.fn() }) }));
vi.mock('../examples/_admin/useFocusTrap.js', () => ({ useFocusTrap: vi.fn() }));
vi.mock('../examples/_admin/lockBodyScroll.js', () => ({ lockBodyScroll: () => () => {} }));

import { SharePanel } from '../examples/_admin/components/SharePanel.js';
import { PublicRespond } from '../examples/_admin/pages/PublicRespond.js';
import { encodePortableSchema } from '../examples/_admin/portableShare.js';
import { PREVIEW_LINK_MESSAGE } from '../examples/_admin/_submissionStore.js';

const schema = {
  brand: { name: 'T' },
  theme: 'editorial',
  themeMode: 'light',
  questions: [
    { id: 'w', type: 'welcome', title: 'Hi', cta: 'Go' },
    { id: 'name', type: 'short_text', title: 'Your name?' },
    { id: 't', type: 'thanks', title: 'Done' },
  ],
} as unknown as Schema;

const draft = { id: 'f_1', name: 'Crew', slug: '48210377', status: 'draft', schema };

function open() {
  return render(
    <SharePanel open onClose={() => {}} formId="f_1" formName="Crew" schema={schema} />,
  );
}

beforeEach(() => {
  state.cloud = true;
  state.form = { ...draft };
  state.renderShareQr.mockReset().mockResolvedValue('data:image/png;base64,AAAA');
});

describe('Share, before Publish', () => {
  it('a cloud draft asks to publish instead of handing out a link', () => {
    open();
    expect(screen.queryByLabelText('Share URL')).toBeNull();
    expect(screen.queryByRole('link', { name: /Open in browser/ })).toBeNull();
    expect(screen.getByText('Publish this form to get a public fill link.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Publish' })).toBeInTheDocument();
    // No QR either: it pointed at a studio page that needs sign-in.
    expect(screen.queryByRole('region', { name: 'QR code' })).toBeNull();
    expect(state.renderShareQr).not.toHaveBeenCalled();
  });

  it('once published, the real public link is there', () => {
    state.form = { ...draft, status: 'published', publishedSchema: schema };
    open();
    expect((screen.getByLabelText('Share URL') as HTMLInputElement).value).toBe(
      'slate.test/forms/48210377',
    );
  });

  it('the offline studio still shares a portable link', () => {
    state.cloud = false;
    open();
    expect((screen.getByLabelText('Share URL') as HTMLInputElement).value).toMatch(/\/r\?d=/);
  });
});

describe('a portable link handed out before this fix', () => {
  it('says up front that it can’t take answers, in a cloud build', async () => {
    const token = encodePortableSchema(schema, { formId: 'f_1', name: 'Crew' });
    render(<PublicRespond token={token} />);
    expect(await screen.findByRole('status')).toHaveTextContent(PREVIEW_LINK_MESSAGE);
    expect(screen.queryByText('Your name?')).toBeNull();
    expect(PREVIEW_LINK_MESSAGE).not.toMatch(/cloud|sync|Retry/i);
  });

  it('a device-only portable link still opens the form', async () => {
    const token = encodePortableSchema(schema, { formId: 'portable_abc', name: 'Crew' });
    render(<PublicRespond token={token} />);
    expect(await screen.findByText('Hi')).toBeInTheDocument();
  });
});
