/**
 * QA pass, fields / text / media (workstream w2b): error text contrast in
 * light mode, long words that wrap, matrix and review layouts, AM / PM on
 * narrow screens, the phone keyboard (GAP-04) and the studio preview that no
 * longer takes the keyboard from the inspector (S15).
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { contrastRatio } from '@/utils/contrast.js';
import { focusAfter } from '@/utils/focus.js';
import { usePreviewFocusGuard } from '../examples/_admin/components/usePreviewFocusGuard.js';

const css = (file: string) => readFileSync(resolve(__dirname, '../src/styles', file), 'utf8');

/** `--name: value` inside the block that starts with `selector {`. */
function token(sheet: string, selector: string, name: string): string {
  const start = sheet.indexOf(`${selector} {`);
  expect(start, selector).toBeGreaterThanOrEqual(0);
  const block = sheet.slice(start, sheet.indexOf('}', start));
  const m = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(block);
  expect(m, `${selector} ${name}`).not.toBeNull();
  return m![1]!;
}

describe('error text contrast (F26, GAP-20)', () => {
  const tokens = css('tokens.css');
  const themes = [
    'classic',
    'editorial',
    'swiss',
    'midnight',
    'sunset',
    'terminal',
    'forest',
    'mono',
    'constellation',
    'bloom',
    'riso',
    'memphis',
  ];

  for (const name of themes) {
    it(`${name} light: error text is at least 5:1 on the page and its raised surfaces`, () => {
      const sel = `[data-slate-forms][data-theme-name='${name}'][data-theme='light']`;
      const error = token(tokens, sel, 'slate-error');
      // 13–14 px text needs 4.5:1; the margin covers decorations behind it.
      expect(contrastRatio(error, token(tokens, sel, 'slate-bg'))).toBeGreaterThanOrEqual(5);
      expect(contrastRatio(error, token(tokens, sel, 'slate-bg-2'))).toBeGreaterThanOrEqual(5);
    });
  }
});

describe('layout (GAP-12, GAP-13, GAP-29, GAP-21)', () => {
  it('long words wrap inside the form instead of being cut at its edge', () => {
    expect(css('base.css')).toMatch(
      /\[data-slate-forms\] \{[^}]*overflow-x: hidden;[^}]*overflow-wrap: anywhere;/,
    );
  });

  it('review rows on phones can’t be widened by a long title', () => {
    expect(css('questions.css')).toMatch(
      /\.slate-review-row \{\s*\/\*[^*]*\*\/\s*grid-template-columns: minmax\(0, 1fr\);/,
    );
  });

  it('matrix headers and rows share column widths whatever the labels', () => {
    expect(css('questions.css')).toContain(
      'grid-template-columns: minmax(120px, 1.4fr) repeat(var(--slate-matrix-cols), minmax(0, 1fr));',
    );
  });

  it('a matrix whose headers can’t fit their words stacks, and headers never break inside a word (R7)', () => {
    const sheet = css('questions.css');
    // MatrixField measures the headers and sets .slate-matrix--stack (any column count, any width).
    expect(sheet).toMatch(
      /\[data-slate-forms\] \.slate-matrix--stack \.slate-matrix-head \{\s*display: none;/,
    );
    const head = /\[data-slate-forms\] \.slate-matrix-colhead \{[^}]*\}/.exec(sheet)![0];
    expect(head).toMatch(/overflow-wrap: normal;/);
    expect(head).not.toMatch(/anywhere/);
  });

  it('AM / PM wraps under the time on a very narrow screen', () => {
    expect(css('extensions.css')).toMatch(/\.slate-time-row \{[^}]*flex-wrap: wrap;/);
  });

  it('an empty message slot takes no room and doesn’t animate', () => {
    expect(css('questions.css')).toMatch(
      /\[data-slate-forms\] p\.slate-err:empty \{\s*margin: 0;\s*animation: none;/,
    );
  });

  it('keyboard-only hints step aside on touch screens', () => {
    const rule = /@media \(hover: none\) \{\s*([^{]+)\{\s*display: none;/.exec(
      css('questions.css'),
    );
    expect(rule).not.toBeNull();
    const selectors = rule![1]!.split(',').map((x) => x.trim());
    // GAP-26: the Welcome / Statement buttons' "press Enter" and the upload
    // zone's "or drag and drop" too, beside the typed boxes' and .slate-keys.
    for (const sel of [
      '[data-slate-forms] .slate-input ~ .slate-actions > .slate-hint',
      '[data-slate-forms] .slate-cta-hint',
      '[data-slate-forms] .slate-upload-hint',
      '[data-slate-forms] .slate-keys',
    ]) {
      expect(selectors).toContain(sel);
    }
  });

  it('the "!" before a message is drawn, with empty alt text, never part of the sentence', () => {
    expect(css('questions.css')).toMatch(
      /\.slate-err:not\(:empty\)::before \{\s*content: '! ';\s*content: '! ' \/ '';/,
    );
  });
});

describe('phone keyboard (GAP-04)', () => {
  function stubViewport() {
    const listeners: Array<() => void> = [];
    const vv = {
      width: 375,
      height: 667,
      addEventListener: (_: string, fn: () => void) => listeners.push(fn),
      removeEventListener: (_: string, fn: () => void) =>
        listeners.splice(listeners.indexOf(fn), 1),
    };
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: vv });
    return { vv, fire: () => listeners.forEach((fn) => fn()), listeners };
  }

  function stage() {
    document.body.innerHTML =
      '<div class="slate-stage-content"><input id="box"><div id="grid" tabindex="-1"></div><p class="slate-err"></p><div class="slate-actions"><button>OK</button></div></div>';
    const actions = document.querySelector('.slate-actions') as HTMLElement;
    actions.scrollIntoView = vi.fn();
    return actions;
  }

  it('the keyboard opening brings the OK row back into view; a pinch-zoom doesn’t', () => {
    const { vv, fire, listeners } = stubViewport();
    const actions = stage();
    const stop = focusAfter(document.getElementById('box'));
    document.getElementById('box')!.focus();
    vv.height = 314;
    fire();
    expect(actions.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
    vv.width = 187;
    fire();
    expect(actions.scrollIntoView).toHaveBeenCalledTimes(1);
    stop();
    expect(listeners).toHaveLength(0);
    delete (window as { visualViewport?: unknown }).visualViewport;
  });

  it('only a keyboard: no text box focused, a toolbar-sized change or a taller viewport never scroll (R3)', () => {
    const { vv, fire } = stubViewport();
    const actions = stage();
    const stop = focusAfter(document.getElementById('grid'));
    // A field with no text box (a grid, a photo list): its own focus never arms the reveal.
    document.getElementById('grid')!.focus();
    vv.height = 300;
    fire();
    expect(actions.scrollIntoView).not.toHaveBeenCalled();
    // A text box in the question: a browser bar sliding away (70 px) or back is not a keyboard.
    vv.height = 667;
    document.getElementById('box')!.focus();
    vv.height = 597;
    fire();
    vv.height = 737;
    fire();
    expect(actions.scrollIntoView).not.toHaveBeenCalled();
    // A keyboard (well over 150 px gone, same width): once per focus.
    vv.height = 400;
    fire();
    vv.height = 380;
    fire();
    expect(actions.scrollIntoView).toHaveBeenCalledTimes(1);
    stop();
    delete (window as { visualViewport?: unknown }).visualViewport;
  });
});

describe('studio preview keeps the keyboard where the owner is (S15)', () => {
  function Studio() {
    const guard = usePreviewFocusGuard();
    return (
      <div>
        <input aria-label="Title" />
        <div data-testid="frame" {...guard}>
          <input aria-label="Answer" />
        </div>
      </div>
    );
  }

  it('a field focusing itself in the preview hands focus straight back', () => {
    render(<Studio />);
    const title = screen.getByLabelText('Title');
    title.focus();
    // What a preview field does ~380 ms after it appears.
    screen.getByLabelText('Answer').focus();
    expect(title).toHaveFocus();
  });

  it('clicking into the preview, or tabbing to it, still works', () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(<Studio />);
      const title = screen.getByLabelText('Title');
      const answer = screen.getByLabelText('Answer');
      title.focus();
      fireEvent.pointerDown(answer);
      answer.focus();
      expect(answer).toHaveFocus();
      title.focus();
      vi.advanceTimersByTime(1500);
      fireEvent.keyDown(title, { key: 'Tab' });
      answer.focus();
      expect(answer).toHaveFocus();
    } finally {
      vi.useRealTimers();
    }
  });
});
