/**
 * A phone or contact question saved with a blank or unknown country (QA F13:
 * the old free-text box allowed '' and 'XX') still reads a local number as a US
 * one, instead of turning every valid number down.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef } from 'react';
import type { Question } from '@/index.js';
import { QuestionRenderer } from '@/components/questions/QuestionRenderer.js';
import { FormConfirmRefContext } from '@/hooks/useRegisterFormConfirm.js';

function renderField(question: Question) {
  const setAnswer = vi.fn<(id: string, value: unknown) => void>();
  const advance = vi.fn<() => void>();
  function Harness() {
    const confirmRef = useRef<(() => void) | null>(null);
    return (
      <FormConfirmRefContext.Provider value={confirmRef}>
        <div data-slate-forms="" data-theme-name="classic" data-theme="light">
          <QuestionRenderer
            question={question}
            answers={{}}
            setAnswer={setAnswer}
            advance={advance}
            stepNumber={1}
            totalSteps={2}
            submitStatus="idle"
            submitError={null}
            onRetrySubmit={vi.fn()}
            onRestart={vi.fn()}
          />
        </div>
      </FormConfirmRefContext.Provider>
    );
  }
  render(<Harness />);
  return { setAnswer, advance };
}

describe('phone country fallback', () => {
  for (const defaultCountry of ['', 'XX', 'zz']) {
    it(`phone saved with "${defaultCountry}" takes (805) 962-1234 as a US number`, async () => {
      const user = userEvent.setup();
      const { setAnswer, advance } = renderField({
        id: 'tel',
        type: 'phone',
        title: 'Phone?',
        required: true,
        defaultCountry,
      });
      const box = await screen.findByRole('textbox');
      await user.type(box, '(805) 962-1234{Enter}');
      await waitFor(() => expect(advance).toHaveBeenCalledTimes(1));
      expect(setAnswer).toHaveBeenCalledWith('tel', '+18059621234');
    });
  }

  it('a real country still wins (a UK number with GB)', async () => {
    const user = userEvent.setup();
    const { setAnswer, advance } = renderField({
      id: 'tel',
      type: 'phone',
      title: 'Phone?',
      defaultCountry: 'GB',
    });
    await user.type(await screen.findByRole('textbox'), '020 7946 0958{Enter}');
    await waitFor(() => expect(advance).toHaveBeenCalledTimes(1));
    expect(setAnswer).toHaveBeenCalledWith('tel', '+442079460958');
  });

  it('contact block saved with "" stores the phone as E.164', async () => {
    const user = userEvent.setup();
    const { setAnswer, advance } = renderField({
      id: 'who',
      type: 'contact_info',
      title: 'How can we reach you?',
      fields: { name: 'off', email: 'off', phone: 'required' },
      defaultCountry: '',
    });
    const phone = await screen.findByRole('textbox', { name: /^phone/i });
    await user.type(phone, '(805) 962-1234{Enter}');
    await waitFor(() => expect(advance).toHaveBeenCalledTimes(1));
    expect(setAnswer).toHaveBeenCalledWith('who', { phone: '+18059621234' });
  });
});
