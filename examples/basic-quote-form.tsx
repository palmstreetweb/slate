/**
 * STEP 6 example — a real 8-question quote form covering: welcome,
 * short_text, email, single_choice, multi_choice, scale, long_text, thanks.
 * Wired with `defineSchema` so `onSubmit` is fully type-inferred.
 */

import { useState } from 'react';
import { Form, defineSchema, type Answers, type SubmitMeta } from '@/index.js';

const schema = defineSchema({
  brand: { name: '805 Sealcoating' },
  theme: 'editorial',
  themeMode: 'toggle',
  questions: [
    {
      id: 'welcome',
      type: 'welcome',
      title: 'Hey there.',
      subtitle:
        "Let's get you a free quote. Takes about 60 seconds — no high-pressure sales, promise.",
      cta: 'Start',
    },
    {
      id: 'name',
      type: 'short_text',
      title: "What's your first name?",
      placeholder: 'Type your answer...',
      required: true,
    },
    {
      id: 'email',
      type: 'email',
      title: (a) =>
        `Nice to meet you${a.name ? ', ' + a.name : ''}. What's your email?`,
      placeholder: 'name@example.com',
      required: true,
    },
    {
      id: 'service',
      type: 'single_choice',
      title: 'Which service are you interested in?',
      options: [
        { label: 'Driveway sealcoating', value: 'sealcoat' },
        { label: 'Parking lot striping', value: 'striping' },
        { label: 'Crack filling & repair', value: 'repair' },
        { label: 'Not sure yet — need advice', value: 'advice' },
      ],
    },
    {
      id: 'addons',
      type: 'multi_choice',
      title: 'Anything else? (pick any)',
      options: [
        { label: 'Crack fill', value: 'crack' },
        { label: 'Re-striping', value: 'stripe' },
        { label: 'Pressure wash', value: 'wash' },
        { label: 'Pothole patch', value: 'patch' },
      ],
    },
    {
      id: 'urgency',
      type: 'scale',
      title: 'How urgent is this for you?',
      min: 0,
      max: 10,
      minLabel: 'no rush',
      maxLabel: 'asap',
      required: true,
    },
    {
      id: 'notes',
      type: 'long_text',
      title: 'Anything else we should know?',
      placeholder: 'Optional...',
    },
    {
      id: 'done',
      type: 'thanks',
      title: "You're all set.",
      subtitle: "We'll be in touch within 24 hours.",
      cta: 'Submit another quote',
    },
  ],
});

export function BasicQuoteForm() {
  const [lastSubmit, setLastSubmit] = useState<{
    answers: Answers;
    meta: SubmitMeta;
  } | null>(null);

  return (
    <>
      <Form
        schema={schema}
        onSubmit={async (answers, meta) => {
          // Simulate a network call so the thanks-screen "submitting..." state
          // is visible.
          await new Promise((r) => setTimeout(r, 400));
          setLastSubmit({ answers, meta });
          console.log('[basic-quote-form] submitted', answers, meta);
        }}
        onQuestionChange={(qid) => {
          console.log('[basic-quote-form] question →', qid);
        }}
        hiddenFields={{ source: 'demo', utm_source: 'localhost' }}
      />

      {lastSubmit && (
        <pre
          style={{
            position: 'fixed',
            bottom: 12,
            left: 12,
            maxWidth: 360,
            maxHeight: 240,
            overflow: 'auto',
            padding: 12,
            background: 'rgba(0,0,0,0.85)',
            color: '#fff',
            fontSize: 11,
            fontFamily: 'ui-monospace, monospace',
            borderRadius: 8,
            zIndex: 200,
            margin: 0,
          }}
        >
          {JSON.stringify(lastSubmit.answers, null, 2)}
        </pre>
      )}
    </>
  );
}
