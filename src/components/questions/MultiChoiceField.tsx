/**
 * Multi choice — tick any number of options, then OK. Loads on demand through
 * ext/MultiChoiceExt.tsx (ADR-069); letter keys go through <Form>.
 *
 * The pick rule is said up front ("Pick up to 3", "Pick at least 2"), from
 * the limits a respondent can actually meet (`pickLimits`). Once the most
 * picks are made, the other options step back and a tap on one only shakes
 * it: there is never a surprise "too many" after OK. An error clears as soon
 * as the picks change, by tap or by key.
 */

'use client';

import { useCallback, useId, useRef, useState } from 'react';
import type { MultiChoiceQuestion } from '@/types/Question.js';
import type { LooseAnswers } from '@/types/Answers.js';
import { pickLimits, validate } from '@/logic/validation.js';
import { pickHint } from '@/logic/pickRule.js';
import { resolveOtherText, splitOther } from '@/logic/other.js';
import { useRegisterFormConfirm, useRegisterOtherKey } from '@/hooks/useRegisterFormConfirm.js';
import { shakeInvalid } from '@/utils/motion.js';
import { CHOICE_LETTERS } from '@/utils/letters.js';
import { OTHER_EMPTY, OtherTextBox, keyRange, useOtherChoice } from './OtherChoice.js';
import { resolveTitle } from './_resolveTitle.js';

type Props = {
  question: MultiChoiceQuestion;
  answers: LooseAnswers;
  /** Option values, plus at most one typed "Other" text (ADR-063); undefined when unanswered. */
  selected: string[] | undefined;
  onSelect: (values: string[]) => void;
  onAdvance: () => void;
  onType?: () => void;
};

const NONE: string[] = [];

/**
 * Long lists of short labels sit in two columns (utils/choiceLayout.ts, the
 * single choice's rule). Spelled out here so this on-demand chunk doesn't
 * split a core chunk in two (AGENTS.md).
 */
function isSplit(options: MultiChoiceQuestion['options']): boolean {
  return (
    options.length >= 8 &&
    options.every((o) => !o.description?.trim() && o.label.trim().length <= 28)
  );
}

export function MultiChoiceField({
  question,
  answers,
  selected = NONE,
  onSelect,
  onAdvance,
  onType,
}: Props) {
  const labelId = useId();
  const [error, setError] = useState<string | null>(null);
  const choicesRef = useRef<HTMLDivElement>(null);
  const other = useOtherChoice(question, selected, labelId);
  const picked = other.enabled ? splitOther(question.options, selected).picked : selected;
  const [, max] = pickLimits(question);
  // The open Other box is a pick too.
  const full = picked.length + (other.open ? 1 : 0) >= max;

  // New picks clear the error, whether they came from a tap or a letter key.
  const [seen, setSeen] = useState(selected);
  if (selected !== seen) {
    setSeen(selected);
    if (error) setError(null);
  }

  /** The answer: picked options, then the typed text while the Other box is open. */
  const withOther = useCallback(
    (values: string[]): string[] => {
      if (!other.open || !other.text.trim()) return values;
      const r = resolveOtherText(question.options, other.text);
      if (r.isOption) return values.includes(r.value) ? values : [...values, r.value];
      return [...values, r.value];
    },
    [other.open, other.text, question.options],
  );

  const toggle = (value: string, el: HTMLElement) => {
    if (picked.includes(value)) {
      onSelect(withOther(picked.filter((v) => v !== value)));
    } else if (full) {
      // At the most picks: the rule is shown above; untick one first.
      shakeInvalid(el);
      return;
    } else {
      onSelect(withOther([...picked, value]));
    }
    if (error) setError(null);
  };

  const toggleOther = useCallback(() => {
    if (other.open) {
      other.close();
      onSelect(picked);
    } else if (full) {
      shakeInvalid(choicesRef.current?.lastElementChild);
      return;
    } else {
      other.openBox();
    }
    if (error) setError(null);
  }, [other, onSelect, picked, error, full]);

  const submit = useCallback(() => {
    if (other.open && !other.text.trim()) {
      other.setError(OTHER_EMPTY);
      shakeInvalid(other.inputRef.current);
      return;
    }
    // Typed text that names an option already ticked would count once, not twice.
    const typed = other.open ? resolveOtherText(question.options, other.text) : null;
    if (typed?.isOption && picked.includes(typed.value)) {
      const label = question.options.find((o) => o.value === typed.value)?.label ?? typed.value;
      other.setError(`You already picked “${label}”. Type something different.`);
      shakeInvalid(other.inputRef.current);
      return;
    }
    const final = withOther(picked);
    const err = validate(question, final);
    if (err) {
      setError(err.message);
      shakeInvalid(choicesRef.current);
      return;
    }
    setError(null);
    if (other.open) onSelect(final);
    onAdvance();
  }, [question, picked, other, withOther, onSelect, onAdvance]);

  useRegisterFormConfirm(submit);
  useRegisterOtherKey(toggleOther, other.enabled);

  return (
    <div>
      <h1 id={labelId} className="slate-title">
        {resolveTitle(question.title, answers)}
      </h1>
      <p className="slate-pick-hint" id={`${labelId}-rule`}>
        {pickHint(question)}
      </p>

      <div
        ref={choicesRef}
        className={`slate-choices${isSplit(question.options) ? ' slate-choices--split' : ''}`}
        role="group"
        aria-labelledby={labelId}
        aria-describedby={`${labelId}-rule`}
      >
        {question.options.map((opt, i) => {
          const isSelected = picked.includes(opt.value);
          return (
            <button
              key={opt.value}
              type="button"
              role="checkbox"
              aria-checked={isSelected}
              aria-disabled={full && !isSelected ? true : undefined}
              onClick={(e) => toggle(opt.value, e.currentTarget)}
              className={`slate-choice${isSelected ? ' slate-choice--selected' : ''}`}
            >
              <span className="slate-choice-badge">{CHOICE_LETTERS[i] ?? ''}</span>
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
            role="checkbox"
            aria-checked={other.open}
            aria-disabled={full && !other.open ? true : undefined}
            aria-controls={other.open ? other.boxId : undefined}
            onClick={toggleOther}
            className={`slate-choice slate-choice--other${other.open ? ' slate-choice--selected' : ''}`}
          >
            <span className="slate-choice-badge">{other.letter}</span>
            <span>{other.label}</span>
          </button>
        ) : null}
      </div>
      <OtherTextBox other={other} onEnter={submit} onType={onType} />

      {other.error || error ? (
        <p className="slate-err" aria-live="polite">
          ! {other.error ?? error}
        </p>
      ) : null}

      <div className="slate-actions">
        <button type="button" className="slate-ok-btn" onClick={submit}>
          OK <span aria-hidden>✓</span>
        </button>
        <span className="slate-hint slate-key-hint">
          press {keyRange(question.options.length + (other.enabled ? 1 : 0))} to pick, then Enter ↵
        </span>
      </div>
    </div>
  );
}
