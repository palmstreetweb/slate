/**
 * Wave B field UIs (ADR-064), rendered through QuestionRenderer (so the
 * on-demand load and the shared prop contract are covered) and end to end
 * through <Form>: the contact block, the address, the signature pad, package
 * cards, and the estimate reveal on the Thank You screen.
 */

import { beforeAll, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef } from 'react';
import { Form, defineSchema } from '@/index.js';
import type { Estimate, Question, SubmitMeta } from '@/index.js';
import { QuestionRenderer } from '@/components/questions/QuestionRenderer.js';
import { FormConfirmRefContext } from '@/hooks/useRegisterFormConfirm.js';
import { OUT_OF_AREA_VALUE } from '@/logic/address.js';
import { parseSignaturePath } from '@/logic/signature.js';
import type { LooseAnswers } from '@/types/Answers.js';

// jsdom has no 2D canvas; the pad paints nothing there (and says so without this).
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
});

function Harness(props: {
  question: Question;
  answers: LooseAnswers;
  setAnswer: (id: string, value: unknown) => void;
  advance: () => void;
  estimate?: Estimate | null;
  submitStatus?: 'idle' | 'success';
}) {
  const confirmRef = useRef<(() => void) | null>(null);
  return (
    <FormConfirmRefContext.Provider value={confirmRef}>
      <div data-slate-forms="" data-theme-name="classic" data-theme="light">
        <QuestionRenderer
          question={props.question}
          answers={props.answers}
          setAnswer={props.setAnswer}
          advance={props.advance}
          stepNumber={1}
          totalSteps={2}
          submitStatus={props.submitStatus ?? 'idle'}
          submitError={null}
          onRetrySubmit={vi.fn()}
          onRestart={vi.fn()}
          estimate={props.estimate}
          estimateSettings={{ breakdown: true, disclaimer: 'Final price after inspection' }}
        />
      </div>
    </FormConfirmRefContext.Provider>
  );
}

function renderField(
  question: Question,
  answers: LooseAnswers = {},
  extra: Partial<Parameters<typeof Harness>[0]> = {},
) {
  const setAnswer = vi.fn<(id: string, value: unknown) => void>();
  const advance = vi.fn<() => void>();
  const utils = render(
    <Harness
      question={question}
      answers={answers}
      setAnswer={setAnswer}
      advance={advance}
      {...extra}
    />,
  );
  return { ...utils, setAnswer, advance };
}

/* ---------- contact block ---------- */

describe('contact block', () => {
  const q: Question = { id: 'who', type: 'contact_info', title: 'How can we reach you?' };

  it('uses the autofill tokens, input types and keyboards iOS needs, inside a form', async () => {
    const { container } = renderField(q);
    const name = await screen.findByRole('textbox', { name: /^name/i });
    const email = screen.getByRole('textbox', { name: /^email/i });
    const phone = screen.getByRole('textbox', { name: /^phone/i });
    expect(name).toHaveAttribute('autocomplete', 'name');
    expect(name).toHaveAttribute('type', 'text');
    expect(email).toHaveAttribute('autocomplete', 'email');
    expect(email).toHaveAttribute('type', 'email');
    expect(email).toHaveAttribute('inputmode', 'email');
    expect(phone).toHaveAttribute('autocomplete', 'tel');
    expect(phone).toHaveAttribute('type', 'tel');
    expect(phone).toHaveAttribute('inputmode', 'tel');
    expect(container.querySelector('form')).toContainElement(name);
    expect(screen.getByText('(optional)')).toBeInTheDocument();
  });

  it('shows a message per missing part and stores nothing', async () => {
    const { setAnswer, advance } = renderField(q);
    await screen.findByRole('textbox', { name: /^name/i });
    fireEvent.click(screen.getByRole('button', { name: /ok/i }));
    expect(await screen.findByText(/please add your name/i)).toBeInTheDocument();
    expect(screen.getByText(/please add your email/i)).toBeInTheDocument();
    expect(setAnswer).not.toHaveBeenCalled();
    expect(advance).not.toHaveBeenCalled();
  });

  it('Enter moves to the next part, then submits trimmed parts with the phone as E.164', async () => {
    const user = userEvent.setup();
    const { setAnswer, advance } = renderField(q);
    const name = await screen.findByRole('textbox', { name: /^name/i });
    await user.type(name, '  Ada Lovelace {Enter}');
    expect(screen.getByRole('textbox', { name: /^email/i })).toHaveFocus();
    await user.keyboard('ada@example.com{Enter}');
    await user.keyboard('(805) 555-0100{Enter}');
    await waitFor(() => expect(advance).toHaveBeenCalledTimes(1));
    expect(setAnswer).toHaveBeenCalledWith('who', {
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      phone: '+18055550100',
    });
  });

  it('turned-off parts are not asked; an all-optional blank block stores nothing', async () => {
    const { setAnswer, advance } = renderField({
      ...q,
      fields: { name: 'optional', email: 'optional', phone: 'off' },
    } as Question);
    await screen.findByRole('textbox', { name: /^name/i });
    expect(screen.queryByRole('textbox', { name: /^phone/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /ok/i }));
    await waitFor(() => expect(advance).toHaveBeenCalled());
    expect(setAnswer).toHaveBeenCalledWith('who', undefined);
  });

  it('a phone that does not parse is refused', async () => {
    const user = userEvent.setup();
    const { advance } = renderField({ ...q, fields: { phone: 'required' } } as Question);
    await user.type(await screen.findByRole('textbox', { name: /^name/i }), 'Ada');
    await user.type(screen.getByRole('textbox', { name: /^email/i }), 'a@b.co');
    await user.type(screen.getByRole('textbox', { name: /^phone/i }), '1234567');
    fireEvent.click(screen.getByRole('button', { name: /ok/i }));
    expect(await screen.findByText(/doesn't look like a phone number/i)).toBeInTheDocument();
    expect(advance).not.toHaveBeenCalled();
  });
});

/* ---------- address ---------- */

describe('address', () => {
  const q: Question = { id: 'addr', type: 'address', title: 'Where’s the job?', required: true };

  it('uses the standard autofill tokens (line1 + line2 with a unit line)', async () => {
    renderField(q);
    const street = await screen.findByRole('textbox', { name: /street address/i });
    expect(street).toHaveAttribute('autocomplete', 'address-line1');
    expect(screen.getByRole('textbox', { name: /apt, suite or unit/i })).toHaveAttribute(
      'autocomplete',
      'address-line2',
    );
    expect(screen.getByRole('textbox', { name: /^city/i })).toHaveAttribute(
      'autocomplete',
      'address-level2',
    );
    expect(screen.getByRole('textbox', { name: /^state/i })).toHaveAttribute(
      'autocomplete',
      'address-level1',
    );
    const zip = screen.getByRole('textbox', { name: /zip code/i });
    expect(zip).toHaveAttribute('autocomplete', 'postal-code');
    expect(zip).toHaveAttribute('inputmode', 'numeric');
    expect(screen.queryByRole('textbox', { name: /country/i })).toBeNull();
  });

  it('without the unit line the street is one street-address line; a country uses country-name', async () => {
    renderField({ ...q, line2: false, country: true, format: 'international' } as Question);
    expect(await screen.findByRole('textbox', { name: /street address/i })).toHaveAttribute(
      'autocomplete',
      'street-address',
    );
    expect(screen.getByRole('textbox', { name: /country/i })).toHaveAttribute(
      'autocomplete',
      'country-name',
    );
    expect(screen.getByRole('textbox', { name: /postal code/i })).toHaveAttribute(
      'inputmode',
      'text',
    );
  });

  it('refuses an incomplete address part by part, then stores only the filled parts', async () => {
    const user = userEvent.setup();
    const { setAnswer, advance } = renderField(q);
    const street = await screen.findByRole('textbox', { name: /street address/i });
    fireEvent.click(screen.getByRole('button', { name: /ok/i }));
    expect(await screen.findByText(/add the street address/i)).toBeInTheDocument();
    await user.type(street, '12 Palm St');
    await user.type(screen.getByRole('textbox', { name: /^city/i }), 'Santa Barbara');
    await user.type(screen.getByRole('textbox', { name: /^state/i }), 'CA');
    await user.type(screen.getByRole('textbox', { name: /zip code/i }), '931');
    fireEvent.click(screen.getByRole('button', { name: /ok/i }));
    expect(await screen.findByText(/zip codes are 5 digits/i)).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: /zip code/i }), '01{Enter}');
    await waitFor(() => expect(advance).toHaveBeenCalledTimes(1));
    expect(setAnswer).toHaveBeenCalledWith('addr', {
      street: '12 Palm St',
      city: 'Santa Barbara',
      region: 'CA',
      postal: '93101',
    });
  });
});

/* ---------- signature ---------- */

function fakeRect(canvas: HTMLElement) {
  canvas.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 500, height: 200, right: 500, bottom: 200, x: 0, y: 0 }) as DOMRect;
}

function draw(canvas: HTMLElement, points: Array<[number, number]>) {
  const [first, ...rest] = points;
  fireEvent.pointerDown(canvas, {
    pointerId: 1,
    button: 0,
    clientX: first![0],
    clientY: first![1],
  });
  for (const [x, y] of rest)
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: x, clientY: y });
  fireEvent.pointerUp(canvas, { pointerId: 1 });
}

describe('signature', () => {
  const q: Question = { id: 'sig', type: 'signature', title: 'Sign to approve', required: true };

  it('is a labelled pad with Clear and a typed-name option', async () => {
    renderField({ ...q, body: 'I approve the estimate.' } as Question);
    const canvas = await screen.findByRole('img', { name: /signature pad, empty/i });
    expect(canvas.tagName).toBe('CANVAS');
    expect(screen.getByText('I approve the estimate.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /type your name instead/i })).toBeInTheDocument();
  });

  it('required: an empty pad or a dot is refused; a real stroke is stored as a path', async () => {
    const { setAnswer, advance } = renderField(q);
    const canvas = await screen.findByRole('img', { name: /signature pad/i });
    fakeRect(canvas);
    fireEvent.click(screen.getByRole('button', { name: /ok/i }));
    expect(await screen.findByText('! Please sign here')).toBeInTheDocument();

    draw(canvas, [[100, 100]]);
    fireEvent.click(screen.getByRole('button', { name: /ok/i }));
    expect(await screen.findByText(/full stroke, not a dot/i)).toBeInTheDocument();
    expect(advance).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Clear' })).toBeDisabled());
    draw(canvas, [
      [40, 150],
      [90, 60],
      [140, 150],
      [190, 60],
      [240, 150],
    ]);
    expect(screen.getByRole('img', { name: 'Your signature' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /ok/i }));
    expect(advance).toHaveBeenCalledTimes(1);
    const stored = setAnswer.mock.calls.at(-1)![1] as { path: string };
    expect(parseSignaturePath(stored.path)).toEqual([
      [
        [40, 150],
        [90, 60],
        [140, 150],
        [190, 60],
        [240, 150],
      ],
    ]);
  });

  it('keyboard users can type their name instead, with name autofill', async () => {
    const user = userEvent.setup();
    const { setAnswer, advance } = renderField(q);
    await user.click(await screen.findByRole('button', { name: /type your name instead/i }));
    const input = screen.getByRole('textbox', { name: /type your full name/i });
    expect(input).toHaveAttribute('autocomplete', 'name');
    await user.type(input, 'Ada Lovelace{Enter}');
    expect(setAnswer).toHaveBeenCalledWith('sig', { typed: 'Ada Lovelace' });
    expect(advance).toHaveBeenCalledTimes(1);
  });

  it('owners can turn typing off; a stored drawing comes back on Back', async () => {
    renderField({ ...q, allowTyped: false } as Question, {
      sig: { path: 'M40 150l50 -90 50 90' },
    });
    expect(await screen.findByRole('img', { name: 'Your signature' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /type your name/i })).toBeNull();
    expect(screen.getByRole('button', { name: 'Clear' })).toBeEnabled();
  });
});

/* ---------- package cards ---------- */

const packages: Question = {
  id: 'plan',
  type: 'single_choice',
  title: 'Pick a package',
  display: 'cards',
  options: [
    { label: 'Basic', value: 'basic', price: 2400, features: ['Patch and seal'] },
    {
      label: 'Standard',
      value: 'standard',
      price: 5200,
      priceMax: 6100,
      badge: 'Most popular',
      description: 'For most homes',
      features: ['New underlayment', '10-year warranty'],
    },
    { label: 'Premium', value: 'premium', price: 9800 },
  ],
};

describe('package cards', () => {
  it('draws a card per option with its price, features and badge', async () => {
    const { container } = renderField(packages);
    const cards = await screen.findAllByRole('radio');
    expect(cards).toHaveLength(3);
    expect(cards[1]).toHaveAccessibleName('Standard, $5,200 – $6,100, Most popular');
    expect(cards[1]).toHaveAccessibleDescription(
      'For most homes New underlayment 10-year warranty',
    );
    expect(within(cards[0]!).getByText('$2,400')).toBeInTheDocument();
    expect(container.querySelector('.slate-pkg-badge')).toHaveTextContent('Most popular');
    expect(container.querySelector('.slate-pkgs')).not.toBeNull();
  });

  it('a tap commits and auto-advances, like the list', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { setAnswer, advance } = renderField(packages);
      const cards = await screen.findAllByRole('radio');
      fireEvent.click(cards[2]!);
      expect(setAnswer).toHaveBeenCalledWith('plan', 'premium');
      act(() => {
        vi.advanceTimersByTime(300);
      });
      expect(advance).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

/* ---------- the estimate, end to end ---------- */

describe('<Form> with an instant estimate', () => {
  const schema = defineSchema({
    brand: { name: 'Roofing' },
    theme: 'classic',
    themeMode: 'light',
    estimate: {
      base: 150,
      baseLabel: 'Service call',
      breakdown: true,
      disclaimer: 'Final price after inspection',
    },
    questions: [
      packages,
      {
        id: 'windows',
        type: 'number',
        title: 'Skylights?',
        display: 'stepper',
        min: 0,
        max: 10,
        unit: 'skylights',
        unitPrice: 300,
        unitPriceMax: 450,
      },
      { id: 'done', type: 'thanks', title: 'Thanks! Your quote: {{estimate}}', showEstimate: true },
    ] as Question[],
  });

  it('letter keys pick a card; the ending reveals the estimate once received and sends it in meta', async () => {
    const user = userEvent.setup();
    const onSubmit = vi
      .fn<(a: unknown, m: SubmitMeta) => Promise<void>>()
      .mockResolvedValue(undefined);
    render(<Form schema={schema} onSubmit={onSubmit} />);
    await screen.findAllByRole('radio');
    await user.keyboard('b');
    const input = await screen.findByRole('spinbutton');
    await user.clear(input);
    await user.type(input, '2{Enter}');
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const [answers, meta] = onSubmit.mock.calls[0]!;
    expect(answers).toEqual({ plan: 'standard', windows: 2 });
    expect(meta.estimate).toMatchObject({
      low: 150 + 5200 + 600,
      high: 150 + 6100 + 900,
      currency: 'USD',
    });
    expect(meta.estimate!.lines.map((l) => l.label)).toEqual([
      'Service call',
      'Standard',
      'Skylights',
    ]);
    // Piped into the title, and revealed under it with its breakdown and small print.
    expect(
      await screen.findByRole('heading', { name: 'Thanks! Your quote: $5,950 – $7,150' }),
    ).toBeInTheDocument();
    const reveal = await screen.findByRole('region', { name: 'Your estimate' });
    expect(within(reveal).getByText('$5,950 – $7,150')).toBeInTheDocument();
    expect(within(reveal).getByText('Final price after inspection')).toBeInTheDocument();
    expect(within(reveal).getAllByRole('listitem')).toHaveLength(3);
  });

  it('a form without prices sends no estimate', async () => {
    const onSubmit = vi
      .fn<(a: unknown, m: SubmitMeta) => Promise<void>>()
      .mockResolvedValue(undefined);
    render(
      <Form
        schema={defineSchema({
          brand: { name: 'x' },
          theme: 'classic',
          themeMode: 'light',
          questions: [
            { id: 'n', type: 'short_text', title: 'Name?' },
            { id: 'done', type: 'thanks', title: 'Thanks', showEstimate: true },
          ],
        })}
        onSubmit={onSubmit}
      />,
    );
    const input = await screen.findByRole('textbox');
    fireEvent.change(input, { target: { value: 'Ada' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]![1].estimate).toBeUndefined();
    expect(screen.queryByRole('region', { name: 'Your estimate' })).toBeNull();
  });
});

describe('<Form> service area', () => {
  it('an out-of-area address jumps to its own ending', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const outside = { field: 'addr', op: 'equals' as const, value: OUT_OF_AREA_VALUE };
    render(
      <Form
        schema={defineSchema({
          brand: { name: 'Pools' },
          theme: 'classic',
          themeMode: 'light',
          questions: [
            {
              id: 'addr',
              type: 'address',
              title: 'Where’s the pool?',
              required: true,
              line2: false,
              serviceArea: ['931'],
              logic: [{ if: outside, goTo: 'sorry' }],
            },
            { id: 'when', type: 'short_text', title: 'When works?' },
            {
              id: 'sorry',
              type: 'thanks',
              title: 'Sorry, we don’t serve that area yet.',
              visibleIf: outside,
            },
            { id: 'done', type: 'thanks', title: 'Thanks!' },
          ] as Question[],
        })}
        onSubmit={onSubmit}
      />,
    );
    await user.type(await screen.findByRole('textbox', { name: /street address/i }), '1 Main St');
    await user.type(screen.getByRole('textbox', { name: /^city/i }), 'Fresno');
    await user.type(screen.getByRole('textbox', { name: /^state/i }), 'CA');
    await user.type(screen.getByRole('textbox', { name: /zip code/i }), '93701{Enter}');
    expect(
      await screen.findByRole('heading', { name: 'Sorry, we don’t serve that area yet.' }),
    ).toBeInTheDocument();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    // The jump skipped the rest of the form.
    expect(onSubmit.mock.calls[0]![1].questionsVisited).not.toContain('when');
    expect(onSubmit.mock.calls[0]![0]).toEqual({
      addr: { street: '1 Main St', city: 'Fresno', region: 'CA', postal: '93701' },
    });
  });
});

describe('the estimate reveal', () => {
  const estimate: Estimate = {
    low: 2400,
    high: 3100,
    currency: 'USD',
    lines: [
      { id: '_base', label: 'Service call', low: 150, high: 150 },
      { id: 'w', label: 'Windows', qty: 3, low: 2250, high: 2950 },
    ],
  };

  it('waits for the confirmation, then shows the range, lines and small print', async () => {
    const thanks: Question = { id: 'done', type: 'thanks', title: 'Thanks', showEstimate: true };
    const { rerender } = renderField(thanks, {}, { estimate, submitStatus: 'idle' });
    expect(screen.queryByText(/your estimate/i)).toBeNull();
    rerender(
      <Harness
        question={thanks}
        answers={{}}
        setAnswer={vi.fn()}
        advance={vi.fn()}
        estimate={estimate}
        submitStatus="success"
      />,
    );
    const reveal = await screen.findByRole('region', { name: 'Your estimate' });
    expect(within(reveal).getByText('$2,400 – $3,100')).toBeInTheDocument();
    expect(within(reveal).getByText('Windows')).toBeInTheDocument();
    expect(within(reveal).getByText('× 3')).toBeInTheDocument();
    expect(within(reveal).getByText('$2,250 – $2,950')).toBeInTheDocument();
  });

  it('an ending without showEstimate never shows it', () => {
    renderField(
      { id: 'done', type: 'thanks', title: 'Thanks' },
      {},
      { estimate, submitStatus: 'success' },
    );
    expect(screen.queryByText(/your estimate/i)).toBeNull();
  });
});
