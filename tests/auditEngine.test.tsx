/**
 * Engine audit fixes (2026-10-09): Back after Resume retraces the path,
 * counters follow the path, drafts survive Back, piped titles read what is
 * sent, a prefilled one-tap question continues on Enter, a prefilled link
 * saves nothing for Resume until something is done, Enter on a focused
 * button is that button's own, the URL check and right-to-left text.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Form, defineSchema } from '@/index.js';
import type { Question } from '@/types/Question.js';
import { validate } from '@/logic/validation.js';

const base = { brand: { name: 'Audit' }, theme: 'classic', themeMode: 'light' } as const;
const W: Question = { id: 'w', type: 'welcome', title: 'Welcome', cta: 'Start' };
const T: Question = { id: 'done', type: 'thanks', title: 'Thanks!' };
const opts = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ label: `Option ${i + 1}`, value: `o${i + 1}` }));

/** The "n / m" footer as text. */
const footer = (c: HTMLElement) =>
  c.querySelector('.slate-footer')?.textContent?.replace(/\s+/g, ' ');
const direction = (c: HTMLElement) =>
  c.querySelector('.slate-stage-content')?.getAttribute('data-direction');

beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Back after Resume (bug 2)', () => {
  it('retraces the path, never into a question a jump passed over', async () => {
    const schema = defineSchema({
      ...base,
      id: 'jumpform',
      questions: [
        {
          id: 'q1',
          type: 'single_choice',
          title: 'Q1',
          options: [
            { label: 'Alpha', value: 'a' },
            { label: 'Beta', value: 'b' },
          ],
          logic: [{ if: { field: 'q1', op: 'equals', value: 'a' }, goTo: 'q4' }],
        },
        { id: 'q2', type: 'short_text', title: 'Q2' },
        { id: 'q3', type: 'short_text', title: 'Q3' },
        { id: 'q4', type: 'short_text', title: 'Q4' },
        T,
      ],
    });
    // A tab's save from before the reload: A picked, the form on Q4.
    window.sessionStorage.setItem(
      'slate-forms-resume:jumpform',
      JSON.stringify({
        answers: { q1: 'a' },
        step: 3,
        visitedIds: ['q1', 'q4'],
        savedAt: new Date().toISOString(),
      }),
    );
    const user = userEvent.setup();
    render(<Form schema={schema} resume="tab" onSubmit={vi.fn()} />);
    await user.click(await screen.findByRole('button', { name: 'Resume' }));
    expect(await screen.findByRole('heading', { name: 'Q4' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /back/i }));
    expect(await screen.findByRole('heading', { name: 'Q1' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Q3' })).toBeNull();
  });
});

describe('the counter, badge and bar follow the path (bug 3)', () => {
  it('a jump leaves the questions it passes over out of the count', async () => {
    const schema = defineSchema({
      ...base,
      questions: [
        W,
        {
          id: 'q1',
          type: 'single_choice',
          title: 'Q1',
          options: [
            { label: 'Alpha', value: 'a' },
            { label: 'Beta', value: 'b' },
          ],
          logic: [{ if: { field: 'q1', op: 'equals', value: 'a' }, goTo: 'q4' }],
        },
        { id: 'q2', type: 'short_text', title: 'Q2' },
        { id: 'q3', type: 'short_text', title: 'Q3' },
        { id: 'q4', type: 'short_text', title: 'Q4' },
        { id: 'rev', type: 'review', title: 'Check' },
        T,
      ],
    });
    const user = userEvent.setup();
    const { container } = render(<Form schema={schema} onSubmit={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /^start/i }));
    await screen.findByRole('heading', { name: 'Q1' });
    // Before the pick the list is the path: 4 questions (Review never counts).
    expect(footer(container)).toBe('1 / 4');
    await user.click(screen.getByRole('radio', { name: /alpha/i }));
    expect(await screen.findByRole('heading', { name: 'Q4' })).toBeInTheDocument();
    expect(footer(container)).toBe('2 / 2');
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
    expect(
      container.querySelector('.slate-stage > .slate-stage-content .slate-step-badge')?.textContent,
    ).toContain('02');
  });

  it('a question a later answer reveals counts where it comes up and slides in forward', async () => {
    const schema = defineSchema({
      ...base,
      questions: [
        W,
        {
          id: 'q1',
          type: 'short_text',
          title: 'Q1 revealed',
          visibleIf: { field: 'q3', op: 'equals', value: 'yes' },
        },
        { id: 'q2', type: 'short_text', title: 'Q2' },
        { id: 'q3', type: 'yes_no', title: 'Q3' },
        { id: 'q4', type: 'short_text', title: 'Q4' },
        T,
      ],
    });
    const user = userEvent.setup();
    const { container } = render(<Form schema={schema} onSubmit={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /^start/i }));
    await user.type(await screen.findByRole('textbox'), 'two{Enter}');
    await screen.findByRole('heading', { name: 'Q3' });
    expect(footer(container)).toBe('2 / 3');
    await user.click(screen.getByRole('radio', { name: /yes/i }));
    expect(await screen.findByRole('heading', { name: 'Q1 revealed' })).toBeInTheDocument();
    expect(footer(container)).toBe('3 / 4');
    expect(direction(container)).toBe('forward');
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
    await user.type(screen.getByRole('textbox'), 'one{Enter}');
    await screen.findByRole('heading', { name: 'Q4' });
    expect(footer(container)).toBe('4 / 4');
  });
});

describe('drafts survive Back (bug 4)', () => {
  it('typed text comes back after Back and forward, and is not an answer until OK', async () => {
    const schema = defineSchema({
      ...base,
      questions: [
        W,
        { id: 'note', type: 'long_text', title: 'Note' },
        { id: 'city', type: 'short_text', title: 'City' },
        T,
      ],
    });
    const onQuestionChange = vi.fn();
    const user = userEvent.setup();
    render(<Form schema={schema} onSubmit={vi.fn()} onQuestionChange={onQuestionChange} />);
    await user.click(screen.getByRole('button', { name: /^start/i }));
    await user.type(await screen.findByRole('textbox'), 'A paragraph in progress');
    await user.click(screen.getByRole('button', { name: /back/i }));
    await screen.findByRole('heading', { name: 'Welcome' });
    await user.click(screen.getByRole('button', { name: /^start/i }));
    expect(await screen.findByRole('textbox')).toHaveValue('A paragraph in progress');
    // Not stored: nothing but OK makes it an answer.
    const last = onQuestionChange.mock.calls.at(-1)!;
    expect(last[0]).toBe('note');
    expect(last[1]).toEqual({});
    await user.click(screen.getByRole('button', { name: /ok/i }));
    await screen.findByRole('heading', { name: 'City' });
    expect(onQuestionChange.mock.calls.at(-1)![1]).toEqual({ note: 'A paragraph in progress' });
  });

  it('an Other box and its text come back after Back', async () => {
    const schema = defineSchema({
      ...base,
      questions: [
        W,
        { id: 'pick', type: 'single_choice', title: 'Pick', options: opts(2), allowOther: true },
        T,
      ],
    });
    const user = userEvent.setup();
    render(<Form schema={schema} onSubmit={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /^start/i }));
    await screen.findByRole('heading', { name: 'Pick' });
    await user.keyboard('c');
    await user.type(await screen.findByRole('textbox'), 'something custom');
    await user.click(screen.getByRole('button', { name: /back/i }));
    await screen.findByRole('heading', { name: 'Welcome' });
    await user.click(screen.getByRole('button', { name: /^start/i }));
    expect(await screen.findByRole('textbox')).toHaveValue('something custom');
  });

  it('"Submit another" starts with a clean slate', async () => {
    const schema = defineSchema({
      ...base,
      questions: [{ id: 'name', type: 'short_text', title: 'Name' }, T],
    });
    const user = userEvent.setup();
    render(<Form schema={schema} onSubmit={vi.fn().mockResolvedValue(undefined)} />);
    await user.type(await screen.findByRole('textbox'), 'Ada{Enter}');
    await user.click(await screen.findByRole('button', { name: /submit another/i }));
    expect(await screen.findByRole('textbox')).toHaveValue('');
  });
});

describe('piped titles read the answers that will be sent (bug 8)', () => {
  it('drops an answer to a question the respondent moved off the path', async () => {
    const schema = defineSchema({
      ...base,
      questions: [
        W,
        { id: 'q1', type: 'yes_no', title: 'Q1' },
        {
          id: 'q2',
          type: 'short_text',
          title: 'Q2',
          visibleIf: { field: 'q1', op: 'equals', value: 'yes' },
        },
        { id: 'q3', type: 'short_text', title: 'You said: [{{field:q2}}]' },
        T,
      ],
    });
    const user = userEvent.setup();
    render(<Form schema={schema} onSubmit={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /^start/i }));
    await user.click(await screen.findByRole('radio', { name: /yes/i }));
    await user.type(await screen.findByRole('textbox'), 'hello{Enter}');
    expect(await screen.findByRole('heading', { name: 'You said: [hello]' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /back/i }));
    await screen.findByRole('heading', { name: 'Q2' });
    await user.click(screen.getByRole('button', { name: /back/i }));
    await screen.findByRole('heading', { name: 'Q1' });
    await user.click(screen.getByRole('radio', { name: /no/i }));
    expect(await screen.findByRole('heading', { name: 'You said: []' })).toBeInTheDocument();
  });
});

describe('a prefilled one-tap question continues from the keyboard (bug 9)', () => {
  it('shows OK and moves on with the pick on Enter, after the question has been up a moment', async () => {
    const schema = defineSchema({
      ...base,
      questions: [
        W,
        { id: 'p', type: 'single_choice', title: 'P', options: opts(3), prefillKey: 'p' },
        { id: 'y', type: 'yes_no', title: 'Y', prefillKey: 'y' },
        { id: 'zz', type: 'short_text', title: 'ZZ' },
        T,
      ],
    });
    const realNow = Date.now;
    let offset = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => realNow() + offset);
    const user = userEvent.setup();
    const onQuestionChange = vi.fn();
    render(
      <Form
        schema={schema}
        prefill={{ p: 'o2', y: 'yes' }}
        onSubmit={vi.fn()}
        onQuestionChange={onQuestionChange}
      />,
    );
    await user.click(screen.getByRole('button', { name: /^start/i }));
    await screen.findByRole('heading', { name: 'P' });
    expect(screen.getByRole('radio', { name: /option 2/i })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('button', { name: /ok/i })).toBeInTheDocument();
    // Straight away, Enter is the double Enter from the screen before: ignored.
    fireEvent.keyDown(document.body, { key: 'Enter' });
    expect(screen.getByRole('heading', { name: 'P' })).toBeInTheDocument();
    offset += 1000;
    fireEvent.keyDown(document.body, { key: 'Enter' });
    expect(await screen.findByRole('heading', { name: 'Y' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /ok/i })).toBeInTheDocument();
    offset += 1000;
    fireEvent.keyDown(document.body, { key: 'Enter' });
    expect(await screen.findByRole('heading', { name: 'ZZ' })).toBeInTheDocument();
    expect(onQuestionChange.mock.calls.at(-1)![1]).toEqual({ p: 'o2', y: 'yes' });
  });
});

describe('a prefilled link saves nothing for Resume until something is done (bug 11)', () => {
  it('no "Pick up where you left off?" after a reload at the welcome', async () => {
    const schema = defineSchema({
      ...base,
      id: 'prefillform',
      questions: [W, { id: 'name', type: 'short_text', title: 'Name', prefillKey: 'name' }, T],
    });
    const user = userEvent.setup();
    render(<Form schema={schema} resume="tab" prefill={{ name: 'Ada' }} onSubmit={vi.fn()} />);
    await screen.findByRole('heading', { name: 'Welcome' });
    expect(window.sessionStorage.getItem('slate-forms-resume:prefillform')).toBeNull();
    await user.click(screen.getByRole('button', { name: /^start/i }));
    await screen.findByRole('heading', { name: 'Name' });
    await waitFor(() =>
      expect(window.sessionStorage.getItem('slate-forms-resume:prefillform')).not.toBeNull(),
    );
  });
});

describe('Enter on a focused button is that button’s own (bug 1)', () => {
  it('does not confirm the question or start the form over it', async () => {
    const schema = defineSchema({
      ...base,
      questions: [
        W,
        { id: 'a', type: 'short_text', title: 'A', required: true },
        { id: 'b', type: 'short_text', title: 'B' },
        T,
      ],
    });
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<Form schema={schema} onSubmit={onSubmit} />);
    await user.click(screen.getByRole('button', { name: /^start/i }));
    await user.type(await screen.findByRole('textbox'), 'one{Enter}');
    await screen.findByRole('heading', { name: 'B' });
    const back = screen.getByRole('button', { name: /back/i });
    back.focus();
    // In a browser the button's own click follows this keydown; the form must not act on it.
    fireEvent.keyDown(back, { key: 'Enter' });
    expect(screen.getByRole('heading', { name: 'B' })).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe('website check (bug 5)', () => {
  const q = { id: 'u', type: 'url', title: 'Site?' } as Question;
  it('takes a query or fragment right after the host, an IP address and an accented host', () => {
    for (const ok of [
      'https://instagram.com?igsh=abc',
      'example.com#top',
      'http://192.168.0.1',
      'münchen.de',
      'https://shop.example.co.uk:8443/a/b?c=d#e',
    ]) {
      expect(validate(q, ok), ok).toBeNull();
    }
    for (const bad of ['not a url', 'example', 'http://', 'a b.com']) {
      expect(validate(q, bad)?.code, bad).toBe('url');
    }
  });
});

describe('right-to-left text (bug 16)', () => {
  it('titles, typed answers and review rows follow their own direction', () => {
    const css = readFileSync(join(process.cwd(), 'src/styles/base.css'), 'utf8');
    const rule = css.match(/([^{}]*\.slate-title,[^{]*)\{\s*unicode-bidi: plaintext;\s*\}/);
    expect(rule, 'a unicode-bidi: plaintext rule on .slate-title').not.toBeNull();
    for (const sel of ['.slate-subtitle', '.slate-input', '.slate-review-q', '.slate-review-a']) {
      expect(rule![1]).toContain(sel);
    }
  });
});
