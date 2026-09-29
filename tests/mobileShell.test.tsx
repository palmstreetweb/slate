/**
 * Phone chrome (ADR-062): the compact bar, the ⋯ sheet, the bottom action
 * bar, the editor's one-pane tabs, the safe-area viewport, and the CSS
 * guards behind "the studio is never wider than the phone".
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const state = vi.hoisted(() => ({ navigate: vi.fn() }));

vi.mock('../examples/_admin/neon/env.js', () => ({ isNeonConfigured: () => false }));
vi.mock('../examples/_admin/uiSounds.js', () => ({ playUiSound: vi.fn() }));
vi.mock('../examples/_admin/toast.js', () => ({ useToast: () => ({ push: vi.fn() }) }));
vi.mock('../examples/_admin/neon/AuthProvider.js', () => ({
  useAuth: () => ({ user: null, signOut: vi.fn(async () => ({ error: null })) }),
}));
vi.mock('../examples/_admin/_router.js', () => ({
  navigate: state.navigate,
  useRoute: () => ({ name: 'dashboard' }),
  routeKey: () => '/',
}));
// The bell has its own tests; here it only has to sit in the bar.
vi.mock('../examples/_admin/shell/StudioInbox.js', () => ({
  StudioInbox: () => <button type="button">Notifications</button>,
}));

import { AdminShell } from '../examples/_admin/shell/AdminShell.js';
import { EditorLayoutShell } from '../examples/_admin/components/EditorLayoutShell.js';
import { enableSafeAreaViewport } from '../examples/_admin/mobile/viewport.js';

const realMatchMedia = window.matchMedia;

/** Phone = the studio's phone breakpoint query matches (responses/hooks.ts). */
function setPhone(phone: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: phone && /max-width:\s*719px/.test(query),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  window.localStorage.clear();
  state.navigate.mockClear();
});

afterEach(() => {
  window.matchMedia = realMatchMedia;
});

function renderShell() {
  const onBack = vi.fn();
  const onPage = vi.fn();
  render(
    <AdminShell
      crumbs={<span className="slate-crumb">Forms / Long form name</span>}
      rightSlot={<button type="button">Desktop action</button>}
      phone={{
        back: { label: 'Forms', onClick: onBack },
        title: 'Long form name',
        subtitle: 'Saved',
        menu: [{ id: 'page', label: 'Page item', onSelect: onPage }],
        actions: <button type="button">Share</button>,
      }}
    >
      <p>Body</p>
    </AdminShell>,
  );
  return { onBack, onPage };
}

describe('AdminShell on a phone', () => {
  it('renders the compact bar and the bottom action bar instead of the desktop header', async () => {
    setPhone(true);
    const { onBack } = renderShell();

    const header = document.querySelector('.slate-header')!;
    expect(header).toHaveClass('slate-header--phone');
    expect(within(header as HTMLElement).getByText('Long form name')).toBeInTheDocument();
    expect(screen.queryByText('Desktop action')).not.toBeInTheDocument();
    expect(screen.getByRole('toolbar', { name: 'Page actions' })).toContainElement(
      screen.getByRole('button', { name: 'Share' }),
    );
    // Settings and Feedback move into the ⋯ sheet: no floating buttons.
    expect(document.querySelector('.slate-settings-fab')).toBeNull();
    expect(document.querySelector('.slate-feedback-fab')).toBeNull();
    expect(document.querySelector('.slate-app')).toHaveClass(
      'slate-app--phone',
      'slate-app--actionbar',
    );

    await userEvent.click(screen.getByRole('button', { name: 'Back to Forms' }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it('opens the ⋯ sheet with page items first, then the studio items', async () => {
    setPhone(true);
    const { onPage } = renderShell();

    await userEvent.click(screen.getByRole('button', { name: 'Menu' }));
    const sheet = screen.getByRole('dialog', { name: 'Menu' });
    const labels = within(sheet)
      .getAllByRole('button')
      .map((b) => b.textContent);
    expect(labels.slice(0, 4)).toEqual([
      'Page item',
      'Settings',
      expect.stringMatching(/mode$/),
      'Send feedback',
    ]);
    // Offline studio: nobody to sign out.
    expect(labels).not.toContain('Sign out');

    await userEvent.click(within(sheet).getByRole('button', { name: 'Page item' }));
    expect(onPage).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog', { name: 'Menu' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Menu' }));
    await userEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(state.navigate).toHaveBeenCalledWith('/settings');
  });

  it('opens the feedback dialog from the sheet', async () => {
    setPhone(true);
    renderShell();
    await userEvent.click(screen.getByRole('button', { name: 'Menu' }));
    await userEvent.click(screen.getByRole('button', { name: 'Send feedback' }));
    expect(screen.getByRole('dialog', { name: 'Send feedback' })).toBeInTheDocument();
  });

  it('keeps the desktop header, rightSlot and floating buttons above the breakpoint', () => {
    setPhone(false);
    renderShell();
    expect(document.querySelector('.slate-header')).not.toHaveClass('slate-header--phone');
    expect(screen.getByText('Desktop action')).toBeInTheDocument();
    expect(screen.queryByRole('toolbar', { name: 'Page actions' })).not.toBeInTheDocument();
    expect(document.querySelector('.slate-settings-fab')).not.toBeNull();
    expect(document.querySelector('.slate-feedback-fab')).not.toBeNull();
  });
});

describe('EditorLayoutShell phone tabs', () => {
  const panes = {
    outline: <p>outline pane</p>,
    inspector: <p>inspector pane</p>,
    canvas: <p>canvas pane</p>,
  };

  it('mounts only the active pane and switches with the tabs', async () => {
    const onTab = vi.fn();
    const { rerender } = render(
      <EditorLayoutShell
        {...panes}
        phoneTab="outline"
        onPhoneTabChange={onTab}
        editLabel="Question"
      />,
    );
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Outline', 'Question', 'Preview']);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('outline pane')).toBeInTheDocument();
    // A hidden preview must not exist (it could grab focus and open the keyboard).
    expect(screen.queryByText('canvas pane')).not.toBeInTheDocument();
    expect(screen.queryByText('inspector pane')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: 'Preview' }));
    expect(onTab).toHaveBeenLastCalledWith('preview');

    rerender(
      <EditorLayoutShell
        {...panes}
        phoneTab="preview"
        onPhoneTabChange={onTab}
        editLabel="Question"
      />,
    );
    expect(screen.getByText('canvas pane')).toBeInTheDocument();
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'slate-m-tab-preview');

    screen.getByRole('tab', { name: 'Preview' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(onTab).toHaveBeenLastCalledWith('outline');
  });

  it('keeps the three-pane grid without phoneTab', () => {
    render(<EditorLayoutShell {...panes} />);
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(screen.getByText('outline pane')).toBeInTheDocument();
    expect(screen.getByText('inspector pane')).toBeInTheDocument();
    expect(screen.getByText('canvas pane')).toBeInTheDocument();
  });
});

describe('enableSafeAreaViewport', () => {
  it('adds viewport-fit=cover once and keeps the rest', () => {
    const doc = document.implementation.createHTMLDocument('t');
    const meta = doc.createElement('meta');
    meta.name = 'viewport';
    meta.content = 'width=device-width, initial-scale=1.0';
    doc.head.append(meta);
    enableSafeAreaViewport(doc);
    enableSafeAreaViewport(doc);
    expect(meta.content).toBe('width=device-width, initial-scale=1.0, viewport-fit=cover');
  });
});

describe('studio CSS guards (ADR-062)', () => {
  const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

  it('the header lead can shrink, so the header never outgrows the window', () => {
    const css = read('examples/_admin/_adminTheme.css');
    const lead = /\.slate-header-lead \{[^}]*\}/.exec(css)?.[0] ?? '';
    expect(lead).toMatch(/min-width:\s*0/);
    expect(lead).toMatch(/flex:\s*1 1 0/);
  });

  it('mobile.css uses colour tokens only', () => {
    const css = read('examples/_admin/mobile/mobile.css').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(css).not.toMatch(/\brgba?\(/i);
    expect(css).not.toMatch(/\bhsla?\(/i);
  });

  it('mobile.css never sizes to 100vh without a dvh line', () => {
    const css = read('examples/_admin/mobile/mobile.css');
    const vh = css.match(/100vh/g)?.length ?? 0;
    const dvh = css.match(/100dvh/g)?.length ?? 0;
    expect(dvh).toBeGreaterThanOrEqual(vh);
  });
});
