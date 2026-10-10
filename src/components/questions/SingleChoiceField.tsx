'use client';

import { useCallback, useId, useRef, useState } from 'react';
import type { SingleChoiceQuestion } from '@/types/Question.js';
import type { LooseAnswers } from '@/types/Answers.js';
import { choiceListIsSplit } from '@/utils/choiceLayout.js';
import { CHOICE_LETTERS } from '@/utils/letters.js';
import { useChoiceCommit } from '@/hooks/useChoiceCommit.js';
import { useRegisterFormConfirm, useRegisterOtherKey } from '@/hooks/useRegisterFormConfirm.js';
import { resolveOtherText } from '@/logic/other.js';
import { shakeInvalid } from '@/utils/motion.js';
import { ChoiceBadge } from './ChoiceBadge.js';
import { OTHER_EMPTY, OtherTextBox, keyRange, useOtherChoice } from './OtherChoice.js';
import { resolveTitle } from './_resolveTitle.js';

type Props = {
  question: SingleChoiceQuestion;
  answers: LooseAnswers;
  selected: string | undefined;
  /** Store the value and auto-advance. Typed "Other" text arrives here too (ADR-063). */
  onSelect: (value: string) => void;
  /** Move on without picking: an optional question offers Skip (and Enter). */
  onSkip?: () => void;
  onType?: () => void;
};

export function SingleChoiceField({
  question,
  answers,
  selected,
  onSelect,
  onSkip,
  onType,
}: Props) {
  const labelId = useId();
  const { committed, markCommitted } = useChoiceCommit(selected);
  const other = useOtherChoice(question, selected, labelId);
  const isOption = (v: string | undefined) => question.options.some((o) => o.value === v);

  // A new pick of a listed option (click or letter key) closes the Other box.
  const [seen, setSeen] = useState(selected);
  if (selected !== seen) {
    setSeen(selected);
    if (other.open && isOption(selected)) other.close();
  }

  const choicesRef = useRef<HTMLDivElement>(null);
  const otherCommitted = other.open && committed !== null && !isOption(committed);

  const commitOther = useCallback(() => {
    if (!other.text.trim()) {
      other.setError(OTHER_EMPTY);
      shakeInvalid(other.inputRef.current);
      return;
    }
    const { value } = resolveOtherText(question.options, other.text);
    markCommitted(value);
    onSelect(value);
  }, [other, question.options, markCommitted, onSelect]);

  // OK commits the typed Other; an optional, unanswered question can be
  // skipped; one already answered (a link's prefill, Back, Resume) continues
  // with its pick on OK or Enter (audit 2026-10). Enter waits until the
  // question has been up a moment, so a double Enter can't pass it unseen.
  const skip = !other.open && question.required === false && !selected ? onSkip : undefined;
  const confirm = other.open ? commitOther : (skip ?? (selected ? onSkip : undefined));
  useRegisterFormConfirm(confirm!, Boolean(confirm), other.open ? 0 : 500);
  useRegisterOtherKey(other.openBox, other.enabled);

  return (
    <div>
      <h1 id={labelId} className="slate-title">
        {resolveTitle(question.title, answers)}
      </h1>

      <div
        ref={choicesRef}
        className={`slate-choices${choiceListIsSplit(question.options) ? ' slate-choices--split' : ''}${committed ? ' slate-choices--committed' : ''}`}
        role="radiogroup"
        aria-labelledby={labelId}
      >
        {question.options.map((opt, i) => {
          const isSelected = !other.open && selected === opt.value;
          const isCommitted = isSelected && committed === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={isSelected}
              onClick={() => {
                other.close();
                markCommitted(opt.value);
                onSelect(opt.value);
              }}
              className={`slate-choice${isSelected ? ' slate-choice--selected' : ''}${isCommitted ? ' slate-choice--committed' : ''}`}
            >
              <ChoiceBadge letter={CHOICE_LETTERS[i] ?? ''} committed={isCommitted} />
              <span>
                {opt.label}
                {opt.description && <span className="slate-choice-desc">{opt.description}</span>}
              </span>
            </button>
          );
        })}
        {other.enabled ? (
          <button
            type="button"
            role="radio"
            aria-checked={other.open}
            aria-controls={other.open ? other.boxId : undefined}
            onClick={other.openBox}
            className={`slate-choice slate-choice--other${other.open ? ' slate-choice--selected' : ''}${otherCommitted ? ' slate-choice--committed' : ''}`}
          >
            <ChoiceBadge letter={other.letter} committed={otherCommitted} />
            <span>{other.label}</span>
          </button>
        ) : null}
      </div>
      <OtherTextBox other={other} onEnter={commitOther} onType={onType} />
      {other.error ? (
        <p className="slate-err" aria-live="polite">
          {other.error}
        </p>
      ) : null}
      {confirm ? (
        <div className="slate-actions">
          {skip ? (
            <button type="button" className="slate-ok-btn slate-ok-btn--skip" onClick={skip}>
              Skip
            </button>
          ) : (
            <button type="button" className="slate-ok-btn" onClick={confirm}>
              OK <span aria-hidden>✓</span>
            </button>
          )}
          <span className="slate-hint slate-key-hint">press Enter ↵</span>
        </div>
      ) : (
        <p className="slate-hint slate-key-hint" style={{ marginTop: 20 }}>
          press {keyRange(question.options.length + (other.enabled ? 1 : 0))}, or click to choose
        </p>
      )}
    </div>
  );
}
