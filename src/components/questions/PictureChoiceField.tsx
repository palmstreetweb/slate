/**
 * Picture choice — image grid. Single-select clicks auto-advance (the
 * renderer passes a select-and-advance callback); `multiple: true`
 * toggles selections and confirms with OK. With `allowOther` (ADR-063) a
 * last tile opens a text box under the grid.
 *
 * Several picks work like a multi choice (ADR-069): the rule is said up
 * front, the maximum blocks extra picks, and an error clears as soon as the
 * picks change. An optional single picture choice can be skipped.
 */

'use client';

import { useCallback, useId, useRef, useState } from 'react';
import type { PictureChoiceQuestion } from '@/types/Question.js';
import type { LooseAnswers } from '@/types/Answers.js';
import { pickLimits, validate } from '@/logic/validation.js';
import { pickHint } from '@/logic/pickRule.js';
import { resolveOtherText, splitOther } from '@/logic/other.js';
import { useRegisterFormConfirm, useRegisterOtherKey } from '@/hooks/useRegisterFormConfirm.js';
import { CHOICE_LETTERS } from '@/utils/letters.js';
import { useChoiceCommit } from '@/hooks/useChoiceCommit.js';
import { shakeInvalid } from '@/utils/motion.js';
import { ChoiceBadge } from './ChoiceBadge.js';
import { OTHER_EMPTY, OtherTextBox, keyRange, useOtherChoice } from './OtherChoice.js';
import { resolveTitle } from './_resolveTitle.js';

type Props = {
  question: PictureChoiceQuestion;
  answers: LooseAnswers;
  selected: string | string[] | undefined;
  /** Single mode — select + auto-advance. Typed "Other" text arrives here too. */
  onSelectSingle: (value: string) => void;
  /** Multi mode — replace the selection array. */
  onSelectMulti: (values: string[]) => void;
  onAdvance: () => void;
  onType?: () => void;
};

/** A pencil drawn in the theme's ink, in place of a photo on the Other tile. */
function OtherTileArt() {
  return (
    <span className="slate-picture-img slate-picture-other-art" aria-hidden="true">
      <svg viewBox="0 0 24 24" focusable="false">
        <path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z" />
        <path d="M14.5 7.5l2 2" />
      </svg>
    </span>
  );
}

export function PictureChoiceField({
  question,
  answers,
  selected,
  onSelectSingle,
  onSelectMulti,
  onAdvance,
  onType,
}: Props) {
  const labelId = useId();
  const [error, setError] = useState<string | null>(null);
  const multiple = question.multiple === true;
  const gridRef = useRef<HTMLDivElement>(null);
  // Single mode auto-advances, so it gets the commit beat (ADR-059).
  const { committed, markCommitted } = useChoiceCommit(
    multiple || typeof selected !== 'string' ? undefined : selected,
  );
  const other = useOtherChoice(question, selected, labelId);
  const isOption = (v: unknown) => question.options.some((o) => o.value === v);
  const raw = multiple
    ? Array.isArray(selected)
      ? selected
      : []
    : typeof selected === 'string'
      ? [selected]
      : [];
  const selectedArr = other.enabled ? splitOther(question.options, raw).picked : raw;
  // Several picks: at the most picks, the tiles left step back (the open Other box counts).
  const full = multiple && selectedArr.length + (other.open ? 1 : 0) >= pickLimits(question)[1];

  // A new pick (tap or letter key) clears the error; in single mode a listed
  // option also closes the Other box.
  const [seen, setSeen] = useState(selected);
  if (selected !== seen) {
    setSeen(selected);
    if (error) setError(null);
    if (!multiple && other.open && isOption(selected)) other.close();
  }
  const otherCommitted = !multiple && other.open && committed !== null && !isOption(committed);

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
    if (selectedArr.includes(value)) {
      onSelectMulti(withOther(selectedArr.filter((v) => v !== value)));
    } else if (full) {
      // At the most picks: the rule is shown above; untick one first.
      shakeInvalid(el);
      return;
    } else {
      onSelectMulti(withOther([...selectedArr, value]));
    }
    if (error) setError(null);
  };

  /** An optional single picture choice can be skipped (or kept, after Back). */
  const skip = !multiple && question.required === false ? onAdvance : undefined;

  const submit = useCallback(() => {
    if (other.open && !other.text.trim()) {
      other.setError(OTHER_EMPTY);
      shakeInvalid(other.inputRef.current);
      return;
    }
    if (!multiple && other.open) {
      const { value } = resolveOtherText(question.options, other.text);
      markCommitted(value);
      onSelectSingle(value);
      return;
    }
    if (skip) {
      skip();
      return;
    }
    // Typed text that names a tile already picked would count once, not twice.
    const typed = other.open ? resolveOtherText(question.options, other.text) : null;
    if (typed?.isOption && selectedArr.includes(typed.value)) {
      const label = question.options.find((o) => o.value === typed.value)?.label ?? typed.value;
      other.setError(`You already picked “${label}”. Type something different.`);
      shakeInvalid(other.inputRef.current);
      return;
    }
    const final = withOther(selectedArr);
    const err = validate(question, multiple ? final : final[0]);
    if (err) {
      setError(err.message);
      shakeInvalid(gridRef.current);
      return;
    }
    setError(null);
    if (other.open) onSelectMulti(final);
    onAdvance();
  }, [
    question,
    multiple,
    selectedArr,
    other,
    withOther,
    markCommitted,
    onSelectSingle,
    onSelectMulti,
    onAdvance,
    skip,
  ]);

  const onOtherTile = useCallback(() => {
    if (multiple && other.open) {
      other.close();
      onSelectMulti(selectedArr);
    } else if (full) {
      shakeInvalid(gridRef.current?.lastElementChild);
      return;
    } else {
      other.openBox();
    }
    if (error) setError(null);
  }, [multiple, other, onSelectMulti, selectedArr, error, full]);

  const confirms = multiple || other.open || Boolean(skip);
  useRegisterFormConfirm(submit, confirms);
  useRegisterOtherKey(onOtherTile, other.enabled);

  const keys = keyRange(question.options.length + (other.enabled ? 1 : 0));

  return (
    <div>
      <h1 id={labelId} className="slate-title">
        {resolveTitle(question.title, answers)}
      </h1>
      {multiple ? (
        <p className="slate-pick-hint" id={`${labelId}-rule`}>
          {pickHint(question)}
        </p>
      ) : null}

      <div
        ref={gridRef}
        className={`slate-picture-grid${committed ? ' slate-picture-grid--committed' : ''}`}
        role={multiple ? 'group' : 'radiogroup'}
        aria-labelledby={labelId}
        aria-describedby={multiple ? `${labelId}-rule` : undefined}
      >
        {question.options.map((opt, i) => {
          const isSelected = selectedArr.includes(opt.value) && (multiple || !other.open);
          const isCommitted = !multiple && isSelected && committed === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              role={multiple ? 'checkbox' : 'radio'}
              aria-checked={isSelected}
              aria-disabled={full && !isSelected ? true : undefined}
              onClick={(e) => {
                if (multiple) {
                  toggle(opt.value, e.currentTarget);
                  return;
                }
                other.close();
                markCommitted(opt.value);
                onSelectSingle(opt.value);
              }}
              className={`slate-picture${isSelected ? ' slate-picture--selected' : ''}${isCommitted ? ' slate-picture--committed' : ''}`}
            >
              <img src={opt.src} alt={opt.alt ?? opt.label} className="slate-picture-img" />
              <span className="slate-picture-caption">
                <ChoiceBadge letter={CHOICE_LETTERS[i] ?? ''} committed={isCommitted} />
                <span>{opt.label}</span>
              </span>
            </button>
          );
        })}
        {other.enabled ? (
          <button
            type="button"
            role={multiple ? 'checkbox' : 'radio'}
            aria-checked={other.open}
            aria-disabled={full && !other.open ? true : undefined}
            aria-controls={other.open ? other.boxId : undefined}
            onClick={onOtherTile}
            className={`slate-picture slate-picture--other${other.open ? ' slate-picture--selected' : ''}${otherCommitted ? ' slate-picture--committed' : ''}`}
          >
            <OtherTileArt />
            <span className="slate-picture-caption">
              <ChoiceBadge letter={other.letter} committed={otherCommitted} />
              <span>{other.label}</span>
            </span>
          </button>
        ) : null}
      </div>
      <OtherTextBox other={other} onEnter={submit} onType={onType} />

      {other.error || error ? (
        <p className="slate-err" aria-live="polite">
          ! {other.error ?? error}
        </p>
      ) : null}

      {confirms ? (
        <div className="slate-actions">
          <button type="button" className="slate-ok-btn" onClick={submit}>
            {skip && !other.open && !selectedArr.length ? (
              'Skip'
            ) : (
              <>
                OK <span aria-hidden>✓</span>
              </>
            )}
          </button>
          <span className="slate-hint slate-key-hint">
            {multiple ? `press ${keys} to pick, then Enter ↵` : 'press Enter ↵'}
          </span>
        </div>
      ) : (
        <p className="slate-hint slate-key-hint" style={{ marginTop: 20 }}>
          press {keys}, or click to choose
        </p>
      )}
    </div>
  );
}
