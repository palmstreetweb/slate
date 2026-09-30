/**
 * Studio settings for Wave B (ADR-064): prices, package cards, the contact
 * block, the address with its service area and "out of area" ending, the
 * signature, and the instant estimate on an ending — plus the logic editor's
 * in / out of area answers and the palette entries.
 */

import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { EstimateSettings, Question } from '@/index.js';
import { OUT_OF_AREA_VALUE } from '@/logic/address.js';
import { checkSchema } from '@/logic/schemaCheck.js';
import { visibleQuestions } from '@/logic/progress.js';
import { Inspector } from '../examples/_admin/components/Inspector.js';
import { ConditionBuilder } from '../examples/_admin/components/LogicEditor.js';
import { ADDABLE_TYPES } from '../examples/_admin/questionTypeMeta.js';
import { withOutOfAreaEnding } from '../examples/_admin/outOfArea.js';

// SlateSelect scrolls the picked option into view; jsdom has no layout.
beforeAll(() => {
  Element.prototype.scrollIntoView ??= vi.fn();
  Element.prototype.scrollBy ??= vi.fn();
});

function renderInspector(
  question: Question,
  all: Question[] = [question],
  estimate?: EstimateSettings,
) {
  const onChange = vi.fn();
  const onEstimateChange = vi.fn();
  const onAddOutOfAreaEnding = vi.fn();
  render(
    <div data-slate-forms="" data-theme-name="slate">
      <Inspector
        question={question}
        allQuestions={all}
        onChange={onChange}
        onDelete={vi.fn()}
        canDelete
        estimate={estimate}
        onEstimateChange={onEstimateChange}
        onAddOutOfAreaEnding={onAddOutOfAreaEnding}
      />
    </div>,
  );
  return { onChange, onEstimateChange, onAddOutOfAreaEnding };
}

async function choose(user: ReturnType<typeof userEvent.setup>, select: string, option: string) {
  await user.click(screen.getByRole('button', { name: select }));
  await user.click(screen.getByRole('option', { name: option }));
}

const plan: Question = {
  id: 'plan',
  type: 'single_choice',
  title: 'Package',
  options: [
    { label: 'Basic', value: 'basic' },
    { label: 'Premium', value: 'premium' },
  ],
};

describe('prices on options', () => {
  it('"Add Prices" shows price inputs without writing $0; a price updates the option', async () => {
    const user = userEvent.setup();
    const { onChange } = renderInspector(plan);
    expect(screen.queryByRole('spinbutton', { name: /price for basic, usd/i })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Add Prices' }));
    expect(onChange).not.toHaveBeenCalled();
    await user.type(screen.getByRole('spinbutton', { name: /price for basic, usd/i }), '9');
    expect(onChange).toHaveBeenLastCalledWith({
      options: [{ label: 'Basic', value: 'basic', price: 9, priceMax: undefined }, plan.options[1]],
    });
  });

  it('"Remove Prices" strips every price', async () => {
    const user = userEvent.setup();
    const priced = {
      ...plan,
      options: [{ label: 'Basic', value: 'basic', price: 10, priceMax: 20 }, plan.options[1]!],
    } as Question;
    const { onChange } = renderInspector(priced);
    await user.click(screen.getByRole('button', { name: 'Remove Prices' }));
    expect(onChange).toHaveBeenLastCalledWith({
      options: [{ label: 'Basic', value: 'basic' }, plan.options[1]],
    });
  });

  it('numbers take a price per unit', async () => {
    const user = userEvent.setup();
    const { onChange } = renderInspector({ id: 'n', type: 'number', title: 'Windows?' });
    await user.click(screen.getByRole('button', { name: /price per unit/i }));
    await user.type(screen.getByRole('spinbutton', { name: /price per unit, usd/i }), '4');
    expect(onChange).toHaveBeenLastCalledWith({ unitPrice: 4, unitPriceMax: undefined });
  });
});

describe('package cards', () => {
  it('the Style menu switches single choice to cards', async () => {
    const user = userEvent.setup();
    const { onChange } = renderInspector(plan);
    await choose(user, 'Choice style', 'Package cards');
    expect(onChange).toHaveBeenLastCalledWith({ display: 'cards' });
  });

  it('cards show prices plus a badge, description and features per option', async () => {
    const user = userEvent.setup();
    const { onChange } = renderInspector({ ...plan, display: 'cards' } as Question);
    expect(screen.getByRole('spinbutton', { name: /price for basic, usd/i })).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: 'Badge for Premium' }), 'M');
    expect(onChange).toHaveBeenLastCalledWith({
      options: [plan.options[0], { label: 'Premium', value: 'premium', badge: 'M' }],
    });
    await user.type(
      screen.getByRole('textbox', { name: 'Features for Basic' }),
      'Patch{Enter}Seal',
    );
    expect(onChange).toHaveBeenLastCalledWith({
      options: [{ label: 'Basic', value: 'basic', features: ['Patch', 'Seal'] }, plan.options[1]],
    });
  });
});

describe('contact block', () => {
  it('each part is Required, Optional or Off', async () => {
    const user = userEvent.setup();
    const { onChange } = renderInspector({ id: 'c', type: 'contact_info', title: 'Reach you?' });
    await choose(user, 'Phone field', 'Required');
    expect(onChange).toHaveBeenLastCalledWith({ fields: { phone: 'required' } });
    expect(screen.getByText(/one tap/i)).toBeInTheDocument();
  });

  it('warns when every part is off', () => {
    renderInspector({
      id: 'c',
      type: 'contact_info',
      title: 'Reach you?',
      fields: { name: 'off', email: 'off', phone: 'off' },
    });
    expect(screen.getByText(/turn on at least one field/i)).toBeInTheDocument();
  });
});

describe('address', () => {
  const addr: Question = { id: 'addr', type: 'address', title: 'Where?' };

  it('toggles the unit line and country, and the format', async () => {
    const user = userEvent.setup();
    const { onChange } = renderInspector(addr);
    await user.click(screen.getByRole('checkbox', { name: /apt \/ unit line/i }));
    expect(onChange).toHaveBeenLastCalledWith({ line2: false });
    await user.click(screen.getByRole('checkbox', { name: /ask for the country/i }));
    expect(onChange).toHaveBeenLastCalledWith({ country: true });
    await choose(user, 'Address format', 'International (region, postal code)');
    expect(onChange).toHaveBeenLastCalledWith({ format: 'international' });
  });

  it('a service area is typed as a list; bad entries are pointed out', async () => {
    const user = userEvent.setup();
    const { onChange } = renderInspector(addr);
    await user.click(screen.getByRole('button', { name: /service area/i }));
    await user.type(screen.getByPlaceholderText(/93101, 93103/), '93101, 931*, bad!');
    expect(onChange).toHaveBeenLastCalledWith({ serviceArea: ['93101', '931*', 'bad!'] });
    expect(screen.getByText(/1 entry isn’t a code/i)).toBeInTheDocument();
  });

  it('offers a one-click out-of-area ending once there is an area', async () => {
    const user = userEvent.setup();
    const withArea = { ...addr, serviceArea: ['931'] } as Question;
    const { onAddOutOfAreaEnding } = renderInspector(withArea);
    await user.click(screen.getByRole('button', { name: /add an “out of area” ending/i }));
    expect(onAddOutOfAreaEnding).toHaveBeenCalledWith('addr');
  });

  it('says so when an ending already catches out-of-area answers', () => {
    const withArea = { ...addr, serviceArea: ['931'] } as Question;
    const { questions } = withOutOfAreaEnding(
      [withArea, { id: 'done', type: 'thanks', title: 'T' }],
      'addr',
    );
    renderInspector(questions[0]!, questions);
    expect(screen.getByText(/already catches addresses outside/i)).toBeInTheDocument();
  });
});

describe('withOutOfAreaEnding', () => {
  it('adds a guarded ending before the others and a jump to it', () => {
    const addr = { id: 'addr', type: 'address', title: 'Where?', serviceArea: ['931'] } as Question;
    const qs: Question[] = [
      { id: 'welcome', type: 'welcome', title: 'Hi' },
      addr,
      { id: 'more', type: 'short_text', title: 'More?' },
      { id: 'done', type: 'thanks', title: 'Thanks' },
    ];
    const { questions, endingId } = withOutOfAreaEnding(qs, 'addr');
    expect(endingId).toBe('out_of_area');
    expect(questions.map((q) => q.id)).toEqual(['welcome', 'addr', 'more', 'out_of_area', 'done']);
    const outside = { field: 'addr', op: 'equals', value: OUT_OF_AREA_VALUE };
    expect(questions[3]).toMatchObject({ type: 'thanks', visibleIf: outside });
    expect(questions[1]).toMatchObject({ logic: [{ if: outside, goTo: 'out_of_area' }] });
    expect(checkSchema(questions)).toEqual([]);
    // In the area, the ending is hidden and the normal thanks is reached.
    const inArea = { addr: { street: 'a', city: 'b', region: 'CA', postal: '93101' } };
    expect(visibleQuestions(questions, inArea).map((q) => q.id)).not.toContain('out_of_area');
    // A second one gets its own id.
    expect(withOutOfAreaEnding(questions, 'addr').endingId).toBe('out_of_area_2');
  });
});

describe('signature', () => {
  it('required, typing and agreement copy are editable; turning typing off warns', async () => {
    const user = userEvent.setup();
    const sig: Question = { id: 's', type: 'signature', title: 'Sign' };
    const { onChange } = renderInspector(sig);
    await user.click(screen.getByRole('checkbox', { name: /let them type their name instead/i }));
    expect(onChange).toHaveBeenLastCalledWith({ allowTyped: false });
    await user.click(screen.getByRole('checkbox', { name: /^required$/i }));
    expect(onChange).toHaveBeenLastCalledWith({ required: true });
  });

  it('warns that keyboard users can’t draw when typing is off', () => {
    renderInspector({ id: 's', type: 'signature', title: 'Sign', allowTyped: false });
    expect(screen.getByText(/keyboard and screen-reader users can’t draw/i)).toBeInTheDocument();
  });
});

describe('instant estimate on an ending', () => {
  const thanks: Question = { id: 'done', type: 'thanks', title: 'Thanks' };
  const priced = { ...plan, options: [{ label: 'Basic', value: 'basic', price: 10 }] } as Question;

  it('shows it on this ending and edits the form-wide settings', async () => {
    const user = userEvent.setup();
    const { onChange, onEstimateChange } = renderInspector(thanks, [priced, thanks], {
      breakdown: true,
    });
    await user.click(screen.getByRole('button', { name: /instant estimate/i }));
    await user.click(screen.getByRole('checkbox', { name: /show the estimate on this ending/i }));
    expect(onChange).toHaveBeenLastCalledWith({ showEstimate: true });
    await choose(user, 'Currency', 'Canadian dollar (CAD)');
    expect(onEstimateChange).toHaveBeenLastCalledWith({ breakdown: true, currency: 'CAD' });
    await user.type(screen.getByPlaceholderText('Final price after inspection'), 'F');
    expect(onEstimateChange).toHaveBeenLastCalledWith({ breakdown: true, disclaimer: 'F' });
    await user.click(screen.getByRole('checkbox', { name: /line per priced answer/i }));
    expect(onEstimateChange).toHaveBeenLastCalledWith(undefined);
  });

  it('warns when nothing has a price yet', async () => {
    const user = userEvent.setup();
    renderInspector(thanks, [plan, thanks]);
    await user.click(screen.getByRole('button', { name: /instant estimate/i }));
    expect(screen.getByText(/nothing has a price yet/i)).toBeInTheDocument();
  });
});

describe('logic editor', () => {
  it('an address with a service area can be tested inside / outside it', async () => {
    const user = userEvent.setup();
    const addr = { id: 'addr', type: 'address', title: 'Where?', serviceArea: ['931'] } as Question;
    const onChange = vi.fn();
    render(
      <div data-slate-forms="" data-theme-name="slate">
        <ConditionBuilder
          value={{ field: 'addr', op: 'equals', value: '' }}
          onChange={onChange}
          questions={[addr, { id: 'done', type: 'thanks', title: 'T' }]}
        />
      </div>,
    );
    await choose(user, 'Answer', 'Outside the service area');
    expect(onChange).toHaveBeenLastCalledWith({
      field: 'addr',
      op: 'equals',
      value: OUT_OF_AREA_VALUE,
    });
  });

  it('a contact block or signature only offers blank / has an answer', async () => {
    const user = userEvent.setup();
    render(
      <div data-slate-forms="" data-theme-name="slate">
        <ConditionBuilder
          value={{ field: 'c', op: 'is_not_empty' }}
          onChange={vi.fn()}
          questions={[{ id: 'c', type: 'contact_info', title: 'Reach you?' }]}
        />
      </div>,
    );
    await user.click(screen.getByRole('button', { name: 'Condition' }));
    const list = screen.getByRole('listbox', { name: 'Condition' });
    expect(
      within(list)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['is blank', 'has an answer']);
  });
});

describe('palette', () => {
  it('offers the three new types', () => {
    const byType = Object.fromEntries(ADDABLE_TYPES.map((t) => [t.type, t.group]));
    expect(byType).toMatchObject({ contact_info: 'Inputs', address: 'Inputs', signature: 'Other' });
  });
});
