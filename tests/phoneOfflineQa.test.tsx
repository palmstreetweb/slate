/**
 * QA pass (X2, COPY-12): when the phone number checker (libphonenumber-js,
 * loaded on demand) can't download, the phone question keeps the number as
 * typed and moves on — it used to blame the number ("Could not parse that
 * phone number") and, since the browser won't fetch a failed module again,
 * trap the respondent there.
 */

import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useRef } from 'react';
import type { Question } from '@/index.js';
import { QuestionRenderer } from '@/components/questions/QuestionRenderer.js';
import { FormConfirmRefContext } from '@/hooks/useRegisterFormConfirm.js';

vi.mock('libphonenumber-js', () => {
  throw new TypeError('Failed to fetch dynamically imported module: /assets/libphonenumber-js.js');
});

function Harness(props: {
  question: Question;
  setAnswer: (id: string, value: unknown) => void;
  advance: () => void;
}) {
  const confirmRef = useRef<(() => void) | null>(null);
  return (
    <FormConfirmRefContext.Provider value={confirmRef}>
      <QuestionRenderer
        question={props.question}
        answers={{}}
        setAnswer={props.setAnswer}
        advance={props.advance}
        stepNumber={1}
        totalSteps={1}
        submitStatus="idle"
        submitError={null}
        onRetrySubmit={vi.fn()}
        onRestart={vi.fn()}
        allQuestions={[props.question]}
      />
    </FormConfirmRefContext.Provider>
  );
}

describe('phone question without its number checker', () => {
  it('keeps the number as typed and moves on, with no error about the number', async () => {
    const setAnswer = vi.fn();
    const advance = vi.fn();
    render(
      <Harness
        question={{ id: 'phone', type: 'phone', title: 'Your phone?', required: true }}
        setAnswer={setAnswer}
        advance={advance}
      />,
    );
    const input = await screen.findByRole('textbox', {}, { timeout: 8000 });
    fireEvent.change(input, { target: { value: ' 805 555 0123 ' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /ok/i }));
    });
    await waitFor(() => expect(advance).toHaveBeenCalled());
    expect(setAnswer).toHaveBeenLastCalledWith('phone', '805 555 0123');
    expect(screen.queryByText(/parse/i)).toBeNull();
  });
});
