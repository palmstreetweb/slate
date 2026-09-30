/** Prefill from the page link (ADR-063): coercion, guards, and <Form prefill>. */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Form, defineSchema } from '@/index.js';
import {
  PREFILL_VALUE_MAX,
  RESERVED_LINK_PARAMS,
  canPrefill,
  isValidPrefillKey,
  prefillAnswers,
} from '@/logic/prefill.js';
import type { Question } from '@/types/Question.js';

const Q: Question[] = [
  { id: 'name', type: 'short_text', title: 'Name', prefillKey: 'name' },
  { id: 'email', type: 'email', title: 'Email', prefillKey: 'email' },
  { id: 'rooms', type: 'number', title: 'Rooms', prefillKey: 'rooms', min: 1, max: 20 },
  { id: 'when', type: 'date', title: 'When', prefillKey: 'when' },
  {
    id: 'svc',
    type: 'single_choice',
    title: 'Service',
    prefillKey: 'service',
    options: [
      { label: 'Roof repair', value: 'repair' },
      { label: 'New roof', value: 'new' },
    ],
  },
  {
    id: 'extras',
    type: 'multi_choice',
    title: 'Extras',
    prefillKey: 'extras',
    allowOther: true,
    options: [
      { label: 'Gutters', value: 'gutters' },
      { label: 'Skylight', value: 'skylight' },
    ],
  },
  { id: 'ok', type: 'yes_no', title: 'Ok?', prefillKey: 'ok' },
  { id: 'rate', type: 'scale', title: 'Rate', min: 1, max: 5, prefillKey: 'rate' },
  { id: 'terms', type: 'legal', title: 'Terms', prefillKey: 'terms' } as Question,
  { id: 'plain', type: 'short_text', title: 'Not prefillable' },
];

describe('prefillAnswers', () => {
  it('fills only questions with a matching key, coerced to their shape', () => {
    expect(
      prefillAnswers(Q, {
        name: '  Jane  ',
        email: 'jane@example.com',
        rooms: '3',
        when: '2026-10-03',
        service: 'New roof',
        extras: 'gutters, Solar panels',
        ok: 'yes',
        rate: '4',
        plain: 'ignored',
      }),
    ).toEqual({
      name: 'Jane',
      email: 'jane@example.com',
      rooms: 3,
      when: '2026-10-03',
      svc: 'new',
      extras: ['gutters', 'Solar panels'],
      ok: 'yes',
      rate: 4,
    });
  });

  it('ignores values that fail the question (never blocks the form)', () => {
    expect(
      prefillAnswers(Q, {
        email: 'not-an-email',
        rooms: '99',
        when: '2026-02-30',
        service: 'Gutter cleaning',
        ok: 'maybe',
        rate: '9',
      }),
    ).toEqual({});
    expect(prefillAnswers(Q, { rooms: '3 rooms' })).toEqual({});
  });

  it('never prefills consent, files, rankings or grids', () => {
    expect(prefillAnswers(Q, { terms: 'accept' })).toEqual({});
    expect(canPrefill({ id: 'f', type: 'file_upload', title: 'F' })).toBe(false);
    expect(canPrefill({ id: 'r', type: 'ranking', title: 'R', options: [] })).toBe(false);
    expect(canPrefill({ id: 'm', type: 'matrix', title: 'M', rows: [], columns: [] })).toBe(false);
  });

  it('refuses reserved and malformed keys', () => {
    for (const key of RESERVED_LINK_PARAMS) expect(isValidPrefillKey(key)).toBe(false);
    expect(isValidPrefillKey('UTM_SOURCE')).toBe(false);
    expect(isValidPrefillKey('first name')).toBe(false);
    expect(isValidPrefillKey('first_name')).toBe(true);
    expect(isValidPrefillKey('x'.repeat(41))).toBe(false);
    const q: Question[] = [{ id: 'a', type: 'short_text', title: 'A', prefillKey: 'src' }];
    expect(prefillAnswers(q, { src: 'mailbox-flyer' })).toEqual({});
  });

  it('caps values and skips blanks and inherited keys', () => {
    const q: Question[] = [{ id: 'a', type: 'long_text', title: 'A', prefillKey: 'note' }];
    expect((prefillAnswers(q, { note: 'x'.repeat(2000) }).a as string).length).toBe(
      PREFILL_VALUE_MAX,
    );
    expect(prefillAnswers(q, { note: '   ' })).toEqual({});
    const proto = Object.create({ note: 'from prototype' }) as Record<string, string>;
    expect(prefillAnswers(q, proto)).toEqual({});
    expect(prefillAnswers(q, undefined)).toEqual({});
  });

  it('single choice without Other refuses unknown text; with Other keeps it', () => {
    const single: Question = {
      id: 's',
      type: 'single_choice',
      title: 'S',
      prefillKey: 's',
      options: [{ label: 'A', value: 'a' }],
    };
    expect(prefillAnswers([single], { s: 'Zed' })).toEqual({});
    expect(prefillAnswers([{ ...single, allowOther: true } as Question], { s: 'Zed' })).toEqual({
      s: 'Zed',
    });
  });
});

describe('<Form prefill>', () => {
  const schema = defineSchema({
    brand: { name: 'Roofs' },
    theme: 'classic',
    themeMode: 'light',
    questions: [
      { id: 'name', type: 'short_text', title: 'Your name?', prefillKey: 'name', required: true },
      { id: 'done', type: 'thanks', title: 'Thanks!' },
    ],
  });

  it('shows the prefilled answer, which the respondent can keep or change', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<Form schema={schema} onSubmit={onSubmit} prefill={{ name: 'Jane' }} />);
    const box = screen.getByRole('textbox');
    expect(box).toHaveValue('Jane');
    await user.clear(box);
    await user.type(box, 'Janet{Enter}');
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]![0]).toEqual({ name: 'Janet' });
  });

  it('keeps the prefilled answer on submit', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<Form schema={schema} onSubmit={onSubmit} prefill={{ name: 'Jane' }} />);
    await user.click(screen.getByRole('button', { name: /ok/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]![0]).toEqual({ name: 'Jane' });
  });
});
