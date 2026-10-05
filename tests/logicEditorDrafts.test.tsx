/**
 * S7: the logic editor keeps half-made rules as drafts, keeps numbers as typed,
 * only offers questions a rule can really use, and says in plain words when a
 * saved rule can't work.
 */

import { useState } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Condition, LogicRule, Question } from '@/index.js';
import { ConditionBuilder, JumpRulesEditor } from '../examples/_admin/components/LogicEditor.js';
import { dropRulesUsing, questionsUsing } from '../examples/_admin/logicRules.js';

type User = ReturnType<typeof userEvent.setup>;

async function choose(user: User, select: string, option: string) {
  await user.click(screen.getByRole('button', { name: select }));
  await user.click(screen.getByRole('option', { name: option }));
}

function optionNames(user: User, select: string) {
  return (async () => {
    await user.click(screen.getByRole('button', { name: select }));
    const names = within(screen.getByRole('listbox', { name: select }))
      .getAllByRole('option')
      .map((o) => o.textContent);
    await user.keyboard('{Escape}');
    return names;
  })();
}

const welcome: Question = { id: 'welcome', type: 'welcome', title: 'Hi' };
const rate: Question = { id: 'rate', type: 'scale', title: 'Rate us', min: 0, max: 10 };
const size: Question = {
  id: 'size',
  type: 'single_choice',
  title: 'What size?',
  options: [
    { label: 'Small', value: 'small' },
    { label: 'Large', value: 'large' },
  ],
};
const details: Question = { id: 'details', type: 'long_text', title: 'Details?' };
const later: Question = { id: 'later', type: 'short_text', title: 'Anything else?' };
const done: Question = { id: 'done', type: 'thanks', title: 'Thanks' };
const form = [welcome, rate, size, details, later, done];

/** A parent that keeps the condition, like the editor does. */
function VisibilityHarness({
  initial,
  questions = form,
  currentId = 'details',
  spy,
}: {
  initial?: Condition;
  questions?: Question[];
  currentId?: string;
  spy: (next: Condition | undefined) => void;
}) {
  const [value, setValue] = useState<Condition | undefined>(initial);
  return (
    <div data-slate-forms="" data-theme-name="slate">
      <ConditionBuilder
        value={value}
        questions={questions}
        currentId={currentId}
        onChange={(next) => {
          spy(next);
          setValue(next);
        }}
      />
    </div>
  );
}

function JumpHarness({
  initial = [],
  questions = form,
  currentId = 'size',
  spy,
}: {
  initial?: LogicRule[];
  questions?: Question[];
  currentId?: string;
  spy: (next: LogicRule[] | undefined) => void;
}) {
  const [rules, setRules] = useState<LogicRule[] | undefined>(initial);
  return (
    <div data-slate-forms="" data-theme-name="slate">
      <JumpRulesEditor
        rules={rules ?? []}
        questions={questions}
        currentId={currentId}
        onChange={(next) => {
          spy(next);
          setRules(next);
        }}
      />
    </div>
  );
}

beforeAll(() => {
  Element.prototype.scrollIntoView ??= vi.fn();
  Element.prototype.scrollBy ??= vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('when-to-show rules are drafts until they are finished', () => {
  it('adding a rule changes nothing until an answer is picked', async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<VisibilityHarness spy={spy} />);
    await user.click(screen.getByRole('button', { name: /add visibility rule/i }));
    // The nearest earlier answer is suggested; nothing is saved yet.
    expect(spy).not.toHaveBeenCalled();
    expect(screen.getByText('Pick an answer to finish this rule.')).toBeInTheDocument();
    await choose(user, 'Answer', 'Large');
    expect(spy).toHaveBeenLastCalledWith({ field: 'size', op: 'equals', value: 'large' });
    expect(screen.getByText('Show when What size? is “Large”')).toBeInTheDocument();
  });

  it('keeps decimals and minus signs, and never turns text into 0', async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<VisibilityHarness spy={spy} initial={{ field: 'rate', op: 'gt', value: 5 }} />);
    const box = screen.getByRole('textbox', { name: 'Value' });

    await user.clear(box);
    // An empty box is an unfinished rule: the form no longer uses it.
    expect(spy).toHaveBeenLastCalledWith(undefined);
    expect(screen.getByText('Type a number to finish this rule.')).toBeInTheDocument();

    await user.type(box, '2.5');
    expect(box).toHaveValue('2.5');
    expect(spy).toHaveBeenLastCalledWith({ field: 'rate', op: 'gt', value: 2.5 });

    await user.clear(box);
    await user.type(box, '-1');
    expect(spy).toHaveBeenLastCalledWith({ field: 'rate', op: 'gt', value: -1 });

    spy.mockClear();
    await user.clear(box);
    await user.type(box, 'abc');
    expect(box).toHaveValue('abc');
    expect(screen.getByText('Use a number, like 3 or 2.5.')).toBeInTheDocument();
    // The last call drops the rule; it is never saved as 0.
    expect(spy.mock.calls.every(([next]) => next === undefined)).toBe(true);
  });

  it('only offers questions that come before this one', async () => {
    const user = userEvent.setup();
    render(<VisibilityHarness spy={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /add visibility rule/i }));
    expect(await optionNames(user, 'Question')).toEqual([
      'Pick a question…',
      'Rate us',
      'What size?',
    ]);
  });

  it('the first question has nothing to depend on, and says so', () => {
    render(<VisibilityHarness spy={vi.fn()} currentId="rate" />);
    expect(screen.queryByRole('button', { name: /add visibility rule/i })).toBeNull();
    expect(screen.getByText(/nothing before this one has an answer yet/i)).toBeInTheDocument();
  });

  it('flags a saved rule on the question itself, or on a later one', () => {
    const { unmount } = render(
      <VisibilityHarness spy={vi.fn()} initial={{ field: 'details', op: 'is_not_empty' }} />,
    );
    expect(screen.getByText(/can’t wait for its own answer/i)).toBeInTheDocument();
    unmount();
    render(<VisibilityHarness spy={vi.fn()} initial={{ field: 'later', op: 'is_not_empty' }} />);
    expect(screen.getByText(/That question comes later/i)).toBeInTheDocument();
  });

  it('flags a rule whose answer was removed from the choices', () => {
    const trimmed: Question = { ...size, options: [{ label: 'Small', value: 'small' }] };
    render(
      <VisibilityHarness
        spy={vi.fn()}
        questions={[welcome, rate, trimmed, details, done]}
        initial={{ field: 'size', op: 'equals', value: 'large' }}
      />,
    );
    expect(screen.getByRole('button', { name: 'Answer' })).toHaveTextContent('Removed answer');
    expect(screen.getByText(/isn’t one of the choices any more/i)).toBeInTheDocument();
  });

  it('starts again from the form after an outside change (undo)', async () => {
    const user = userEvent.setup();
    const questions = form;
    function Undoable() {
      const [value, setValue] = useState<Condition | undefined>({
        field: 'size',
        op: 'equals',
        value: 'small',
      });
      return (
        <div data-slate-forms="" data-theme-name="slate">
          <button type="button" onClick={() => setValue({ field: 'rate', op: 'lt', value: 3 })}>
            undo
          </button>
          <ConditionBuilder
            value={value}
            onChange={setValue}
            questions={questions}
            currentId="details"
          />
        </div>
      );
    }
    render(<Undoable />);
    await user.click(screen.getByRole('button', { name: /add visibility rule/i }));
    expect(screen.getAllByText('When this is true…')).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'undo' }));
    expect(screen.getAllByText('When this is true…')).toHaveLength(1);
    expect(screen.getByRole('textbox', { name: 'Value' })).toHaveValue('3');
  });
});

describe('skip rules', () => {
  it('saves a rule only once it has an answer and a place to go, without render warnings', async () => {
    const user = userEvent.setup();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const spy = vi.fn();
    render(<JumpHarness spy={spy} />);
    await user.click(screen.getByRole('button', { name: /add skip rule/i }));
    await choose(user, 'Jump target', 'Thanks');
    expect(spy).not.toHaveBeenCalled();
    await choose(user, 'Answer', 'Small');
    expect(spy).toHaveBeenLastCalledWith([
      { if: { field: 'size', op: 'equals', value: 'small' }, goTo: 'done' },
    ]);
    expect(screen.getByText('If', { exact: false })).toHaveTextContent(
      'If What size? is “Small”, skip to Thanks.',
    );
    expect(errors.mock.calls.flat().join(' ')).not.toMatch(/Cannot update a component/);
  });

  it('only skips ahead', async () => {
    const user = userEvent.setup();
    render(<JumpHarness spy={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /add skip rule/i }));
    expect(await optionNames(user, 'Jump target')).toEqual([
      'Pick a question…',
      'Details?',
      'Anything else?',
      'Thanks',
    ]);
  });

  it('flags a saved rule that goes back to an earlier question', () => {
    render(
      <JumpHarness
        spy={vi.fn()}
        currentId="details"
        initial={[{ if: { field: 'size', op: 'equals', value: 'small' }, goTo: 'rate' }]}
      />,
    );
    expect(screen.getByRole('button', { name: 'Jump target' })).toHaveTextContent('Rate us');
    expect(screen.getByText(/go round in circles/i)).toBeInTheDocument();
  });
});

describe('inside the Inspector', () => {
  it('a rule that stops being finished mid-typing keeps its row (the section stays open)', async () => {
    const user = userEvent.setup();
    const { Inspector } = await import('../examples/_admin/components/Inspector.js');
    function Harness() {
      const [q, setQ] = useState<Question>({
        ...later,
        visibleIf: { field: 'rate', op: 'gt', value: 5 },
      } as Question);
      return (
        <div data-slate-forms="" data-theme-name="slate">
          <Inspector
            question={q}
            allQuestions={[welcome, rate, size, details, q, done]}
            onChange={(patch) => setQ((cur) => ({ ...cur, ...patch }) as Question)}
            onDelete={() => {}}
            canDelete
          />
        </div>
      );
    }
    render(<Harness />);
    const box = screen.getByRole('textbox', { name: 'Value' });
    await user.clear(box);
    await user.type(box, 'abc');
    // The rule isn't saved while it isn't a number, but the row and its note stay.
    expect(screen.getByRole('textbox', { name: 'Value' })).toHaveValue('abc');
    expect(screen.getByText('Use a number, like 3 or 2.5.')).toBeInTheDocument();
    await user.clear(screen.getByRole('textbox', { name: 'Value' }));
    await user.type(screen.getByRole('textbox', { name: 'Value' }), '7');
    expect(screen.getByText('Show when Rate us is greater than “7”')).toBeInTheDocument();
  });
});

describe('deleting a question that rules use (S8)', () => {
  const sized: Question = {
    ...details,
    visibleIf: {
      all: [
        { field: 'size', op: 'equals', value: 'large' },
        { field: 'rate', op: 'gt', value: 3 },
      ],
    },
  } as Question;
  const skipper: Question = {
    ...rate,
    logic: [
      { if: { field: 'rate', op: 'gt', value: 8 }, goTo: 'size' },
      { if: { field: 'rate', op: 'lt', value: 2 }, goTo: 'done' },
    ],
  } as Question;
  const questions = [welcome, skipper, size, sized, done];

  it('finds the questions whose rules use it', () => {
    expect(questionsUsing(questions, new Set(['size'])).map((q) => q.id)).toEqual([
      'rate',
      'details',
    ]);
    expect(questionsUsing(questions, new Set(['later'])).map((q) => q.id)).toEqual([]);
  });

  it('removes only those rules', () => {
    const next = dropRulesUsing(questions, new Set(['size']));
    const byId = Object.fromEntries(next.map((q) => [q.id, q]));
    expect((byId.details as { visibleIf?: Condition }).visibleIf).toEqual({
      field: 'rate',
      op: 'gt',
      value: 3,
    });
    expect((byId.rate as { logic?: LogicRule[] }).logic).toEqual([
      { if: { field: 'rate', op: 'lt', value: 2 }, goTo: 'done' },
    ]);
    // Untouched questions keep their identity.
    expect(byId.size).toBe(size);
  });
});
