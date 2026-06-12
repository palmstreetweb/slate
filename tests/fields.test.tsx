/**
 * Per-question-type render tests + one snapshot each (AGENTS.md testing
 * expectations). Rendered through QuestionRenderer so the dispatch switch
 * is exercised too.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QuestionRenderer } from '@/components/questions/QuestionRenderer.js';
import type { Question } from '@/types/Question.js';
import type { LooseAnswers } from '@/types/Answers.js';

function renderQuestion(question: Question, answers: LooseAnswers = {}) {
  const setAnswer = vi.fn();
  const advance = vi.fn();
  const utils = render(
    <QuestionRenderer
      question={question}
      answers={answers}
      setAnswer={setAnswer}
      advance={advance}
      stepNumber={1}
      totalSteps={3}
      submitStatus="idle"
      submitError={null}
      onRetrySubmit={vi.fn()}
      onRestart={vi.fn()}
    />,
  );
  return { ...utils, setAnswer, advance };
}

describe('question types render', () => {
  it('welcome', () => {
    const { container } = renderQuestion({
      id: 'w',
      type: 'welcome',
      title: 'Hello.',
      subtitle: 'Welcome aboard',
      cta: 'Begin',
    });
    expect(screen.getByText('Hello.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /begin/i })).toBeInTheDocument();
    expect(container).toMatchSnapshot();
  });

  it('statement', () => {
    const { container } = renderQuestion({
      id: 's',
      type: 'statement',
      title: 'Quick note',
      body: 'We never share your data.',
    });
    expect(screen.getByText('Quick note')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /continue/i })).toBeInTheDocument();
    expect(container).toMatchSnapshot();
  });

  it('short_text', () => {
    const { container } = renderQuestion({
      id: 'name',
      type: 'short_text',
      title: 'Name?',
      placeholder: 'Jane',
    });
    expect(screen.getByRole('textbox')).toHaveAttribute('placeholder', 'Jane');
    expect(container).toMatchSnapshot();
  });

  it('long_text', () => {
    const { container } = renderQuestion({ id: 'notes', type: 'long_text', title: 'Notes?' });
    expect(screen.getByRole('textbox').tagName).toBe('TEXTAREA');
    expect(container).toMatchSnapshot();
  });

  it('email', () => {
    const { container } = renderQuestion({ id: 'email', type: 'email', title: 'Email?' });
    expect(screen.getByRole('textbox')).toHaveAttribute('type', 'email');
    expect(container).toMatchSnapshot();
  });

  it('phone', () => {
    const { container } = renderQuestion({ id: 'phone', type: 'phone', title: 'Phone?' });
    expect(screen.getByRole('textbox')).toHaveAttribute('type', 'tel');
    expect(container).toMatchSnapshot();
  });

  it('number', () => {
    const { container } = renderQuestion({ id: 'sqft', type: 'number', title: 'Sq ft?' });
    expect(screen.getByRole('textbox')).toHaveAttribute('inputmode', 'decimal');
    expect(container).toMatchSnapshot();
  });

  it('single_choice', () => {
    const { container } = renderQuestion({
      id: 'svc',
      type: 'single_choice',
      title: 'Service?',
      options: [
        { label: 'One', value: 'one' },
        { label: 'Two', value: 'two', description: 'the second' },
      ],
    });
    expect(screen.getByRole('radiogroup')).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(2);
    expect(container).toMatchSnapshot();
  });

  it('multi_choice', () => {
    const { container } = renderQuestion({
      id: 'addons',
      type: 'multi_choice',
      title: 'Add-ons?',
      options: [
        { label: 'A', value: 'a' },
        { label: 'B', value: 'b' },
      ],
    });
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
    expect(container).toMatchSnapshot();
  });

  it('scale', () => {
    const { container } = renderQuestion({
      id: 'urgency',
      type: 'scale',
      title: 'Urgency?',
      min: 1,
      max: 5,
      minLabel: 'chill',
      maxLabel: 'asap',
    });
    expect(screen.getAllByRole('radio')).toHaveLength(5);
    expect(screen.getByText('chill')).toBeInTheDocument();
    expect(container).toMatchSnapshot();
  });

  it('thanks', () => {
    const { container } = renderQuestion({
      id: 'done',
      type: 'thanks',
      title: 'Done.',
      subtitle: 'Talk soon.',
    });
    expect(screen.getByText('Done.')).toBeInTheDocument();
    expect(container).toMatchSnapshot();
  });
});

describe('field interactions', () => {
  it('single_choice select stores the option value', async () => {
    const user = userEvent.setup();
    const { setAnswer } = renderQuestion({
      id: 'svc',
      type: 'single_choice',
      title: 'Service?',
      options: [{ label: 'One', value: 'one' }],
    });
    await user.click(screen.getByRole('radio', { name: /one/i }));
    expect(setAnswer).toHaveBeenCalledWith('svc', 'one');
  });

  it('multi_choice toggles values and validates min selections', async () => {
    const user = userEvent.setup();
    const { setAnswer, advance } = renderQuestion({
      id: 'addons',
      type: 'multi_choice',
      title: 'Add-ons?',
      min: 1,
      options: [
        { label: 'A', value: 'a' },
        { label: 'B', value: 'b' },
      ],
    });
    // OK with nothing selected → min-selection error, no advance.
    await user.click(screen.getByRole('button', { name: /ok/i }));
    expect(await screen.findByText(/pick at least one/i)).toBeInTheDocument();
    expect(advance).not.toHaveBeenCalled();

    await user.click(screen.getByRole('checkbox', { name: /a/i }));
    expect(setAnswer).toHaveBeenCalledWith('addons', ['a']);
  });

  it('number rejects out-of-range values', async () => {
    const user = userEvent.setup();
    const { advance } = renderQuestion({
      id: 'sqft',
      type: 'number',
      title: 'Sq ft?',
      min: 100,
    });
    await user.type(screen.getByRole('textbox'), '50');
    await user.click(screen.getByRole('button', { name: /ok/i }));
    expect(await screen.findByText(/Minimum is 100/)).toBeInTheDocument();
    expect(advance).not.toHaveBeenCalled();
  });

  it('email rejects an invalid address', async () => {
    const user = userEvent.setup();
    const { advance } = renderQuestion({ id: 'email', type: 'email', title: 'Email?' });
    await user.type(screen.getByRole('textbox'), 'not-an-email');
    await user.click(screen.getByRole('button', { name: /ok/i }));
    expect(await screen.findByText(/valid email/i)).toBeInTheDocument();
    expect(advance).not.toHaveBeenCalled();
  });

  it('scale click answers with the numeric value', async () => {
    const user = userEvent.setup();
    const { setAnswer } = renderQuestion({
      id: 'urgency',
      type: 'scale',
      title: 'Urgency?',
      min: 1,
      max: 3,
    });
    await user.click(screen.getByRole('radio', { name: '2' }));
    expect(setAnswer).toHaveBeenCalledWith('urgency', 2);
  });
});
