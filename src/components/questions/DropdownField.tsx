/**
 * Searchable dropdown — Typeform-style select for long option lists.
 * A combobox text input filters the option list; arrows + Enter or click
 * select. Selecting auto-advances like single_choice.
 *
 * With `allowOther` (ADR-063) the list ends with "Other: “…”": whatever the
 * respondent typed that isn't an option becomes their answer, from the list
 * or with Enter / OK.
 *
 * Enter picks a row only after the respondent moved to it (arrow keys,
 * typing, or the pointer moving over it); a bare Enter is OK, which keeps
 * what the box shows (a prefilled answer too) or asks for a pick (QA CH-10,
 * GAP-01). The list opens on a tap, a click, typing or ↓, never by itself on
 * arrival, and phones aren't focused on arrival, so the keyboard doesn't
 * cover the list before the respondent asks for it.
 */

'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { DropdownQuestion } from '@/types/Question.js';
import type { LooseAnswers } from '@/types/Answers.js';
import { validate } from '@/logic/validation.js';
import { useRegisterFormConfirm } from '@/hooks/useRegisterFormConfirm.js';
import { shakeInvalid } from '@/utils/motion.js';
import { focusAfter } from '@/utils/focus.js';
import { useAutoAdvanceTimer } from '@/hooks/useAutoAdvanceTimer.js';
import { OTHER_MAX, allowsOther, otherLabelOf, resolveOtherText } from '@/logic/other.js';
import { resolveTitle } from './_resolveTitle.js';

/** Listbox row id for the Other entry (never an option value: options are keyed by value). */
const OTHER_ROW = '\u0000other';

type Props = {
  question: DropdownQuestion;
  answers: LooseAnswers;
  selected: string | undefined;
  onSelect: (value: string) => void;
  onAdvance: () => void;
  /** OK / Enter confirm — defaults to `onAdvance` when omitted. */
  onSubmit?: () => void;
};

export function DropdownField({
  question,
  answers,
  selected,
  onSelect,
  onAdvance,
  onSubmit,
}: Props) {
  const selectedOption = question.options.find((o) => o.value === selected);
  const withOther = allowsOther(question);
  // A stored answer that isn't an option is typed Other text: show it as typed.
  const [query, setQuery] = useState(
    selectedOption?.label ?? (withOther && typeof selected === 'string' ? selected : ''),
  );
  const [open, setOpen] = useState(false);
  /** The row Enter picks; -1 until the respondent moves to one. */
  const [highlight, setHighlight] = useState(-1);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const labelId = useId();
  const listId = useId();
  const optionId = (value: string) =>
    value === OTHER_ROW ? `${listId}-other-row` : `${listId}-opt-${value}`;
  const { schedule: scheduleAutoAdvance } = useAutoAdvanceTimer(question.id);

  useEffect(() => {
    // A phone would open its keyboard over the list before anyone asked for it.
    if (window.matchMedia?.('(pointer: coarse)').matches) return undefined;
    return focusAfter(inputRef.current);
  }, [question.id]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    // When the query is exactly the selected label, show everything so
    // reopening the list isn't filtered down to one entry.
    if (q === '' || q === selectedOption?.label.toLowerCase()) return [...question.options];
    return question.options.filter((o) => o.label.toLowerCase().includes(q));
  }, [query, question.options, selectedOption]);

  /** Typed text that names no option — offered as the Other answer. */
  const typedOther =
    withOther && query.trim() !== '' && !resolveOtherText(question.options, query).isOption
      ? query.trim().slice(0, OTHER_MAX)
      : '';
  const rows: Array<{ value: string; label: string; description?: string }> = withOther
    ? [
        ...filtered,
        {
          value: OTHER_ROW,
          label: typedOther
            ? `${otherLabelOf(question)}: “${typedOther}”`
            : `${otherLabelOf(question)} — type your answer above`,
        },
      ]
    : filtered;

  const choose = (value: string) => {
    if (value === OTHER_ROW) {
      if (!typedOther) {
        setOpen(false);
        setError('Type your answer, then pick Other');
        inputRef.current?.focus();
        return;
      }
      setOpen(false);
      setError(null);
      onSelect(typedOther);
      scheduleAutoAdvance(() => onAdvance());
      return;
    }
    const opt = question.options.find((o) => o.value === value);
    if (!opt) return;
    setQuery(opt.label);
    setOpen(false);
    setError(null);
    onSelect(value);
    scheduleAutoAdvance(() => onAdvance());
  };

  const resolveValueFromQuery = (): string | undefined => {
    const q = query.trim();
    if (q === '') return undefined;
    if (selectedOption && q.toLowerCase() === selectedOption.label.toLowerCase()) {
      return selected;
    }
    const hit = question.options.find((o) => o.label.toLowerCase() === q.toLowerCase())?.value;
    if (hit !== undefined) return hit;
    return withOther ? resolveOtherText(question.options, q).value : undefined;
  };

  const submit = useCallback(() => {
    const value = resolveValueFromQuery();
    const err = validate(question, value);
    if (err) {
      setError(err.message);
      shakeInvalid(inputRef.current);
      return;
    }
    setError(null);
    if (value) onSelect(value);
    (onSubmit ?? onAdvance)();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question, query, selected, selectedOption, onSelect, onSubmit, onAdvance, withOther]);

  useRegisterFormConfirm(submit);

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setHighlight((h) => Math.min(h + 1, rows.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(true);
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const row = open ? rows[highlight] : undefined;
      if (row && (row.value !== OTHER_ROW || typedOther)) {
        choose(row.value);
      } else {
        submit();
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
      setHighlight(-1);
    }
  };

  return (
    <div>
      <h1 id={labelId} className="slate-title">
        {resolveTitle(question.title, answers)}
      </h1>
      <div style={{ marginTop: 24, position: 'relative' }}>
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-labelledby={labelId}
          aria-invalid={Boolean(error)}
          aria-activedescendant={
            open && rows[highlight] ? optionId(rows[highlight].value) : undefined
          }
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            // Typing filters; Enter then takes the first match.
            setHighlight(e.target.value.trim() ? 0 : -1);
            if (error) setError(null);
            if (selectedOption && e.target.value !== selectedOption.label) {
              onSelect('');
            } else if (
              withOther &&
              !selectedOption &&
              selected &&
              e.target.value.trim() !== selected
            ) {
              // A typed Other answer is being edited: it is only stored again on Enter / OK.
              onSelect('');
            }
          }}
          onClick={() => setOpen(true)}
          onKeyDown={handleKey}
          placeholder={question.placeholder ?? 'Type or select an option...'}
          className={`slate-input${error ? ' slate-input--error' : ''}`}
          autoComplete="off"
          maxLength={withOther ? OTHER_MAX : undefined}
        />
        {open && rows.length > 0 && (
          <ul id={listId} role="listbox" aria-labelledby={labelId} className="slate-dropdown-list">
            {rows.map((opt, i) => {
              const isOther = opt.value === OTHER_ROW;
              const isSelected = isOther
                ? Boolean(typedOther) && selected === typedOther
                : selected === opt.value;
              const isHighlighted = i === highlight;
              return (
                <li key={opt.value} role="presentation">
                  <button
                    type="button"
                    role="option"
                    id={optionId(opt.value)}
                    aria-selected={isSelected}
                    className={`slate-dropdown-item${isHighlighted ? ' slate-dropdown-item--hl' : ''}${
                      isSelected ? ' slate-dropdown-item--selected' : ''
                    }${isOther ? ' slate-dropdown-item--other' : ''}`}
                    // Only a pointer that moves: a list opening under a resting cursor picks nothing.
                    onMouseMove={() => {
                      if (highlight !== i) setHighlight(i);
                    }}
                    onClick={() => choose(opt.value)}
                  >
                    {opt.label}
                    {opt.description && (
                      <span className="slate-choice-desc">{opt.description}</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {open && rows.length === 0 && (
          <p className="slate-hint" style={{ marginTop: 12 }}>
            no matches — try fewer letters
          </p>
        )}
        {error && (
          <p className="slate-err" aria-live="polite">
            ! {error}
          </p>
        )}
        <div className="slate-actions">
          <button type="button" className="slate-ok-btn" onClick={submit}>
            OK <span aria-hidden>✓</span>
          </button>
          <span className="slate-hint slate-key-hint">type to search, or use ↑ ↓ and Enter</span>
        </div>
      </div>
    </div>
  );
}
