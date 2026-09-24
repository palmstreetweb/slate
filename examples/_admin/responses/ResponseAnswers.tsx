/**
 * Numbered question/answer list for one response, shared by both views
 * (ADR-055). `stack` is the Inbox reader (one column, hairlines between);
 * `grid` is the Summary's expanded row (two columns on desktop, one on
 * phones, long answers span both). Answers render as text only.
 */

'use client';

import { memo } from 'react';
import type { Question } from '@/index.js';
import { titleOf } from '../responsesFormat.js';
import { ResponseFileAnswer } from '../components/ResponseFileAnswer.js';
import { answerText, isBlankAnswer } from './model.js';

type Props = {
  /** Answer questions in schema order; numbering follows this array. */
  questions: ReadonlyArray<Question>;
  answers: Readonly<Record<string, unknown>>;
  layout: 'stack' | 'grid';
  className?: string;
};

/** Always full width in the grid layout. */
const WIDE_TYPES = new Set<Question['type']>(['long_text', 'file_upload', 'matrix', 'ranking']);
const WIDE_TEXT = 64;

export const ResponseAnswers = memo(function ResponseAnswers({
  questions,
  answers,
  layout,
  className,
}: Props) {
  return (
    <ol className={`rsp-answers rsp-answers--${layout}${className ? ` ${className}` : ''}`}>
      {questions.map((q, i) => {
        const value = answers[q.id];
        const isFile = q.type === 'file_upload';
        const text = isFile ? '' : answerText(q, value);
        const empty = isFile ? isBlankAnswer(value) : text === '';
        const wide =
          layout === 'grid' &&
          (WIDE_TYPES.has(q.type) || text.length > WIDE_TEXT || text.includes('\n'));
        return (
          <li key={q.id} className={`rsp-answer${wide ? ' rsp-answer--wide' : ''}`}>
            <span className="rsp-answer-n" aria-hidden="true">
              {String(i + 1).padStart(2, '0')}
            </span>
            <div className="rsp-answer-body">
              <p className="rsp-answer-q">{titleOf(q)}</p>
              {empty ? (
                <p className="rsp-answer-v rsp-answer-v--empty">
                  <span aria-hidden="true">—</span>
                  <span className="rsp-sr">No answer</span>
                </p>
              ) : isFile ? (
                <div className="rsp-answer-v rsp-answer-v--files">
                  <ResponseFileAnswer value={value} />
                </div>
              ) : (
                <p className="rsp-answer-v slate-selectable">{text}</p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
});
