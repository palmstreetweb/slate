/**
 * Matrix — rows x columns grid. Radio semantics per row by default,
 * checkboxes with `multiple: true`. Desktop renders a grid; narrow
 * viewports stack each row (CSS), and so does a grid whose column headers
 * can't fit their words side by side, measured here (R7). Answer shape per
 * ADR-013: `Record<rowValue, columnValue | columnValue[]>`.
 *
 * When a required grid is sent with gaps, the message names what's missing
 * and those rows are marked, so a respondent at the foot of a tall grid
 * knows where to look (ADR-070).
 */

'use client';

import { useCallback, useId, useLayoutEffect, useRef, useState } from 'react';
import type { MatrixQuestion } from '@/types/Question.js';
import type { LooseAnswers, MatrixAnswer } from '@/types/Answers.js';
import { validate } from '@/logic/validation.js';
import { useRegisterFormConfirm } from '@/hooks/useRegisterFormConfirm.js';
import { shakeInvalid } from '@/utils/motion.js';
import { resolveTitle } from './_resolveTitle.js';

type Props = {
  question: MatrixQuestion;
  answers: LooseAnswers;
  initialValue: MatrixAnswer | undefined;
  onAnswer: (value: MatrixAnswer) => void;
  onAdvance: () => void;
};

function isEmptyCell(v: unknown): boolean {
  return v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
}

export function MatrixField({ question, answers, initialValue, onAnswer, onAdvance }: Props) {
  const [value, setValue] = useState<MatrixAnswer>(() => ({ ...(initialValue ?? {}) }));
  const [error, setError] = useState<string | null>(null);
  /** After a send with gaps, the rows still empty are marked. */
  const [tried, setTried] = useState(false);
  const matrixRef = useRef<HTMLDivElement>(null);
  const labelId = useId();
  const multiple = question.multiple === true;

  const isChecked = (row: string, col: string): boolean => {
    const v = value[row];
    return Array.isArray(v) ? v.includes(col) : v === col;
  };

  // The next answer is worked out here, then stored: the parent's setAnswer
  // never runs inside a state updater (QA CH-15).
  const setCell = (row: string, col: string) => {
    const next = { ...value };
    if (multiple) {
      const existing = next[row];
      const arr = Array.isArray(existing) ? existing : [];
      next[row] = arr.includes(col) ? arr.filter((c) => c !== col) : [...arr, col];
    } else {
      next[row] = col;
    }
    setValue(next);
    onAnswer(next);
    if (error) setError(null);
  };

  const submit = useCallback(() => {
    const err = validate(question, value);
    if (err) {
      // Name what's missing: one row by its label, several by how many.
      const empty = question.rows.filter((r) => isEmptyCell(value[r.value]));
      setError(
        err.code !== 'required' || empty.length === 0
          ? err.message
          : empty.length === 1
            ? `Please answer “${empty[0]!.label}” too.`
            : `Please answer every row. ${empty.length} are still empty.`,
      );
      setTried(true);
      shakeInvalid(matrixRef.current);
      return;
    }
    setError(null);
    onAnswer(value);
    onAdvance();
  }, [question, value, onAnswer, onAdvance]);

  useRegisterFormConfirm(submit);

  const colCount = question.columns.length;

  // Stack when a column header's word is wider than its column, measured on
  // the side-by-side layout, and again whenever the grid's width changes.
  const heads = question.columns.map((c) => c.label).join('\u0000');
  useLayoutEffect(() => {
    const el = matrixRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    let width = -1;
    const check = () => {
      el.classList.remove('slate-matrix--stack');
      const tight = Array.from(el.querySelectorAll<HTMLElement>('.slate-matrix-colhead')).some(
        (h) => h.offsetParent !== null && h.scrollWidth > h.clientWidth + 1,
      );
      el.classList.toggle('slate-matrix--stack', tight);
    };
    const ro = new ResizeObserver(([entry]) => {
      // Stacking changes only the height: re-measure on a new width alone.
      const w = entry?.contentRect.width ?? 0;
      if (w !== width) {
        width = w;
        check();
      }
    });
    ro.observe(el);
    void document.fonts?.ready.then(check);
    return () => ro.disconnect();
  }, [heads]);

  return (
    <div>
      <h1 id={labelId} className="slate-title">
        {resolveTitle(question.title, answers)}
      </h1>

      <div
        ref={matrixRef}
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
            className={`slate-matrix-row${
              tried && question.required && isEmptyCell(value[row.value])
                ? ' slate-matrix-row--missing'
                : ''
            }`}
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
          {error}
        </p>
      )}
      <div className="slate-actions">
        <button type="button" className="slate-ok-btn" onClick={submit}>
          OK <span aria-hidden>✓</span>
        </button>
        <span className="slate-hint slate-key-hint">press Enter ↵</span>
      </div>
    </div>
  );
}
