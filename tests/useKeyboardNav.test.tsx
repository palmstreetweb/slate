/**
 * useKeyboardNav — global key handling: Enter on chrome screens, A–F choice
 * selection, 0–9 scale selection, Esc opt-in, and typing-target suppression.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import { useKeyboardNav } from '@/hooks/useKeyboardNav.js';
import type { Question } from '@/types/Question.js';

const welcome: Question = { id: 'w', type: 'welcome', title: 'Hi' };
const choice: Question = {
  id: 'svc',
  type: 'single_choice',
  title: 'Service?',
  options: [
    { label: 'A', value: 'a' },
    { label: 'B', value: 'b' },
  ],
};
const scale: Question = { id: 'urg', type: 'scale', title: 'Urgency?', min: 1, max: 5 };
const yesNo: Question = { id: 'ins', type: 'yes_no', title: 'Insured?' };
const legal: Question = { id: 'terms', type: 'legal', title: 'Terms?' };
const nps: Question = { id: 'rec', type: 'nps', title: 'Recommend?' };
const picture: Question = {
  id: 'pet',
  type: 'picture_choice',
  title: 'Pick a pet',
  options: [
    { label: 'Cat', value: 'cat', src: 'cat.jpg' },
    { label: 'Dog', value: 'dog', src: 'dog.jpg' },
  ],
};

function setup(currentQ: Question, extra: Partial<Parameters<typeof useKeyboardNav>[0]> = {}) {
  const onAdvance = vi.fn();
  const onBack = vi.fn();
  const onSelectChoice = vi.fn();
  const onSelectScale = vi.fn();
  renderHook(() =>
    useKeyboardNav({ currentQ, onAdvance, onBack, onSelectChoice, onSelectScale, ...extra }),
  );
  return { onAdvance, onBack, onSelectChoice, onSelectScale };
}

let input: HTMLInputElement;

beforeEach(() => {
  input = document.createElement('input');
  document.body.appendChild(input);
});

afterEach(() => {
  input.remove();
});

describe('useKeyboardNav', () => {
  it('Enter advances welcome screens', () => {
    const { onAdvance } = setup(welcome);
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onAdvance).toHaveBeenCalledTimes(1);
  });

  it('Enter does not advance while typing in an input', () => {
    const { onAdvance } = setup(welcome);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onAdvance).not.toHaveBeenCalled();
  });

  it('A/B select choice options by index', () => {
    const { onSelectChoice } = setup(choice);
    fireEvent.keyDown(window, { key: 'a' });
    expect(onSelectChoice).toHaveBeenCalledWith(0);
    fireEvent.keyDown(window, { key: 'B' });
    expect(onSelectChoice).toHaveBeenCalledWith(1);
  });

  it('letters beyond the option count are ignored', () => {
    const { onSelectChoice } = setup(choice);
    fireEvent.keyDown(window, { key: 'c' });
    expect(onSelectChoice).not.toHaveBeenCalled();
  });

  it('digits select in-range scale values; out-of-range ignored', () => {
    const { onSelectScale } = setup(scale);
    fireEvent.keyDown(window, { key: '3' });
    expect(onSelectScale).toHaveBeenCalledWith(3);
    onSelectScale.mockClear();
    fireEvent.keyDown(window, { key: '9' });
    expect(onSelectScale).not.toHaveBeenCalled();
  });

  it('Esc is a no-op by default, fires onBack when escapeBack is set', () => {
    const first = setup(welcome);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(first.onBack).not.toHaveBeenCalled();

    const second = setup(welcome, { escapeBack: true });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(second.onBack).toHaveBeenCalledTimes(1);
  });

  it('Y / N answer yes_no questions', () => {
    const { onSelectChoice } = setup(yesNo);
    fireEvent.keyDown(window, { key: 'y' });
    expect(onSelectChoice).toHaveBeenCalledWith(0);
    fireEvent.keyDown(window, { key: 'N' });
    expect(onSelectChoice).toHaveBeenCalledWith(1);
  });

  it('A / B answer legal questions', () => {
    const { onSelectChoice } = setup(legal);
    fireEvent.keyDown(window, { key: 'a' });
    expect(onSelectChoice).toHaveBeenCalledWith(0);
    fireEvent.keyDown(window, { key: 'b' });
    expect(onSelectChoice).toHaveBeenCalledWith(1);
  });

  it('A/B select picture_choice options', () => {
    const { onSelectChoice } = setup(picture);
    fireEvent.keyDown(window, { key: 'b' });
    expect(onSelectChoice).toHaveBeenCalledWith(1);
    fireEvent.keyDown(window, { key: 'c' });
    expect(onSelectChoice).toHaveBeenCalledTimes(1);
  });

  it('digits 0–9 select NPS values', () => {
    const { onSelectScale } = setup(nps);
    fireEvent.keyDown(window, { key: '0' });
    expect(onSelectScale).toHaveBeenCalledWith(0);
    fireEvent.keyDown(window, { key: '9' });
    expect(onSelectScale).toHaveBeenCalledWith(9);
  });

  it('modifier keys suppress shortcuts', () => {
    const { onSelectChoice } = setup(choice);
    fireEvent.keyDown(window, { key: 'a', ctrlKey: true });
    expect(onSelectChoice).not.toHaveBeenCalled();
  });

  it('disabled hook ignores everything', () => {
    const { onAdvance } = setup(welcome, { enabled: false });
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onAdvance).not.toHaveBeenCalled();
  });
});
