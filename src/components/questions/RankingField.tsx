/**
 * Ranking — reorder a list. Up/down buttons are the keyboard-accessible
 * path; rows are also draggable (HTML5 DnD) for mouse users. The full
 * ordered array of option values is stored on OK.
 */

'use client';

import { useId, useRef, useState } from 'react';
import type { RankingQuestion } from '@/types/Question.js';
import type { LooseAnswers } from '@/types/Answers.js';
import { resolveTitle } from './_resolveTitle.js';

type Props = {
  question: RankingQuestion;
  answers: LooseAnswers;
  initialValue: string[] | undefined;
  onAnswer: (order: string[]) => void;
  onAdvance: () => void;
};

function initialOrder(question: RankingQuestion, stored: string[] | undefined): string[] {
  const values = question.options.map((o) => o.value);
  if (
    stored &&
    stored.length === values.length &&
    values.every((v) => stored.includes(v))
  ) {
    return [...stored];
  }
  return values;
}

export function RankingField({ question, answers, initialValue, onAnswer, onAdvance }: Props) {
  const [order, setOrder] = useState<string[]>(() => initialOrder(question, initialValue));
  const dragIndex = useRef<number | null>(null);
  const labelId = useId();

  const labelFor = (value: string) =>
    question.options.find((o) => o.value === value)?.label ?? value;

  const move = (from: number, to: number) => {
    if (to < 0 || to >= order.length || from === to) return;
    setOrder((cur) => {
      const next = [...cur];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item!);
      return next;
    });
  };

  const submit = () => {
    onAnswer(order);
    onAdvance();
  };

  return (
    <div>
      <h1 id={labelId} className="psw-title">
        {resolveTitle(question.title, answers)}
      </h1>

      <ol className="psw-ranking" aria-labelledby={labelId}>
        {order.map((value, i) => (
          <li
            key={value}
            className="psw-ranking-row"
            draggable
            onDragStart={() => {
              dragIndex.current = i;
            }}
            onDragOver={(e) => {
              e.preventDefault();
              if (dragIndex.current !== null && dragIndex.current !== i) {
                move(dragIndex.current, i);
                dragIndex.current = i;
              }
            }}
            onDragEnd={() => {
              dragIndex.current = null;
            }}
          >
            <span className="psw-ranking-pos">{i + 1}</span>
            <span className="psw-ranking-label">{labelFor(value)}</span>
            <span className="psw-ranking-controls">
              <button
                type="button"
                className="psw-ranking-btn"
                onClick={() => move(i, i - 1)}
                disabled={i === 0}
                aria-label={`Move ${labelFor(value)} up`}
              >
                ↑
              </button>
              <button
                type="button"
                className="psw-ranking-btn"
                onClick={() => move(i, i + 1)}
                disabled={i === order.length - 1}
                aria-label={`Move ${labelFor(value)} down`}
              >
                ↓
              </button>
            </span>
          </li>
        ))}
      </ol>

      <div className="psw-actions">
        <button type="button" className="psw-ok-btn" onClick={submit}>
          OK <span aria-hidden>✓</span>
        </button>
        <span className="psw-hint">drag rows or use ↑↓ to reorder</span>
      </div>
    </div>
  );
}
