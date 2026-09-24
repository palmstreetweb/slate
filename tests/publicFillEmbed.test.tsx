import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const api = vi.hoisted(() => ({
  fetchPublishedFormBySlug: vi.fn(),
  unlockPublicForm: vi.fn(),
  submitPublicResponse: vi.fn(),
  metaToPayload: vi.fn(),
}));

vi.mock('../examples/_admin/neon/publicApi.js', () => api);
vi.mock('../examples/_admin/neon/config.js', () => ({ isNeonConfigured: () => true }));
vi.mock('../examples/_admin/shell/LoadingScreen.js', () => ({
  LoadingScreen: () => <p>loading</p>,
}));
vi.mock('../examples/_admin/hostFileUpload.js', () => ({ hostFileUpload: vi.fn() }));
vi.mock('../examples/_admin/resolveUploadMeta.js', () => ({ resolveUploadMeta: vi.fn() }));
vi.mock('@/index.js', () => ({
  Form: ({ schema }: { schema: { marker: string } }) => <p>form:{schema.marker}</p>,
}));

import { PublicFill } from '../examples/_admin/pages/PublicFill.js';

const opened = {
  id: 'f_1',
  name: 'Crew sign-up',
  slug: '48210377',
  locked: false,
  schema: { marker: 'welcome' },
};

/** jsdom has no ResizeObserver; this one fires on observe, like the real thing. */
class FakeResizeObserver {
  constructor(private readonly cb: ResizeObserverCallback) {}
  observe() {
    this.cb([], this as unknown as ResizeObserver);
  }
  unobserve() {}
  disconnect() {}
}

function framedBy(parent: { postMessage: (...args: unknown[]) => void }) {
  vi.spyOn(window, 'parent', 'get').mockReturnValue(parent as unknown as Window);
}

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  api.fetchPublishedFormBySlug.mockResolvedValue(opened);
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(640);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState({}, '', '/');
});

describe('PublicFill embed mode (ADR-054)', () => {
  it('normal link keeps the form-name line under the form', async () => {
    window.history.replaceState({}, '', '/forms/48210377');
    render(<PublicFill slug="48210377" />);
    expect(await screen.findByText('form:welcome')).toBeTruthy();
    expect(screen.getByText('Crew sign-up')).toBeTruthy();
    expect(document.querySelector('.slate-embed')).toBeNull();
  });

  it('?embed=1 hides the footer line and marks the page for the transparent layout', async () => {
    window.history.replaceState({}, '', '/forms/48210377?embed=1');
    render(<PublicFill slug="48210377" />);
    expect(await screen.findByText('form:welcome')).toBeTruthy();
    expect(screen.queryByText('Crew sign-up')).toBeNull();
    expect(document.querySelector('.slate-public-respond.slate-embed')).toBeTruthy();
  });

  it('framed + ?embed=1 posts its height to the parent — a number, nothing else', async () => {
    window.history.replaceState({}, '', '/forms/48210377?embed=1');
    const parent = { postMessage: vi.fn() };
    framedBy(parent);
    render(<PublicFill slug="48210377" />);
    expect(await screen.findByText('form:welcome')).toBeTruthy();
    expect(parent.postMessage).toHaveBeenCalledWith({ type: 'slate:height', height: 640 }, '*');
    expect(parent.postMessage).toHaveBeenCalledTimes(1);
  });

  it('locked form gate reports its height too', async () => {
    window.history.replaceState({}, '', '/forms/48210377?embed=1');
    api.fetchPublishedFormBySlug.mockResolvedValue({ ...opened, locked: true, schema: null });
    const parent = { postMessage: vi.fn() };
    framedBy(parent);
    render(<PublicFill slug="48210377" />);
    expect(await screen.findByRole('button', { name: 'Continue' })).toBeTruthy();
    expect(parent.postMessage).toHaveBeenCalledWith({ type: 'slate:height', height: 640 }, '*');
  });

  it('not framed: embed mode posts nothing', async () => {
    window.history.replaceState({}, '', '/forms/48210377?embed=1');
    const spy = vi.spyOn(window, 'postMessage');
    render(<PublicFill slug="48210377" />);
    expect(await screen.findByText('form:welcome')).toBeTruthy();
    expect(spy).not.toHaveBeenCalled();
  });

  it('framed without ?embed=1: posts nothing', async () => {
    window.history.replaceState({}, '', '/forms/48210377');
    const parent = { postMessage: vi.fn() };
    framedBy(parent);
    render(<PublicFill slug="48210377" />);
    expect(await screen.findByText('form:welcome')).toBeTruthy();
    expect(parent.postMessage).not.toHaveBeenCalled();
    expect(screen.getByText('Crew sign-up')).toBeTruthy();
  });
});
