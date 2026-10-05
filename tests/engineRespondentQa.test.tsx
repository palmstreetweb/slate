/**
 * QA pass (w4a), engine side: a failed submit never shows the thanks title
 * (GAPV-X1), a question whose part didn't download offers a "Try again" that
 * really tries again — a page reload, since browsers refuse a failed module
 * without asking the network (GAP-06, F12) — and `resume="tab"` keeps the
 * save in this tab only (GAP-05).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef } from 'react';
import { Form, defineSchema } from '@/index.js';
import type { Question } from '@/index.js';
import { ThanksScreen } from '@/components/questions/ThanksScreen.js';
import { QuestionRenderer } from '@/components/questions/QuestionRenderer.js';
import { FormConfirmRefContext } from '@/hooks/useRegisterFormConfirm.js';
import { jpgName } from '@/utils/heicToJpeg.js';

// The website / NPS / phone UIs live in one on-demand chunk; this one never downloads.
vi.mock('@/components/questions/ext/CoreFieldsExt.js', () => {
  throw new TypeError('Failed to fetch dynamically imported module: /assets/CoreFieldsExt-x.js');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Thank You screen (GAPV-X1)', () => {
  const question = {
    id: 'done',
    type: 'thanks',
    title: 'Thanks, all done.',
    subtitle: 'We’ll call you tomorrow.',
  } as const;

  it('a failed submit says “Not sent yet.” — no thanks title, no subtitle', () => {
    render(
      <ThanksScreen
        question={question}
        status="error"
        error="We couldn’t send your answers just now."
        onRetry={vi.fn()}
        onRestart={vi.fn()}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Not sent yet.' })).toBeInTheDocument();
    expect(screen.queryByText('Thanks, all done.')).toBeNull();
    expect(screen.queryByText('We’ll call you tomorrow.')).toBeNull();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('a confirmed submit keeps the owner’s title and subtitle', () => {
    render(
      <ThanksScreen
        question={question}
        status="success"
        error={null}
        onRetry={vi.fn()}
        onRestart={vi.fn()}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Thanks, all done.' })).toBeInTheDocument();
    expect(screen.getByText('We’ll call you tomorrow.')).toBeInTheDocument();
  });
});

describe('a question whose part didn’t download (GAP-06, F12)', () => {
  function Harness({ question }: { question: Question }) {
    const confirmRef = useRef<(() => void) | null>(null);
    return (
      <FormConfirmRefContext.Provider value={confirmRef}>
        <QuestionRenderer
          question={question}
          answers={{}}
          setAnswer={vi.fn()}
          advance={vi.fn()}
          stepNumber={1}
          totalSteps={1}
          submitStatus="idle"
          submitError={null}
          onRetrySubmit={vi.fn()}
          onRestart={vi.fn()}
          allQuestions={[question]}
        />
      </FormConfirmRefContext.Provider>
    );
  }

  it('says so plainly, and Try again reloads the page (the only retry that refetches)', async () => {
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<Harness question={{ id: 'site', type: 'url', title: 'Your website?' }} />);
    expect(
      await screen.findByText(
        '! This question didn’t load. Check your connection, then tap Try again.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Your website?' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe('<Form resume="tab"> (GAP-05)', () => {
  const KEY = 'slate-forms-resume:tabform';
  const schema = () =>
    defineSchema({
      id: 'tabform',
      brand: { name: 'Test' },
      theme: 'classic',
      themeMode: 'light',
      questions: [
        { id: 'name', type: 'short_text', title: 'Your name?', required: true },
        { id: 'city', type: 'short_text', title: 'Your city?' },
        { id: 'done', type: 'thanks', title: 'Done!' },
      ],
    });

  beforeEach(() => {
    window.sessionStorage.clear();
    window.localStorage.removeItem(KEY);
  });

  it('saves to this tab’s sessionStorage, never localStorage, and offers it back', async () => {
    const user = userEvent.setup();
    const first = render(<Form schema={schema()} resume="tab" onSubmit={vi.fn()} />);
    await user.type(await screen.findByRole('textbox'), 'Ada');
    await user.click(screen.getByRole('button', { name: /ok/i }));
    await screen.findByText('Your city?');
    expect(JSON.parse(window.sessionStorage.getItem(KEY)!).answers).toEqual({ name: 'Ada' });
    expect(window.localStorage.getItem(KEY)).toBeNull();
    first.unmount();

    render(<Form schema={schema()} resume="tab" onSubmit={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /^resume$/i }));
    expect(await screen.findByText('Your city?')).toBeInTheDocument();
  });

  it('Start over deletes this tab’s save', async () => {
    window.sessionStorage.setItem(
      KEY,
      JSON.stringify({ answers: { name: 'Ada' }, step: 1, visitedIds: ['name'], savedAt: '' }),
    );
    const user = userEvent.setup();
    render(<Form schema={schema()} resume="tab" onSubmit={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /start over/i }));
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
  });

  it('plain `resume` still uses localStorage (ADR-017 unchanged)', async () => {
    const user = userEvent.setup();
    render(<Form schema={schema()} resume onSubmit={vi.fn()} />);
    await user.type(await screen.findByRole('textbox'), 'Ada');
    await user.click(screen.getByRole('button', { name: /ok/i }));
    await screen.findByText('Your city?');
    expect(window.localStorage.getItem(KEY)).toContain('Ada');
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
    window.localStorage.removeItem(KEY);
  });
});

describe('photo names (MEDIA-18)', () => {
  it('a photo keeps its own name as a JPEG', () => {
    expect(jpgName('IMG_2041.HEIC')).toBe('IMG_2041.jpg');
    expect(jpgName('photo2.png')).toBe('photo2.jpg');
    expect(jpgName('kitchen.final.jpeg')).toBe('kitchen.final.jpg');
    expect(jpgName('.jpg')).toBe('photo.jpg');
    expect(jpgName('')).toBe('photo.jpg');
  });
});
