/**
 * Long-standing fields through the on-demand registry (ADR-065): the plain
 * date, the typed number, the phone number, the website, legal consent, NPS
 * and (since the QA pass) the numbers scale. Each keeps its own component
 * (DateField, NumberField, PhoneField, UrlField, LegalField, NpsField,
 * ScaleField); only where it loads moved, to make room in the engine's 50 kB
 * budget — the file field (ADR-063) and picture choice, ranking and matrix
 * (ADR-064) set the precedent. `<Form>` preloads them on mount, so a
 * respondent almost never sees the placeholder. Letter, Y / N and digit keys
 * still go through `<Form>`. One chunk for all of them: they are small, and a
 * form that uses one often uses another.
 */

'use client';

import type {
  DateQuestion,
  LegalQuestion,
  NpsQuestion,
  NumberQuestion,
  PhoneQuestion,
  ScaleQuestion,
  UrlQuestion,
} from '@/types/Question.js';
import type { ExtFieldProps } from '../lazyFields.js';
import { DateField } from '../DateField.js';
import { NumberField } from '../NumberField.js';
import { PhoneField } from '../PhoneField.js';
import { UrlField } from '../UrlField.js';
import { LegalField } from '../LegalField.js';
import { NpsField } from '../NpsField.js';
import { ScaleField } from '../ScaleField.js';

export default function CoreFieldsExt(props: ExtFieldProps) {
  const { question, answers, value, onAnswer, onCommit, onAdvance, onType } = props;
  switch (question.type) {
    case 'date':
      return (
        <DateField
          question={question as DateQuestion}
          answers={answers}
          initialValue={(value as string | undefined) ?? ''}
          onAnswer={onAnswer}
          onAdvance={onAdvance}
        />
      );
    case 'number':
      return (
        <NumberField
          question={question as NumberQuestion}
          answers={answers}
          initialValue={value as number | undefined}
          onAnswer={onAnswer}
          onAdvance={onAdvance}
          onType={onType}
        />
      );
    case 'phone':
      return (
        <PhoneField
          question={question as PhoneQuestion}
          answers={answers}
          initialValue={(value as string | undefined) ?? ''}
          onAnswer={onAnswer}
          onAdvance={onAdvance}
          onType={onType}
        />
      );
    case 'url':
      return (
        <UrlField
          question={question as UrlQuestion}
          answers={answers}
          initialValue={(value as string | undefined) ?? ''}
          onAnswer={onAnswer}
          onAdvance={onAdvance}
          onType={onType}
        />
      );
    case 'legal':
      return (
        <LegalField
          question={question as LegalQuestion}
          answers={answers}
          selected={value as string | undefined}
          onSelect={onCommit}
          onAdvance={onAdvance}
        />
      );
    case 'nps':
      return (
        <NpsField
          question={question as NpsQuestion}
          answers={answers}
          initialValue={value as number | undefined}
          onAnswer={onCommit}
          onAdvance={onAdvance}
        />
      );
    case 'scale':
      return (
        <ScaleField
          question={question as ScaleQuestion}
          answers={answers}
          initialValue={value as number | undefined}
          onAnswer={onCommit}
          onAdvance={onAdvance}
        />
      );
    default:
      return null;
  }
}
