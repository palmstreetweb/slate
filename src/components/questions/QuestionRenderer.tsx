/**
 * Type-discriminated dispatcher for question rendering. Each `case` returns
 * the field component for that question type. New question types only need
 * an entry here + an `import` above + a Field component.
 *
 * Variants that load on demand (ADR-063 — styled scales, the stepper, date
 * ranges and times, and later waves' types) are dispatched first, through
 * `lazyFields.tsx`, with one shared prop contract.
 */

'use client';

import { useMemo } from 'react';
import type { LooseAnswers } from '@/types/Answers.js';
import type { Question } from '@/types/Question.js';
import type { Estimate, EstimateSettings } from '@/types/Estimate.js';
import { pipeQuestionCopy } from '@/logic/piping.js';
import { estimateCurrency, formatEstimate } from '@/logic/estimate.js';
import { useAutoAdvanceTimer } from '@/hooks/useAutoAdvanceTimer.js';

import { WelcomeScreen } from './WelcomeScreen.js';
import { StatementScreen } from './StatementScreen.js';
import { ReviewScreen } from './ReviewScreen.js';
import { ThanksScreen } from './ThanksScreen.js';
import { ShortTextField } from './ShortTextField.js';
import { LongTextField } from './LongTextField.js';
import { EmailField } from './EmailField.js';
import { SingleChoiceField } from './SingleChoiceField.js';
import { MultiChoiceField } from './MultiChoiceField.js';
import { YesNoField } from './YesNoField.js';
import type { FileUploadHandler } from '@/utils/createFileUploadHandler.js';
import type { FileUploadMeta } from '@/utils/fileUploadRef.js';
import { ExtField, extFieldKey } from './lazyFields.js';

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
  resolveFileUploadMeta?: (ref: string) => Promise<FileUploadMeta | null>;
  /** Running score total, available in piping as `{{score}}` (ADR-016). */
  score?: number;
  /** Currently visible questions — feeds the review screen's answer list. */
  visibleList?: ReadonlyArray<Question>;
  /** Jump back to a question for editing (review screen). */
  onEditQuestion?: (questionId: string) => void;
  /** Play the schema step-sound on discrete interactions (choices, OK, etc.). */
  playInteractionSound?: () => void;
  /** Soft typewriter tick while typing in text fields (ADR-034). */
  playTypingSound?: () => void;
  /**
   * Every question in the schema, so piped answers read as labels and
   * formatted dates (ADR-063). Optional: without it, raw values are piped.
   */
  allQuestions?: ReadonlyArray<Question>;
  /**
   * The instant estimate for the current answers (ADR-064), or null when the
   * form prices nothing. Feeds `{{estimate}}` and the Thank You reveal.
   */
  estimate?: Estimate | null;
  /** `schema.estimate`: currency, labels, breakdown, disclaimer. */
  estimateSettings?: EstimateSettings;
  /** Spots left on this question's sign-up slots, by slot value (ADR-066). */
  slotsLeft?: Readonly<Record<string, number>>;
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
  resolveFileUploadMeta,
  score = 0,
  visibleList,
  onEditQuestion,
  playInteractionSound,
  playTypingSound,
  allQuestions,
  estimate = null,
  estimateSettings,
  slotsLeft,
}: QuestionRendererProps) {
  // Resolve {{field:id}} / {{score}} / {{estimate}} piping (and function-style
  // DynamicTitle) once here, so every field component receives ready-to-render copy.
  const estimateText = estimate ? formatEstimate(estimate) : '';
  const question = useMemo(
    () => pipeQuestionCopy(rawQuestion, answers, score, allQuestions, estimateText),
    [rawQuestion, answers, score, allQuestions, estimateText],
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

  const extKey = extFieldKey(question);
  if (extKey) {
    const id = question.id;
    return (
      <>
        <StepBadge step={stepNumber} total={totalSteps} />
        <ExtField
          key={id}
          extKey={extKey}
          question={question}
          answers={answers}
          value={answers[id]}
          onAnswer={(v) => setAnswer(id, v)}
          onCommit={(v) => {
            ping();
            setAnswer(id, v);
            scheduleAutoAdvance(() => advance());
          }}
          onAdvance={advanceWithSound}
          onAdvanceSilent={advance}
          onType={playTypingSound}
          ping={ping}
          onFileUpload={onFileUpload}
          resolveFileUploadMeta={resolveFileUploadMeta}
          currency={estimateCurrency(estimateSettings)}
          allQuestions={allQuestions}
          slotsLeft={slotsLeft}
        />
      </>
    );
  }

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
          estimate={question.showEstimate ? estimate : null}
          estimateSettings={estimateSettings}
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
            onType={playTypingSound}
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
            onType={playTypingSound}
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
            onType={playTypingSound}
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
            onType={playTypingSound}
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
            onType={playTypingSound}
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

    case 'dropdown':
    case 'scale':
    case 'url':
    case 'number':
    case 'date':
    case 'phone':
    case 'legal':
    case 'nps':
    case 'image_pin':
    case 'voice_note':
    case 'location':
    case 'photo_checklist':
    case 'availability':
    case 'signup_slots':
    case 'contact_info':
    case 'address':
    case 'signature':
    case 'ranking':
    case 'matrix':
    case 'picture_choice':
      return null;
  }
}
