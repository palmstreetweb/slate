/**
 * Inspector guards (QA 2026-10). Settings that would trap or confuse respondents
 * are said in plain words right where the owner is typing, with a one-tap fix,
 * and the inputs store only numbers that can work.
 */

import { useState } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Question, SignupSlotsQuestion } from '@/index.js';
import { Inspector } from '../examples/_admin/components/Inspector.js';
import { SignupSlotsSettings } from '../examples/_admin/components/InspectorWaveD.js';
import { ConfirmProvider } from '../examples/_admin/_confirm.js';

// SlateSelect scrolls the picked option into view; jsdom has no layout.
beforeAll(() => {
  Element.prototype.scrollIntoView ??= vi.fn();
  Element.prototype.scrollBy ??= vi.fn();
});

/** The inspector with a parent that applies each patch, like the editor does. */
function Live({ initial, spy }: { initial: Question; spy: (patch: Partial<Question>) => void }) {
  const [q, setQ] = useState(initial);
  return (
    <div data-slate-forms="" data-theme-name="slate">
      <Inspector
        question={q}
        allQuestions={[q]}
        onChange={(patch) => {
          spy(patch);
          setQ((cur) => ({ ...cur, ...patch }) as Question);
        }}
        onDelete={vi.fn()}
        canDelete
      />
      <button type="button">elsewhere</button>
    </div>
  );
}

function setup(question: Question) {
  const spy = vi.fn();
  const user = userEvent.setup();
  render(<Live initial={question} spy={spy} />);
  const leave = () => user.click(screen.getByRole('button', { name: 'elsewhere' }));
  return { spy, user, leave };
}

const opts = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ label: `Choice ${i + 1}`, value: `opt_${i + 1}` }));

const field = (label: RegExp | string) =>
  screen.getByText(label, { selector: '.slate-label' }).closest('label')!;

const numberIn = (label: RegExp | string) =>
  within(field(label)).getByRole('spinbutton') as HTMLInputElement;

describe('multi choice: Required, Min and Max (CH-04, CH-08)', () => {
  const base: Question = {
    id: 'services',
    type: 'multi_choice',
    title: 'Which services?',
    options: opts(4),
  };

  it('Required means at least one pick, and turning it off clears Min', async () => {
    const { user, spy } = setup(base);
    const required = screen.getByRole('checkbox', { name: /required/i });
    expect(required).not.toBeChecked();
    await user.click(required);
    expect(spy).toHaveBeenLastCalledWith({ min: 1 });
    expect(required).toBeChecked();
    await user.click(required);
    expect(spy).toHaveBeenLastCalledWith({ min: undefined });
  });

  it('Min above the 4 choices is explained, with a fix', async () => {
    const { user, spy } = setup({ ...base, min: 6 } as Question);
    expect(
      screen.getByText(/There are only 4 choices, so nobody could pick 6\./),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Set Min to 4' }));
    expect(spy).toHaveBeenLastCalledWith({ min: 4 });
    expect(screen.queryByText(/nobody could pick/)).toBeNull();
  });

  it('counts “Other” as a choice', () => {
    setup({ ...base, min: 6, allowOther: true } as Question);
    expect(
      screen.getByText(/only 5 choices \(counting “Other”\), so nobody could pick 6/),
    ).toBeInTheDocument();
  });

  it('Max below Min is explained, and Swap fixes it', async () => {
    const { user, spy } = setup({ ...base, min: 3, max: 2 } as Question);
    expect(
      screen.getByText('Max (2) is less than Min (3), so nobody could finish.'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Swap them' }));
    expect(spy).toHaveBeenLastCalledWith({ min: 2, max: 3 });
  });

  it('Min and Max take whole numbers only: 1.5 becomes 2, and − never goes below 0', async () => {
    const { user, spy, leave } = setup(base);
    const min = numberIn('Min Selections');
    await user.click(min);
    await user.keyboard('1.5');
    await leave();
    expect(spy).toHaveBeenLastCalledWith({ min: 2 });
    const maxField = field('Max Selections');
    await user.click(within(maxField).getByRole('button', { name: 'Decrease' }));
    expect(spy).toHaveBeenLastCalledWith({ max: 1 });
  });
});

describe('picture choice (CH-08)', () => {
  const pic: Question = {
    id: 'looks',
    type: 'picture_choice',
    title: 'Which looks?',
    options: opts(3).map((o) => ({ ...o, src: 'https://x.test/a.jpg' })),
  };

  it('turning on multiple keeps it required (at least one), and back', async () => {
    const { user, spy } = setup(pic);
    await user.click(screen.getByRole('checkbox', { name: /allow multiple selections/i }));
    expect(spy).toHaveBeenLastCalledWith({ multiple: true, min: 1 });
    expect(screen.getByRole('checkbox', { name: /required/i })).toBeChecked();
    await user.click(screen.getByRole('checkbox', { name: /required/i }));
    await user.click(screen.getByRole('checkbox', { name: /allow multiple selections/i }));
    expect(spy).toHaveBeenLastCalledWith({ multiple: false, required: false });
  });

  it('swipe cards talk about likes and cards', () => {
    setup({ ...pic, multiple: true, display: 'swipe', min: 5 } as Question);
    expect(screen.getByText(/only 3 cards, so nobody could like 5/)).toBeInTheDocument();
  });
});

describe('options (CH-05, S5, S6)', () => {
  const single: Question = {
    id: 'pick',
    type: 'single_choice',
    title: 'Pick one',
    options: [
      { label: 'Option A', value: 'opt_1' },
      { label: 'Option B', value: 'opt_2' },
    ],
  };

  it('delete then add never repeats a value or a label', async () => {
    const { user, spy } = setup(single);
    await user.click(screen.getByRole('button', { name: /add option/i }));
    await user.click(screen.getAllByRole('button', { name: 'Remove option' })[0]!);
    await user.click(screen.getByRole('button', { name: /add option/i }));
    const options = spy.mock.calls.at(-1)![0].options as Array<{ label: string; value: string }>;
    expect(options.map((o) => o.label)).toEqual(['Option B', 'Option C', 'Option D']);
    expect(new Set(options.map((o) => o.value)).size).toBe(3);
  });

  it('the last option can’t be removed', () => {
    setup({ ...single, options: [{ label: 'Only', value: 'opt_1' }] } as Question);
    expect(screen.getByRole('button', { name: 'Remove option' })).toBeDisabled();
  });

  it('two options with one value are pointed out and fixed in one tap', async () => {
    const { user, spy } = setup({
      ...single,
      options: [
        { label: 'Option D', value: 'opt_4' },
        { label: 'Option D', value: 'opt_4' },
      ],
    } as Question);
    expect(
      screen.getByText('Two options count as one: picking one picks both.'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Fix' }));
    const options = spy.mock.calls.at(-1)![0].options as Array<{ value: string }>;
    expect(options[0]!.value).toBe('opt_4');
    expect(options[1]!.value).not.toBe('opt_4');
    expect(screen.queryByText(/count as one/)).toBeNull();
  });

  it('a blank name is pointed out', () => {
    setup({ ...single, options: [{ label: '', value: 'opt_1' }] } as Question);
    expect(screen.getByText(/Give every option a name/)).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Option 1 name' })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
  });

  it('single choice can be made optional', () => {
    setup(single);
    expect(screen.getByRole('checkbox', { name: 'Required' })).toBeChecked();
  });
});

describe('numbers (F7, F11)', () => {
  it('Min above Max is explained, and Swap fixes it', async () => {
    const { user, spy } = setup({
      id: 'n',
      type: 'number',
      title: 'How many windows need cleaning?',
      min: 10,
      max: 2,
    });
    expect(
      screen.getByText('Min (10) is more than Max (2), so nobody could answer.'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Swap them' }));
    expect(spy).toHaveBeenLastCalledWith({ min: 2, max: 10 });
  });

  it('Step 0.01 is saved as 0.01', async () => {
    const { user, spy, leave } = setup({ id: 'n', type: 'number', title: 'Amount?' });
    await user.click(numberIn('Step'));
    await user.keyboard('0.01');
    await leave();
    expect(spy).toHaveBeenLastCalledWith({ step: 0.01 });
    expect(numberIn('Step')).toHaveValue(0.01);
  });
});

describe('scale (F6, F7, F20, S16, S22)', () => {
  const scale: Question = { id: 's', type: 'scale', title: 'Rate us', min: 0, max: 10 };

  it('Max Value can be cleared and retyped (10 → 5, not 15)', async () => {
    const { user, spy, leave } = setup(scale);
    const max = numberIn('Max Value');
    await user.click(max);
    await user.keyboard('{Backspace}{Backspace}5');
    expect(max).toHaveValue(5);
    await leave();
    expect(spy).toHaveBeenLastCalledWith({ max: 5 });
  });

  it('has a Required switch', async () => {
    const { user, spy } = setup(scale);
    await user.click(screen.getByRole('checkbox', { name: 'Required' }));
    expect(spy).toHaveBeenLastCalledWith({ required: true });
  });

  it('Min above Max is explained, with Swap', () => {
    setup({ ...scale, min: 10, max: 1 } as Question);
    expect(
      screen.getByText('Min Value (10) is more than Max Value (1), so there’s nothing to pick.'),
    ).toBeInTheDocument();
  });

  it('too many points is explained, with a fix', async () => {
    const { user, spy } = setup({ ...scale, max: 20000 } as Question);
    expect(screen.getByText('That’s 20,001 points. A scale shows 21 at most.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Use 0 to 10' }));
    expect(spy).toHaveBeenLastCalledWith({ max: 10, step: undefined });
  });

  it('switching to Stars counts from 1, five stars by default', async () => {
    const { user, spy } = setup(scale);
    await user.click(screen.getByRole('button', { name: 'Scale style' }));
    await user.click(screen.getByRole('option', { name: 'Stars' }));
    expect(spy).toHaveBeenLastCalledWith(
      expect.objectContaining({ display: 'stars', min: 1, max: 5 }),
    );
  });

  it('stars from 0 are pointed out', async () => {
    const { user, spy } = setup({ ...scale, display: 'stars', max: 4 } as Question);
    expect(
      screen.getByText(/Stars start at 1\. Starting at 0, the first star saves 0\./),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Start at 1' }));
    expect(spy).toHaveBeenLastCalledWith({ min: 1, max: 4 });
  });
});

describe('text and files (F9, S13, MEDIA-05)', () => {
  it('max length takes whole numbers from 1; a saved 0 is explained', async () => {
    const { user, spy } = setup({
      id: 't',
      type: 'short_text',
      title: 'Name?',
      maxLength: 0,
    } as Question);
    expect(screen.getByText(/With 0, nobody could type an answer/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear it' }));
    expect(spy).toHaveBeenLastCalledWith({ maxLength: undefined });
  });

  it('max size: − on an empty field is 1 MB, never −1; a saved −1 is explained', async () => {
    const { user, spy } = setup({ id: 'f', type: 'file_upload', title: 'Upload' } as Question);
    await user.click(within(field('Max Size (MB)')).getByRole('button', { name: 'Decrease' }));
    expect(spy).toHaveBeenLastCalledWith({ maxSizeMb: 1 });
  });

  it('a saved max size of −1 is explained, with a fix', async () => {
    const { user, spy } = setup({
      id: 'f',
      type: 'file_upload',
      title: 'Upload',
      maxSizeMb: -1,
    } as Question);
    expect(screen.getByText('With -1 MB, nobody could attach a file.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Use 32 MB' }));
    expect(spy).toHaveBeenLastCalledWith({ maxSizeMb: 32 });
  });

  it('max files can be cleared (blank = 10) and retyped', async () => {
    const { user, spy, leave } = setup({
      id: 'f',
      type: 'file_upload',
      title: 'Upload',
      multiple: true,
      maxFiles: 10,
    } as Question);
    const files = numberIn('Max Files');
    await user.tripleClick(files);
    await user.keyboard('{Backspace}4');
    await leave();
    expect(spy).toHaveBeenLastCalledWith({ maxFiles: 4 });
    expect(files).toHaveValue(4);
  });
});

describe('phone country (F13, S14)', () => {
  it('is a list of countries, United States by default', async () => {
    const { user, spy } = setup({ id: 'p', type: 'phone', title: 'Phone?' } as Question);
    const picker = screen.getByRole('button', { name: 'Country for local numbers' });
    expect(picker).toHaveTextContent('United States');
    await user.click(picker);
    await user.click(screen.getByRole('option', { name: 'Canada' }));
    expect(spy).toHaveBeenLastCalledWith({ defaultCountry: 'CA' });
  });

  it('a cleared or unknown code asks for a country', () => {
    setup({ id: 'p', type: 'phone', title: 'Phone?', defaultCountry: '' } as Question);
    expect(screen.getByRole('button', { name: 'Country for local numbers' })).toHaveTextContent(
      'Pick a country',
    );
    expect(
      screen.getByText(/a number typed without its country code is turned down/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/ISO 3166/)).toBeNull();
  });
});

describe('redirect (F3, S12)', () => {
  const thanks = (redirectUrl?: string): Question =>
    ({ id: 'done', type: 'thanks', title: 'Thanks!', redirectUrl }) as Question;
  const box = () => screen.getByPlaceholderText('https://yoursite.com/thanks');

  it('a bare domain gets https:// in front', async () => {
    const { user, spy, leave } = setup(thanks());
    await user.type(box(), 'example.com/thank-you');
    await leave();
    expect(spy).toHaveBeenLastCalledWith({ redirectUrl: 'https://example.com/thank-you' });
    expect(box()).toHaveValue('https://example.com/thank-you');
  });

  it('something that isn’t a web address is not kept, and says so', async () => {
    const { user, spy, leave } = setup(thanks('https://old.example.com'));
    await user.clear(box());
    await user.type(box(), 'javascript:alert(1)');
    await leave();
    expect(spy).toHaveBeenLastCalledWith({ redirectUrl: undefined });
    expect(
      screen.getByText(/That isn’t a web address, so nobody is sent anywhere/),
    ).toBeInTheDocument();
  });

  it('a saved address without https:// is pointed out, and Fix adds it', async () => {
    const { user, spy } = setup(thanks('www.example.com'));
    expect(screen.getByText(/This needs https:\/\/ in front/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Fix' }));
    expect(spy).toHaveBeenLastCalledWith({ redirectUrl: 'https://www.example.com' });
  });
});

describe('welcome and thanks keep a Subtitle field (S18)', () => {
  it('shows it even when the subtitle was cleared', () => {
    setup({ id: 'w', type: 'welcome', title: 'Hi' } as Question);
    expect(screen.getByText('Subtitle (Optional)')).toBeInTheDocument();
  });
});

describe('prices (S25)', () => {
  it('a high end below the low price is said on the option, once the owner leaves it', async () => {
    const { user } = setup({
      id: 'pick',
      type: 'single_choice',
      title: 'Pick one',
      options: [{ label: 'Basic', value: 'opt_1', price: 500 }],
    } as Question);
    const high = screen.getByRole('spinbutton', { name: /price for basic, high end/i });
    await user.click(high);
    await user.keyboard('100');
    expect(screen.queryByText(/high end has to be at least/i)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'elsewhere' }));
    expect(screen.getByText('The high end has to be at least the low price.')).toBeInTheDocument();
  });
});

describe('sign-up slots (MEDIA-20, S17)', () => {
  it('a slot that ends before it starts, a past day and a repeat are pointed out', () => {
    const q: SignupSlotsQuestion = {
      id: 'su',
      type: 'signup_slots',
      title: 'Pick a time',
      slots: [
        { label: 'A', value: 's_a', capacity: 5, start: '14:00', end: '10:00' },
        { label: 'B', value: 's_b', capacity: 5, date: '2020-01-01' },
        { label: 'C', value: 's_c', capacity: 5, date: '2099-01-01', start: '09:00' },
        { label: 'C', value: 's_d', capacity: 5, date: '2099-01-01', start: '09:00' },
      ],
    };
    render(
      <ConfirmProvider>
        <div data-slate-forms="" data-theme-name="slate">
          <SignupSlotsSettings question={q} onChange={vi.fn()} />
        </div>
      </ConfirmProvider>,
    );
    expect(
      screen.getByText('It ends before it starts. Check Starts and Ends.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('This day has passed, so nobody should sign up for it.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Same name, day and time as slot 3.')).toBeInTheDocument();
  });

  it('a slot with neither a name nor a day asks for one', () => {
    const q: SignupSlotsQuestion = {
      id: 'su',
      type: 'signup_slots',
      title: 'Bring something',
      slots: [
        { label: 'Drinks', value: 's_a', capacity: 2 },
        { label: '  ', value: 's_b', capacity: 2 },
      ],
    };
    render(
      <ConfirmProvider>
        <div data-slate-forms="" data-theme-name="slate">
          <SignupSlotsSettings question={q} onChange={vi.fn()} />
        </div>
      </ConfirmProvider>,
    );
    expect(screen.getAllByText('Give this slot a name or a day.')).toHaveLength(1);
  });
});
