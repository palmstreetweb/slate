'use client';

/**
 * The typed-answer field behind short text, long text and email: one box,
 * its message slot and OK. Each type passes what differs — the box's
 * attributes, multi-line, a length limit, the hint — so the three fields cost
 * the engine's core one copy of the logic.
 *
 * The message slot is always in the page (GAP-21): a screen reader announces a
 * message when it appears (a live region created together with its text often
 * isn't), and the box points at it with `aria-describedby`. While empty it
 * takes no space (questions.css). On-demand fields render the same slot from
 * `ext/fieldMessage.tsx`, so this module stays core-only (no extra chunk).
 */

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type InputHTMLAttributes,
  type KeyboardEvent,
} from 'react';
import type { EmailQuestion, LongTextQuestion, ShortTextQuestion } from '@/types/Question.js';
import type { LooseAnswers } from '@/types/Answers.js';
import { charCount, textMax, validate } from '@/logic/validation.js';
import { useRegisterFormConfirm } from '@/hooks/useRegisterFormConfirm.js';
import { shakeInvalid } from '@/utils/motion.js';
import { focusAfter } from '@/utils/focus.js';
import { isTypewriterKey } from '@/utils/typewriterKey.js';
import { resolveTitle } from './_resolveTitle.js';

export type TextFieldProps<Q> = {
  question: Q;
  answers: LooseAnswers;
  initialValue: string;
  onAnswer: (value: string) => void;
  onAdvance: () => void;
  onType?: () => void;
};

type Props = TextFieldProps<ShortTextQuestion | LongTextQuestion | EmailQuestion> & {
  /** The box's own attributes (type, keyboard, autocomplete, rows, placeholder). */
  box: InputHTMLAttributes<HTMLInputElement> & { rows?: number };
  /** A textarea; Return starts a new line on phones. */
  multiline?: boolean;
  hint: string;
};

export function TextAnswer({
  question,
  answers,
  initialValue,
  onAnswer,
  onAdvance,
  onType,
  box,
  multiline,
  hint,
}: Props) {
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const labelId = useId();
  const errId = `${labelId}-err`;
  // One element type for TypeScript; the attributes passed suit both.
  const Box = (multiline ? 'textarea' : 'input') as 'input';
  // The longest answer. Nothing is cut: near the limit a counter shows
  // "9410 / 10000", past it in the error colour, and OK says how long it may be.
  const max = textMax(question as { maxLength?: number });
  const n = charCount(value);

  useEffect(() => {
    return focusAfter(inputRef.current);
  }, [question.id]);

  const submit = useCallback(() => {
    const err = validate(question, value);
    if (err) {
      setError(err.message);
      shakeInvalid(inputRef.current);
      return;
    }
    setError(null);
    // A long answer keeps its spacing and line breaks.
    onAnswer(multiline ? value : value.trim());
    onAdvance();
  }, [question, value, onAnswer, onAdvance, multiline]);

  useRegisterFormConfirm(submit);

  const handleKey = (e: KeyboardEvent) => {
    if (isTypewriterKey(e)) onType?.();
    // Shift+Enter is a new line in a textarea (browser default); plain Enter
    // submits — except a textarea on a phone, where Return is the only way to
    // start a new line and OK is right there (its Shift hint is hidden too).
    // A held Enter (key repeat) never submits: it would run through the questions after.
    if (
      e.key === 'Enter' &&
      !e.shiftKey &&
      !e.repeat &&
      !(multiline && matchMedia('(hover: none)').matches)
    ) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div>
      <h1 id={labelId} className="slate-title">
        {resolveTitle(question.title, answers)}
      </h1>
      <div style={{ marginTop: 24 }}>
        <Box
          ref={inputRef}
          // Return on a phone keyboard says "next" (GAP-04); a long answer's makes a new line.
          enterKeyHint={multiline ? undefined : 'next'}
          {...box}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={handleKey}
          aria-labelledby={labelId}
          aria-describedby={errId}
          aria-invalid={Boolean(error)}
          className={`slate-input${error ? ' slate-input--error' : ''}`}
        />
        <p id={errId} className="slate-err" aria-live="polite">
          {error}
        </p>
        <div className="slate-actions">
          <button type="button" className="slate-ok-btn" onClick={submit}>
            OK <span aria-hidden>✓</span>
          </button>
          {n > max * 0.9 ? (
            <span className={n > max ? 'slate-count slate-count--over' : 'slate-count'}>
              {n} / {max}
            </span>
          ) : null}
          <span className="slate-hint">{hint}</span>
        </div>
      </div>
    </div>
  );
}
