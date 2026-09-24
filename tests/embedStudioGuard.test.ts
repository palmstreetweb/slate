import { afterEach, describe, expect, it, vi } from 'vitest';
import { readRoute, syncPathFromHash } from '../examples/_admin/_router.js';

// Audit M-FRAME-1: /forms/{slug} is framable for embeds, so nothing on that
// path may turn into a studio page.
describe('old #/ links upgrade at the root only', () => {
  afterEach(() => window.history.replaceState({}, '', '/'));

  it('upgrades /#/forms/abc/submissions at the root', () => {
    window.history.replaceState({}, '', '/#/forms/abc/submissions?x=1');
    syncPathFromHash();
    expect(window.location.pathname).toBe('/forms/abc/submissions');
    expect(window.location.search).toBe('?x=1');
  });

  it('never upgrades on an embeddable form path', () => {
    window.history.replaceState({}, '', '/forms/pool-care#/settings');
    syncPathFromHash();
    expect(window.location.pathname).toBe('/forms/pool-care');
    expect(readRoute().name).toBe('fill');
  });
});

describe('the studio never mounts inside a frame', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    window.history.replaceState({}, '', '/');
    document.body.innerHTML = '';
  });

  it('shows an open-in-new-tab link instead of the studio', async () => {
    document.body.innerHTML = '<div id="root"></div>';
    window.history.replaceState({}, '', '/settings');
    vi.spyOn(window, 'top', 'get').mockReturnValue({} as Window);
    const mountStudio = vi.fn();
    vi.doMock('../examples/studioApp.js', () => ({ mountStudio }));
    await import('../examples/main.js');
    await new Promise((r) => setTimeout(r, 0));
    const link = document.querySelector('#root a') as HTMLAnchorElement | null;
    expect(link?.textContent).toBe('Open Slate in its own tab');
    expect(link?.target).toBe('_blank');
    expect(mountStudio).not.toHaveBeenCalled();
  });

  it('mounts normally when not framed', async () => {
    document.body.innerHTML = '<div id="root"></div>';
    window.history.replaceState({}, '', '/settings');
    const mountStudio = vi.fn();
    vi.doMock('../examples/studioApp.js', () => ({ mountStudio }));
    await import('../examples/main.js');
    await vi.waitFor(() => expect(mountStudio).toHaveBeenCalled());
  });
});
