/**
 * Build with AI modal: plain errors, and Retry only when retrying can help
 * (QA COPY-07 / S19). File problems have their own message and no Retry.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AiClient from '../examples/_admin/ai/client.js';

const requestGeneratedForm = vi.hoisted(() => vi.fn());
vi.mock('../examples/_admin/ai/client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof AiClient>()),
  requestGeneratedForm,
}));
vi.mock('../examples/_admin/uiSounds.js', () => ({ playUiSound: () => {} }));

import { GenerateRequestError } from '../examples/_admin/ai/client.js';
import { generatedFormSchema } from '../api/_lib/generateFormSchema.js';
import { blankGeneratedQuestion, mapGeneratedForm } from '../api/_lib/mapGeneratedForm.js';
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
        'You’ve used your Build with AI drafts for now. You can make more after 5:00 PM today.',
        false,
      ),
    );
    renderModal();
    await generateWith('Wedding RSVP');
    expect(await screen.findByRole('alert')).toHaveTextContent(/used your Build with AI drafts/);
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

describe('Open in editor', () => {
  function draft() {
    const form = generatedFormSchema.parse({
      title: 'RSVP',
      description: 'Who is coming.',
      theme: 'editorial',
      welcome: { title: 'Welcome.', subtitle: '', cta: 'Start' },
      questions: ['name', 'email', 'notes'].map((id) =>
        blankGeneratedQuestion({ id, type: 'short_text', title: `${id}?` }),
      ),
      thanks: { title: 'Thanks.', subtitle: '', cta: 'Done' },
      estimate: { show: false, currency: 'USD', base: 0, disclaimer: '' },
    });
    return { ...mapGeneratedForm(form), form, sourcePrompt: 'RSVP' };
  }

  async function toReview() {
    requestGeneratedForm.mockResolvedValueOnce(draft());
    await generateWith('RSVP');
    expect(await screen.findByText('Here’s a draft.', {}, { timeout: 3000 })).toBeInTheDocument();
  }

  it('a save that didn’t land says so plainly, and Open in editor is the retry', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <BuildWithAiModal
        open
        onClose={() => {}}
        onReady={async () => {
          throw new Error('The cloud did not save the generated draft.');
        }}
      />,
    );
    await toReview();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Open in editor' }));
    });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      'Couldn’t save the draft. Check your connection, then press Open in editor again.',
    );
    expect(alert).not.toHaveTextContent(/cloud/);
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('the form-limit path closes the modal; reopening shows no stale error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    function Host() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            reopen
          </button>
          <BuildWithAiModal
            open={open}
            onClose={() => setOpen(false)}
            onReady={async () => {
              setOpen(false);
              await new Promise((r) => setTimeout(r, 0));
              throw new Error('Form limit reached.');
            }}
          />
        </>
      );
    }
    render(<Host />);
    await toReview();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Open in editor' }));
      await new Promise((r) => setTimeout(r, 10));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'reopen' }));
    });
    expect(screen.getByText('Describe your perfect form')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
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
    const count = screen.getByText('1,700 / 2,000 characters');
    // The running count is read with the box, not announced on every keystroke (COPY-R9).
    expect(count).not.toHaveAttribute('aria-live');
    expect(box).toHaveAttribute('aria-describedby', count.id);
    const live = screen.getAllByRole('status').find((el) => el.classList.contains('slate-sr'))!;
    expect(live).toHaveTextContent('');
    fireEvent.change(box, { target: { value: 'x'.repeat(AI_PROMPT_MAX) } });
    expect(document.getElementById('slate-ai-count')).toHaveTextContent(
      'That’s the limit: 2,000 characters.',
    );
    // Said once, by a region that was there all along.
    expect(live).toHaveTextContent('That’s the limit: 2,000 characters.');
  });

  it('exports the revision cap the route enforces', () => {
    expect(AI_REVISE_MAX).toBe(800);
  });
});
