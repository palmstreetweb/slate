import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * Review fixes of 2026-10-05 on the public fill page, with the real engine and
 * only the network stubbed: a reply lost on the way, then a reload and Resume,
 * sends the same retry key, so the Function returns the response it stored
 * instead of storing a second one (ENG-03, SEC-1); a redirect typed without
 * https:// opens that site, as the editor said (CON-06, SEC-5).
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
import { SEND_OFFLINE } from '../examples/_admin/fillCopy.js';
import { normalizeRedirectUrl, withWebRedirects } from '../examples/_admin/redirectUrl.js';
import { studioIssues } from '../examples/_admin/formChecks.js';
import type { Question } from '@/index.js';

const schema = (redirectUrl?: string) => ({
  brand: { name: 'Roof check' },
  theme: 'classic',
  themeMode: 'light',
  questions: [
    { id: 'name', type: 'short_text', title: 'Your name?', required: true },
    {
      id: 'when',
      type: 'single_choice',
      title: 'When?',
      options: [
        { label: 'Morning', value: 'am' },
        { label: 'Evening', value: 'pm' },
      ],
    },
    { id: 'done', type: 'thanks', title: 'Thanks, all done.', redirectUrl },
  ],
});

const formOf = (redirectUrl?: string) => ({
  id: 'f_1',
  name: 'Roof check',
  slug: '48210378',
  locked: false,
  schema: schema(redirectUrl),
});

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  window.history.replaceState({}, '', '/forms/48210378');
  window.sessionStorage.clear();
  window.localStorage.clear();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const keyOf = (call: number) =>
  (api.submitPublicResponse.mock.calls[call]![0] as { submitId?: string }).submitId;

describe('a reply lost on the way, then a reload (ENG-03, SEC-1)', () => {
  it('Resume sends the same retry key, so the Function returns the stored response', async () => {
    api.fetchPublishedFormBySlug.mockResolvedValue(formOf());
    api.submitPublicResponse
      .mockRejectedValueOnce(new Error(SEND_OFFLINE))
      .mockResolvedValueOnce({ id: 's_1' });
    const user = userEvent.setup();
    const first = render(<PublicFill slug="48210378" />);
    await user.type(await screen.findByRole('textbox'), 'Ada{Enter}');
    await user.click(await screen.findByRole('radio', { name: /evening/i }));
    await waitFor(() => expect(api.submitPublicResponse).toHaveBeenCalledTimes(1));
    expect(keyOf(0)).toMatch(/^[0-9a-f-]{36}$/);
    first.unmount();

    render(<PublicFill slug="48210378" />);
    await user.click(await screen.findByRole('button', { name: 'Resume' }));
    await user.click(await screen.findByRole('radio', { name: /evening/i }));
    await waitFor(() => expect(api.submitPublicResponse).toHaveBeenCalledTimes(2));
    expect(keyOf(1)).toBe(keyOf(0));
    expect(api.submitPublicResponse.mock.calls[1]![0]).toMatchObject({
      formId: 'f_1',
      answers: { name: 'Ada', when: 'pm' },
    });
  });

  it('Start over after a reload is a new fill with a new key', async () => {
    api.fetchPublishedFormBySlug.mockResolvedValue(formOf());
    api.submitPublicResponse
      .mockRejectedValueOnce(new Error(SEND_OFFLINE))
      .mockResolvedValueOnce({ id: 's_2' });
    const user = userEvent.setup();
    const first = render(<PublicFill slug="48210378" />);
    await user.type(await screen.findByRole('textbox'), 'Ada{Enter}');
    await user.click(await screen.findByRole('radio', { name: /evening/i }));
    await waitFor(() => expect(api.submitPublicResponse).toHaveBeenCalledTimes(1));
    first.unmount();

    render(<PublicFill slug="48210378" />);
    await user.click(await screen.findByRole('button', { name: 'Start over' }));
    await user.type(await screen.findByRole('textbox'), 'Bea{Enter}');
    await user.click(await screen.findByRole('radio', { name: /morning/i }));
    await waitFor(() => expect(api.submitPublicResponse).toHaveBeenCalledTimes(2));
    expect(keyOf(1)).toMatch(/^[0-9a-f-]{36}$/);
    expect(keyOf(1)).not.toBe(keyOf(0));
  });
});

describe('a redirect typed without https:// (CON-06, SEC-5)', () => {
  it('the public fill opens that site after the submit, as the editor said', async () => {
    const assign = vi.fn();
    vi.spyOn(window, 'location', 'get').mockReturnValue({
      ...window.location,
      href: 'https://slateforms.vercel.app/forms/48210378',
      pathname: '/forms/48210378',
      search: '',
      assign,
    } as unknown as Location);
    api.fetchPublishedFormBySlug.mockResolvedValue(formOf('example.com/thanks?at=10:30'));
    api.submitPublicResponse.mockResolvedValueOnce({ id: 's_3' });
    const user = userEvent.setup();
    render(<PublicFill slug="48210378" />);
    await user.type(await screen.findByRole('textbox'), 'Ada{Enter}');
    await user.click(await screen.findByRole('radio', { name: /evening/i }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://example.com/thanks?at=10:30'));
  });

  it('every address the editor says “opens as” is the one Slate’s pages open', () => {
    for (const [typed, opens] of [
      ['example.com/thank-you', 'https://example.com/thank-you'],
      ['www.example.com/a?t=10:30', 'https://www.example.com/a?t=10:30'],
      ['example.com/thanks?next=https://x.com', 'https://example.com/thanks?next=https://x.com'],
      ['example.com:8443/thanks', 'https://example.com:8443/thanks'],
      ['//example.com/x', 'https://example.com/x'],
      // A scheme without "//" is read the way the browser reads it (SEC-5).
      ['https:example.com/thanks', 'https://example.com/thanks'],
      ['https:/example.com/thanks', 'https://example.com/thanks'],
      ['https://example.com', 'https://example.com'],
    ] as const) {
      expect(normalizeRedirectUrl(typed)).toBe(opens);
      const thanks = { id: 'done', type: 'thanks', title: 'Thanks!', redirectUrl: typed };
      const shown = withWebRedirects({ ...schema(), questions: [thanks] } as never) as {
        questions: Array<{ redirectUrl?: string }>;
      };
      expect(shown.questions[0]!.redirectUrl).toBe(opens);
      const [issue] = studioIssues([thanks as Question]);
      if (opens === typed) expect(issue).toBeUndefined();
      else expect(issue!.message).toContain(`which opens as ${opens}`);
    }
  });

  it('leaves what can’t be a web address as typed (the editor blocks it), and the schema alone when nothing changes', () => {
    const s = schema('javascript:alert(1)');
    expect(withWebRedirects(s as never)).toBe(s);
    const full = schema('https://example.com/done');
    expect(withWebRedirects(full as never)).toBe(full);
    expect(normalizeRedirectUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeRedirectUrl('thanks')).toBeNull();
  });
});
