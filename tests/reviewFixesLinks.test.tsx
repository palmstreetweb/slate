import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

/**
 * Review fixes of 2026-10-05, SEC-3: a crafted portable link (`/r?d=…`) with a
 * question that isn't one (null) shows the live site's preview-link notice,
 * or in the offline studio the questions that are real ones — never a blank
 * page.
 */

const cfg = vi.hoisted(() => ({ cloud: false, sanitizerThrows: false }));

vi.mock('../examples/_admin/neon/config.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  isNeonConfigured: () => cfg.cloud,
}));
vi.mock('../examples/_admin/sanitizeUntrustedSchema.js', async (importOriginal) => {
  const real = await importOriginal<typeof Sanitizer>();
  return {
    ...real,
    sanitizeUntrustedSchema: (s: Parameters<typeof real.sanitizeUntrustedSchema>[0]) => {
      if (cfg.sanitizerThrows) throw new TypeError('Cannot read properties of null');
      return real.sanitizeUntrustedSchema(s);
    },
  };
});

import type * as Sanitizer from '../examples/_admin/sanitizeUntrustedSchema.js';
import type { Schema } from '@/index.js';
import { PublicRespond } from '../examples/_admin/pages/PublicRespond.js';
import { sanitizeUntrustedSchema } from '../examples/_admin/sanitizeUntrustedSchema.js';
import { withoutRepeats, withoutRepeatedOptionsIn } from '../examples/_admin/uniqueOptions.js';
import { LINK_BROKEN, LINK_PREVIEW_ONLY } from '../examples/_admin/fillCopy.js';

const token = (payload: unknown) =>
  Buffer.from(JSON.stringify(payload), 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

const crafted = (questions: unknown[]) =>
  token({
    v: 1,
    schema: { brand: { name: 'X' }, theme: 'classic', themeMode: 'light', questions },
  });

beforeEach(() => {
  cfg.cloud = false;
  cfg.sanitizerThrows = false;
  window.sessionStorage.clear();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('a crafted portable link with a question that isn’t one (SEC-3)', () => {
  it('on the live site: the preview-link notice, read before anything else', () => {
    cfg.cloud = true;
    render(<PublicRespond token={token({ v: 1, schema: { questions: [null] } })} />);
    expect(screen.getByText(LINK_PREVIEW_ONLY)).toBeInTheDocument();
  });

  it('in the offline studio: the real questions, the rest left out', async () => {
    render(
      <PublicRespond
        token={crafted([
          null,
          'text',
          7,
          { type: 'short_text' },
          { id: 'name', type: 'short_text', title: 'Your name?' },
        ])}
      />,
    );
    expect(await screen.findByRole('heading', { name: 'Your name?' })).toBeInTheDocument();
  });

  it('a link the page still can’t read, or with no question at all, says it is broken, never a blank page', () => {
    render(<PublicRespond token={crafted([null])} />);
    expect(screen.getByText(LINK_BROKEN)).toBeInTheDocument();
    cleanup();
    cfg.sanitizerThrows = true;
    render(<PublicRespond token={crafted([{ id: 'n', type: 'short_text', title: 'N' }])} />);
    expect(screen.getByText(LINK_BROKEN)).toBeInTheDocument();
  });

  it('the sanitizer and the repeated-option pass never throw on one', () => {
    const s = {
      brand: { name: 'X' },
      theme: 'classic',
      themeMode: 'light',
      questions: [
        null,
        {
          id: 'c',
          type: 'single_choice',
          title: 'C',
          options: [null, { label: 'A', value: 'a' }],
        },
      ],
    } as unknown as Schema;
    const out = sanitizeUntrustedSchema(s);
    // The link named no ending, so the sanitizer adds one (audit 2026-10).
    expect(out.questions.map((q) => q.id)).toEqual(['c', 'slate-ending']);
    expect((out.questions[0] as unknown as { options: unknown[] }).options).toEqual([
      { label: 'A', value: 'a' },
    ]);
    expect(withoutRepeats(null as never)).toBeNull();
    expect(() => withoutRepeatedOptionsIn(s)).not.toThrow();
  });
});
