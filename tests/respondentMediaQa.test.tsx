/**
 * QA pass (w4a): files, the photo checklist and the voice note on the
 * respondent's side — type filters that hold for drops and "All files"
 * (MEDIA-08), batches that keep what fits and name what doesn't (MEDIA-10,
 * GAP-22), photos sized after they are made smaller (MEDIA-11), settings a
 * respondent can't meet ignored (MEDIA-05), a failed retake that keeps the
 * earlier photo (MEDIA-09), plain words instead of a browser's (MEDIA-06), a
 * stale "Stop the recording first" (MEDIA-12).
 */

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useRef } from 'react';
import type { Question } from '@/index.js';
import { QuestionRenderer } from '@/components/questions/QuestionRenderer.js';
import { FormConfirmRefContext } from '@/hooks/useRegisterFormConfirm.js';
import { acceptLabel, matchesAccept } from '@/components/questions/FileUploadField.js';
import type { LooseAnswers } from '@/types/Answers.js';
import type { FileUploadHandler } from '@/utils/createFileUploadHandler.js';

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
  // jsdom has no object URLs.
  URL.createObjectURL ??= () => 'blob:test';
  URL.revokeObjectURL ??= () => undefined;
});

function Harness(props: {
  question: Question;
  answers: LooseAnswers;
  setAnswer: (id: string, value: unknown) => void;
  advance: () => void;
  onFileUpload?: FileUploadHandler;
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
          allQuestions={[props.question]}
        />
      </div>
    </FormConfirmRefContext.Provider>
  );
}

function renderField(question: Question, onFileUpload?: FileUploadHandler) {
  const setAnswer = vi.fn<(id: string, value: unknown) => void>();
  const advance = vi.fn<() => void>();
  const utils = render(
    <Harness
      question={question}
      answers={{}}
      setAnswer={setAnswer}
      advance={advance}
      onFileUpload={onFileUpload}
    />,
  );
  return { ...utils, setAnswer, advance };
}

const lastAnswer = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls[fn.mock.calls.length - 1]?.[1];
const bytes = (n: number) => new Uint8Array(n);
const pick = (files: File[]) =>
  act(async () => {
    fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files } });
  });
const drop = (files: File[]) =>
  act(async () => {
    fireEvent.drop(screen.getByRole('button', { name: /choose/i }), {
      dataTransfer: { files, types: ['Files'] },
    });
  });

describe('file type filter (MEDIA-08)', () => {
  it('matchesAccept reads extensions, wildcards and exact types', () => {
    const pdf = new File(['%PDF'], 'doc.pdf', { type: 'application/pdf' });
    const txt = new File(['x'], 'notes.txt', { type: 'text/plain' });
    const heic = new File(['x'], 'IMG_1.HEIC', { type: '' });
    expect(matchesAccept(pdf, '.pdf')).toBe(true);
    expect(matchesAccept(txt, '.pdf')).toBe(false);
    expect(matchesAccept(txt, '')).toBe(true);
    expect(matchesAccept(heic, 'image/*')).toBe(true);
    expect(matchesAccept(pdf, 'image/*')).toBe(false);
    expect(matchesAccept(pdf, 'application/pdf, .docx')).toBe(true);
    expect(matchesAccept(txt, 'text/*')).toBe(true);
  });

  it('acceptLabel says the kinds in words', () => {
    expect(acceptLabel('image/*')).toBe('photos');
    expect(acceptLabel('.pdf')).toBe('PDFs');
    expect(acceptLabel('.docx,.xlsx')).toBe('DOCX or XLSX files');
    expect(acceptLabel('image/*,.pdf')).toBe('photos or PDFs');
    expect(acceptLabel('application/x-weird')).toBeNull();
  });

  it('a dropped notes.txt on a PDF-only question is not attached, and is named', async () => {
    const { setAnswer } = renderField({
      id: 'doc',
      type: 'file_upload',
      title: 'One PDF only',
      accept: '.pdf',
      multiple: false,
    });
    await screen.findByText(/choose a file/i);
    await drop([new File(['hello'], 'notes.txt', { type: 'text/plain' })]);
    expect(
      screen.getByText(/notes\.txt can’t be added — this question takes PDFs only\./),
    ).toBeInTheDocument();
    expect(setAnswer).not.toHaveBeenCalled();
  });

  it('“All files” in the picker can’t slip a PDF into a photos-only question', async () => {
    const { setAnswer } = renderField({
      id: 'pics',
      type: 'file_upload',
      title: 'Images only',
      accept: 'image/*',
    });
    await screen.findByText(/choose files/i);
    await pick([new File(['%PDF'], 'doc.pdf', { type: 'application/pdf' })]);
    expect(screen.getByText(/doc\.pdf can’t be added — this question takes photos only\./)).toBeInTheDocument();
    expect(setAnswer).not.toHaveBeenCalled();
  });
});

describe('batches keep what fits (MEDIA-10, GAP-22)', () => {
  const q: Question = {
    id: 'docs',
    type: 'file_upload',
    title: 'Two files',
    maxFiles: 2,
    maxSizeMb: 1,
  };

  it('three files at once: the first two are added and the third is named', async () => {
    const { setAnswer } = renderField(q);
    await screen.findByText(/choose files/i);
    const a = new File(['a'], 'a.txt', { type: 'text/plain' });
    const b = new File(['b'], 'b.txt', { type: 'text/plain' });
    const c = new File(['c'], 'notes.txt', { type: 'text/plain' });
    await pick([a, b, c]);
    expect(setAnswer).toHaveBeenCalledWith('docs', [a, b]);
    expect(
      screen.getByText(/You can attach up to 2 files, so notes\.txt wasn’t added\./),
    ).toBeInTheDocument();
  });

  it('one oversize file no longer sinks the batch: the small one is added', async () => {
    const { setAnswer } = renderField(q);
    await screen.findByText(/choose files/i);
    const small = new File(['%PDF'], 'doc.pdf', { type: 'application/pdf' });
    const big = new File([bytes(2.5 * 1024 * 1024)], 'big.pdf', { type: 'application/pdf' });
    await pick([small, big]);
    expect(setAnswer).toHaveBeenCalledWith('docs', [small]);
    expect(screen.getByText(/big\.pdf is too big\. The limit is 1 MB\./)).toBeInTheDocument();
  });

  it('an empty file is named and skipped', async () => {
    const { setAnswer } = renderField(q);
    await screen.findByText(/choose files/i);
    await pick([new File([], 'blank.txt', { type: 'text/plain' })]);
    expect(screen.getByText(/blank\.txt is empty, so it wasn’t added\./)).toBeInTheDocument();
    expect(setAnswer).not.toHaveBeenCalled();
  });
});

describe('sizes and settings', () => {
  it('a phone photo over the limit goes to the upload, which makes it smaller (MEDIA-11)', async () => {
    const onFileUpload = vi.fn<FileUploadHandler>(async () => 'slate-file://photo');
    renderField(
      { id: 'pics', type: 'file_upload', title: 'Photos', accept: 'image/*', maxSizeMb: 5 },
      onFileUpload,
    );
    await screen.findByText(/choose files/i);
    await pick([new File([bytes(18 * 1024 * 1024)], 'IMG_4410.jpg', { type: 'image/jpeg' })]);
    await waitFor(() => expect(onFileUpload).toHaveBeenCalledTimes(1));
    expect(onFileUpload.mock.calls[0]![2]).toEqual({ maxSizeMb: 5 });
    expect(screen.queryByText(/too big/)).toBeNull();
  });

  it('a limit of 0 or below is no limit, and a fractional file count is whole (MEDIA-05)', async () => {
    renderField({ id: 'docs', type: 'file_upload', title: 'Docs', maxSizeMb: -1, maxFiles: 2.5 });
    await screen.findByText(/choose files/i);
    expect(screen.queryByText(/max -1 MB/)).toBeNull();
    expect(screen.getByText('0/2 files')).toBeInTheDocument();
  });

  it('a browser’s own error text never reaches the respondent (MEDIA-06)', async () => {
    const onFileUpload = vi.fn<FileUploadHandler>(async () => {
      throw Object.assign(new Error('The quota has been exceeded.'), { name: 'QuotaExceededError' });
    });
    renderField({ id: 'docs', type: 'file_upload', title: 'Docs' }, onFileUpload);
    await screen.findByText(/choose files/i);
    await pick([new File(['x'], 'a.txt', { type: 'text/plain' })]);
    expect(
      await screen.findByText(/We couldn’t add that file\. Try again, or pick a different one\./),
    ).toBeInTheDocument();
    expect(screen.queryByText(/quota/i)).toBeNull();
  });
});

describe('photo checklist', () => {
  const q: Question = {
    id: 'shots',
    type: 'photo_checklist',
    title: 'Snap a few photos',
    items: [
      { label: 'Front of house', value: 'front' },
      { label: 'Roof', value: 'roof' },
    ],
  };
  const shoot = async (item: string, file: File, camera = true) => {
    fireEvent.click(
      screen.getByRole('button', {
        name: camera ? new RegExp(`(Take|Retake) photo: ${item}`) : `Choose a photo for ${item}`,
      }),
    );
    const [cam, lib] = Array.from(document.querySelectorAll<HTMLInputElement>('.slate-shots-input'));
    await act(async () => {
      fireEvent.change(camera ? cam! : lib!, { target: { files: [file] } });
    });
  };
  const jpg = (name: string) => new File(['x'], name, { type: 'image/jpeg' });

  it('takes photos only (MEDIA-08)', async () => {
    const onFileUpload = vi.fn<FileUploadHandler>(async () => 'slate-file://p');
    renderField(q, onFileUpload);
    await screen.findByText('0 of 2 photos');
    await shoot('Front of house', new File(['%PDF'], 'doc.pdf', { type: 'application/pdf' }), false);
    expect(screen.getByRole('alert')).toHaveTextContent('That file isn’t a photo. Take or choose a photo.');
    expect(onFileUpload).not.toHaveBeenCalled();
    expect(screen.getByText('0 of 2 photos')).toBeInTheDocument();
  });

  it('a failed retake keeps the earlier photo, the count, and what is sent (MEDIA-09)', async () => {
    let n = 0;
    const onFileUpload = vi.fn<FileUploadHandler>(async () => {
      n += 1;
      if (n === 3) throw new Error('That upload didn’t go through. Try again.');
      return `slate-file://p${n}`;
    });
    const { setAnswer, advance } = renderField(q, onFileUpload);
    await screen.findByText('0 of 2 photos');
    await shoot('Front of house', jpg('front.jpg'));
    await shoot('Roof', jpg('roof.jpg'));
    await screen.findByText('All set');
    await shoot('Front of house', jpg('front-2.jpg'));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That upload didn’t go through. Try again. We kept your earlier photo.',
    );
    expect(screen.getByText('2 of 2 photos')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /ok/i }));
    expect(advance).toHaveBeenCalled();
    expect(lastAnswer(setAnswer)).toEqual({ front: 'slate-file://p1', roof: 'slate-file://p2' });
  });

  it('a first photo that fails says why in plain words (MEDIA-06)', async () => {
    const onFileUpload = vi.fn<FileUploadHandler>(async () => {
      throw Object.assign(new Error('Encountered full disk while opening backing store for indexedDB.open.'), {
        name: 'UnknownError',
      });
    });
    renderField(q, onFileUpload);
    await screen.findByText('0 of 2 photos');
    await shoot('Roof', jpg('roof.jpg'));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That photo didn’t upload. Try again.',
    );
    expect(screen.queryByText(/backing store|indexedDB/)).toBeNull();
  });
});

/* ---------- voice note ---------- */

class FakeRecorder {
  static isTypeSupported(t: string) {
    return t === 'audio/webm';
  }
  mimeType = 'audio/webm';
  state = 'inactive';
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  start() {
    this.state = 'recording';
  }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob([new Uint8Array(2048)], { type: this.mimeType }) });
    this.onstop?.();
  }
}

function stubMic() {
  const track = { stop: vi.fn() };
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [track] })) },
  });
  (globalThis as { MediaRecorder?: unknown }).MediaRecorder = FakeRecorder;
}

describe('voice note', () => {
  const q: Question = { id: 'story', type: 'voice_note', title: 'Tell us', required: true };

  afterEach(() => {
    delete (globalThis as { MediaRecorder?: unknown }).MediaRecorder;
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined });
  });

  const record = async () => {
    // The voice note is an on-demand chunk: wait for it outside act().
    const start = await screen.findByRole('button', { name: 'Start recording' }, { timeout: 8000 });
    await act(async () => {
      fireEvent.click(start);
    });
    return screen.findByRole('button', { name: 'Stop recording' });
  };

  it('“Stop the recording first” goes away once it stops and saves (MEDIA-12)', async () => {
    stubMic();
    renderField(q, vi.fn<FileUploadHandler>(async () => 'slate-file://v1'));
    const stop = await record();
    fireEvent.click(screen.getByRole('button', { name: /ok/i }));
    expect(screen.getByText(/Stop the recording first/)).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(stop);
    });
    expect(await screen.findByText('Saved')).toBeInTheDocument();
    expect(screen.queryByText(/Stop the recording first/)).toBeNull();
  });

  it('a recording that didn’t save says so, in plain words (MEDIA-06, MEDIA-12)', async () => {
    stubMic();
    const { advance } = renderField(
      q,
      vi.fn<FileUploadHandler>(async () => {
        throw Object.assign(new Error('The quota has been exceeded.'), {
          name: 'QuotaExceededError',
        });
      }),
    );
    const stop = await record();
    await act(async () => {
      fireEvent.click(stop);
    });
    expect(await screen.findByText('Your recording didn’t save. Try again.')).toBeInTheDocument();
    expect(screen.queryByText(/quota/i)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /ok/i }));
    expect(
      screen.getByText(/Your recording didn’t save\. Tap Retry, or type your answer instead\./),
    ).toBeInTheDocument();
    expect(advance).not.toHaveBeenCalled();
  });
});
