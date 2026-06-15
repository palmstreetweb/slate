/**
 * Per-question-type render tests + one snapshot each (AGENTS.md testing
 * expectations). Rendered through QuestionRenderer so the dispatch switch
 * is exercised too.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QuestionRenderer } from '@/components/questions/QuestionRenderer.js';
import type { Question } from '@/types/Question.js';
import type { LooseAnswers } from '@/types/Answers.js';

function renderQuestion(
  question: Question,
  answers: LooseAnswers = {},
  onFileUpload?: (file: File, questionId: string) => Promise<string>,
) {
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
      onFileUpload={onFileUpload}
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

  it('url', () => {
    const { container } = renderQuestion({ id: 'site', type: 'url', title: 'Website?' });
    expect(screen.getByRole('textbox')).toHaveAttribute('inputmode', 'url');
    expect(container).toMatchSnapshot();
  });

  it('date', () => {
    const { container } = renderQuestion({ id: 'when', type: 'date', title: 'When?' });
    expect(screen.getByLabelText('Month')).toBeInTheDocument();
    expect(screen.getByLabelText('Day')).toBeInTheDocument();
    expect(screen.getByLabelText('Year')).toBeInTheDocument();
    expect(container).toMatchSnapshot();
  });

  it('dropdown', () => {
    const { container } = renderQuestion({
      id: 'state',
      type: 'dropdown',
      title: 'State?',
      options: [
        { label: 'California', value: 'ca' },
        { label: 'Texas', value: 'tx' },
      ],
    });
    expect(screen.getByRole('combobox')).toBeInTheDocument();
    expect(container).toMatchSnapshot();
  });

  it('yes_no', () => {
    const { container } = renderQuestion({ id: 'insured', type: 'yes_no', title: 'Insured?' });
    expect(screen.getByRole('radio', { name: /yes/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /no/i })).toBeInTheDocument();
    expect(container).toMatchSnapshot();
  });

  it('legal', () => {
    const { container } = renderQuestion({
      id: 'terms',
      type: 'legal',
      title: 'Accept terms?',
      body: 'The fine print.',
    });
    expect(screen.getByRole('radio', { name: /i accept/i })).toBeInTheDocument();
    expect(screen.getByText('The fine print.')).toBeInTheDocument();
    expect(container).toMatchSnapshot();
  });

  it('nps', () => {
    const { container } = renderQuestion({ id: 'rec', type: 'nps', title: 'Recommend us?' });
    expect(screen.getAllByRole('radio')).toHaveLength(11);
    expect(screen.getByText('Not at all likely')).toBeInTheDocument();
    expect(screen.getByText('Extremely likely')).toBeInTheDocument();
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

  it('date segments auto-advance, store ISO, and reject impossible dates', async () => {
    const user = userEvent.setup();
    const { setAnswer, advance } = renderQuestion({
      id: 'when',
      type: 'date',
      title: 'When?',
    });
    const month = screen.getByLabelText('Month');
    const day = screen.getByLabelText('Day');
    const year = screen.getByLabelText('Year');

    await user.type(month, '02');
    // Focus auto-advanced to the day segment after two digits.
    expect(day).toHaveFocus();
    await user.type(day, '30');
    await user.type(year, '2026');
    await user.click(screen.getByRole('button', { name: /ok/i }));
    expect(await screen.findByText(/valid date/i)).toBeInTheDocument();
    expect(advance).not.toHaveBeenCalled();

    await user.clear(day);
    await user.type(day, '28');
    await user.click(screen.getByRole('button', { name: /ok/i }));
    expect(setAnswer).toHaveBeenCalledWith('when', '2026-02-28');
    expect(advance).toHaveBeenCalled();
  });

  it('dropdown filters options and selects via click', async () => {
    const user = userEvent.setup();
    const { setAnswer } = renderQuestion({
      id: 'state',
      type: 'dropdown',
      title: 'State?',
      options: [
        { label: 'California', value: 'ca' },
        { label: 'Colorado', value: 'co' },
        { label: 'Texas', value: 'tx' },
      ],
    });
    await user.type(screen.getByRole('combobox'), 'col');
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent('Colorado');
    await user.click(options[0]!);
    expect(setAnswer).toHaveBeenCalledWith('state', 'co');
  });

  it('dropdown blocks OK when required and empty', async () => {
    const user = userEvent.setup();
    const { advance } = renderQuestion({
      id: 'state',
      type: 'dropdown',
      title: 'State?',
      options: [{ label: 'California', value: 'ca' }],
    });
    await user.click(screen.getByRole('button', { name: /ok/i }));
    expect(await screen.findByText(/pick one/i)).toBeInTheDocument();
    expect(advance).not.toHaveBeenCalled();
  });

  it('yes_no click stores yes/no', async () => {
    const user = userEvent.setup();
    const { setAnswer } = renderQuestion({ id: 'insured', type: 'yes_no', title: 'Insured?' });
    await user.click(screen.getByRole('radio', { name: /no/i }));
    expect(setAnswer).toHaveBeenCalledWith('insured', 'no');
  });

  it('legal click stores accept/decline', async () => {
    const user = userEvent.setup();
    const { setAnswer } = renderQuestion({ id: 'terms', type: 'legal', title: 'Terms?' });
    await user.click(screen.getByRole('radio', { name: /i accept/i }));
    expect(setAnswer).toHaveBeenCalledWith('terms', 'accept');
  });

  it('nps click stores the 0–10 value', async () => {
    const user = userEvent.setup();
    const { setAnswer } = renderQuestion({ id: 'rec', type: 'nps', title: 'Recommend?' });
    await user.click(screen.getByRole('radio', { name: '10' }));
    expect(setAnswer).toHaveBeenCalledWith('rec', 10);
  });

  it('url normalizes bare domains and rejects junk', async () => {
    const user = userEvent.setup();
    const { setAnswer, advance } = renderQuestion({ id: 'site', type: 'url', title: 'Site?' });
    await user.type(screen.getByRole('textbox'), 'not a url');
    await user.click(screen.getByRole('button', { name: /ok/i }));
    expect(await screen.findByText(/valid website/i)).toBeInTheDocument();
    expect(advance).not.toHaveBeenCalled();

    await user.clear(screen.getByRole('textbox'));
    await user.type(screen.getByRole('textbox'), 'example.com');
    await user.click(screen.getByRole('button', { name: /ok/i }));
    expect(setAnswer).toHaveBeenCalledWith('site', 'https://example.com');
    expect(advance).toHaveBeenCalled();
  });
});

describe('phase 3 question types', () => {
  const pictureOpts = [
    { label: 'Cat', value: 'cat', src: 'https://example.com/cat.jpg' },
    { label: 'Dog', value: 'dog', src: 'https://example.com/dog.jpg' },
    { label: 'Bird', value: 'bird', src: 'https://example.com/bird.jpg' },
  ];

  it('file_upload renders drop zone + snapshot', () => {
    const { container } = renderQuestion({
      id: 'doc',
      type: 'file_upload',
      title: 'Upload your doc',
      maxSizeMb: 5,
    });
    expect(screen.getByText(/choose a file/i)).toBeInTheDocument();
    expect(screen.getByText(/max 5 MB/i)).toBeInTheDocument();
    expect(container).toMatchSnapshot();
  });

  it('file_upload stores the raw File when no onFileUpload is given', async () => {
    const user = userEvent.setup();
    const { container, setAnswer, advance } = renderQuestion({
      id: 'doc',
      type: 'file_upload',
      title: 'Upload your doc',
      required: true,
    });
    const file = new File(['hello'], 'hello.txt', { type: 'text/plain' });
    const input = container.querySelector('input[type="file"]')!;
    fireEvent.change(input, { target: { files: [file] } });
    expect(setAnswer).toHaveBeenCalledWith('doc', file);
    expect(screen.getByText(/hello\.txt/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /ok/i }));
    expect(advance).toHaveBeenCalled();
  });

  it('file_upload hands the file to onFileUpload and stores the returned string', async () => {
    const onFileUpload = vi.fn().mockResolvedValue('https://cdn.example.com/hello.txt');
    const { container, setAnswer } = renderQuestion(
      { id: 'doc', type: 'file_upload', title: 'Upload your doc' },
      {},
      onFileUpload,
    );
    const file = new File(['hello'], 'hello.txt', { type: 'text/plain' });
    fireEvent.change(container.querySelector('input[type="file"]')!, {
      target: { files: [file] },
    });
    await waitFor(() =>
      expect(setAnswer).toHaveBeenCalledWith('doc', 'https://cdn.example.com/hello.txt'),
    );
    expect(onFileUpload).toHaveBeenCalledWith(file, 'doc', { maxSizeMb: undefined });
  });

  it('file_upload rejects files over maxSizeMb', () => {
    const { container, setAnswer } = renderQuestion({
      id: 'doc',
      type: 'file_upload',
      title: 'Upload your doc',
      maxSizeMb: 1,
    });
    const big = new File([new ArrayBuffer(2 * 1024 * 1024)], 'big.bin');
    fireEvent.change(container.querySelector('input[type="file"]')!, {
      target: { files: [big] },
    });
    expect(screen.getByText(/too large/i)).toBeInTheDocument();
    expect(setAnswer).not.toHaveBeenCalled();
  });

  it('file_upload blocks OK when required and empty', async () => {
    const user = userEvent.setup();
    const { advance } = renderQuestion({
      id: 'doc',
      type: 'file_upload',
      title: 'Upload your doc',
      required: true,
    });
    await user.click(screen.getByRole('button', { name: /ok/i }));
    expect(await screen.findByText(/Please choose a file/)).toBeInTheDocument();
    expect(advance).not.toHaveBeenCalled();
  });

  it('picture_choice renders the image grid + snapshot', () => {
    const { container } = renderQuestion({
      id: 'pet',
      type: 'picture_choice',
      title: 'Pick a pet',
      options: pictureOpts,
    });
    expect(screen.getAllByRole('radio')).toHaveLength(3);
    expect(screen.getByAltText('Cat')).toBeInTheDocument();
    expect(container).toMatchSnapshot();
  });

  it('picture_choice single select stores the value and advances', async () => {
    const user = userEvent.setup();
    const { setAnswer, advance } = renderQuestion({
      id: 'pet',
      type: 'picture_choice',
      title: 'Pick a pet',
      options: pictureOpts,
    });
    await user.click(screen.getByRole('radio', { name: /dog/i }));
    expect(setAnswer).toHaveBeenCalledWith('pet', 'dog');
    // Auto-advance fires after a 220ms highlight pause.
    await waitFor(() => expect(advance).toHaveBeenCalled());
  });

  it('picture_choice multiple toggles and enforces min', async () => {
    const user = userEvent.setup();
    const { setAnswer, advance } = renderQuestion({
      id: 'pets',
      type: 'picture_choice',
      title: 'Pick pets',
      options: pictureOpts,
      multiple: true,
      min: 1,
    });
    await user.click(screen.getByRole('button', { name: /ok/i }));
    expect(await screen.findByText(/at least one/i)).toBeInTheDocument();
    expect(advance).not.toHaveBeenCalled();

    await user.click(screen.getByRole('checkbox', { name: /cat/i }));
    expect(setAnswer).toHaveBeenCalledWith('pets', ['cat']);
  });

  it('ranking renders + snapshot, reorders via buttons, submits full order', async () => {
    const user = userEvent.setup();
    const { container, setAnswer, advance } = renderQuestion({
      id: 'rank',
      type: 'ranking',
      title: 'Rank these',
      options: [
        { label: 'Alpha', value: 'a' },
        { label: 'Beta', value: 'b' },
        { label: 'Gamma', value: 'c' },
      ],
    });
    expect(container).toMatchSnapshot();

    await user.click(screen.getByRole('button', { name: /move gamma up/i }));
    await user.click(screen.getByRole('button', { name: /ok/i }));
    expect(setAnswer).toHaveBeenCalledWith('rank', ['a', 'c', 'b']);
    expect(advance).toHaveBeenCalled();
  });

  it('matrix renders + snapshot, single-select per row, required blocks gaps', async () => {
    const user = userEvent.setup();
    const { container, setAnswer, advance } = renderQuestion({
      id: 'rate',
      type: 'matrix',
      title: 'Rate each',
      required: true,
      rows: [
        { label: 'Quality', value: 'quality' },
        { label: 'Speed', value: 'speed' },
      ],
      columns: [
        { label: 'Poor', value: 'poor' },
        { label: 'Great', value: 'great' },
      ],
    });
    expect(container).toMatchSnapshot();

    await user.click(screen.getByRole('radio', { name: 'Quality: Great' }));
    expect(setAnswer).toHaveBeenCalledWith('rate', { quality: 'great' });

    await user.click(screen.getByRole('button', { name: /ok/i }));
    expect(await screen.findByText(/answer every row/i)).toBeInTheDocument();
    expect(advance).not.toHaveBeenCalled();

    await user.click(screen.getByRole('radio', { name: 'Speed: Poor' }));
    await user.click(screen.getByRole('button', { name: /ok/i }));
    expect(advance).toHaveBeenCalled();
  });

  it('matrix multiple toggles checkbox cells', async () => {
    const user = userEvent.setup();
    const { setAnswer } = renderQuestion({
      id: 'use',
      type: 'matrix',
      title: 'Which apply?',
      multiple: true,
      rows: [{ label: 'Web', value: 'web' }],
      columns: [
        { label: 'Daily', value: 'daily' },
        { label: 'Weekly', value: 'weekly' },
      ],
    });
    await user.click(screen.getByRole('checkbox', { name: 'Web: Daily' }));
    expect(setAnswer).toHaveBeenCalledWith('use', { web: ['daily'] });
    await user.click(screen.getByRole('checkbox', { name: 'Web: Weekly' }));
    expect(setAnswer).toHaveBeenLastCalledWith('use', { web: ['daily', 'weekly'] });
  });
});
