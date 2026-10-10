/**
 * Audit fixes (2026-10-09), studio A2: a Build with AI request that never
 * answers no longer pins the modal. The request gives up after 60 s, Cancel
 * stops it, and Escape or the backdrop close the modal after stopping it.
 */

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AiClient from '../examples/_admin/ai/client.js';

const requestGeneratedForm = vi.hoisted(() => vi.fn());
vi.mock('../examples/_admin/ai/client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof AiClient>()),
  requestGeneratedForm,
}));
vi.mock('../examples/_admin/uiSounds.js', () => ({ playUiSound: () => {} }));

import { GENERATE_TIMEOUT_MS, GenerateRequestError } from '../examples/_admin/ai/client.js';
// The module above is mocked for the modal; the request tests want the real one.
const { requestGeneratedForm: realRequest } = await vi.importActual<typeof AiClient>(
  '../examples/_admin/ai/client.js',
);
import { BuildWithAiModal } from '../examples/_admin/components/BuildWithAiModal.js';

async function startGenerating(text = 'A quote form for driveway sealcoating') {
  fireEvent.change(screen.getByPlaceholderText('Type what this form should ask…'), {
    target: { value: text },
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
  });
}

/** A request that never answers unless cancelled. */
function hanging() {
  let signal: AbortSignal | undefined;
  requestGeneratedForm.mockImplementationOnce(
    (_input: unknown, opts?: { signal?: AbortSignal }) =>
      new Promise((_, reject) => {
        signal = opts?.signal;
        signal?.addEventListener('abort', () =>
          reject(new GenerateRequestError('Stopped.', false, true)),
        );
      }),
  );
  return () => signal;
}

beforeEach(() => {
  requestGeneratedForm.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('the modal while a request hangs (audit A2)', () => {
  it('Cancel stops the request and goes back to composing, with nothing to show', async () => {
    const signalOf = hanging();
    const onClose = vi.fn();
    render(<BuildWithAiModal open onClose={onClose} onReady={() => {}} />);
    await startGenerating();
    expect(requestGeneratedForm).toHaveBeenCalledTimes(1);
    expect(signalOf()?.aborted).toBe(false);

    const cancel = screen.getByRole('button', { name: 'Cancel' });
    expect(cancel).toBeEnabled();
    await act(async () => {
      fireEvent.click(cancel);
    });
    expect(signalOf()?.aborted).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Generate' })).toBeEnabled();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('Escape stops the request and closes the modal', async () => {
    const signalOf = hanging();
    const onClose = vi.fn();
    render(<BuildWithAiModal open onClose={onClose} onReady={() => {}} />);
    await startGenerating();
    await act(async () => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });
    expect(signalOf()?.aborted).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('the backdrop does the same', async () => {
    const signalOf = hanging();
    const onClose = vi.fn();
    render(<BuildWithAiModal open onClose={onClose} onReady={() => {}} />);
    await startGenerating();
    await act(async () => {
      fireEvent.click(document.querySelector('.slate-dialog-backdrop')!);
    });
    expect(signalOf()?.aborted).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('a late answer to a cancelled request is ignored', async () => {
    let resolveLate: (v: unknown) => void = () => {};
    requestGeneratedForm.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveLate = resolve;
        }),
    );
    render(<BuildWithAiModal open onClose={() => {}} onReady={() => {}} />);
    await startGenerating();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    });
    await act(async () => {
      resolveLate({
        name: 'Late',
        schema: { brand: { name: 'x' }, theme: 'swiss', questions: [] },
        form: { title: 'Late', questions: [] },
        sourcePrompt: 'late',
      });
    });
    expect(screen.queryByRole('button', { name: 'Open in editor' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Generate' })).toBeInTheDocument();
  });
});

describe('the request itself (audit A2)', () => {
  function fetchThatHangsUntilAborted() {
    return vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('The operation was aborted.', 'AbortError')),
          );
        }),
    );
  }

  it('gives up after a minute with the "took too long" sentence, and can be retried', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchMock = fetchThatHangsUntilAborted();
    vi.stubGlobal('fetch', fetchMock);
    const p = realRequest({ prompt: 'Wedding RSVP' });
    const outcome = p.then(
      () => 'resolved',
      (err: unknown) => err,
    );
    await vi.advanceTimersByTimeAsync(GENERATE_TIMEOUT_MS - 1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2);
    const err = (await outcome) as GenerateRequestError;
    expect(err).toBeInstanceOf(GenerateRequestError);
    expect(err.message).toBe('That took too long. Try a shorter description or a smaller PDF.');
    expect(err.retryable).toBe(true);
    expect(err.cancelled).toBe(false);
  });

  it('a cancel from the caller ends the fetch and is marked cancelled', async () => {
    const fetchMock = fetchThatHangsUntilAborted();
    vi.stubGlobal('fetch', fetchMock);
    const ctrl = new AbortController();
    const p = realRequest({ prompt: 'Wedding RSVP' }, { signal: ctrl.signal });
    const outcome = p.then(
      () => 'resolved',
      (err: unknown) => err,
    );
    await Promise.resolve();
    ctrl.abort();
    const err = (await outcome) as GenerateRequestError;
    expect(err).toBeInstanceOf(GenerateRequestError);
    expect(err.cancelled).toBe(true);
    expect(err.retryable).toBe(false);
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(init.signal?.aborted).toBe(true);
  });
});
