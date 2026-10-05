/** S9: the issues banner folds to one line, and never fills a phone screen. */

import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IssuesBanner } from '../examples/_admin/components/IssuesBanner.js';
import type { OwnerIssue } from '../examples/_admin/editorIssues.js';

const issues: OwnerIssue[] = Array.from({ length: 5 }, (_, i) => ({
  questionId: `q${i}`,
  kind: 'no_options',
  text: `“Question ${i}” has no options. Add at least one.`,
  blocking: i === 0,
}));

function show(phone: boolean, list = issues, onPick = vi.fn()) {
  render(
    <div data-slate-forms="" data-theme-name="slate">
      <IssuesBanner issues={list} phone={phone} cloud onPick={onPick} />
    </div>,
  );
  return { region: screen.getByRole('region', { name: 'Things to fix' }), onPick };
}

describe('IssuesBanner', () => {
  it('on a computer it starts open and taps open the question', async () => {
    const user = userEvent.setup();
    const { region, onPick } = show(false);
    expect(region.textContent).toContain('1 thing to fix before you publish · 4 to check');
    await user.click(within(region).getByRole('button', { name: /Question 2/ }));
    expect(onPick).toHaveBeenCalledWith('q2');
    expect(within(region).getByRole('list')).toBeTruthy();
  });

  it('on a phone, more than three start folded; a tap folds it so the question is in view', async () => {
    const user = userEvent.setup();
    const { region, onPick } = show(true);
    expect(within(region).queryByRole('list')).toBeNull();
    expect(within(region).getByRole('button', { name: 'Show' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    await user.click(within(region).getByRole('button', { name: 'Show' }));
    await user.click(within(region).getByRole('button', { name: /Question 0/ }));
    expect(onPick).toHaveBeenCalledWith('q0');
    expect(within(region).queryByRole('list')).toBeNull();
  });

  it('a short list on a phone starts open; nothing to fix shows nothing', () => {
    const { region } = show(true, issues.slice(0, 2));
    expect(within(region).getByRole('list')).toBeTruthy();
    const { container } = render(<IssuesBanner issues={[]} phone={false} cloud onPick={vi.fn()} />);
    expect(container.innerHTML).toBe('');
  });
});
