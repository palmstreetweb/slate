/**
 * Share panel Publish (S10, COPY-10): it waits, in plain words and with a way
 * to the question, while something would stop people finishing; and a publish
 * whose write fails never says "You're live". Also the QR error copy.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Schema } from '../src/index.js';

const state = vi.hoisted(() => ({
  form: null as Record<string, unknown> | null,
  publishForm: vi.fn(),
  push: vi.fn(),
  navigate: vi.fn(),
  qr: () => Promise.resolve('data:image/png;base64,AAAA') as Promise<string>,
}));

vi.mock('../examples/_admin/_formsStore.js', () => ({
  getForm: () => state.form,
  publishForm: (id: string, opts?: { onFail?: () => void }) => state.publishForm(id, opts),
  unpublishForm: vi.fn(),
  subscribe: () => () => {},
  hasUnpublishedChanges: () => false,
  setFormFillPassword: vi.fn(),
  supportsCloseSettings: () => false,
}));
vi.mock('../examples/_admin/neon/env.js', () => ({ isNeonConfigured: () => true }));
vi.mock('../examples/_admin/neon/publicApi.js', () => ({
  publicFillUrl: (slug: string) => `https://slate.test/forms/${slug}`,
}));
vi.mock('../examples/_admin/shareQr.js', () => ({
  readShareQrStyle: () => 'swiss',
  writeShareQrStyle: vi.fn(),
  renderShareQr: () => state.qr(),
  SHARE_QR_DISPLAY_PX: 196,
  SHARE_QR_STYLES: [{ id: 'swiss', label: 'Swiss', description: '' }],
}));
vi.mock('../examples/_admin/uiSounds.js', () => ({ playUiSound: vi.fn() }));
vi.mock('../examples/_admin/toast.js', () => ({ useToast: () => ({ push: state.push }) }));
vi.mock('../examples/_admin/useFocusTrap.js', () => ({ useFocusTrap: vi.fn() }));
vi.mock('../examples/_admin/lockBodyScroll.js', () => ({ lockBodyScroll: () => () => {} }));
vi.mock('../examples/_admin/_router.js', () => ({ navigate: state.navigate }));

import { SharePanel } from '../examples/_admin/components/SharePanel.js';

function schemaWith(questions: unknown[]): Schema {
  return {
    brand: { name: 'T' },
    theme: 'editorial',
    questions: [
      { id: 'w', type: 'welcome', title: 'Hi', cta: 'Go' },
      ...questions,
      { id: 't', type: 'thanks', title: 'Done' },
    ],
  } as unknown as Schema;
}

const broken = schemaWith([{ id: 'qty', type: 'number', title: 'How many?', min: 10, max: 5 }]);
const clean = schemaWith([{ id: 'name', type: 'short_text', title: 'Name?' }]);

function draft(schema: Schema) {
  return { id: 'f_1', name: 'Crew', slug: '48210377', status: 'draft', schema };
}

beforeEach(() => {
  state.publishForm.mockReset();
  state.push.mockReset();
  state.navigate.mockReset();
  state.qr = () => Promise.resolve('data:image/png;base64,AAAA');
});

describe('Publish waits for problems that stop people finishing (S10)', () => {
  it('says what to fix, does not publish, and Show me opens the question', async () => {
    const user = userEvent.setup();
    state.form = draft(broken);
    const onShowQuestion = vi.fn();
    render(
      <SharePanel
        open
        onClose={() => {}}
        formId="f_1"
        formName="Crew"
        schema={broken}
        onShowQuestion={onShowQuestion}
      />,
    );
    const notice = screen.getByRole('status', { name: 'Before you publish' });
    expect(notice.textContent).toContain('Fix this before you publish');
    expect(notice.textContent).toContain('“How many?” has a lowest number above its highest');
    expect(notice.textContent).not.toMatch(/schema|qty/);

    await user.click(screen.getAllByRole('button', { name: 'Publish' })[0]!);
    expect(state.publishForm).not.toHaveBeenCalled();
    // A second look: the notice says it again, as an alert.
    expect(screen.getByRole('alert', { name: 'Before you publish' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Show me' }));
    expect(onShowQuestion).toHaveBeenCalledWith('qty');
  });

  it('from the dashboard, Show me opens the editor', async () => {
    const user = userEvent.setup();
    state.form = draft(broken);
    const onClose = vi.fn();
    render(<SharePanel open onClose={onClose} formId="f_1" formName="Crew" schema={broken} />);
    await user.click(screen.getByRole('button', { name: 'Show me' }));
    expect(onClose).toHaveBeenCalled();
    expect(state.navigate).toHaveBeenCalledWith('/forms/f_1/edit');
  });

  it('a clean form publishes', async () => {
    const user = userEvent.setup();
    state.form = draft(clean);
    state.publishForm.mockReturnValue({ ...draft(clean), status: 'published' });
    render(<SharePanel open onClose={() => {}} formId="f_1" formName="Crew" schema={clean} />);
    expect(screen.queryByRole('status', { name: 'Before you publish' })).toBeNull();
    await user.click(screen.getAllByRole('button', { name: 'Publish' })[0]!);
    expect(state.publishForm).toHaveBeenCalledTimes(1);
    await vi.waitFor(() =>
      expect(state.push).toHaveBeenCalledWith(expect.objectContaining({ title: 'You’re live' })),
    );
  });
});

describe('a publish that fails (COPY-10)', () => {
  it('never says “You’re live”', async () => {
    const user = userEvent.setup();
    state.form = draft(clean);
    state.publishForm.mockImplementation((_id: string, opts?: { onFail?: () => void }) => {
      setTimeout(() => opts?.onFail?.(), 10);
      return { ...draft(clean), status: 'published' };
    });
    render(<SharePanel open onClose={() => {}} formId="f_1" formName="Crew" schema={clean} />);
    await user.click(screen.getAllByRole('button', { name: 'Publish' })[0]!);
    await new Promise((r) => setTimeout(r, 700));
    expect(state.push).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'You’re live' }));
  });
});

describe('the QR code', () => {
  it('a QR that can’t be drawn says what to do, not the error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    state.form = { ...draft(clean), status: 'published', publishedSchema: clean };
    state.qr = () => Promise.reject(new Error('URL too long for QR code'));
    render(<SharePanel open onClose={() => {}} formId="f_1" formName="Crew" schema={clean} />);
    expect(await screen.findByText('Couldn’t make a QR code. Copy the link instead.')).toBeTruthy();
    expect(screen.queryByText(/URL too long/)).toBeNull();
  });
});
