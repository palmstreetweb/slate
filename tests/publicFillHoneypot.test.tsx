import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * Public fill honeypot (ADR-052): an off-screen trap input outside the engine.
 * People never reach it; a filled trap flags the submit so the Function drops
 * it — with the same thanks screen, so a bot learns nothing.
 */

const api = vi.hoisted(() => ({
  fetchPublishedFormBySlug: vi.fn(),
  unlockPublicForm: vi.fn(),
  submitPublicResponse: vi.fn(),
}));

const META = vi.hoisted(() => ({
  startedAt: new Date('2026-09-23T10:00:00Z'),
  completedAt: new Date('2026-09-23T10:01:00Z'),
  durationMs: 60_000,
  questionsVisited: ['q_name'],
  hiddenFields: { utm_source: 'flyer' },
  score: 0,
}));

// Real metaToPayload so the test covers what actually goes over the wire.
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
// Stand-in engine: one button that fires onSubmit, then a thanks line on success.
vi.mock('@/index.js', () => ({
  Form: ({
    onSubmit,
  }: {
    onSubmit: (answers: Record<string, unknown>, meta: typeof META) => Promise<void>;
  }) => {
    const [status, setStatus] = useState<'idle' | 'thanks' | 'error'>('idle');
    return status === 'idle' ? (
      <button
        type="button"
        onClick={() =>
          onSubmit({ q_name: 'Ada' }, META).then(
            () => setStatus('thanks'),
            () => setStatus('error'),
          )
        }
      >
        Submit
      </button>
    ) : (
      <p>{status === 'thanks' ? 'Thanks — response received' : 'Submit failed'}</p>
    );
  },
}));

import { PublicFill } from '../examples/_admin/pages/PublicFill.js';
import type * as PublicApi from '../examples/_admin/neon/publicApi.js';

const opened = { id: 'f_1', name: 'Crew sign-up', slug: '48210377', locked: false, schema: {} };

function trapInput(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>('.slate-fill-trap input');
  if (!input) throw new Error('trap input missing');
  return input;
}

function submittedMeta() {
  expect(api.submitPublicResponse).toHaveBeenCalledTimes(1);
  return api.submitPublicResponse.mock.calls[0]![0].meta as {
    hiddenFields: Record<string, unknown>;
  };
}

beforeEach(() => {
  window.sessionStorage.clear();
  Object.values(api).forEach((fn) => fn.mockReset());
  api.fetchPublishedFormBySlug.mockResolvedValue(opened);
});

describe('PublicFill honeypot', () => {
  it('renders a trap outside the engine that people and screen readers never reach', async () => {
    const user = userEvent.setup();
    const { container } = render(<PublicFill slug="48210377" />);
    const submit = await screen.findByRole('button', { name: 'Submit' });
    const trap = trapInput(container);

    // Hidden from the accessibility tree: aria-hidden container, no textbox role exposed.
    expect(trap.closest('[aria-hidden="true"]')?.className).toBe('slate-fill-trap');
    expect(screen.queryByRole('textbox')).toBeNull();
    // Not in the engine's markup (the stand-in engine owns only the button).
    expect(trap.closest('.slate-public-respond')).toBeTruthy();
    expect(submit.contains(trap)).toBe(false);

    // Out of the tab order, and Tab never lands on it.
    expect(trap.tabIndex).toBe(-1);
    for (let i = 0; i < 4; i += 1) {
      await user.tab();
      expect(document.activeElement).not.toBe(trap);
    }

    // Autofill and password managers stay out.
    expect(trap.getAttribute('autocomplete')).toBe('off');
    expect(trap.hasAttribute('data-1p-ignore')).toBe(true);
    expect(trap.getAttribute('data-lpignore')).toBe('true');
    expect(trap.hasAttribute('data-bwignore')).toBe(true);
    expect(trap.name).not.toMatch(/mail|website|url|company|name|phone|address|tel|user/i);
    expect(trap.value).toBe('');
  });

  it('empty trap: payload has no _hp and keeps the real hidden fields', async () => {
    const user = userEvent.setup();
    api.submitPublicResponse.mockResolvedValue({ id: 's_real' });
    render(<PublicFill slug="48210377" />);
    await user.click(await screen.findByRole('button', { name: 'Submit' }));

    expect(await screen.findByText('Thanks — response received')).toBeTruthy();
    const meta = submittedMeta();
    expect(meta.hiddenFields).toEqual({ utm_source: 'flyer' });
    expect('_hp' in meta.hiddenFields).toBe(false);
    expect(api.submitPublicResponse.mock.calls[0]![0]).toMatchObject({
      formId: 'f_1',
      answers: { q_name: 'Ada' },
    });
  });

  it('trap typed into: payload carries _hp, and the respondent sees the same thanks', async () => {
    const user = userEvent.setup();
    api.submitPublicResponse.mockResolvedValue({ id: 'ignored' });
    const { container } = render(<PublicFill slug="48210377" />);
    const submit = await screen.findByRole('button', { name: 'Submit' });
    await user.type(trapInput(container), 'https://spam.example');
    await user.click(submit);

    expect(await screen.findByText('Thanks — response received')).toBeTruthy();
    const meta = submittedMeta();
    expect(meta.hiddenFields._hp).toBeTruthy();
    // Real hidden fields still ride along; the engine's own object isn't mutated.
    expect(meta.hiddenFields.utm_source).toBe('flyer');
    expect(META.hiddenFields).toEqual({ utm_source: 'flyer' });
  });

  it('trap set straight on the DOM (no input events) is still caught', async () => {
    const user = userEvent.setup();
    api.submitPublicResponse.mockResolvedValue({ id: 'ignored' });
    const { container } = render(<PublicFill slug="48210377" />);
    const submit = await screen.findByRole('button', { name: 'Submit' });
    trapInput(container).value = 'bot';
    await user.click(submit);

    expect(await screen.findByText('Thanks — response received')).toBeTruthy();
    expect(submittedMeta().hiddenFields._hp).toBeTruthy();
  });
});
