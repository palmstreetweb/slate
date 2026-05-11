/**
 * STEP 7 example — demonstrates `visibleIf` branching across two paths:
 *
 *   homeowner=yes → lot_size  → (skip business questions) → notes → thanks
 *   homeowner=no  → business? → if yes: company → notes → thanks
 *
 * Toggle the first answer back and forth and watch the visible question
 * list re-derive. Try walking down one path, hit BACK, change the answer,
 * and confirm via the debug overlay that the irrelevant branch's answers
 * never appear in onSubmit (ADR-005).
 */

import { useState } from 'react';
import { Form, defineSchema, type Answers, type SubmitMeta } from '@/index.js';

const schema = defineSchema({
  brand: { name: 'PSW · branching demo' },
  theme: 'swiss',
  themeMode: 'toggle',
  questions: [
    {
      id: 'welcome',
      type: 'welcome',
      title: 'A branching demo.',
      subtitle:
        "Two paths from one question. Try answering Yes, then walking back and switching to No — watch the questions change.",
      cta: 'Start',
    },
    {
      id: 'homeowner',
      type: 'single_choice',
      title: 'Are you a homeowner?',
      options: [
        { label: 'Yes', value: 'yes' },
        { label: 'No', value: 'no' },
      ],
    },

    /* ----- homeowner=yes path ----- */
    {
      id: 'lot_size',
      type: 'single_choice',
      title: "What's your lot size?",
      visibleIf: { field: 'homeowner', op: 'equals', value: 'yes' },
      options: [
        { label: 'Under 1,000 sq ft', value: 'sm' },
        { label: '1,000 – 5,000 sq ft', value: 'md' },
        { label: '5,000 – 15,000 sq ft', value: 'lg' },
        { label: 'Bigger than that', value: 'xl' },
      ],
    },

    /* ----- homeowner=no path ----- */
    {
      id: 'business',
      type: 'single_choice',
      title: 'Are you representing a business?',
      visibleIf: { field: 'homeowner', op: 'equals', value: 'no' },
      options: [
        { label: 'Yes', value: 'yes' },
        { label: 'No, just personal', value: 'no' },
      ],
    },
    {
      id: 'company',
      type: 'short_text',
      title: "What's the company name?",
      placeholder: '...',
      // Nested condition — only when both homeowner=no AND business=yes
      visibleIf: {
        all: [
          { field: 'homeowner', op: 'equals', value: 'no' },
          { field: 'business', op: 'equals', value: 'yes' },
        ],
      },
      required: true,
    },

    /* ----- always-shown final questions ----- */
    {
      id: 'notes',
      type: 'long_text',
      title: 'Anything else?',
      placeholder: 'Optional...',
    },
    {
      id: 'done',
      type: 'thanks',
      title: "Thanks.",
      subtitle: 'Check the bottom-left overlay — only visible-path answers were submitted.',
      cta: 'Try another path',
    },
  ],
});

export function ConditionalLogicDemo() {
  const [lastSubmit, setLastSubmit] = useState<{
    answers: Answers;
    meta: SubmitMeta;
  } | null>(null);

  return (
    <>
      <Form
        schema={schema}
        onSubmit={async (answers, meta) => {
          await new Promise((r) => setTimeout(r, 250));
          setLastSubmit({ answers, meta });
        }}
      />

      {lastSubmit && (
        <pre
          style={{
            position: 'fixed',
            bottom: 12,
            left: 12,
            maxWidth: 420,
            maxHeight: 280,
            overflow: 'auto',
            padding: 12,
            background: 'rgba(0,0,0,0.85)',
            color: '#fff',
            fontSize: 11,
            fontFamily: 'ui-monospace, monospace',
            borderRadius: 8,
            zIndex: 200,
            margin: 0,
            lineHeight: 1.45,
          }}
        >
          {`// answers (visible-only per ADR-005)\n${JSON.stringify(lastSubmit.answers, null, 2)}\n\n// meta.questionsVisited\n${JSON.stringify(lastSubmit.meta.questionsVisited, null, 2)}`}
        </pre>
      )}
    </>
  );
}
