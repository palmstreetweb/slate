/**
 * QA pass 2026-10, integration (ADR-070): checks that hold only once the seven
 * workstreams are together.
 * - The editor's live preview names the question by its type, never its
 *   internal id (S9, CH-17, F25, MEDIA-13; neither studio workstream owned it).
 * - The submit Function caps a multi pick exactly where the engine stops the
 *   respondent (decision 1: the server mirrors the engine's clamp, w2a + w4a).
 */

import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { defineSchema } from '@/index.js';
import type { Question } from '@/types/Question.js';
import { pickLimits, validate } from '@/logic/validation.js';
import { Canvas, labelForQuestion } from '../examples/_admin/components/Canvas.js';
import { TYPE_LABEL } from '../examples/_admin/questionTypeMeta.js';
import { clampForQuestion } from '../neon/functions/submit-response/answerShape.js';

if (!HTMLElement.prototype.scrollIntoView) {
  HTMLElement.prototype.scrollIntoView = function scrollIntoView() {};
}

describe('the live preview’s label (S9, CH-17, F25)', () => {
  it('reads the question’s type for every type, never its id', () => {
    for (const type of Object.keys(TYPE_LABEL) as Question['type'][]) {
      const q = { id: `a_${type}_internal`, type, title: 'Anything' } as unknown as Question;
      expect(labelForQuestion(q)).toBe(TYPE_LABEL[type]);
      expect(labelForQuestion(q)).not.toMatch(/internal|_/);
    }
  });

  it('shows “Live preview · Number” over a number question named a_number', () => {
    const schema = defineSchema({
      brand: { name: 'Preview Co' },
      theme: 'classic',
      themeMode: 'dark',
      questions: [
        { id: 'a_number', type: 'number', title: 'How many windows?' },
        { id: 'done', type: 'thanks', title: 'Thanks' },
      ],
    });
    const { container } = render(
      <Canvas
        formId="f_label_test"
        schema={schema}
        selectedQuestion={schema.questions[0] as Question}
      />,
    );
    const label = container.querySelector('.slate-canvas-label')!.textContent;
    expect(label).toBe('Live preview · Number');
    expect(container.querySelector('.slate-canvas-toolbar')!.textContent).not.toMatch(
      /a_number|schema/i,
    );
    expect(container.querySelector('.slate-badge')).toHaveTextContent('Always dark');
  });
});

describe('the server keeps the picks the engine lets through (decision 1)', () => {
  const values = ['a', 'b', 'c', 'd', 'e'];
  const mins = [undefined, -1, 0, 1, 1.5, 2, 3, 7];
  const maxes = [undefined, 0, 0.5, 1, 2, 2.5, 3, 9];

  it('caps at the engine’s maximum, never below what the engine asks for, and never refuses', () => {
    let checked = 0;
    for (let n = 1; n <= values.length; n++) {
      for (const allowOther of [false, true]) {
        for (const min of mins) {
          for (const max of maxes) {
            const q = {
              id: 'q',
              type: 'multi_choice',
              title: 'Pick',
              options: values.slice(0, n).map((v) => ({ label: v, value: v })),
              ...(allowOther ? { allowOther: true } : {}),
              ...(min !== undefined ? { min } : {}),
              ...(max !== undefined ? { max } : {}),
            } as Question;
            const [lo, hi] = pickLimits(q as never);
            // Every number of picks a respondent could send: all options, plus a typed Other.
            const all = [...values.slice(0, n), ...(allowOther ? ['My own'] : [])];
            for (let k = 0; k <= all.length; k++) {
              const sent = all.slice(0, k);
              const kept = clampForQuestion(q as unknown as Record<string, unknown>, sent);
              const keptList = Array.isArray(kept) ? kept : [];
              // The server keeps exactly what fits under the engine's maximum.
              expect(keptList).toEqual(sent.slice(0, Math.min(k, hi)));
              // Whatever the engine accepts, the server keeps whole.
              if (validate(q, sent) === null) expect(keptList).toEqual(sent);
              checked++;
            }
            // The engine never asks for more picks than there are choices.
            expect(lo).toBeLessThanOrEqual(all.length);
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });
});
