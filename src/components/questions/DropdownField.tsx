/**
 * Searchable dropdown — Typeform-style select for long option lists.
 * A combobox text input filters the option list; arrows + Enter or click
 * select. Selecting auto-advances like single_choice.
 */

'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { DropdownQuestion } from '@/types/Question.js';
import type { LooseAnswers } from '@/types/Answers.js';
import { validate } from '@/logic/validation.js';
import { focusAfter } from '@/utils/focus.js';
import { resolveTitle } from './_resolveTitle.js';

type Props = {
  question: DropdownQuestion;
  answers: LooseAnswers;
  selected: string | undefined;
  onSelect: (value: string) => void;
  onAdvance: () => void;
  /** OK / Enter confirm — defaults to `onAdvance` when omitted. */
  onSubmit?: () => void;
};

export function DropdownField({ question, answers, selected, onSelect, onAdvance, onSubmit }: Props) {
  const selectedOption = question.options.find((o) => o.value === selected);
  const [query, setQuery] = useState(selectedOption?.label ?? '');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const labelId = useId();
  const listId = useId();

  useEffect(() => {
    return focusAfter(inputRef.current);
  }, [question.id]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    // When the query is exactly the selected label, show everything so
    // reopening the list isn't filtered down to one entry.
    if (q === '' || q === selectedOption?.label.toLowerCase()) return [...question.options];
    return question.options.filter((o) => o.label.toLowerCase().includes(q));
  }, [query, question.options, selectedOption]);

  const choose = (value: string) => {
    const opt = question.options.find((o) => o.value === value);
    if (!opt) return;
    setQuery(opt.label);
    setOpen(false);
    setError(null);
    onSelect(value);
    window.setTimeout(() => onAdvance(), 220);
  };

  const submit = () => {
    const err = validate(question, selected);
    if (err) {
      setError(err.message);
      return;
    }
    setError(null);
    (onSubmit ?? onAdvance)();
  };

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setHighlight((h) => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (open && filtered[highlight]) {
        choose(filtered[highlight].value);
      } else {
        submit();
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
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
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setHighlight(0);
            if (error) setError(null);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKey}
          placeholder={question.placeholder ?? 'Type or select an option...'}
          className={`slate-input${error ? ' slate-input--error' : ''}`}
          autoComplete="off"
        />
        {open && filtered.length > 0 && (
          <ul id={listId} role="listbox" aria-labelledby={labelId} className="slate-dropdown-list">
            {filtered.map((opt, i) => {
              const isSelected = selected === opt.value;
              const isHighlighted = i === highlight;
              return (
                <li key={opt.value} role="presentation">
                  <button
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    className={`slate-dropdown-item${isHighlighted ? ' slate-dropdown-item--hl' : ''}${
                      isSelected ? ' slate-dropdown-item--selected' : ''
                    }`}
                    onMouseEnter={() => setHighlight(i)}
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
        {open && filtered.length === 0 && (
          <p className="slate-hint" style={{ marginTop: 12 }}>
            no matches
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
          <span className="slate-hint">type to filter, ↑↓ + Enter to select</span>
        </div>
      </div>
    </div>
  );
}
