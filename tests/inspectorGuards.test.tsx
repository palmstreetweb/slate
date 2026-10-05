/**
 * Inspector guards (QA 2026-10). Settings that would trap or confuse respondents
 * are said in plain words right where the owner is typing, with a one-tap fix,
 * and the inputs store only numbers that can work.
 */

import { useState } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
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
  // A number field settles its draft a frame after the blur (S4: a focus handed straight back isn't leaving).
  const leave = async () => {
    await user.click(screen.getByRole('button', { name: 'elsewhere' }));
    await act(() => new Promise<void>((r) => requestAnimationFrame(() => r())));
  };
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
  it('Min above Max is explained as what happens, and Swap fixes it', async () => {
    const { user, spy } = setup({
      id: 'n',
      type: 'number',
      title: 'How many windows need cleaning?',
      min: 10,
      max: 2,
    });
    // The form ignores bounds set the wrong way round (ENG-11): nobody is stuck.
    expect(
      screen.getByText('Min (10) is more than Max (2), so neither limit is used.'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Swap them' }));
    expect(spy).toHaveBeenLastCalledWith({ min: 2, max: 10 });
  });

  it('a step of 0 says what the form does with it, with Use 1 (STU-3)', async () => {
    const { user, spy } = setup({ id: 'n', type: 'number', title: 'Amount?', step: 0 } as Question);
    expect(screen.getByText('A step of 0 can’t be used, so it counts by 1.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Use 1' }));
    expect(spy).toHaveBeenLastCalledWith({ step: undefined });
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

describe('date limits (STU-3)', () => {
  it('limits set the wrong way round can be fixed here, though the inspector has no fields for them', async () => {
    const { user, spy } = setup({
      id: 'd',
      type: 'date',
      title: 'When?',
      min: '2026-12-01',
      max: '2026-01-01',
    } as Question);
    expect(
      screen.getByText(
        'The earliest date (12/01/2026) is after the latest (01/01/2026), so neither limit is used.',
      ),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Swap them' }));
    expect(spy).toHaveBeenLastCalledWith({ min: '2026-01-01', max: '2026-12-01' });
    expect(screen.queryByText(/so neither limit is used/)).toBeNull();
  });

  it('says nothing for limits in order, or only one of them', () => {
    setup({ id: 'd', type: 'date', title: 'When?', min: '2026-01-01' } as Question);
    expect(screen.queryByRole('button', { name: 'Swap them' })).toBeNull();
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

  it('Min above Max is explained as what happens, with Swap', () => {
    setup({ ...scale, min: 10, max: 1 } as Question);
    // The scale is drawn from the lower number to the higher (ENG-11).
    expect(
      screen.getByText(
        'Min Value (10) is more than Max Value (1), so the scale runs from 1 to 10.',
      ),
    ).toBeInTheDocument();
  });

  it('too many points is explained, with a fix', async () => {
    const { user, spy } = setup({ ...scale, max: 20000 } as Question);
    expect(
      screen.getByText(
        'That’s 20,001 points: the form can show 101. Use fewer, or the Slider style.',
      ),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Use 0 to 10' }));
    expect(spy).toHaveBeenLastCalledWith({ max: 10, step: undefined });
  });

  it('a scale step of 0 says it counts by 1, with Count by 1 (STU-3)', async () => {
    const { user, spy } = setup({ ...scale, step: 0 } as Question);
    expect(
      screen.getByText('A step of 0 can’t be used, so this scale counts by 1.'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Count by 1' }));
    expect(spy).toHaveBeenLastCalledWith({ step: undefined });
  });

  it('a 0–100 slider draws no cells: no points note (R4, R10)', () => {
    setup({ ...scale, max: 100, display: 'slider' } as Question);
    expect(screen.queryByText(/points/)).toBeNull();
  });

  it('a 0–100 numbers scale gets a quiet note, not a warning (it draws in full)', () => {
    setup({ ...scale, max: 100 } as Question);
    const note = screen.getByText(/That’s 101 points to tap through/).closest('.slate-guard');
    expect(note).toHaveClass('slate-guard--quiet');
  });

  it('trying Stars never rewrites the range: it offers 1 to 5 instead (STU-9)', async () => {
    const { user, spy } = setup(scale);
    await user.click(screen.getByRole('button', { name: 'Scale style' }));
    await user.click(screen.getByRole('option', { name: 'Stars' }));
    expect(spy).toHaveBeenLastCalledWith({ display: 'stars', sliderIcon: undefined });
    // A 0–10 scale stays 0–10; the guard says why 1–5 reads better, with one tap to set it.
    expect(numberIn('Min Value')).toHaveValue(0);
    expect(numberIn('Max Value')).toHaveValue(10);
    expect(
      screen.getByText('Stars start at 1. Starting at 0, the first star saves 0.'),
    ).toBeInTheDocument();
    // Switching back leaves the range as it was.
    await user.click(screen.getByRole('button', { name: 'Scale style' }));
    await user.click(screen.getByRole('option', { name: 'Numbers' }));
    expect(spy).toHaveBeenLastCalledWith({ display: undefined, sliderIcon: undefined });
    expect(spy).not.toHaveBeenCalledWith(expect.objectContaining({ min: 1 }));
    expect(numberIn('Max Value')).toHaveValue(10);
  });

  it('Stars from 0 to 10: one tap sets 1 to 5, and the button says so', async () => {
    const { user, spy } = setup({ ...scale, display: 'stars' } as Question);
    await user.click(screen.getByRole('button', { name: 'Use 1 to 5' }));
    expect(spy).toHaveBeenLastCalledWith({ min: 1, max: 5 });
  });

  it('Stars from 1 to 10: a quiet note that 5 reads best, with a fix', async () => {
    const { user, spy } = setup({ ...scale, min: 1, display: 'stars' } as Question);
    const note = screen.getByText('10 stars is a lot to tap on a phone. 5 reads best.');
    expect(note.closest('.slate-guard')).toHaveClass('slate-guard--quiet');
    await user.click(screen.getByRole('button', { name: 'Use 1 to 5' }));
    expect(spy).toHaveBeenLastCalledWith({ min: 1, max: 5 });
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
  it('max length: a saved 0 means no limit, said plainly, with Clear', async () => {
    const { user, spy } = setup({
      id: 't',
      type: 'short_text',
      title: 'Name?',
      maxLength: 0,
    } as Question);
    expect(screen.getByText('0 means no limit.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear it' }));
    expect(spy).toHaveBeenLastCalledWith({ maxLength: undefined });
  });

  it('max length: typing 0 or -5 saves no limit, never a limit of 1 (R18)', async () => {
    const { user, spy, leave } = setup({ id: 't', type: 'short_text', title: 'Name?' } as Question);
    const box = numberIn('Max Length (Characters)');
    await user.click(box);
    await user.keyboard('0');
    await leave();
    expect(spy).toHaveBeenLastCalledWith({ maxLength: undefined });
    await user.click(box);
    await user.keyboard('-5');
    await leave();
    expect(spy).not.toHaveBeenCalledWith({ maxLength: 1 });
    expect(spy).toHaveBeenLastCalledWith({ maxLength: undefined });
  });

  it('max length: a saved 2.5 says it counts as 2, with a fix', async () => {
    const { user, spy } = setup({
      id: 't',
      type: 'short_text',
      title: 'Name?',
      maxLength: 2.5,
    } as Question);
    expect(
      screen.getByText('Answers can be up to 2 characters: a limit is a whole number.'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Use 2' }));
    expect(spy).toHaveBeenLastCalledWith({ maxLength: 2 });
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
    expect(screen.getByText('-1 MB means the usual 32 MB limit.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Use 32 MB' }));
    expect(spy).toHaveBeenLastCalledWith({ maxSizeMb: 32 });
  });

  it('max files 2.5: the note, the banner and the fix all say 2 (COPY-R4)', async () => {
    const { user, spy } = setup({
      id: 'f',
      type: 'file_upload',
      title: 'Upload',
      multiple: true,
      maxFiles: 2.5,
    } as Question);
    expect(
      screen.getByText('This counts as 2 files: a limit is a whole number.'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Use 2' }));
    expect(spy).toHaveBeenLastCalledWith({ maxFiles: 2 });
  });

  it('max files 1.5 says one file; below 1 counts as the usual 10', async () => {
    setup({
      id: 'f',
      type: 'file_upload',
      title: 'Upload',
      multiple: true,
      maxFiles: 1.5,
    } as Question);
    expect(
      screen.getByText('This counts as 1 file: a limit is a whole number.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Use 1' })).toBeInTheDocument();
  });

  it('max files below 1 offers the usual 10', async () => {
    const { user, spy } = setup({
      id: 'f',
      type: 'file_upload',
      title: 'Upload',
      multiple: true,
      maxFiles: 0.5,
    } as Question);
    expect(screen.getByText('0.5 counts as 10, the usual limit.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Use 10' }));
    expect(spy).toHaveBeenLastCalledWith({ maxFiles: 10 });
  });

  it('max length 1.5 says one character', () => {
    setup({ id: 't', type: 'short_text', title: 'Name?', maxLength: 1.5 } as Question);
    expect(
      screen.getByText('Answers can be up to 1 character: a limit is a whole number.'),
    ).toBeInTheDocument();
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
    // What actually happens until then (R16): read as a US number, never "turned down".
    expect(
      screen.getByText(
        'Until you pick one, a number typed without its country code is read as a US number.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/turned down/)).toBeNull();
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
    expect(
      screen.getByText('People will go to https://www.example.com. Press Fix to save it that way.'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Fix' }));
    expect(spy).toHaveBeenLastCalledWith({ redirectUrl: 'https://www.example.com' });
  });
});

describe('redirect per ending (STU-7)', () => {
  it('a half-typed address stays with its ending: another ending starts empty', async () => {
    const endings: Question[] = [
      { id: 'done', type: 'thanks', title: 'Thanks!' },
      { id: 'out_of_area', type: 'thanks', title: 'Out of area' },
    ];
    const spy = vi.fn();
    function TwoEndings() {
      const [qs, setQs] = useState(endings);
      const [at, setAt] = useState(0);
      const q = qs[at]!;
      return (
        <div data-slate-forms="" data-theme-name="slate">
          <button type="button" onClick={() => setAt(1)}>
            second ending
          </button>
          {/* Not keyed by question, like the editor's own inspector. */}
          <Inspector
            question={q}
            allQuestions={qs}
            onChange={(patch) => {
              spy(q.id, patch);
              setQs((cur) =>
                cur.map((x) => (x.id === q.id ? ({ ...x, ...patch } as Question) : x)),
              );
            }}
            onDelete={vi.fn()}
            canDelete
          />
        </div>
      );
    }
    const user = userEvent.setup();
    render(<TwoEndings />);
    const box = () => screen.getByPlaceholderText('https://yoursite.com/thanks');
    await user.type(box(), 'mysite');
    expect(spy).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'second ending' }));
    expect(box()).toHaveValue('');
    expect(screen.queryByText(/That isn’t a web address/)).toBeNull();
    await user.type(box(), 'other.com');
    expect(spy).toHaveBeenLastCalledWith('out_of_area', { redirectUrl: 'https://other.com' });
    expect(spy).not.toHaveBeenCalledWith('out_of_area', { redirectUrl: 'https://mysite.com' });
  });
});

describe('plain labels (QA leftovers)', () => {
  it('a title set in the form’s code says so, without developer words', () => {
    setup({ id: 'q', type: 'short_text', title: (() => 'Hi') as never } as Question);
    expect(screen.getByText('Title (set in code)')).toBeInTheDocument();
    expect(screen.queryByText(/Dynamic Function/)).toBeNull();
  });

  it('Fill from link says how, in a sentence', () => {
    // A question with a link name opens the section.
    setup({
      id: 'first_name',
      type: 'short_text',
      title: 'First name?',
      prefillKey: 'first_name',
    } as Question);
    expect(
      screen.getByText(
        'To fill it in, add ?first_name= and the answer to the end of the form’s link.',
      ),
    ).toBeInTheDocument();
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

  it('a too-big Spots then a tap on + Add Slot keeps the new slot (touch order, STU-4)', async () => {
    const initial: SignupSlotsQuestion = {
      id: 'su',
      type: 'signup_slots',
      title: 'Pick a time',
      slots: [
        { label: 'A', value: 's_a', capacity: 8 },
        { label: 'B', value: 's_b', capacity: 8 },
      ],
    };
    let latest = initial;
    function Editor() {
      const [q, setQ] = useState(initial);
      latest = q;
      return (
        <ConfirmProvider>
          <div data-slate-forms="" data-theme-name="slate">
            <SignupSlotsSettings
              question={q}
              // Patches merge into the newest question, as the editor's updateQuestion does.
              onChange={(patch) => setQ((cur) => ({ ...cur, ...patch }) as SignupSlotsQuestion)}
            />
          </div>
        </ConfirmProvider>
      );
    }
    const user = userEvent.setup();
    render(<Editor />);
    const spots = screen.getByRole('spinbutton', { name: 'Spots in B' });
    await user.tripleClick(spots);
    await user.keyboard('1500');
    // On a phone the blur and the click both land before the next frame.
    act(() => spots.blur());
    act(() => screen.getByRole('button', { name: /Add Slot/ }).click());
    await act(() => new Promise<void>((r) => requestAnimationFrame(() => r())));
    expect(latest.slots).toHaveLength(3);
    expect(latest.slots.map((x) => x.capacity)).toEqual([8, 1000, expect.any(Number)]);
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
