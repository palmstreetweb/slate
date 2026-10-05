/**
 * Multi choice — tick any number of options, then OK. Loads on demand through
 * ext/MultiChoiceExt.tsx (ADR-069); letter keys go through <Form>.
 *
 * The pick rule is said up front ("Pick up to 3", "Pick at least 2"), from
 * the limits a respondent can actually meet (`pickLimits`). Once the most
 * picks are made, the other options step back, and a tap on one shakes it and
 * says why right under it (on a phone the rule above can be off-screen):
 * there is never a surprise "too many" after OK. An error clears as soon as
 * the picks change, by tap or by key.
 */

'use client';

import { Fragment, useCallback, useId, useRef, useState } from 'react';
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
import { sayAgain } from './ext/fieldMessage.js';
// `.slate-sr`, the visually hidden region (on demand only, like this field).
import '@/styles/extensions.css';

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

/** Stands for "Other" in the note under a refused tap. */
const OTHER_KEY = '\u0000other';

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
  /** The option tapped while the most picks were made: its note says why. */
  const [refused, setRefused] = useState<string | null>(null);
  /** The note's words for a screen reader, in a region that's always there (COPY-R8). */
  const [said, setSaid] = useState('');
  const choicesRef = useRef<HTMLDivElement>(null);
  const other = useOtherChoice(question, selected, labelId);
  const picked = other.enabled ? splitOther(question.options, selected).picked : selected;
  const [, max] = pickLimits(question);
  // The open Other box is a pick too.
  const full = picked.length + (other.open ? 1 : 0) >= max;
  const fullText = `You can pick up to ${max}. Tap one of your picks to let it go.`;

  // New picks clear the error, whether they came from a tap or a letter key.
  const [seen, setSeen] = useState(selected);
  if (selected !== seen) {
    setSeen(selected);
    if (error) setError(null);
    if (refused) setRefused(null);
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
      // At the most picks: untick one first, says the note under this option.
      setRefused(value);
      setSaid(sayAgain(fullText));
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
      setRefused(OTHER_KEY);
      setSaid(sayAgain(fullText));
      shakeInvalid(choicesRef.current?.querySelector('.slate-choice--other'));
      return;
    } else {
      other.openBox();
    }
    if (error) setError(null);
  }, [other, onSelect, picked, error, full, fullText]);

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

  // Shown under the option tapped; said by the region below the choices.
  const note = <p className="slate-err slate-choice-note">{fullText}</p>;

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
            <Fragment key={opt.value}>
              <button
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
              {refused === opt.value ? note : null}
            </Fragment>
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
        {refused === OTHER_KEY ? note : null}
      </div>
      <OtherTextBox other={other} onEnter={submit} onType={onType} />
      <p className="slate-sr" aria-live="polite">
        {said}
      </p>

      {other.error || error ? (
        <p className="slate-err" aria-live="polite">
          {other.error ?? error}
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
