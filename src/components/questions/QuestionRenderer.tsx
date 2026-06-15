/**
 * Type-discriminated dispatcher for question rendering. Each `case` returns
 * the field component for that question type. New question types only need
 * an entry here + an `import` above + a Field component.
 */

'use client';

import { useMemo } from 'react';
import type { LooseAnswers } from '@/types/Answers.js';
import type { Question } from '@/types/Question.js';
import { pipeQuestionCopy } from '@/logic/piping.js';
import { useAutoAdvanceTimer } from '@/hooks/useAutoAdvanceTimer.js';

import { WelcomeScreen } from './WelcomeScreen.js';
import { StatementScreen } from './StatementScreen.js';
import { ReviewScreen } from './ReviewScreen.js';
import { ThanksScreen } from './ThanksScreen.js';
import { ShortTextField } from './ShortTextField.js';
import { LongTextField } from './LongTextField.js';
import { EmailField } from './EmailField.js';
import { PhoneField } from './PhoneField.js';
import { UrlField } from './UrlField.js';
import { NumberField } from './NumberField.js';
import { DateField } from './DateField.js';
import { ScaleField } from './ScaleField.js';
import { NpsField } from './NpsField.js';
import { SingleChoiceField } from './SingleChoiceField.js';
import { MultiChoiceField } from './MultiChoiceField.js';
import { DropdownField } from './DropdownField.js';
import { YesNoField } from './YesNoField.js';
import { LegalField } from './LegalField.js';
import { FileUploadField, type FileUploadHandler } from './FileUploadField.js';
import { PictureChoiceField } from './PictureChoiceField.js';
import { RankingField } from './RankingField.js';
import { MatrixField } from './MatrixField.js';
import type { MatrixAnswer } from '@/types/Answers.js';

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
  /** Host-controlled file storage for `file_upload` questions (ADR-012). */
  onFileUpload?: FileUploadHandler;
  /** Running score total, available in piping as `{{score}}` (ADR-016). */
  score?: number;
  /** Currently visible questions — feeds the review screen's answer list. */
  visibleList?: ReadonlyArray<Question>;
  /** Jump back to a question for editing (review screen). */
  onEditQuestion?: (questionId: string) => void;
  /** Play the schema step-sound on discrete interactions (choices, OK, etc.). */
  playInteractionSound?: () => void;
};

function StepBadge({ step, total }: { step: number; total: number }) {
  if (step <= 0 || total <= 0) return null;
  return (
    <div className="slate-step-badge">
      <span>{String(step).padStart(2, '0')}</span>
      <span className="slate-step-sep">→</span>
    </div>
  );
}

export function QuestionRenderer({
  question: rawQuestion,
  answers,
  setAnswer,
  advance,
  stepNumber,
  totalSteps,
  submitStatus,
  submitError,
  onRetrySubmit,
  onRestart,
  onFileUpload,
  score = 0,
  visibleList,
  onEditQuestion,
  playInteractionSound,
}: QuestionRendererProps) {
  // Resolve {{field:id}} / {{score}} piping (and function-style DynamicTitle)
  // once here, so every field component receives ready-to-render copy.
  const question = useMemo(
    () => pipeQuestionCopy(rawQuestion, answers, score),
    [rawQuestion, answers, score],
  );

  const { schedule: scheduleAutoAdvance } = useAutoAdvanceTimer(rawQuestion.id);

  const ping = () => playInteractionSound?.();
  const advanceWithSound = () => {
    ping();
    advance();
  };

  // Auto-advance helper for single_choice — fire after a brief pause so
  // the selected highlight is visible before the transition starts.
  const selectAndAdvance = (id: string, value: string) => {
    ping();
    setAnswer(id, value);
    scheduleAutoAdvance(() => advance());
  };

  const selectScaleAndAdvance = (id: string, value: number) => {
    ping();
    setAnswer(id, value);
    scheduleAutoAdvance(() => advance());
  };

  switch (question.type) {
    case 'welcome':
      return <WelcomeScreen question={question} advance={advanceWithSound} />;

    case 'statement':
      return (
        <StatementScreen
          question={question}
          advance={advanceWithSound}
          stepBadge={stepNumber}
          totalSteps={totalSteps}
        />
      );

    case 'review':
      return (
        <ReviewScreen
          question={question}
          visible={visibleList ?? []}
          answers={answers}
          onEdit={(id) => onEditQuestion?.(id)}
          onAdvance={advanceWithSound}
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
            onAdvance={advanceWithSound}
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
            onAdvance={advanceWithSound}
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
            onAdvance={advanceWithSound}
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
            onAdvance={advanceWithSound}
          />
        </>
      );

    case 'url':
      return (
        <>
          <StepBadge step={stepNumber} total={totalSteps} />
          <UrlField
            question={question}
            answers={answers}
            initialValue={(answers[question.id] as string | undefined) ?? ''}
            onAnswer={(v) => setAnswer(question.id, v)}
            onAdvance={advanceWithSound}
          />
        </>
      );

    case 'date':
      return (
        <>
          <StepBadge step={stepNumber} total={totalSteps} />
          <DateField
            question={question}
            answers={answers}
            initialValue={(answers[question.id] as string | undefined) ?? ''}
            onAnswer={(v) => setAnswer(question.id, v)}
            onAdvance={advanceWithSound}
          />
        </>
      );

    case 'number':
      return (
        <>
          <StepBadge step={stepNumber} total={totalSteps} />
          <NumberField
            question={question}
            answers={answers}
            initialValue={answers[question.id] as number | undefined}
            onAnswer={(v) => setAnswer(question.id, v)}
            onAdvance={advanceWithSound}
          />
        </>
      );

    case 'scale':
      return (
        <>
          <StepBadge step={stepNumber} total={totalSteps} />
          <ScaleField
            question={question}
            answers={answers}
            initialValue={answers[question.id] as number | undefined}
            onAnswer={(v) => selectScaleAndAdvance(question.id, v)}
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
            onSelect={(vs) => {
              ping();
              setAnswer(question.id, vs);
            }}
            onAdvance={advanceWithSound}
          />
        </>
      );

    case 'dropdown':
      return (
        <>
          <StepBadge step={stepNumber} total={totalSteps} />
          <DropdownField
            question={question}
            answers={answers}
            selected={answers[question.id] as string | undefined}
            onSelect={(v) => {
              ping();
              setAnswer(question.id, v);
            }}
            onAdvance={advance}
            onSubmit={advanceWithSound}
          />
        </>
      );

    case 'yes_no':
      return (
        <>
          <StepBadge step={stepNumber} total={totalSteps} />
          <YesNoField
            question={question}
            answers={answers}
            selected={answers[question.id] as string | undefined}
            onSelect={(v) => selectAndAdvance(question.id, v)}
          />
        </>
      );

    case 'legal':
      return (
        <>
          <StepBadge step={stepNumber} total={totalSteps} />
          <LegalField
            question={question}
            answers={answers}
            selected={answers[question.id] as string | undefined}
            onSelect={(v) => selectAndAdvance(question.id, v)}
          />
        </>
      );

    case 'nps':
      return (
        <>
          <StepBadge step={stepNumber} total={totalSteps} />
          <NpsField
            question={question}
            answers={answers}
            initialValue={answers[question.id] as number | undefined}
            onAnswer={(v) => selectScaleAndAdvance(question.id, v)}
          />
        </>
      );

    case 'file_upload':
      return (
        <>
          <StepBadge step={stepNumber} total={totalSteps} />
          <FileUploadField
            question={question}
            answers={answers}
            initialValue={answers[question.id] as File | string | undefined}
            onAnswer={(v) => setAnswer(question.id, v)}
            onAdvance={advanceWithSound}
            onFileUpload={onFileUpload}
          />
        </>
      );

    case 'picture_choice':
      return (
        <>
          <StepBadge step={stepNumber} total={totalSteps} />
          <PictureChoiceField
            question={question}
            answers={answers}
            selected={answers[question.id] as string | string[] | undefined}
            onSelectSingle={(v) => selectAndAdvance(question.id, v)}
            onSelectMulti={(vs) => {
              ping();
              setAnswer(question.id, vs);
            }}
            onAdvance={advanceWithSound}
          />
        </>
      );

    case 'ranking':
      return (
        <>
          <StepBadge step={stepNumber} total={totalSteps} />
          <RankingField
            question={question}
            answers={answers}
            initialValue={answers[question.id] as string[] | undefined}
            onAnswer={(order) => setAnswer(question.id, order)}
            onAdvance={advanceWithSound}
          />
        </>
      );

    case 'matrix':
      return (
        <>
          <StepBadge step={stepNumber} total={totalSteps} />
          <MatrixField
            question={question}
            answers={answers}
            initialValue={answers[question.id] as MatrixAnswer | undefined}
            onAnswer={(v) => {
              ping();
              setAnswer(question.id, v);
            }}
            onAdvance={advanceWithSound}
          />
        </>
      );
  }
}
