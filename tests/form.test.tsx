/**
 * Full <Form> integration tests — rendering, navigation, validation,
 * submit success/error/retry, onQuestionChange, and theme decorations.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Form, defineSchema } from '@/index.js';

function makeSchema() {
  return defineSchema({
    brand: { name: 'Test Co' },
    theme: 'editorial',
    themeMode: 'light',
    questions: [
      { id: 'welcome', type: 'welcome', title: 'Hey there.', cta: 'Start' },
      { id: 'name', type: 'short_text', title: 'Your name?', required: true },
      {
        id: 'service',
        type: 'single_choice',
        title: 'Which service?',
        options: [
          { label: 'Sealcoating', value: 'sealcoat' },
          { label: 'Striping', value: 'striping' },
        ],
      },
      { id: 'done', type: 'thanks', title: 'All set.' },
    ],
  });
}

async function walkToThanks(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /start/i }));
  await user.type(await screen.findByRole('textbox'), 'Caleb');
  await user.click(screen.getByRole('button', { name: /ok/i }));
  await user.click(await screen.findByRole('radio', { name: /sealcoating/i }));
  // single_choice auto-advances after ~220ms.
  await screen.findByText('All set.');
}

describe('<Form> — rendering', () => {
  it('renders welcome screen, brand, and progress bar', () => {
    render(<Form schema={makeSchema()} onSubmit={vi.fn()} />);
    expect(screen.getByText('Hey there.')).toBeInTheDocument();
    expect(screen.getByText('Test Co')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('editorial theme renders the grain decoration', () => {
    render(<Form schema={makeSchema()} onSubmit={vi.fn()} />);
    expect(screen.getByTestId('psw-grain-decoration')).toBeInTheDocument();
  });

  it('swiss theme renders the geometric decoration', () => {
    const schema = { ...makeSchema(), theme: 'swiss' as const };
    render(<Form schema={schema} onSubmit={vi.fn()} />);
    expect(screen.getByTestId('psw-swiss-decoration')).toBeInTheDocument();
  });

  it('unknown custom theme renders no decoration', () => {
    const schema = { ...makeSchema(), theme: 'custom-acme' };
    render(<Form schema={schema} onSubmit={vi.fn()} />);
    expect(screen.queryByTestId('psw-grain-decoration')).not.toBeInTheDocument();
    expect(screen.queryByTestId('psw-swiss-decoration')).not.toBeInTheDocument();
  });
});

describe('<Form> — navigation + validation', () => {
  it('advances from welcome and blocks an empty required field', async () => {
    const user = userEvent.setup();
    render(<Form schema={makeSchema()} onSubmit={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /start/i }));
    expect(await screen.findByText('Your name?')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /ok/i }));
    expect(await screen.findByText(/Please fill this in/)).toBeInTheDocument();
    // Still on the same question.
    expect(screen.getByText('Your name?')).toBeInTheDocument();
  });

  it('back button returns to the previous question', async () => {
    const user = userEvent.setup();
    render(<Form schema={makeSchema()} onSubmit={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /start/i }));
    await screen.findByText('Your name?');
    await user.click(screen.getByRole('button', { name: /back/i }));
    expect(await screen.findByText('Hey there.')).toBeInTheDocument();
  });

  it('fires onQuestionChange on step transitions', async () => {
    const user = userEvent.setup();
    const onQuestionChange = vi.fn();
    render(
      <Form schema={makeSchema()} onSubmit={vi.fn()} onQuestionChange={onQuestionChange} />,
    );
    await user.click(screen.getByRole('button', { name: /start/i }));
    await screen.findByText('Your name?');
    expect(onQuestionChange).toHaveBeenCalledWith('name', expect.any(Object));
  });
});

describe('<Form> — submission', () => {
  it('submits once with answers + meta, then shows the confirmation chip', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<Form schema={makeSchema()} onSubmit={onSubmit} hiddenFields={{ utm: 'x' }} />);

    await walkToThanks(user);

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const [answers, meta] = onSubmit.mock.calls[0]!;
    expect(answers).toEqual({ name: 'Caleb', service: 'sealcoat' });
    // The thanks screen's own visit is recorded one render after onSubmit
    // fires, so the meta lists everything shown before submission.
    expect(meta.questionsVisited).toEqual(['welcome', 'name', 'service']);
    expect(meta.hiddenFields).toEqual({ utm: 'x' });
    expect(meta.startedAt).toBeInstanceOf(Date);
    expect(meta.completedAt).toBeInstanceOf(Date);
    expect(typeof meta.durationMs).toBe('number');

    expect(await screen.findByText(/confirmation sent/i)).toBeInTheDocument();
  });

  it('shows error + retry when onSubmit rejects, and retry can succeed', async () => {
    const user = userEvent.setup();
    const onSubmit = vi
      .fn()
      .mockRejectedValueOnce(new Error('Server exploded'))
      .mockResolvedValueOnce(undefined);
    render(<Form schema={makeSchema()} onSubmit={onSubmit} />);

    await walkToThanks(user);

    expect(await screen.findByText('Server exploded')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /retry/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/confirmation sent/i)).toBeInTheDocument();
  });

  it('restart CTA resets the form to the welcome screen', async () => {
    const user = userEvent.setup();
    render(<Form schema={makeSchema()} onSubmit={vi.fn().mockResolvedValue(undefined)} />);

    await walkToThanks(user);
    await screen.findByText(/confirmation sent/i);

    await user.click(screen.getByRole('button', { name: /submit another/i }));
    expect(await screen.findByText('Hey there.')).toBeInTheDocument();
  });
});

describe('<Form> — dynamic titles', () => {
  it('resolves function titles with prior answers, including number + scale', async () => {
    const user = userEvent.setup();
    const schema = defineSchema({
      brand: { name: 'Test Co' },
      theme: 'editorial',
      themeMode: 'light',
      questions: [
        { id: 'name', type: 'short_text', title: 'Your name?', required: true },
        {
          id: 'sqft',
          type: 'number',
          title: (a) => `How many square feet, ${String(a.name)}?`,
        },
        {
          id: 'urgency',
          type: 'scale',
          title: (a) => `${String(a.name)}, how urgent?`,
          min: 1,
          max: 5,
        },
        { id: 'done', type: 'thanks', title: 'Done.' },
      ],
    });
    render(<Form schema={schema} onSubmit={vi.fn()} />);

    await user.type(screen.getByRole('textbox'), 'Caleb');
    await user.click(screen.getByRole('button', { name: /ok/i }));
    expect(await screen.findByText('How many square feet, Caleb?')).toBeInTheDocument();

    await user.type(screen.getByRole('textbox'), '1200');
    await user.click(screen.getByRole('button', { name: /ok/i }));
    expect(await screen.findByText('Caleb, how urgent?')).toBeInTheDocument();
  });
});

describe('<Form> — piping, scoring, multiple endings (Phase 4)', () => {
  const quizSchema = () =>
    defineSchema({
      brand: { name: 'Quiz Co' },
      theme: 'editorial',
      themeMode: 'light',
      questions: [
        { id: 'name', type: 'short_text', title: 'Your name?', required: true },
        {
          id: 'level',
          type: 'single_choice',
          title: 'Hi {{field:name}} — pick your level',
          options: [
            { label: 'Beginner', value: 'beginner', score: 1 },
            { label: 'Pro', value: 'pro', score: 10 },
          ],
        },
        {
          id: 'pro_end',
          type: 'thanks',
          title: 'Pro detected, {{field:name}}!',
          visibleIf: { field: 'level', op: 'equals', value: 'pro' },
        },
        {
          id: 'done',
          type: 'thanks',
          title: 'Thanks {{field:name}}.',
        },
      ],
    });

  it('pipes {{field:id}} into titles and selects the visibleIf-matching ending', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<Form schema={quizSchema()} onSubmit={onSubmit} />);

    await user.type(screen.getByRole('textbox'), 'Ada');
    await user.click(screen.getByRole('button', { name: /ok/i }));
    expect(await screen.findByText('Hi Ada — pick your level')).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: /pro/i }));
    expect(await screen.findByText('Pro detected, Ada!')).toBeInTheDocument();

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const [, meta] = onSubmit.mock.calls[0]!;
    expect(meta.score).toBe(10);
  });

  it('falls through to the unconditioned ending and reports the other score', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<Form schema={quizSchema()} onSubmit={onSubmit} />);

    await user.type(screen.getByRole('textbox'), 'Bo');
    await user.click(screen.getByRole('button', { name: /ok/i }));
    await user.click(await screen.findByRole('radio', { name: /beginner/i }));
    expect(await screen.findByText('Thanks Bo.')).toBeInTheDocument();

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]![1].score).toBe(1);
  });

  it('review screen lists answers and jumps back for editing', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const schema = defineSchema({
      brand: { name: 'Test' },
      theme: 'editorial',
      themeMode: 'light',
      questions: [
        { id: 'name', type: 'short_text', title: 'Your name?', required: true },
        { id: 'check', type: 'review', title: 'Everything correct?' },
        { id: 'done', type: 'thanks', title: 'Done!' },
      ],
    });
    render(<Form schema={schema} onSubmit={onSubmit} />);

    await user.type(screen.getByRole('textbox'), 'Ada');
    await user.click(screen.getByRole('button', { name: /ok/i }));

    // Review lists the question + answer.
    expect(await screen.findByText('Everything correct?')).toBeInTheDocument();
    expect(screen.getByText('Ada')).toBeInTheDocument();

    // Edit jumps back to the question.
    await user.click(screen.getByRole('button', { name: /edit your name/i }));
    expect(await screen.findByText('Your name?')).toBeInTheDocument();

    // Walk forward again and confirm.
    await user.click(screen.getByRole('button', { name: /ok/i }));
    await screen.findByText('Everything correct?');
    await user.click(screen.getByRole('button', { name: /looks good/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    // Chrome review step contributes nothing to the answers payload.
    expect(onSubmit.mock.calls[0]![0]).toEqual({ name: 'Ada' });
  });

  it('logic jump skips ahead and back returns to the origin', async () => {
    const user = userEvent.setup();
    const schema = defineSchema({
      brand: { name: 'Test' },
      theme: 'editorial',
      themeMode: 'light',
      questions: [
        {
          id: 'interested',
          type: 'yes_no',
          title: 'Interested?',
          logic: [{ if: { field: 'interested', op: 'equals', value: 'no' }, goTo: 'done' }],
        },
        { id: 'email', type: 'email', title: 'Your email?' },
        { id: 'done', type: 'thanks', title: 'Bye.' },
      ],
    });
    render(<Form schema={schema} onSubmit={vi.fn().mockResolvedValue(undefined)} />);

    await user.click(screen.getByRole('radio', { name: /no/i }));
    // Jumps straight past the email question to the ending.
    expect(await screen.findByText('Bye.')).toBeInTheDocument();
    expect(screen.queryByText('Your email?')).not.toBeInTheDocument();
  });
});

describe('<Form> — save-and-resume (ADR-017)', () => {
  const RESUME_KEY = 'psw-forms-resume:intake';

  const resumableSchema = () =>
    defineSchema({
      id: 'intake',
      brand: { name: 'Test' },
      theme: 'editorial',
      themeMode: 'light',
      questions: [
        { id: 'welcome', type: 'welcome', title: 'Hey.', cta: 'Start' },
        { id: 'name', type: 'short_text', title: 'Your name?', required: true },
        { id: 'email', type: 'email', title: 'Your email?' },
        { id: 'done', type: 'thanks', title: 'Done!' },
      ],
    });

  beforeEach(() => {
    window.localStorage.removeItem(RESUME_KEY);
  });

  it('autosaves progress to the namespaced key', async () => {
    const user = userEvent.setup();
    render(<Form schema={resumableSchema()} resume onSubmit={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /start/i }));
    await user.type(await screen.findByRole('textbox'), 'Ada');
    await user.click(screen.getByRole('button', { name: /ok/i }));
    await screen.findByText('Your email?');

    const saved = JSON.parse(window.localStorage.getItem(RESUME_KEY)!);
    expect(saved.answers).toEqual({ name: 'Ada' });
    expect(saved.step).toBe(2);
  });

  it('prompts on remount; Resume restores the session', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(
      RESUME_KEY,
      JSON.stringify({
        answers: { name: 'Ada' },
        step: 2,
        visitedIds: ['welcome', 'name'],
        savedAt: new Date().toISOString(),
      }),
    );
    render(<Form schema={resumableSchema()} resume onSubmit={vi.fn()} />);

    expect(screen.getByText(/pick up where you left off/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^resume$/i }));
    expect(await screen.findByText('Your email?')).toBeInTheDocument();
  });

  it('Start over discards the saved session', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(
      RESUME_KEY,
      JSON.stringify({
        answers: { name: 'Ada' },
        step: 2,
        visitedIds: ['welcome', 'name'],
        savedAt: new Date().toISOString(),
      }),
    );
    render(<Form schema={resumableSchema()} resume onSubmit={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /start over/i }));
    expect(window.localStorage.getItem(RESUME_KEY)).toBeNull();
    expect(screen.getByText('Hey.')).toBeInTheDocument();
  });

  it('clears the save after a successful submit', async () => {
    const user = userEvent.setup();
    render(
      <Form schema={resumableSchema()} resume onSubmit={vi.fn().mockResolvedValue(undefined)} />,
    );

    await user.click(screen.getByRole('button', { name: /start/i }));
    await user.type(await screen.findByRole('textbox'), 'Ada');
    await user.click(screen.getByRole('button', { name: /ok/i }));
    await user.type(await screen.findByRole('textbox'), 'ada@example.com');
    await user.click(screen.getByRole('button', { name: /ok/i }));

    await screen.findByText(/confirmation sent/i);
    expect(window.localStorage.getItem(RESUME_KEY)).toBeNull();
  });

  it('no autosave without the resume prop', async () => {
    const user = userEvent.setup();
    render(<Form schema={resumableSchema()} onSubmit={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /start/i }));
    await user.type(await screen.findByRole('textbox'), 'Ada');
    await user.click(screen.getByRole('button', { name: /ok/i }));
    await screen.findByText('Your email?');
    expect(window.localStorage.getItem(RESUME_KEY)).toBeNull();
  });
});

describe('<Form> — onPartialChange', () => {
  it('fires with visibility-filtered answers and partial meta on each change', async () => {
    const user = userEvent.setup();
    const onPartialChange = vi.fn();
    render(
      <Form schema={makeSchema()} onSubmit={vi.fn()} onPartialChange={onPartialChange} />,
    );

    await user.click(screen.getByRole('button', { name: /start/i }));
    await user.type(await screen.findByRole('textbox'), 'Ada');
    await user.click(screen.getByRole('button', { name: /ok/i }));

    await waitFor(() => expect(onPartialChange).toHaveBeenCalled());
    const [answers, meta] = onPartialChange.mock.calls.at(-1)!;
    expect(answers).toEqual({ name: 'Ada' });
    expect(meta.lastQuestionId).toBeDefined();
    expect(meta.startedAt).toBeInstanceOf(Date);
    expect(typeof meta.score).toBe('number');
  });
});
