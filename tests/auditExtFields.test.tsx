/**
 * Engine audit fixes (2026-10-09) in the on-demand fields: the swipe deck and
 * a signature keep their progress across Back, an untouched optional stepper
 * stores nothing, Cmd/Ctrl+A in a time box is select-all, "Type instead"
 * while a recording saves, a late position never overwrites a typed place,
 * and Shift + arrows paint from a busy time too.
 */

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useRef } from 'react';
import { QuestionRenderer } from '@/components/questions/QuestionRenderer.js';
import { FormConfirmRefContext, FormDraftsContext } from '@/hooks/useRegisterFormConfirm.js';
import type { Question } from '@/types/Question.js';
import type { LooseAnswers } from '@/types/Answers.js';
import type { FileUploadHandler } from '@/utils/createFileUploadHandler.js';

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function Harness(props: {
  question: Question;
  answers: LooseAnswers;
  setAnswer: (id: string, value: unknown) => void;
  advance: () => void;
  drafts: Map<string, unknown>;
  onFileUpload?: FileUploadHandler;
}) {
  const confirmRef = useRef<(() => void) | null>(null);
  return (
    <FormConfirmRefContext.Provider value={confirmRef}>
      <FormDraftsContext.Provider value={props.drafts}>
        <div data-slate-forms="" data-theme-name="classic" data-theme="light">
          <QuestionRenderer
            question={props.question}
            answers={props.answers}
            setAnswer={props.setAnswer}
            advance={props.advance}
            stepNumber={1}
            totalSteps={2}
            submitStatus="idle"
            submitError={null}
            onRetrySubmit={vi.fn()}
            onRestart={vi.fn()}
            onFileUpload={props.onFileUpload}
            allQuestions={[props.question]}
          />
        </div>
      </FormDraftsContext.Provider>
    </FormConfirmRefContext.Provider>
  );
}

/** Render a field as `<Form>` does, with the drafts map Back would keep. */
function renderField(
  question: Question,
  answers: LooseAnswers = {},
  extra: { drafts?: Map<string, unknown>; onFileUpload?: FileUploadHandler } = {},
) {
  const setAnswer = vi.fn<(id: string, value: unknown) => void>();
  const advance = vi.fn<() => void>();
  const drafts = extra.drafts ?? new Map<string, unknown>();
  const utils = render(
    <Harness
      question={question}
      answers={answers}
      setAnswer={setAnswer}
      advance={advance}
      drafts={drafts}
      onFileUpload={extra.onFileUpload}
    />,
  );
  return { ...utils, setAnswer, advance, drafts };
}

const lastAnswer = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls[fn.mock.calls.length - 1]?.[1];

describe('swipe deck keeps its progress across Back (bug 7)', () => {
  const q: Question = {
    id: 'style',
    type: 'picture_choice',
    title: 'Which do you like?',
    display: 'swipe',
    multiple: true,
    options: [
      { label: 'One', value: 'one', src: 'https://img.example/1.jpg' },
      { label: 'Two', value: 'two', src: 'https://img.example/2.jpg' },
      { label: 'Three', value: 'three', src: 'https://img.example/3.jpg' },
    ],
  };

  it('comes back on card 2 with card 1 liked', async () => {
    const { drafts, unmount } = renderField(q);
    await screen.findByText('1 / 3');
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    await screen.findByText('2 / 3');
    unmount();
    const { setAnswer, advance } = renderField(q, {}, { drafts });
    expect(await screen.findByText('2 / 3')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    fireEvent.click(await screen.findByRole('button', { name: /ok/i }));
    expect(lastAnswer(setAnswer)).toEqual(['one']);
    expect(advance).toHaveBeenCalled();
  });
});

describe('an untouched optional stepper stores nothing (bug 10)', () => {
  const q: Question = {
    id: 'n',
    type: 'number',
    title: 'How many?',
    display: 'stepper',
    min: 2,
    max: 4,
    required: false,
  };

  it('OK without touching it stores no answer; a step stores the number shown', async () => {
    const first = renderField(q);
    fireEvent.click(await screen.findByRole('button', { name: /ok/i }));
    expect(first.setAnswer).toHaveBeenCalledWith('n', undefined);
    expect(first.advance).toHaveBeenCalled();
    cleanup();
    const second = renderField(q);
    fireEvent.click(await screen.findByRole('button', { name: 'Increase by 1' }));
    fireEvent.click(screen.getByRole('button', { name: /ok/i }));
    expect(second.setAnswer).toHaveBeenCalledWith('n', 3);
    cleanup();
    // Required: the starting number is still what is shown, and what is sent.
    const third = renderField({ ...q, required: true } as Question);
    fireEvent.click(await screen.findByRole('button', { name: /ok/i }));
    expect(third.setAnswer).toHaveBeenCalledWith('n', 2);
  });
});

describe('Cmd / Ctrl + A or P in a time box (bug 13)', () => {
  it('is the browser’s own, not AM / PM', async () => {
    renderField({ id: 'd', type: 'date', title: 'When?', includeTime: true } as Question);
    const hour = await screen.findByLabelText('Hour');
    fireEvent.change(hour, { target: { value: '09' } });
    const am = () => screen.getByRole('radio', { name: 'AM' });
    expect(am()).toHaveAttribute('aria-checked', 'true');
    fireEvent.keyDown(hour, { key: 'p', metaKey: true });
    fireEvent.keyDown(hour, { key: 'p', ctrlKey: true });
    expect(am()).toHaveAttribute('aria-checked', 'true');
    fireEvent.keyDown(hour, { key: 'p' });
    expect(screen.getByRole('radio', { name: 'PM' })).toHaveAttribute('aria-checked', 'true');
  });
});

describe('a signature keeps its typed name and tab across Back (bug 4)', () => {
  it('comes back on the typed tab with the name', async () => {
    const q: Question = { id: 'sig', type: 'signature', title: 'Sign', allowTyped: true };
    const { drafts, unmount } = renderField(q);
    fireEvent.click(await screen.findByRole('button', { name: 'Type your name instead' }));
    fireEvent.change(screen.getByPlaceholderText('Jane Smith'), { target: { value: 'Ada L' } });
    unmount();
    renderField(q, {}, { drafts });
    expect(await screen.findByPlaceholderText('Jane Smith')).toHaveValue('Ada L');
  });
});

/* ---------- voice note ---------- */

class FakeRecorder {
  static isTypeSupported(t: string) {
    return t === 'audio/webm;codecs=opus' || t === 'audio/webm';
  }
  mimeType: string;
  state = 'inactive';
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(_stream: unknown, opts?: { mimeType?: string }) {
    this.mimeType = opts?.mimeType ?? 'audio/webm';
  }
  start() {
    this.state = 'recording';
  }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob([new Uint8Array(2048)], { type: this.mimeType }) });
    this.onstop?.();
  }
}

describe('voice note: "Type instead" while the recording saves (suspect)', () => {
  afterEach(() => {
    delete (globalThis as { MediaRecorder?: unknown }).MediaRecorder;
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined });
  });

  it('OK goes with the typed answer, and the upload landing later changes nothing', async () => {
    const stream = { getTracks: () => [{ stop: vi.fn() }] };
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => stream) },
    });
    (globalThis as { MediaRecorder?: unknown }).MediaRecorder = FakeRecorder;
    let finish: (ref: string) => void = () => {};
    const onFileUpload = vi.fn<FileUploadHandler>(
      () => new Promise<string>((resolve) => (finish = resolve)),
    );
    const q: Question = { id: 'story', type: 'voice_note', title: 'Tell us', required: true };
    const { setAnswer, advance } = renderField(q, {}, { onFileUpload });
    const record = await screen.findByRole(
      'button',
      { name: 'Start recording' },
      { timeout: 8000 },
    );
    await act(async () => {
      fireEvent.click(record);
    });
    const stop = await screen.findByRole('button', { name: 'Stop recording' });
    await act(async () => {
      fireEvent.click(stop);
    });
    await waitFor(() => expect(onFileUpload).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Type instead' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'It leaks after rain' } });
    fireEvent.click(screen.getByRole('button', { name: /ok/i }));
    expect(screen.queryByText('Still saving your recording…')).toBeNull();
    expect(advance).toHaveBeenCalled();
    expect(lastAnswer(setAnswer)).toEqual({ typed: 'It leaks after rain' });
    await act(async () => {
      finish('slate-file://voice-late');
    });
    expect(lastAnswer(setAnswer)).toEqual({ typed: 'It leaks after rain' });
  });
});

describe('location: a late position never overwrites a typed place (suspect)', () => {
  it('after "Type it instead", the position that lands is dropped', async () => {
    let deliver: ((p: unknown) => void) | null = null;
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition: vi.fn((ok: (p: unknown) => void) => {
          deliver = ok;
        }),
      },
    });
    const q: Question = {
      id: 'where',
      type: 'location',
      title: 'Where?',
      required: true,
      center: { lat: 34.4208, lng: -119.6982 },
      radius: 25,
    };
    const { setAnswer } = renderField(q);
    fireEvent.click(await screen.findByRole('button', { name: 'Use my location' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Type it instead' }));
    fireEvent.change(await screen.findByRole('textbox'), { target: { value: 'Goleta' } });
    expect(lastAnswer(setAnswer)).toEqual({ typed: 'Goleta' });
    await act(async () => {
      deliver!({ coords: { latitude: 34.44123, longitude: -119.81234 } });
    });
    expect(lastAnswer(setAnswer)).toEqual({ typed: 'Goleta' });
    expect(screen.getByRole('textbox')).toHaveValue('Goleta');
    expect(screen.queryByText(/Got it/)).toBeNull();
  });
});

describe('availability: Shift + arrows paint from a busy time too (suspect)', () => {
  it('marks both times free', async () => {
    const q: Question = {
      id: 'when',
      type: 'availability',
      title: 'When are you free?',
      days: ['mon'],
      startTime: '09:00',
      endTime: '12:00',
      slotMinutes: 60,
    };
    const { setAnswer } = renderField(q);
    const grid = await screen.findByRole('grid', { name: 'When are you free?' });
    const first = within(grid).getByRole('gridcell', { name: 'Monday 9 AM to 10 AM' });
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowDown', shiftKey: true });
    expect(lastAnswer(setAnswer)).toEqual({ mon: '09:00-11:00' });
    fireEvent.keyDown(within(grid).getByRole('gridcell', { name: 'Monday 10 AM to 11 AM' }), {
      key: 'ArrowDown',
      shiftKey: true,
    });
    expect(lastAnswer(setAnswer)).toEqual({ mon: '09:00-12:00' });
  });
});
