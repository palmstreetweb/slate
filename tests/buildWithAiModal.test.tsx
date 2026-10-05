/**
 * Build with AI modal: plain errors, and Retry only when retrying can help
 * (QA COPY-07 / S19). File problems have their own message and no Retry.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AiClient from '../examples/_admin/ai/client.js';

const requestGeneratedForm = vi.hoisted(() => vi.fn());
vi.mock('../examples/_admin/ai/client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof AiClient>()),
  requestGeneratedForm,
}));
vi.mock('../examples/_admin/uiSounds.js', () => ({ playUiSound: () => {} }));

import { GenerateRequestError } from '../examples/_admin/ai/client.js';
import {
  AI_PROMPT_MAX,
  AI_REVISE_MAX,
  BuildWithAiModal,
} from '../examples/_admin/components/BuildWithAiModal.js';

function renderModal() {
  return render(<BuildWithAiModal open onClose={() => {}} onReady={() => {}} />);
}

async function generateWith(text: string) {
  fireEvent.change(screen.getByPlaceholderText('Type what this form should ask…'), {
    target: { value: text },
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
  });
}

beforeEach(() => {
  requestGeneratedForm.mockReset();
});

describe('Build with AI errors', () => {
  it('offers Retry when trying again can help, and it retries', async () => {
    requestGeneratedForm.mockRejectedValueOnce(
      new GenerateRequestError('The AI is busy right now. Try again in a minute.', true),
    );
    renderModal();
    await generateWith('A quote form for driveway sealcoating');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The AI is busy right now. Try again in a minute.',
    );
    requestGeneratedForm.mockReturnValueOnce(new Promise(() => {}));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    });
    expect(requestGeneratedForm).toHaveBeenCalledTimes(2);
  });

  it('no Retry for the daily limit', async () => {
    requestGeneratedForm.mockRejectedValueOnce(
      new GenerateRequestError(
        'You’ve used today’s Build with AI drafts. You can make more after 5:00 PM today.',
        false,
      ),
    );
    renderModal();
    await generateWith('Wedding RSVP');
    expect(await screen.findByRole('alert')).toHaveTextContent(/used today’s Build with AI drafts/);
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('an unexpected failure shows a plain sentence, never its own text', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    requestGeneratedForm.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    renderModal();
    await generateWith('Wedding RSVP');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Something went wrong building your form. Try again.');
    expect(alert).not.toHaveTextContent(/Failed to fetch/);
    error.mockRestore();
  });

  it('a file that is not a PDF gets its own message and no Retry', async () => {
    renderModal();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const docx = new File(['x'], 'brief.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    await act(async () => {
      fireEvent.change(input, { target: { files: [docx] } });
    });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Only PDFs work here for now. Save it as a PDF and try again.',
    );
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(requestGeneratedForm).not.toHaveBeenCalled();
  });

  it('a PDF over 3 MB is refused before sending, with no Retry', async () => {
    renderModal();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const big = new File(['x'], 'big.pdf', { type: 'application/pdf' });
    Object.defineProperty(big, 'size', { value: 3_500_000 });
    await act(async () => {
      fireEvent.change(input, { target: { files: [big] } });
    });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That PDF is too big. Pick one under 3 MB.',
    );
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });
});

describe('Build with AI length limits', () => {
  it('caps the description while typing and counts near the end', () => {
    renderModal();
    const box = screen.getByPlaceholderText('Type what this form should ask…');
    expect(box).toHaveAttribute('maxLength', String(AI_PROMPT_MAX));
    fireEvent.change(box, { target: { value: 'x'.repeat(100) } });
    expect(screen.queryByText(/characters/)).toBeNull();
    fireEvent.change(box, { target: { value: 'x'.repeat(1700) } });
    expect(screen.getByText('1,700 / 2,000 characters')).toBeInTheDocument();
    fireEvent.change(box, { target: { value: 'x'.repeat(AI_PROMPT_MAX) } });
    expect(screen.getByText('That’s the limit: 2,000 characters.')).toBeInTheDocument();
  });

  it('exports the revision cap the route enforces', () => {
    expect(AI_REVISE_MAX).toBe(800);
  });
});
