/**
 * Review fixes of 2026-10-05, the file question's type filter: words from
 * main's free-text Accept field ("PDF, Word", "any", "Excel") read the way the
 * owner meant them or not at all, never as made-up endings that refuse every
 * real file; `image/*` takes an SVG logo (CON-03); and a refusal names the
 * kinds the question takes, so a photo of another kind is never told "this
 * question takes photos only" (COPY-R2, the final QA check).
 */

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import type { Question } from '@/index.js';
import { QuestionRenderer } from '@/components/questions/QuestionRenderer.js';
import { FormConfirmRefContext } from '@/hooks/useRegisterFormConfirm.js';
import {
  acceptLabel,
  acceptTokens,
  matchesAccept,
} from '@/components/questions/FileUploadField.js';
import { readableAccept, unreadableAccept } from '../examples/_admin/formChecks.js';

beforeAll(() => {
  URL.createObjectURL ??= () => 'blob:test';
  URL.revokeObjectURL ??= () => undefined;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const file = (name: string, type = '') => new File(['x'], name, { type });

describe('Accept words from main’s free-text field (CON-03)', () => {
  it('“PDF, Word” takes a .docx résumé', () => {
    expect(acceptTokens('PDF, Word')).toEqual(['.pdf', '.doc', '.docx']);
    expect(matchesAccept(file('resume.docx'), 'PDF, Word')).toBe(true);
    expect(matchesAccept(file('cv.pdf', 'application/pdf'), 'PDF, Word')).toBe(true);
    expect(matchesAccept(file('photo.jpg', 'image/jpeg'), 'PDF, Word')).toBe(false);
    expect(acceptTokens('Excel')).toEqual(['.xls', '.xlsx']);
    expect(matchesAccept(file('budget.xlsx'), 'Excel')).toBe(true);
  });

  it('a word that isn’t a file type is left out, so it never traps anyone on a required upload', () => {
    for (const word of ['any', 'all', 'docs', 'files', 'Any file']) {
      expect(acceptTokens(word)).toEqual([]);
      expect(matchesAccept(file('anything.bin'), word)).toBe(true);
    }
    // The editor says so, and keeps what it can read.
    expect(unreadableAccept('PDF, Word, any')).toEqual(['any']);
    expect(readableAccept('PDF, Word, any')).toBe('PDF, Word');
  });

  it('common endings still read with or without their dot', () => {
    expect(acceptTokens('pdf, .jpg, png')).toEqual(['.pdf', '.jpg', '.png']);
    expect(acceptTokens('.pages, numbers')).toEqual(['.pages', '.numbers']);
    expect(acceptTokens('application/pdf, image/*')).toEqual(['application/pdf', 'image/*']);
  });

  it('image/* takes an SVG logo, as the picker offers it', () => {
    expect(matchesAccept(file('logo.svg', 'image/svg+xml'), 'image/*')).toBe(true);
    expect(matchesAccept(file('IMG_1.HEIC'), 'image/*')).toBe(true);
    expect(matchesAccept(file('doc.pdf', 'application/pdf'), 'image/*')).toBe(false);
  });
});

describe('a refusal names what the question takes (COPY-R2)', () => {
  it.each([
    ['pdf, jpg', 'PDFs or JPG photos'],
    ['png', 'PNG photos'],
    ['.jpg', 'JPG photos'],
    ['jpg, jpeg', 'JPG photos'],
    ['jpg, png, heic', 'JPG, PNG or HEIC photos'],
    ['image/*, video/*, .pdf', 'photos, videos or PDFs'],
    ['image/*', 'photos'],
    ['image/*, .jpg', 'photos'],
    ['PDF, Word', 'PDFs or DOC or DOCX files'],
    ['.docx,.xlsx', 'DOCX or XLSX files'],
  ])('%s → %s', (accept, words) => {
    expect(acceptLabel(accept)).toBe(words);
  });

  function Harness({ question }: { question: Question }) {
    const confirmRef = useRef<(() => void) | null>(null);
    return (
      <FormConfirmRefContext.Provider value={confirmRef}>
        <div data-slate-forms="" data-theme-name="classic" data-theme="light">
          <QuestionRenderer
            question={question}
            answers={{}}
            setAnswer={vi.fn()}
            advance={vi.fn()}
            stepNumber={1}
            totalSteps={2}
            submitStatus="idle"
            submitError={null}
            onRetrySubmit={vi.fn()}
            onRestart={vi.fn()}
            allQuestions={[question]}
          />
        </div>
      </FormConfirmRefContext.Provider>
    );
  }

  it('a PNG on a JPG-only question is told JPG, not “photos only”', async () => {
    render(
      <Harness question={{ id: 'p', type: 'file_upload', title: 'Your photo', accept: '.jpg' }} />,
    );
    await screen.findByText(/choose files/i);
    await act(async () => {
      fireEvent.change(document.querySelector('input[type="file"]')!, {
        target: { files: [file('photo2.png', 'image/png')] },
      });
    });
    expect(
      screen.getByText('photo2.png can’t be added — this question takes JPG photos only.'),
    ).toBeInTheDocument();
  });
});
