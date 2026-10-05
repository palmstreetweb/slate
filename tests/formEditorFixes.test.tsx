/**
 * The editor (QA pass, workstream w1b): the issues banner speaks plainly and
 * folds (S9); Publish waits for problems that would stop people finishing
 * (S10); "You're live" only follows a publish that landed (COPY-10); deleting
 * a question that rules use says so and removes the rules (S8, COPY-08);
 * duplicates don't share a link name (S24); opening the editor writes nothing
 * (COPY-X2); a save error stays short in the header (COPY-X1); and /forms/new
 * opens the new form under StrictMode (S28).
 */

import { StrictMode, type ReactNode } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Question, Schema } from '@/index.js';
import type { FormRecord } from '../examples/_admin/_formsStore.js';
import type * as Router from '../examples/_admin/_router.js';

const state = vi.hoisted(() => ({
  cloud: true,
  forms: new Map<string, FormRecord>(),
  listeners: new Set<() => void>(),
  updateForm: vi.fn(),
  publishForm: vi.fn(),
  createFormAsync: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock('../examples/_admin/shell/AdminShell.js', () => ({
  AdminShell: ({
    children,
    rightSlot,
    crumbs,
  }: {
    children?: ReactNode;
    rightSlot?: ReactNode;
    crumbs?: ReactNode;
  }) => (
    <div data-slate-forms="" data-theme-name="slate">
      <header>
        {crumbs}
        {rightSlot}
      </header>
      {children}
    </div>
  ),
}));

vi.mock('../examples/_admin/_formsStore.js', () => {
  const notify = () => state.listeners.forEach((l) => l());
  const updateForm = (id: string, patch: Partial<FormRecord>): [FormRecord | null, boolean] => {
    state.updateForm(id, patch);
    const prev = state.forms.get(id);
    if (!prev) return [null, false];
    const next = { ...prev, ...patch, updatedAt: new Date().toISOString() };
    state.forms.set(id, next);
    notify();
    return [next, true];
  };
  return {
    getForm: (id: string) => state.forms.get(id) ?? null,
    updateForm,
    subscribe: (l: () => void) => {
      state.listeners.add(l);
      return () => state.listeners.delete(l);
    },
    hasUnpublishedChanges: (f: FormRecord | null | undefined) =>
      Boolean(
        f &&
        f.status === 'published' &&
        JSON.stringify(f.publishedSchema) !== JSON.stringify(f.schema),
      ),
    publishForm: (id: string, opts?: { onFail?: () => void }) => state.publishForm(id, opts),
    unpublishForm: vi.fn(),
    createFormAsync: (opts: unknown) => state.createFormAsync(opts),
    permanentlyDeleteForm: vi.fn(),
    setFormFillPassword: vi.fn(),
    supportsCloseSettings: () => false,
  };
});

vi.mock('../examples/_admin/neon/env.js', () => ({ isNeonConfigured: () => state.cloud }));
// The confirm dialog follows the route (it closes when the page changes, QA
// w3), so keep the real route hooks and replace only navigation.
vi.mock('../examples/_admin/_router.js', async (importOriginal) => ({
  ...(await importOriginal<typeof Router>()),
  navigate: state.navigate,
}));
vi.mock('../examples/_admin/uiSounds.js', () => ({ playUiSound: vi.fn() }));
vi.mock('../examples/_admin/_submissionStore.js', () => ({
  countSubmissions: () => 0,
  subscribe: () => () => {},
}));
vi.mock('../examples/_admin/shareQr.js', () => ({
  readShareQrStyle: () => 'classic',
  writeShareQrStyle: vi.fn(),
  renderShareQr: () => Promise.resolve('data:image/png;base64,'),
  SHARE_QR_DISPLAY_PX: 160,
  SHARE_QR_STYLES: [],
}));

const { FormEditor } = await import('../examples/_admin/pages/FormEditor.js');
const { ConfirmProvider } = await import('../examples/_admin/_confirm.js');
const { ToastProvider } = await import('../examples/_admin/toast.js');
const { PersistErrorToasts } = await import('../examples/_admin/shell/PersistErrorToasts.js');
const { PromptFormTitleProvider } = await import('../examples/_admin/promptFormTitle.js');

beforeAll(() => {
  Element.prototype.scrollIntoView ??= vi.fn();
  Element.prototype.scrollBy ??= vi.fn();
  Element.prototype.scrollTo ??= vi.fn();
  Element.prototype.setPointerCapture ??= vi.fn();
  Element.prototype.releasePointerCapture ??= vi.fn();
  Element.prototype.hasPointerCapture ??= vi.fn(() => false);
});

/** + Add → open the group → the type. */
async function addType(user: ReturnType<typeof userEvent.setup>, group: string, label: string) {
  await user.click(screen.getByRole('button', { name: '+ Add' }));
  const palette = screen.getByRole('dialog', { name: 'Add question' });
  const trigger = within(palette).getByRole('button', { name: new RegExp(`^${group}`) });
  if (trigger.getAttribute('aria-expanded') !== 'true') await user.click(trigger);
  await user.click(within(palette).getByRole('button', { name: new RegExp(label) }));
}

const welcome: Question = { id: 'welcome', type: 'welcome', title: 'Hi' };
const size: Question = {
  id: 'size',
  type: 'single_choice',
  title: 'What size?',
  options: [
    { label: 'Small', value: 'small' },
    { label: 'Large', value: 'large' },
  ],
};
const details: Question = {
  id: 'details',
  type: 'long_text',
  title: 'Details?',
  visibleIf: { field: 'size', op: 'equals', value: 'large' },
};
const named: Question = {
  id: 'first_name',
  type: 'short_text',
  title: 'First name',
  prefillKey: 'first_name',
};
const done: Question = { id: 'done', type: 'thanks', title: 'Thanks' };
const badNumber: Question = { id: 'qty', type: 'number', title: 'How many?', min: 10, max: 5 };

function seed(questions: Question[], extra: Partial<FormRecord> = {}): FormRecord {
  const schema: Schema = {
    brand: { name: 'Shop' },
    theme: 'swiss',
    themeMode: 'toggle',
    questions,
  };
  const form: FormRecord = {
    id: 'f_1',
    name: 'Shop',
    slug: '48210377',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    schema,
    status: 'draft',
    ...extra,
  };
  state.forms.set(form.id, form);
  return form;
}

function renderEditor(formId: string | null = 'f_1') {
  return render(
    <ToastProvider>
      <ConfirmProvider>
        <PromptFormTitleProvider>
          <PersistErrorToasts />
          <FormEditor formId={formId} />
        </PromptFormTitleProvider>
      </ConfirmProvider>
    </ToastProvider>,
  );
}

beforeEach(() => {
  state.cloud = true;
  state.forms.clear();
  state.listeners.clear();
  state.updateForm.mockReset();
  state.publishForm.mockReset();
  state.createFormAsync.mockReset();
  state.navigate.mockReset();
  state.publishForm.mockImplementation((id: string) => {
    const f = state.forms.get(id)!;
    const next: FormRecord = {
      ...f,
      status: 'published',
      publishedSchema: f.schema,
      publishedName: f.name,
    };
    state.forms.set(id, next);
    return next;
  });
});

afterEach(() => {
  vi.useRealTimers();
});

const banner = () => screen.queryByRole('region', { name: 'Things to fix' });
/** An outline row: "02" + the title. */
const row = (title: string) =>
  screen.getByRole('button', {
    name: new RegExp(`^\\d+${title.replace(/[?()]/g, (c) => `\\${c}`)}`),
  });

describe('opening and saving (COPY-X2, COPY-X1)', () => {
  it('opening the editor writes nothing; an edit writes', async () => {
    const user = userEvent.setup();
    seed([welcome, size, done]);
    renderEditor();
    expect(document.querySelector('.slate-save-status')!.textContent).toBe('All changes saved');
    expect(state.updateForm).not.toHaveBeenCalled();
    await user.click(row('What size?'));
    await user.type(screen.getByDisplayValue('What size?'), '!');
    expect(state.updateForm).toHaveBeenCalled();
    expect(state.forms.get('f_1')!.schema.questions[1]).toMatchObject({ title: 'What size?!' });
  });

  it('a save error reads “Not saved” in the header, with the sentence on hover', () => {
    seed([welcome, size, done]);
    renderEditor();
    const message = 'Couldn’t save — check your connection. Your last change isn’t saved yet.';
    act(() => {
      window.dispatchEvent(
        new CustomEvent('slate-persist-error', { detail: { kind: 'form', message } }),
      );
    });
    const status = document.querySelector('.slate-save-status')!;
    expect(status.textContent).toBe('Not saved');
    expect(status.getAttribute('title')).toBe(message);
  });
});

describe('the issues banner (S9)', () => {
  it('names the question by its title, in plain words, and folds', async () => {
    const user = userEvent.setup();
    seed([welcome, badNumber, done]);
    renderEditor();
    const region = banner()!;
    expect(region).toBeTruthy();
    expect(region.textContent).toContain('1 thing to fix before you publish');
    expect(region.textContent).toContain(
      '“How many?” has a lowest number above its highest, so no answer fits. Swap them.',
    );
    expect(region.textContent).not.toMatch(/schema|qty|visibleIf/);

    await user.click(within(region).getByRole('button', { name: 'Hide' }));
    expect(within(region).queryByRole('list')).toBeNull();
    await user.click(within(region).getByRole('button', { name: 'Show' }));
    expect(within(region).getByRole('list')).toBeTruthy();
  });

  it('a question just added keeps its setup issues to itself until the owner moves on', async () => {
    const user = userEvent.setup();
    state.cloud = false;
    seed([welcome, size, done]);
    renderEditor();
    expect(banner()).toBeNull();
    await addType(user, 'Capture', 'Pin the Spot');
    // The new pin question has no photo yet; no red banner while it's being set up.
    expect(banner()).toBeNull();
    await user.click(row('What size?'));
    expect(banner()!.textContent).toContain('needs a photo to mark');
  });

  it('waits for a pause before flagging the question being edited', async () => {
    const user = userEvent.setup();
    state.cloud = false;
    seed([welcome, { id: 'qty', type: 'number', title: 'How many?', min: 1, max: 20 }, done]);
    renderEditor();
    await user.click(row('How many?'));
    const min = screen.getByLabelText('Min') as HTMLInputElement;
    await user.clear(min);
    await user.type(min, '30');
    // Min 30 is above max 20, but the owner is mid-edit (maybe about to raise the max).
    expect(banner()).toBeNull();
    await waitFor(() => expect(banner()?.textContent).toContain('“How many?” has a lowest'), {
      timeout: 3000,
    });
  });

  it('a new Location question raises nothing (no half-set service area)', async () => {
    const user = userEvent.setup();
    state.cloud = false;
    seed([welcome, size, done]);
    renderEditor();
    await addType(user, 'Capture', 'Location');
    await user.click(row('What size?'));
    expect(banner()).toBeNull();
  });
});

describe('Publish (S10, COPY-10)', () => {
  it('waits while something would stop people finishing, and Show me opens it', async () => {
    const user = userEvent.setup();
    seed([welcome, size, badNumber, done]);
    renderEditor();
    await user.click(screen.getByRole('button', { name: 'Publish' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Fix this before you publish')).toBeTruthy();
    expect(dialog.textContent).toContain('People couldn’t finish your form as it is.');
    expect(state.publishForm).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Show me' }));
    expect(screen.getByDisplayValue('How many?')).toBeTruthy();
  });

  it('warnings never hold Publish back', async () => {
    const user = userEvent.setup();
    // A rule that uses a removed answer: worth a look, not a blocker.
    const stale: Question = { ...details, visibleIf: { field: 'size', op: 'equals', value: 'xl' } };
    seed([welcome, size, stale, done]);
    renderEditor();
    expect(banner()!.textContent).toContain('1 thing to check');
    await user.click(screen.getByRole('button', { name: 'Publish' }));
    expect(state.publishForm).toHaveBeenCalledTimes(1);
  });

  it('says “You’re live” only when the publish landed', async () => {
    const user = userEvent.setup();
    seed([welcome, size, done]);
    renderEditor();
    await user.click(screen.getByRole('button', { name: 'Publish' }));
    expect(await screen.findByText('You’re live', {}, { timeout: 2000 })).toBeTruthy();
  });

  it('a publish whose write fails says “Couldn’t publish”, never “You’re live”', async () => {
    const user = userEvent.setup();
    seed([welcome, size, done]);
    const before = state.forms.get('f_1')!;
    state.publishForm.mockImplementation((id: string, opts?: { onFail?: () => void }) => {
      const next: FormRecord = { ...before, status: 'published', publishedSchema: before.schema };
      state.forms.set(id, next);
      // The write fails fast (offline): the store rolls back, then tells the shell.
      setTimeout(() => {
        state.forms.set(id, before);
        state.listeners.forEach((l) => l());
        window.dispatchEvent(new CustomEvent('slate-publish-error', { detail: { formId: id } }));
        opts?.onFail?.();
        window.dispatchEvent(
          new CustomEvent('slate-persist-error', {
            detail: { kind: 'form', message: 'Couldn’t save — check your connection.' },
          }),
        );
      }, 50);
      return next;
    });
    renderEditor();
    await user.click(screen.getByRole('button', { name: 'Publish' }));
    expect(await screen.findByText('Couldn’t publish')).toBeTruthy();
    expect(
      screen.getByText('Your form isn’t live yet. Check your connection and try again.'),
    ).toBeTruthy();
    // The save error behind it is the same problem: no second toast.
    expect(screen.queryByText('Couldn’t save your form')).toBeNull();
    await new Promise((r) => setTimeout(r, 700));
    expect(screen.queryByText('You’re live')).toBeNull();
    expect(screen.getByRole('button', { name: 'Publish' })).toBeTruthy();
  });
});

describe('deleting and duplicating (S8, COPY-08, S24)', () => {
  it('deleting a question a rule uses says so, without storage words, and removes the rule', async () => {
    const user = userEvent.setup();
    state.cloud = false;
    seed([welcome, size, details, done]);
    renderEditor();
    await user.click(row('What size?'));
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toContain(
      'Removes “What size?” from this form. Responses you already have keep their answers.',
    );
    expect(dialog.textContent).toContain(
      '“Details?” has a rule that uses it. Deleting removes that rule too.',
    );
    expect(dialog.textContent).not.toMatch(/localStorage/);
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    const saved = state.forms.get('f_1')!.schema.questions;
    expect(saved.map((q) => q.id)).toEqual(['welcome', 'details', 'done']);
    expect((saved[1] as { visibleIf?: unknown }).visibleIf).toBeUndefined();
  });

  it('a duplicate doesn’t copy the link name, so nothing clashes', async () => {
    const user = userEvent.setup();
    state.cloud = false;
    seed([welcome, named, done]);
    renderEditor();
    await user.click(row('First name'));
    await user.click(screen.getByRole('button', { name: 'Duplicate' }));
    const saved = state.forms.get('f_1')!.schema.questions;
    expect(saved).toHaveLength(4);
    expect(saved[2]).toMatchObject({ id: 'first_name_copy', title: 'First name' });
    expect('prefillKey' in saved[2]!).toBe(false);
    expect((saved[1] as { prefillKey?: string }).prefillKey).toBe('first_name');
    await user.click(screen.getAllByRole('button', { name: /^\d+First name/ })[0]!);
    expect(banner()).toBeNull();
  });
});

describe('/forms/new (S28)', () => {
  it('opens the new form under StrictMode, and creates only one', async () => {
    state.createFormAsync.mockImplementation(async () => ({ id: 'f_new' }));
    render(
      <StrictMode>
        <ToastProvider>
          <ConfirmProvider>
            <PromptFormTitleProvider>
              <FormEditor formId={null} />
            </PromptFormTitleProvider>
          </ConfirmProvider>
        </ToastProvider>
      </StrictMode>,
    );
    await waitFor(() => expect(state.navigate).toHaveBeenCalledWith('/forms/f_new/edit'));
    expect(state.createFormAsync).toHaveBeenCalledTimes(1);
  });
});
