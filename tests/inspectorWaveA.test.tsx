/**
 * Studio settings for ADR-063 (Inspector) and the Add-to-form palette polish:
 * every Wave A option is editable, and every palette tile has the same shape.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Question } from '@/index.js';
import { Inspector } from '../examples/_admin/components/Inspector.js';
import { TypeIcon } from '../examples/_admin/components/TypeIcon.js';
import { ADDABLE_TYPES, TYPE_LABEL } from '../examples/_admin/questionTypeMeta.js';

function renderInspector(question: Question, all: Question[] = [question]) {
  const onChange = vi.fn();
  render(
    <div data-slate-forms="" data-theme-name="slate">
      <Inspector
        question={question}
        allQuestions={all}
        onChange={onChange}
        onDelete={vi.fn()}
        canDelete
      />
    </div>,
  );
  return { onChange };
}

describe('Inspector — Wave A options', () => {
  it('choice questions get "Allow Other" and, once on, a label', async () => {
    const user = userEvent.setup();
    const q: Question = {
      id: 'how',
      type: 'single_choice',
      title: 'How did you hear about us?',
      options: [{ label: 'Flyer', value: 'opt_1' }],
    };
    const { onChange } = renderInspector(q);
    await user.click(screen.getByRole('checkbox', { name: /allow “other”/i }));
    expect(onChange).toHaveBeenLastCalledWith({ allowOther: true, otherLabel: undefined });
    expect(screen.queryByText('Other Label')).not.toBeInTheDocument();
  });

  it('shows the Other label field when Other is on', async () => {
    const user = userEvent.setup();
    const q: Question = {
      id: 'how',
      type: 'multi_choice',
      title: 'Services?',
      allowOther: true,
      options: [{ label: 'Roof', value: 'opt_1' }],
    };
    const { onChange } = renderInspector(q);
    const label = screen.getByPlaceholderText('Other');
    await user.type(label, 'X');
    expect(onChange).toHaveBeenLastCalledWith({ otherLabel: 'X' });
  });

  it('prefill: turning it on suggests a link name from the title', async () => {
    const user = userEvent.setup();
    const q: Question = { id: 'q1', type: 'short_text', title: 'What is your first name?' };
    const { onChange } = renderInspector(q);
    await user.click(screen.getByRole('button', { name: /fill from link/i }));
    await user.click(screen.getByRole('checkbox', { name: /prefilled from the link/i }));
    expect(onChange).toHaveBeenLastCalledWith({ prefillKey: 'first_name' });
  });

  it('prefill: warns on a reserved or duplicate link name', () => {
    const q: Question = { id: 'q1', type: 'short_text', title: 'Name', prefillKey: 'src' };
    renderInspector(q);
    expect(screen.getByText(/not src, embed or utm/i)).toBeInTheDocument();
  });

  it('consent and files have no prefill setting', () => {
    renderInspector({ id: 'l', type: 'legal', title: 'Terms' } as Question);
    expect(screen.queryByRole('button', { name: /fill from link/i })).not.toBeInTheDocument();
  });

  it('dates can ask for a time and a range', async () => {
    const user = userEvent.setup();
    const { onChange } = renderInspector({ id: 'd', type: 'date', title: 'When?' });
    await user.click(screen.getByRole('checkbox', { name: /ask for a time too/i }));
    expect(onChange).toHaveBeenLastCalledWith({ includeTime: true });
    await user.click(screen.getByRole('checkbox', { name: /date range/i }));
    expect(onChange).toHaveBeenLastCalledWith({ range: true });
  });

  it('numbers edit step, prefix and unit', async () => {
    const user = userEvent.setup();
    const { onChange } = renderInspector({ id: 'n', type: 'number', title: 'Budget?' });
    await user.type(screen.getByRole('textbox', { name: /shown before the number/i }), '$');
    expect(onChange).toHaveBeenLastCalledWith({ prefix: '$' });
    await user.type(screen.getByRole('textbox', { name: /shown after the number/i }), 'k');
    expect(onChange).toHaveBeenLastCalledWith({ unit: 'k' });
  });

  it('a 0–10 scale shown as stars warns it is a lot for a phone', () => {
    renderInspector({
      id: 's',
      type: 'scale',
      title: 'Rate',
      min: 0,
      max: 10,
      display: 'stars',
    });
    expect(screen.getByText(/11 points is a lot of stars/i)).toBeInTheDocument();
  });
});

describe('palette icons', () => {
  it('every addable type has a line icon and a label', () => {
    for (const t of ADDABLE_TYPES) {
      const { container, unmount } = render(<TypeIcon type={t.type} />);
      const svg = container.querySelector('svg')!;
      expect(svg).toHaveAttribute('aria-hidden', 'true');
      expect(svg.getAttribute('viewBox')).toBe('0 0 16 16');
      expect(svg.children.length).toBeGreaterThan(0);
      expect(TYPE_LABEL[t.type]).toBeTruthy();
      unmount();
    }
  });

  it('palette labels sit in their own left-aligned span', async () => {
    const { Outline } = await import('../examples/_admin/components/Outline.js');
    const user = userEvent.setup();
    render(
      <div data-slate-forms="" data-theme-name="slate">
        <Outline
          schema={{
            brand: { name: 'x' },
            theme: 'classic',
            themeMode: 'light',
            questions: [{ id: 'w', type: 'welcome', title: 'Hi' }],
          }}
          selectedId="w"
          onSelect={vi.fn()}
          onAddQuestion={vi.fn()}
          onReorder={vi.fn()}
          onMove={vi.fn()}
          onDuplicate={vi.fn()}
          onBulkDelete={vi.fn()}
          name="Form"
          onNameChange={vi.fn()}
          onBrandChange={vi.fn()}
          onLogoChange={vi.fn()}
          onThemeChange={vi.fn()}
          onThemeModeChange={vi.fn()}
          onSoundChange={vi.fn()}
        />
      </div>,
    );
    await user.click(screen.getByRole('button', { name: /add/i }));
    const dialog = screen.getByRole('dialog', { name: /add question/i });
    await user.click(within(dialog).getByRole('button', { name: /choices/i }));
    const tile = within(dialog).getByRole('button', { name: 'Picture Choice' });
    expect(tile.querySelector('.slate-add-type-glyph svg')).not.toBeNull();
    expect(tile.querySelector('.slate-add-type-label')).toHaveTextContent('Picture Choice');
  });
});
