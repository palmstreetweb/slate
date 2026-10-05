/**
 * Wave C field UIs (ADR-065), rendered through QuestionRenderer (so the
 * on-demand load and the shared prop contract are covered) and end to end
 * through <Form>: swipe cards, pin the spot, the voice note, location, the
 * photo checklist and the availability grid. The browser APIs they use
 * (MediaRecorder, getUserMedia, geolocation, file pickers) are stubbed.
 */

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useRef } from 'react';
import { Form, defineSchema, OUT_OF_AREA_VALUE } from '@/index.js';
import type { Question } from '@/index.js';
import { QuestionRenderer } from '@/components/questions/QuestionRenderer.js';
import { FormConfirmRefContext } from '@/hooks/useRegisterFormConfirm.js';
import {
  VOICE_MIME_PREFERENCE,
  failedMimes,
  pickVoiceMime,
} from '@/components/questions/ext/voiceFormat.js';
import type { LooseAnswers } from '@/types/Answers.js';
import type { FileUploadHandler } from '@/utils/createFileUploadHandler.js';

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
});

function Harness(props: {
  question: Question;
  answers: LooseAnswers;
  setAnswer: (id: string, value: unknown) => void;
  advance: () => void;
  onFileUpload?: FileUploadHandler;
  allQuestions?: Question[];
}) {
  const confirmRef = useRef<(() => void) | null>(null);
  return (
    <FormConfirmRefContext.Provider value={confirmRef}>
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
          allQuestions={props.allQuestions ?? [props.question]}
        />
      </div>
    </FormConfirmRefContext.Provider>
  );
}

function renderField(
  question: Question,
  answers: LooseAnswers = {},
  extra: Partial<Parameters<typeof Harness>[0]> = {},
) {
  const setAnswer = vi.fn<(id: string, value: unknown) => void>();
  const advance = vi.fn<() => void>();
  const utils = render(
    <Harness
      question={question}
      answers={answers}
      setAnswer={setAnswer}
      advance={advance}
      {...extra}
    />,
  );
  return { ...utils, setAnswer, advance };
}

const lastAnswer = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls[fn.mock.calls.length - 1]?.[1];

/* ---------- swipe cards ---------- */

describe('swipe cards on picture choice', () => {
  const q: Question = {
    id: 'style',
    type: 'picture_choice',
    title: 'Which do you like?',
    display: 'swipe',
    multiple: true,
    options: [
      { label: 'Craftsman', value: 'craft', src: 'https://example.com/a.jpg' },
      { label: 'Farmhouse', value: 'farm', src: 'https://example.com/b.jpg' },
      { label: 'Spanish', value: 'spanish', src: 'https://example.com/c.jpg' },
    ],
  };

  it('is a card stack you can answer without swiping: buttons, arrow keys, undo', async () => {
    const { setAnswer, advance } = renderField(q);
    const like = await screen.findByRole('button', { name: 'Like Craftsman' });
    expect(screen.getByRole('group', { name: 'Which do you like?' })).toHaveAttribute(
      'aria-roledescription',
      'card stack',
    );
    fireEvent.click(like);
    expect(screen.getByRole('button', { name: 'Like Farmhouse' })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(screen.getByText('Passed on Farmhouse. Card 3 of 3: Spanish.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByRole('button', { name: 'Like Farmhouse' })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    // Done: the liked list is the answer, the same shape as the grid.
    expect(screen.getByText('You liked 2 of 3')).toBeInTheDocument();
    expect(lastAnswer(setAnswer)).toEqual(['craft', 'farm']);
    fireEvent.click(screen.getByRole('button', { name: /ok/i }));
    expect(advance).toHaveBeenCalled();
  });

  it('a finished deck comes back as the summary; Swipe again starts over', async () => {
    const { setAnswer } = renderField(q, { style: ['spanish'] });
    expect(await screen.findByText('You liked 1 of 3')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Swipe again' }));
    expect(screen.getByRole('button', { name: 'Like Craftsman' })).toBeInTheDocument();
    expect(lastAnswer(setAnswer)).toBeUndefined();
  });

  it('min likes are checked on OK, in the deck’s own words (CH-11)', async () => {
    const { advance } = renderField({ ...q, min: 1 } as Question);
    await screen.findByRole('button', { name: 'Like Craftsman' });
    // The rule is shown over the deck.
    expect(screen.getByText('Like at least 1')).toBeInTheDocument();
    for (let i = 0; i < 3; i++) fireEvent.keyDown(window, { key: 'ArrowLeft' });
    // Never "That's an answer too" above an error that says it isn't.
    expect(screen.queryByText('None of these? That’s an answer too.')).not.toBeInTheDocument();
    expect(screen.getByText('Like at least 1 to go on.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /ok/i }));
    expect(
      screen.getByText('! Like at least 1 to go on. Tap Swipe again to look again.'),
    ).toBeInTheDocument();
    expect(advance).not.toHaveBeenCalled();
  });

  it('with no minimum, liking nothing is an answer', async () => {
    const { advance } = renderField(q);
    await screen.findByRole('button', { name: 'Like Craftsman' });
    for (let i = 0; i < 3; i++) fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(screen.getByText('None of these? That’s an answer too.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /ok/i }));
    expect(advance).toHaveBeenCalled();
  });

  it('a drag past the edge decides; a short drag springs back', async () => {
    const { setAnswer } = renderField(q);
    await screen.findByRole('button', { name: 'Like Craftsman' });
    const card = document.querySelector('.slate-swipe-card--top') as HTMLElement;
    card.getBoundingClientRect = () => ({
      width: 300,
      height: 400,
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 300,
      bottom: 400,
      toJSON: () => ({}),
    });
    fireEvent.pointerDown(card, {
      pointerId: 1,
      clientX: 150,
      clientY: 200,
      button: 0,
      pointerType: 'mouse',
    });
    // Under the flick distance, however fast.
    fireEvent.pointerMove(card, { pointerId: 1, clientX: 170, clientY: 200 });
    fireEvent.pointerUp(card, { pointerId: 1, clientX: 170, clientY: 200 });
    expect(screen.getByRole('button', { name: 'Like Craftsman' })).toBeInTheDocument();
    const top = document.querySelector('.slate-swipe-card--top') as HTMLElement;
    top.getBoundingClientRect = card.getBoundingClientRect;
    fireEvent.pointerDown(top, {
      pointerId: 2,
      clientX: 150,
      clientY: 200,
      button: 0,
      pointerType: 'mouse',
    });
    fireEvent.pointerMove(top, { pointerId: 2, clientX: 60, clientY: 210 });
    fireEvent.pointerMove(top, { pointerId: 2, clientX: -60, clientY: 210 });
    fireEvent.pointerUp(top, { pointerId: 2, clientX: -60, clientY: 210 });
    expect(screen.getByRole('button', { name: 'Like Farmhouse' })).toBeInTheDocument();
    expect(setAnswer).not.toHaveBeenCalled();
  });

  it('single-select picture choice keeps the grid (swipe needs multi-select)', async () => {
    renderField({ ...q, multiple: false } as Question);
    expect(await screen.findAllByRole('radio')).toHaveLength(3);
    expect(document.querySelector('.slate-swipe')).toBeNull();
  });
});

describe('swipe card on yes / no', () => {
  const q: Question = {
    id: 'first',
    type: 'yes_no',
    title: 'First time with us?',
    display: 'swipe',
  };

  it('the question is the card; ✓ commits yes and advances', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { setAnswer, advance } = renderField(q);
      expect(
        await screen.findByRole('heading', { name: 'First time with us?' }),
      ).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /yes/i }));
      expect(setAnswer).toHaveBeenCalledWith('first', 'yes');
      act(() => {
        vi.advanceTimersByTime(300);
      });
      expect(advance).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('← says no', async () => {
    const { setAnswer } = renderField(q);
    await screen.findByRole('heading', { name: 'First time with us?' });
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(setAnswer).toHaveBeenCalledWith('first', 'no');
  });
});

describe('<Form> with swipe cards', () => {
  it('letter keys don’t pick cards; Y answers a yes / no card', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <Form
        schema={defineSchema({
          brand: { name: 'x' },
          theme: 'classic',
          themeMode: 'light',
          questions: [
            {
              id: 'style',
              type: 'picture_choice',
              title: 'Like?',
              display: 'swipe',
              multiple: true,
              options: [{ label: 'A', value: 'a', src: 'https://example.com/a.jpg' }],
            },
            { id: 'first', type: 'yes_no', title: 'First time?', display: 'swipe' },
            { id: 'done', type: 'thanks', title: 'Thanks' },
          ],
        })}
        onSubmit={onSubmit}
      />,
    );
    await screen.findByRole('button', { name: 'Like A' });
    fireEvent.keyDown(window, { key: 'a' });
    expect(screen.getByRole('button', { name: 'Like A' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Like A' }));
    fireEvent.click(screen.getByRole('button', { name: /ok/i }));
    await screen.findByRole('heading', { name: 'First time?' });
    fireEvent.keyDown(window, { key: 'y' });
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]![0]).toEqual({ style: ['a'], first: 'yes' });
  });
});

/* ---------- pin the spot ---------- */

describe('pin the spot', () => {
  const q: Question = {
    id: 'leak',
    type: 'image_pin',
    title: 'Where’s the leak?',
    image: 'https://example.com/house.jpg',
    imageAlt: 'Front of the house',
    maxPins: 2,
    required: true,
  };

  it('keyboard: arrows move a crosshair, Space drops a numbered pin; notes ride along', async () => {
    const { setAnswer, advance } = renderField(q);
    const area = await screen.findByRole('group', { name: 'Where’s the leak?' });
    expect(screen.getByAltText('Front of the house')).toBeInTheDocument();
    fireEvent.keyDown(area, { key: 'ArrowRight' });
    fireEvent.keyDown(area, { key: 'ArrowRight', shiftKey: true });
    fireEvent.keyDown(area, { key: ' ' });
    expect(lastAnswer(setAnswer)).toEqual({ pins: ['0.62,0.5'] });
    const pin = screen.getByRole('button', { name: /^Pin 1, 62% across, 50% down/ });
    fireEvent.change(screen.getByLabelText('Note for pin 1'), { target: { value: ' leak here ' } });
    expect(lastAnswer(setAnswer)).toEqual({ pins: ['0.62,0.5'], notes: ['leak here'] });
    // A focused pin moves with the arrows.
    fireEvent.keyDown(pin, { key: 'ArrowUp' });
    expect(lastAnswer(setAnswer)).toEqual({ pins: ['0.62,0.48'], notes: ['leak here'] });
    fireEvent.click(screen.getByRole('button', { name: /ok/i }));
    expect(advance).toHaveBeenCalled();
  });

  it('stops at the owner’s limit, and Delete removes a pin', async () => {
    const { setAnswer } = renderField(q);
    const area = await screen.findByRole('group', { name: 'Where’s the leak?' });
    fireEvent.keyDown(area, { key: ' ' });
    fireEvent.keyDown(area, { key: 'ArrowDown' });
    fireEvent.keyDown(area, { key: ' ' });
    fireEvent.keyDown(area, { key: ' ' });
    expect(screen.getByText(/That’s 2 pins — remove one to add another/)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Pin \d/ })).toHaveLength(2);
    fireEvent.keyDown(screen.getByRole('button', { name: /^Pin 1,/ }), { key: 'Delete' });
    expect(lastAnswer(setAnswer)).toEqual({ pins: ['0.5,0.52'] });
  });

  it('required: OK without a pin is refused', async () => {
    const { advance } = renderField(q);
    await screen.findByRole('group', { name: 'Where’s the leak?' });
    fireEvent.click(screen.getByRole('button', { name: /ok/i }));
    expect(screen.getByText(/tap the photo to mark a spot/i)).toBeInTheDocument();
    expect(advance).not.toHaveBeenCalled();
  });

  it('without a usable photo it still takes pins on a plain grid', async () => {
    renderField({ ...q, image: 'javascript:alert(1)' } as Question);
    await screen.findByRole('group', { name: 'Where’s the leak?' });
    expect(document.querySelector('.slate-pin-img')).toBeNull();
    expect(document.querySelector('.slate-pin-blank')).not.toBeNull();
  });

  it('notes off: no note boxes, and the stored answer has none', async () => {
    const { setAnswer } = renderField({ ...q, notes: false } as Question);
    const area = await screen.findByRole('group', { name: 'Where’s the leak?' });
    fireEvent.keyDown(area, { key: ' ' });
    expect(screen.queryByLabelText('Note for pin 1')).toBeNull();
    expect(lastAnswer(setAnswer)).toEqual({ pins: ['0.5,0.5'] });
  });
});

/* ---------- voice note ---------- */

class FakeRecorder {
  static types = new Set(['audio/webm;codecs=opus', 'audio/webm']);
  static isTypeSupported(t: string) {
    return FakeRecorder.types.has(t);
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

function stubMic(mode: 'ok' | 'deny' | 'none') {
  const track = { stop: vi.fn() };
  const stream = { getTracks: () => [track] };
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value:
      mode === 'none'
        ? undefined
        : {
            getUserMedia: vi.fn(async () => {
              if (mode === 'deny')
                throw Object.assign(new Error('no'), { name: 'NotAllowedError' });
              return stream;
            }),
          },
  });
  (globalThis as { MediaRecorder?: unknown }).MediaRecorder =
    mode === 'none' ? undefined : FakeRecorder;
  return track;
}

describe('voice note', () => {
  const q: Question = {
    id: 'story',
    type: 'voice_note',
    title: 'Tell us',
    maxSeconds: 30,
    required: true,
  };

  afterEach(() => {
    delete (globalThis as { MediaRecorder?: unknown }).MediaRecorder;
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined });
  });

  it('asks for the mic only on tap, records, releases it, and uploads the file', async () => {
    const track = stubMic('ok');
    const onFileUpload = vi.fn<FileUploadHandler>(async () => 'slate-file://voice-1');
    const { setAnswer, advance } = renderField(q, {}, { onFileUpload });
    const record = await screen.findByRole('button', { name: 'Start recording' });
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(record);
    });
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
    const stop = await screen.findByRole('button', { name: 'Stop recording' });
    await act(async () => {
      fireEvent.click(stop);
    });
    expect(track.stop).toHaveBeenCalled();
    await waitFor(() => expect(onFileUpload).toHaveBeenCalledTimes(1));
    const [file, qid, ctx] = onFileUpload.mock.calls[0]!;
    expect(file.type).toBe('audio/webm');
    expect(file.name).toBe('voice-note.webm');
    expect(qid).toBe('story');
    expect(ctx?.maxSizeMb).toBeCloseTo((30 * 40_000 + 64 * 1024) / (1024 * 1024));
    await waitFor(() =>
      expect(lastAnswer(setAnswer)).toEqual({ audio: 'slate-file://voice-1', sec: '1' }),
    );
    expect(await screen.findByText('Saved')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Play your recording' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /ok/i }));
    expect(advance).toHaveBeenCalled();
  });

  it('a blocked mic explains itself and offers typing instead', async () => {
    stubMic('deny');
    const { setAnswer, advance } = renderField(q);
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Start recording' }));
    });
    expect(await screen.findByText(/microphone is blocked/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Type instead' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'It leaks after rain' } });
    expect(lastAnswer(setAnswer)).toEqual({ typed: 'It leaks after rain' });
    fireEvent.click(screen.getByRole('button', { name: /ok/i }));
    expect(advance).toHaveBeenCalled();
  });

  // MEDIA-17: with typing off, a missing recorder used to be a dead end on a
  // required question. Typing is now offered when the mic can't be used.
  it('no recorder and typing off: a clear message, required still holds, and typing gets them through', async () => {
    stubMic('none');
    const { setAnswer, advance } = renderField({ ...q, allowTyped: false } as Question);
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Start recording' }));
    });
    expect(await screen.findByText(/can’t record audio here/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /ok/i }));
    expect(screen.getByText(/please record a voice note/i)).toBeInTheDocument();
    expect(advance).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Type instead' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'No mic on this laptop' } });
    fireEvent.click(screen.getByRole('button', { name: /ok/i }));
    expect(lastAnswer(setAnswer)).toEqual({ typed: 'No mic on this laptop' });
    expect(advance).toHaveBeenCalled();
  });

  it('prefers Opus in WebM, then AAC; a format that failed is skipped', () => {
    (globalThis as { MediaRecorder?: unknown }).MediaRecorder = FakeRecorder;
    expect(VOICE_MIME_PREFERENCE[0]).toBe('audio/webm;codecs=opus');
    expect(pickVoiceMime()).toBe('audio/webm;codecs=opus');
    failedMimes.add('audio/webm;codecs=opus');
    expect(pickVoiceMime()).toBe('audio/webm');
    failedMimes.clear();
    FakeRecorder.types = new Set(['audio/mp4']);
    expect(pickVoiceMime()).toBe('audio/mp4');
    FakeRecorder.types = new Set(['audio/webm;codecs=opus', 'audio/webm']);
  });
});

/* ---------- location ---------- */

function stubGeo(result: { lat: number; lng: number } | 'deny') {
  const getCurrentPosition = vi.fn(
    (ok: (p: unknown) => void, err: (e: { code: number }) => void) => {
      if (result === 'deny') err({ code: 1 });
      else ok({ coords: { latitude: result.lat, longitude: result.lng } });
    },
  );
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition },
  });
  return getCurrentPosition;
}

describe('location', () => {
  const q: Question = {
    id: 'where',
    type: 'location',
    title: 'Where’s the job?',
    required: true,
    center: { lat: 34.4208, lng: -119.6982 },
    radius: 25,
  };

  it('asks only on tap; stores rounded coordinates and in / out of the radius', async () => {
    const get = stubGeo({ lat: 34.44123, lng: -119.81234 });
    const { setAnswer, advance } = renderField(q);
    // By default only the verdict is saved, and the page says so (ADR-068).
    expect(
      await screen.findByText('We only save whether you’re in the service area.'),
    ).toBeInTheDocument();
    expect(get).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Use my location' }));
    expect(get).toHaveBeenCalledTimes(1);
    expect(lastAnswer(setAnswer)).toEqual({ lat: '34.441', lng: '-119.812', area: 'in' });
    expect(screen.getByText('You’re in our service area.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /ok/i }));
    expect(advance).toHaveBeenCalled();
  });

  it('says what is saved: the verdict, or the approximate location when the owner keeps it', async () => {
    renderField({ ...q, privacyNote: 'We use this to plan the visit' });
    // The owner's note comes first; what is saved is always said, whatever the note says.
    const line = await screen.findByText(/^We use this to plan the visit\. We only save whether/);
    expect(line).toHaveTextContent(
      'We use this to plan the visit. We only save whether you’re in the service area.',
    );
    expect(screen.getByRole('group')).toHaveAccessibleDescription(line.textContent!);
    cleanup();
    stubGeo({ lat: 34.44123, lng: -119.81234 });
    const { setAnswer } = renderField({ ...q, keepLocation: true });
    expect(
      await screen.findByText(
        'Your approximate location (about 110 m) is shared with this business.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/only save whether/)).toBeNull();
    // Either way the page sends the rounded position, so the server can check the verdict.
    fireEvent.click(screen.getByRole('button', { name: 'Use my location' }));
    expect(lastAnswer(setAnswer)).toEqual({ lat: '34.441', lng: '-119.812', area: 'in' });
  });

  it('while typing, says the typed place is saved as written', async () => {
    renderField(q);
    await screen.findByText('We only save whether you’re in the service area.');
    fireEvent.click(screen.getByRole('button', { name: 'Type it instead' }));
    expect(
      await screen.findByText('We save what you type here, not your exact location.'),
    ).toBeInTheDocument();
  });

  it('outside the radius says so', async () => {
    stubGeo({ lat: 34.0522, lng: -118.2437 });
    const { setAnswer } = renderField(q);
    fireEvent.click(await screen.findByRole('button', { name: 'Use my location' }));
    expect(lastAnswer(setAnswer)).toMatchObject({ area: 'out' });
    expect(screen.getByText('You’re outside our usual area.')).toBeInTheDocument();
  });

  it('denied: a ZIP typed instead is checked against the form’s address areas', async () => {
    stubGeo('deny');
    const address: Question = {
      id: 'addr',
      type: 'address',
      title: 'Address',
      serviceArea: ['931'],
    };
    const { setAnswer } = renderField(q, {}, { allQuestions: [q, address] });
    fireEvent.click(await screen.findByRole('button', { name: 'Use my location' }));
    expect(screen.getByText(/type your ZIP code instead/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Your ZIP code'), { target: { value: '93105' } });
    expect(lastAnswer(setAnswer)).toEqual({ zip: '93105', area: 'in' });
    expect(screen.getByText('In our service area')).toBeInTheDocument();
  });

  it('denied without address areas: the town, as typed', async () => {
    stubGeo('deny');
    const { setAnswer } = renderField(q);
    fireEvent.click(await screen.findByRole('button', { name: 'Use my location' }));
    fireEvent.change(screen.getByLabelText('Your town or ZIP code'), {
      target: { value: 'Goleta' },
    });
    expect(lastAnswer(setAnswer)).toEqual({ typed: 'Goleta' });
  });

  it('required: nothing shared is refused', async () => {
    stubGeo('deny');
    const { advance } = renderField(q);
    await screen.findByRole('button', { name: 'Use my location' });
    fireEvent.click(screen.getByRole('button', { name: /ok/i }));
    expect(screen.getByText(/share your location, or type it instead/i)).toBeInTheDocument();
    expect(advance).not.toHaveBeenCalled();
  });
});

describe('<Form> location routing', () => {
  it('outside the radius jumps to the out-of-area ending', async () => {
    stubGeo({ lat: 34.0522, lng: -118.2437 });
    const outside = { field: 'where', op: 'equals' as const, value: OUT_OF_AREA_VALUE };
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <Form
        schema={defineSchema({
          brand: { name: 'Pools' },
          theme: 'classic',
          themeMode: 'light',
          questions: [
            {
              id: 'where',
              type: 'location',
              title: 'Where?',
              center: { lat: 34.4208, lng: -119.6982 },
              radius: 25,
              logic: [{ if: outside, goTo: 'sorry' }],
            },
            { id: 'name', type: 'short_text', title: 'Name?' },
            { id: 'sorry', type: 'thanks', title: 'Out of area', visibleIf: outside },
            { id: 'done', type: 'thanks', title: 'Thanks' },
          ],
        })}
        onSubmit={onSubmit}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Use my location' }));
    // The owner routes out-of-area answers to an ending: no "you can still continue".
    expect(screen.queryByText(/still continue/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /ok/i }));
    expect(await screen.findByRole('heading', { name: 'Out of area' })).toBeInTheDocument();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]![0]).toEqual({
      where: { lat: '34.052', lng: '-118.244', area: 'out' },
    });
  });
});

/* ---------- photo checklist ---------- */

describe('photo checklist', () => {
  const q: Question = {
    id: 'shots',
    type: 'photo_checklist',
    title: 'Snap a few photos',
    items: [
      { label: 'Front of the house', value: 'front' },
      { label: 'Roof close-up', value: 'roof' },
    ],
  };

  it('each shot opens the rear camera; uploads land item by item with progress', async () => {
    let n = 0;
    const onFileUpload = vi.fn<FileUploadHandler>(async () => `slate-file://photo-${++n}`);
    const { setAnswer, advance } = renderField(q, {}, { onFileUpload });
    await screen.findByText('0 of 2 photos');
    const [camera, library] = Array.from(
      document.querySelectorAll<HTMLInputElement>('.slate-shots-input'),
    );
    expect(camera).toHaveAttribute('capture', 'environment');
    expect(camera).toHaveAttribute('accept', 'image/*');
    expect(library).not.toHaveAttribute('capture');
    fireEvent.click(screen.getByRole('button', { name: 'Take photo: Roof close-up' }));
    await act(async () => {
      fireEvent.change(camera!, {
        target: { files: [new File(['x'], 'IMG_1.jpg', { type: 'image/jpeg' })] },
      });
    });
    await waitFor(() => expect(lastAnswer(setAnswer)).toEqual({ roof: 'slate-file://photo-1' }));
    expect(screen.getByText('1 of 2 photos')).toBeInTheDocument();
    expect(onFileUpload.mock.calls[0]![1]).toBe('shots');
    // Required by default: every shot.
    fireEvent.click(screen.getByRole('button', { name: /ok/i }));
    expect(screen.getByText(/one more photo to go/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Choose a photo for Front of the house' }));
    await act(async () => {
      fireEvent.change(library!, {
        target: { files: [new File(['y'], 'IMG_2.jpg', { type: 'image/jpeg' })] },
      });
    });
    await waitFor(() =>
      expect(lastAnswer(setAnswer)).toEqual({
        roof: 'slate-file://photo-1',
        front: 'slate-file://photo-2',
      }),
    );
    expect(screen.getByText('All set')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /ok/i }));
    expect(advance).toHaveBeenCalled();
  });

  it('a failed upload says why, per shot, and keeps the rest', async () => {
    const onFileUpload = vi.fn<FileUploadHandler>(async () => {
      throw new Error('Too many uploads from this network right now.');
    });
    renderField(q, {}, { onFileUpload });
    await screen.findByText('0 of 2 photos');
    fireEvent.click(screen.getByRole('button', { name: 'Take photo: Front of the house' }));
    await act(async () => {
      fireEvent.change(document.querySelector('.slate-shots-input')!, {
        target: { files: [new File(['x'], 'a.jpg', { type: 'image/jpeg' })] },
      });
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many uploads');
  });
});

/* ---------- availability ---------- */

describe('availability grid', () => {
  const q: Question = {
    id: 'when',
    type: 'availability',
    title: 'When are you free?',
    required: true,
    days: ['mon', 'tue'],
    startTime: '09:00',
    endTime: '12:00',
    slotMinutes: 60,
  };

  it('is a keyboard grid: arrows move, Space toggles, Shift+arrow paints', async () => {
    const { setAnswer } = renderField(q);
    const grid = await screen.findByRole('grid', { name: 'When are you free?' });
    expect(within(grid).getAllByRole('gridcell')).toHaveLength(6);
    const first = within(grid).getByRole('gridcell', { name: 'Monday 9 AM to 10 AM' });
    expect(first).toHaveAttribute('tabindex', '0');
    first.focus();
    fireEvent.keyDown(first, { key: ' ' });
    expect(lastAnswer(setAnswer)).toEqual({ mon: '09:00-10:00' });
    fireEvent.keyDown(first, { key: 'ArrowDown', shiftKey: true });
    expect(lastAnswer(setAnswer)).toEqual({ mon: '09:00-11:00' });
    expect(within(grid).getByRole('gridcell', { name: 'Monday 10 AM to 11 AM' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByText('2 hours free · Mon')).toBeInTheDocument();
  });

  it('a day header fills (and clears) the whole day; Clear empties it', async () => {
    const { setAnswer } = renderField(q);
    await screen.findByRole('grid');
    fireEvent.click(screen.getByRole('button', { name: 'Fill or clear Tuesday' }));
    expect(lastAnswer(setAnswer)).toEqual({ tue: '09:00-12:00' });
    fireEvent.click(screen.getByRole('button', { name: 'Fill or clear 10 AM on every day' }));
    expect(lastAnswer(setAnswer)).toEqual({ mon: '10:00-11:00', tue: '09:00-12:00' });
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(lastAnswer(setAnswer)).toBeUndefined();
  });

  it('a mouse drag paints every cell between, even when it skips some', async () => {
    const { setAnswer } = renderField(q);
    const grid = await screen.findByRole('grid');
    const cell = (k: string) => grid.querySelector(`[data-cell="${k}"]`)!;
    document.elementFromPoint = vi.fn(() => cell('mon:2')) as never;
    fireEvent.pointerDown(cell('mon:0'), { pointerId: 1, button: 0, pointerType: 'mouse' });
    fireEvent.pointerMove(grid, { pointerId: 1, clientX: 5, clientY: 5 });
    fireEvent.pointerUp(grid, { pointerId: 1 });
    expect(lastAnswer(setAnswer)).toEqual({ mon: '09:00-12:00' });
  });

  it('required: an empty week is refused', async () => {
    const { advance } = renderField(q);
    await screen.findByRole('grid');
    fireEvent.click(screen.getByRole('button', { name: /ok/i }));
    expect(screen.getByText(/paint at least one time/i)).toBeInTheDocument();
    expect(advance).not.toHaveBeenCalled();
  });
});
