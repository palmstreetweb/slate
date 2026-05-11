/**
 * Type-discriminated dispatcher for question rendering. Each `case` returns
 * the field component for that question type. New question types only need
 * an entry here + an `import` above + a Field component.
 */

'use client';

import type { LooseAnswers } from '@/types/Answers.js';
import type { Question } from '@/types/Question.js';

import { WelcomeScreen } from './WelcomeScreen.js';
import { StatementScreen } from './StatementScreen.js';
import { ThanksScreen } from './ThanksScreen.js';
import { ShortTextField } from './ShortTextField.js';
import { LongTextField } from './LongTextField.js';
import { EmailField } from './EmailField.js';
import { PhoneField } from './PhoneField.js';
import { NumberField } from './NumberField.js';
import { ScaleField } from './ScaleField.js';
import { SingleChoiceField } from './SingleChoiceField.js';
import { MultiChoiceField } from './MultiChoiceField.js';

type SubmitStatus = 'idle' | 'submitting' | 'success' | 'error';

type SetAnswerValue = LooseAnswers[string];
type SetAnswerUpdater = (prev: SetAnswerValue) => SetAnswerValue;

export type QuestionRendererProps = {
  question: Question;
  answers: LooseAnswers;
  setAnswer: (id: string, value: SetAnswerValue | SetAnswerUpdater) => void;
  advance: () => void;
  stepNumber: number;
  totalSteps: number;
  submitStatus: SubmitStatus;
  submitError: string | null;
  /** Called when user clicks "Retry" after a submit error. */
  onRetrySubmit: () => void;
  /** Called when user clicks the thanks-screen restart CTA. */
  onRestart: () => void;
};

function StepBadge({ step, total }: { step: number; total: number }) {
  if (step <= 0 || total <= 0) return null;
  return (
    <div className="psw-step-badge">
      <span>{String(step).padStart(2, '0')}</span>
      <span className="psw-step-sep">→</span>
    </div>
  );
}

export function QuestionRenderer({
  question,
  answers,
  setAnswer,
  advance,
  stepNumber,
  totalSteps,
  submitStatus,
  submitError,
  onRetrySubmit,
  onRestart,
}: QuestionRendererProps) {
  // Auto-advance helper for single_choice — fire after a brief pause so
  // the selected highlight is visible before the transition starts.
  const selectAndAdvance = (id: string, value: string) => {
    setAnswer(id, value);
    window.setTimeout(() => advance(), 220);
  };

  switch (question.type) {
    case 'welcome':
      return <WelcomeScreen question={question} advance={advance} />;

    case 'statement':
      return (
        <StatementScreen
          question={question}
          advance={advance}
          stepBadge={stepNumber}
          totalSteps={totalSteps}
        />
      );

    case 'thanks':
      return (
        <ThanksScreen
          question={question}
          status={submitStatus}
          error={submitError}
          onRetry={onRetrySubmit}
          onRestart={onRestart}
        />
      );

    case 'short_text':
      return (
        <>
          <StepBadge step={stepNumber} total={totalSteps} />
          <ShortTextField
            question={question}
            answers={answers}
            initialValue={(answers[question.id] as string | undefined) ?? ''}
            onAnswer={(v) => setAnswer(question.id, v)}
            onAdvance={advance}
          />
        </>
      );

    case 'long_text':
      return (
        <>
          <StepBadge step={stepNumber} total={totalSteps} />
          <LongTextField
            question={question}
            answers={answers}
            initialValue={(answers[question.id] as string | undefined) ?? ''}
            onAnswer={(v) => setAnswer(question.id, v)}
            onAdvance={advance}
          />
        </>
      );

    case 'email':
      return (
        <>
          <StepBadge step={stepNumber} total={totalSteps} />
          <EmailField
            question={question}
            answers={answers}
            initialValue={(answers[question.id] as string | undefined) ?? ''}
            onAnswer={(v) => setAnswer(question.id, v)}
            onAdvance={advance}
          />
        </>
      );

    case 'phone':
      return (
        <>
          <StepBadge step={stepNumber} total={totalSteps} />
          <PhoneField
            question={question}
            answers={answers}
            initialValue={(answers[question.id] as string | undefined) ?? ''}
            onAnswer={(v) => setAnswer(question.id, v)}
            onAdvance={advance}
          />
        </>
      );

    case 'number':
      return (
        <>
          <StepBadge step={stepNumber} total={totalSteps} />
          <NumberField
            question={question}
            initialValue={answers[question.id] as number | undefined}
            onAnswer={(v) => setAnswer(question.id, v)}
            onAdvance={advance}
          />
        </>
      );

    case 'scale':
      return (
        <>
          <StepBadge step={stepNumber} total={totalSteps} />
          <ScaleField
            question={question}
            initialValue={answers[question.id] as number | undefined}
            onAnswer={(v) => {
              setAnswer(question.id, v);
              window.setTimeout(() => advance(), 220);
            }}
          />
        </>
      );

    case 'single_choice':
      return (
        <>
          <StepBadge step={stepNumber} total={totalSteps} />
          <SingleChoiceField
            question={question}
            answers={answers}
            selected={answers[question.id] as string | undefined}
            onSelect={(v) => selectAndAdvance(question.id, v)}
          />
        </>
      );

    case 'multi_choice':
      return (
        <>
          <StepBadge step={stepNumber} total={totalSteps} />
          <MultiChoiceField
            question={question}
            answers={answers}
            selected={(answers[question.id] as string[] | undefined) ?? []}
            onSelect={(vs) => setAnswer(question.id, vs)}
            onAdvance={advance}
          />
        </>
      );
  }
}
