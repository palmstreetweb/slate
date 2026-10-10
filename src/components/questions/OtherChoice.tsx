/**
 * The "Other: ___" choice shared by single choice, multi choice and picture
 * choice (ADR-063). The Other choice sits after the options with the next
 * letter key; picking it opens a text box right below the list. The field
 * decides what "commit" means (auto-advance for single, OK for multi).
 */

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Option, Question } from '@/types/Question.js';
import { CHOICE_LETTERS } from '@/utils/letters.js';
import { OTHER_MAX, allowsOther, otherLabelOf, splitOther } from '@/logic/other.js';
import { isTypewriterKey } from '@/utils/typewriterKey.js';
import { useDraft } from '@/hooks/useRegisterFormConfirm.js';

export type OtherState = {
  /** The question offers Other. */
  enabled: boolean;
  open: boolean;
  text: string;
  error: string | null;
  label: string;
  /** Letter key for the Other choice ('' past Z). */
  letter: string;
  boxId: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  setText: (text: string) => void;
  setError: (error: string | null) => void;
  /** Open the box (or keep it open) and move focus into it. */
  openBox: () => void;
  close: () => void;
};

/**
 * Other box state, seeded from the stored answer: typed text that isn't an
 * option value means Other was picked (Back, or a resumed session).
 */
export function useOtherChoice(
  question: Question & { options: ReadonlyArray<Option> },
  value: unknown,
  /** The field's title id; the box's id is derived from it. */
  idBase: string,
): OtherState {
  const enabled = allowsOther(question);
  const seed = enabled ? splitOther(question.options, value).other : '';
  // The box and its text are kept across Back until a commit (audit 2026-10).
  const [open, setOpen] = useDraft(`${question.id}:o`, seed !== '');
  const [text, setText] = useDraft(`${question.id}:t`, seed);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const focusNext = useRef(false);
  const boxId = `${idBase}-other`;

  useEffect(() => {
    if (!open || !focusNext.current) return;
    focusNext.current = false;
    inputRef.current?.focus();
  }, [open]);

  const openBox = useCallback(() => {
    setError(null);
    if (open) {
      inputRef.current?.focus();
      return;
    }
    focusNext.current = true;
    setOpen(true);
  }, [open, setOpen]);

  const close = useCallback(() => {
    setOpen(false);
    setError(null);
  }, [setOpen]);

  return {
    enabled,
    open: enabled && open,
    text,
    error,
    label: otherLabelOf(question as { otherLabel?: string }),
    letter: CHOICE_LETTERS[question.options.length] ?? '',
    boxId,
    inputRef,
    setText,
    setError,
    openBox,
    close,
  };
}

type BoxProps = {
  other: OtherState;
  /** Enter in the box. */
  onEnter: () => void;
  onType?: () => void;
};

/** The text box under the list. Enter commits; a new keystroke clears the error. */
export function OtherTextBox({ other, onEnter, onType }: BoxProps) {
  if (!other.open) return null;
  return (
    <div className="slate-other-box" id={other.boxId}>
      <input
        ref={other.inputRef}
        type="text"
        className={`slate-input slate-other-input${other.error ? ' slate-input--error' : ''}`}
        value={other.text}
        maxLength={OTHER_MAX}
        onChange={(e) => {
          other.setText(e.target.value);
          if (other.error) other.setError(null);
        }}
        onKeyDown={(e) => {
          if (isTypewriterKey(e)) onType?.();
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            onEnter();
          }
        }}
        placeholder="Type your answer"
        aria-label={`${other.label}: your answer`}
        aria-invalid={Boolean(other.error)}
        autoComplete="off"
        enterKeyHint="done"
      />
    </div>
  );
}

/** Message for an open, empty Other box. */
export const OTHER_EMPTY = 'Please type your answer';

/** "A", "A–D" or "A–Z": the letter keys a list of `count` choices answers to. */
export function keyRange(count: number): string {
  return count > 1 ? `A–${CHOICE_LETTERS[Math.min(count, 26) - 1]}` : 'A';
}
