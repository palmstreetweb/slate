/**
 * Studio shell CSS (QA pass, 2026-10-04). Layout bugs a browser shows and
 * jsdom can't, pinned at the rules that fix them:
 * - SCROLL-6: the Responses reader is positioned, so its screen-reader-only
 *   "No answer" spans stay inside it instead of stretching the page;
 * - SCROLL-8: at the Larger / Largest studio sizes, heights sized to the
 *   window divide the zoom back out (the editor and the test-run frame used to
 *   end 80–160 px below the fold);
 * - SCROLL-5: the editor's preview frame clips instead of hiding, so focus
 *   can't scroll it out of the wheel's reach;
 * - MEDIA-21: in a narrow test-run frame the theme toggle goes back to the
 *   form's top bar instead of sitting on the answers;
 * - S27: light-mode inline warnings are at least 4.5:1.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (p: string) =>
  readFileSync(resolve(__dirname, '..', p), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** The first rule whose selector ends with `selectorEnd` (and that declares `has`, if given). */
function rule(css: string, selectorEnd: string, has = ''): string {
  let at = css.indexOf(`${selectorEnd} {`);
  while (at >= 0) {
    const body = css.slice(at, css.indexOf('}', at));
    if (body.includes(has)) return body;
    at = css.indexOf(`${selectorEnd} {`, at + 1);
  }
  return '';
}

describe('Responses reader (SCROLL-6)', () => {
  it('positions the reader and the panel, so absolute text stays inside them', () => {
    const css = read('examples/_admin/responses/inbox.css');
    expect(rule(css, '.slate-rsp .rsp-ib-scroll')).toMatch(/position:\s*relative/);
    expect(rule(css, '.slate-rsp .rsp-ib')).toMatch(/position:\s*relative/);
    // The text it protects is still visually hidden by absolute positioning.
    expect(rule(read('examples/_admin/responses/responses.css'), '.slate-rsp .rsp-sr')).toMatch(
      /position:\s*absolute/,
    );
  });
});

describe('studio size zoom (SCROLL-8)', () => {
  const theme = read('examples/_admin/_adminTheme.css');
  const mobile = read('examples/_admin/mobile/mobile.css');

  it('names the zoom next to each zoom rule', () => {
    expect(theme).toMatch(/zoom:\s*1\.1;\s*--slate-zoom:\s*1\.1;/);
    expect(theme).toMatch(/zoom:\s*1\.2;\s*--slate-zoom:\s*1\.2;/);
  });

  it('the editor and the test-run frame divide the zoom out of the window height', () => {
    const shell = rule(theme, '.slate-editor-shell');
    expect(shell).toMatch(
      /height:\s*calc\(100dvh \/ var\(--slate-zoom, 1\) - var\(--slate-header-h\)\)/,
    );
    const frame = rule(mobile, '.slate-preview.slate-preview--page');
    expect(frame).toMatch(/height:\s*calc\(\s*100dvh \/ var\(--slate-zoom, 1\)/);
    const phoneFrame = rule(mobile, '.slate-app--phone .slate-preview--page');
    expect(phoneFrame).toMatch(/100dvh \/ var\(--slate-zoom, 1\)/);
    const phoneCanvas = rule(mobile, '.slate-m-editor-pane > .slate-canvas');
    expect(phoneCanvas).toMatch(/100dvh \/ var\(--slate-zoom, 1\)/);
  });

  it('the zoomed wrapper and the app shell stop adding a blank screen under every page', () => {
    expect(theme).toMatch(
      /body\[data-slate-scale\] #root > \.slate-page > \[data-slate-forms\]\[data-theme-name='slate'\],[\s\S]*?> \.slate-app:not\(\.slate-app--phone\) \{\s*min-height: calc\(100vh \/ var\(--slate-zoom, 1\)\);/,
    );
    expect(rule(mobile, '.slate-app--phone')).toMatch(
      /min-height: calc\(100dvh \/ var\(--slate-zoom, 1\)\)/,
    );
    // Responses no longer needs its own copy of the fix.
    expect(read('examples/_admin/responses/responses.css')).not.toMatch(/calc\(100vh \/ 1\.[12]\)/);
  });

  it('nothing in the studio shell sizes to the window without dividing the zoom out', () => {
    // Login and the drop lab are never zoomed; the lightbox is portaled outside the studio wrapper.
    const exempt = /\.slate-login|\.slate-drop-lab|\.slate-file-lightbox/;
    for (const [name, css] of [
      ['_adminTheme.css', theme],
      ['mobile.css', mobile],
    ] as const) {
      const rules = css.split('}');
      for (const r of rules) {
        if (exempt.test(r)) continue;
        for (const m of r.matchAll(/calc\(\s*100d?vh(?! \/ var\(--slate-zoom)/g)) {
          throw new Error(`${name}: ${r.trim().slice(0, 120)} … ${m[0]}`);
        }
      }
    }
  });
});

describe('preview frames', () => {
  const theme = read('examples/_admin/_adminTheme.css');

  it('the editor preview frame clips, and stays its column’s height (SCROLL-5)', () => {
    const frame = rule(theme, '.slate-canvas-frame', 'border-radius');
    expect(frame).toMatch(/overflow:\s*clip/);
    expect(frame).toMatch(/min-height:\s*0/);
  });

  it('a narrow test-run frame puts the theme toggle back in the top bar (MEDIA-21)', () => {
    expect(rule(theme, '.slate-preview--page')).toMatch(
      /container:\s*slate-test-run \/ inline-size/,
    );
    const query = /@container slate-test-run \(max-width: (\d+)px\) \{([\s\S]*?\})\s*\}/.exec(
      theme,
    );
    expect(query).not.toBeNull();
    // 720 px column + the toggle's 24 px inset and ~60 px width on both sides.
    expect(Number(query![1])).toBeGreaterThanOrEqual(880);
    expect(query![2]).toMatch(/\.slate-toggle-scale \{[^}]*position:\s*static/);
  });
});

describe('light-mode warning contrast (S27)', () => {
  const tokens = readFileSync(
    resolve(__dirname, '../examples/_admin/slateChromeTokens.css'),
    'utf8',
  );

  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const lum = (hex: string) => {
    const n = Number.parseInt(hex.slice(1), 16);
    return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  };
  const ratio = (a: string, b: string) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p) as [number, number];
    return (x + 0.05) / (y + 0.05);
  };

  for (const ui of ['warm', 'neutral', 'cool']) {
    it(`${ui}: warnings read at ≥ 4.5:1 on the panel and on the page behind the phone pane`, () => {
      const block =
        new RegExp(
          `\\[data-admin-ui='${ui}'\\]\\[data-theme='light'\\] \\{([\\s\\S]*?)\\n\\}`,
        ).exec(tokens)?.[1] ?? '';
      const token = (name: string) =>
        new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, 'i').exec(block)?.[1];
      const warn = token('--slate-warn')!;
      for (const bg of ['--chrome-panel', '--chrome-panel-2', '--chrome-bg']) {
        expect(ratio(warn, token(bg)!), `${ui} ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    });
  }
});
