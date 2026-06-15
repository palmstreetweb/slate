/**
 * Matrix — rows x columns grid. Radio semantics per row by default,
 * checkboxes with `multiple: true`. Desktop renders a grid; narrow
 * viewports stack each row (CSS). Answer shape per ADR-013:
 * `Record<rowValue, columnValue | columnValue[]>`.
 */

'use client';

import { useCallback, useId, useState } from 'react';
import type { MatrixQuestion } from '@/types/Question.js';
import type { LooseAnswers, MatrixAnswer } from '@/types/Answers.js';
import { validate } from '@/logic/validation.js';
import { useRegisterFormConfirm } from '@/hooks/useRegisterFormConfirm.js';
import { resolveTitle } from './_resolveTitle.js';

type Props = {
  question: MatrixQuestion;
  answers: LooseAnswers;
  initialValue: MatrixAnswer | undefined;
  onAnswer: (value: MatrixAnswer) => void;
  onAdvance: () => void;
};

export function MatrixField({ question, answers, initialValue, onAnswer, onAdvance }: Props) {
  const [value, setValue] = useState<MatrixAnswer>(() => ({ ...(initialValue ?? {}) }));
  const [error, setError] = useState<string | null>(null);
  const labelId = useId();
  const multiple = question.multiple === true;

  const isChecked = (row: string, col: string): boolean => {
    const v = value[row];
    return Array.isArray(v) ? v.includes(col) : v === col;
  };

  const setCell = (row: string, col: string) => {
    setValue((cur) => {
      const next = { ...cur };
      if (multiple) {
        const existing = next[row];
        const arr = Array.isArray(existing) ? existing : [];
        next[row] = arr.includes(col) ? arr.filter((c) => c !== col) : [...arr, col];
      } else {
        next[row] = col;
      }
      onAnswer(next);
      return next;
    });
    if (error) setError(null);
  };

  const submit = useCallback(() => {
    const err = validate(question, value);
    if (err) {
      setError(err.message);
      return;
    }
    setError(null);
    onAnswer(value);
    onAdvance();
  }, [question, value, onAnswer, onAdvance]);

  useRegisterFormConfirm(submit);

  const colCount = question.columns.length;

  return (
    <div>
      <h1 id={labelId} className="slate-title">
        {resolveTitle(question.title, answers)}
      </h1>

      <div
        className="slate-matrix"
        style={{ ['--slate-matrix-cols' as string]: colCount }}
        aria-labelledby={labelId}
      >
        <div className="slate-matrix-head" aria-hidden="true">
          <span className="slate-matrix-corner" />
          {question.columns.map((c) => (
            <span key={c.value} className="slate-matrix-colhead">
              {c.label}
            </span>
          ))}
        </div>

        {question.rows.map((row) => (
          <div
            key={row.value}
            className="slate-matrix-row"
            role={multiple ? 'group' : 'radiogroup'}
            aria-label={row.label}
          >
            <span className="slate-matrix-rowlabel">{row.label}</span>
            {question.columns.map((col) => {
              const checked = isChecked(row.value, col.value);
              return (
                <button
                  key={col.value}
                  type="button"
                  role={multiple ? 'checkbox' : 'radio'}
                  aria-checked={checked}
                  aria-label={`${row.label}: ${col.label}`}
                  onClick={() => setCell(row.value, col.value)}
                  className={`slate-matrix-cell${checked ? ' slate-matrix-cell--selected' : ''}`}
                >
                  <span className="slate-matrix-dot" aria-hidden="true" />
                  <span className="slate-matrix-cell-label">{col.label}</span>
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {error && (
        <p className="slate-err" aria-live="polite">
          ! {error}
        </p>
      )}
      <div className="slate-actions">
        <button type="button" className="slate-ok-btn" onClick={submit}>
          OK <span aria-hidden>✓</span>
        </button>
      </div>
    </div>
  );
}
