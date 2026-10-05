/**
 * Right-rail inspector. Shows the editable properties for the currently
 * selected question. Per-question-type fields rendered via a switch on
 * `question.type`. Logic sections collapse by default and open when needed.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type {
  Condition,
  EstimateSettings,
  Option,
  PictureOption,
  Question,
  ScaleQuestion,
} from '@/index.js';
import { OUT_OF_AREA_VALUE, IN_AREA_VALUE } from '@/logic/address.js';
import { estimateCurrency } from '@/logic/estimate.js';
import { formatDateAnswer } from '@/logic/dateValue.js';
import { TYPE_LABEL } from '../questionTypeMeta.js';
import { TypeIcon } from './TypeIcon.js';
import { ConditionBuilder, JumpRulesEditor } from './LogicEditor.js';
import { canPrefill, isValidPrefillKey, RESERVED_LINK_PARAMS } from '@/logic/prefill.js';
import { SlateNumberInput } from './SlateNumberInput.js';
import { SlateSelect } from './SlateSelect.js';
import { Checkbox, CollapsibleSection, Field, Row } from './inspectorParts.js';
import { GuardNote } from './inspectorGuards.js';
import {
  FILE_COUNT_MAX,
  FILE_SIZE_MAX_MB,
  SCALE_CELLS_MAX,
  SCALE_POINTS_MAX,
  SLIDER_STOPS_MAX,
  choiceCount,
  pictureLinkProblem,
  readableAccept,
  unreadableAccept,
  hasSameValues,
  isSwipe,
  newOptionLabel,
  newOptionValue,
  normalizeRedirectUrl,
  pickProblem,
  pickWords,
  scalePointCount,
  withUniqueValues,
  type MultiPick,
} from '../formChecks.js';
import {
  AddressSettings,
  CardDetails,
  ContactSettings,
  EstimateSection,
  PhoneCountrySetting,
  PriceInputs,
  SignatureSettings,
  UnitPriceSetting,
  usePricing,
  withoutPrices,
} from './InspectorWaveB.js';
import {
  AvailabilitySettings,
  ImagePinSettings,
  LocationSettings,
  PictureStyleSetting,
  VoiceNoteSettings,
  YesNoStyleSetting,
} from './InspectorWaveC.js';
import { SignupSlotsSettings } from './InspectorWaveD.js';

type Props = {
  question: Question;
  /** Full question list — feeds logic-editor field and jump-target dropdowns. */
  allQuestions: ReadonlyArray<Question>;
  onChange: (patch: Partial<Question>) => void;
  onDelete: () => void;
  canDelete: boolean;
  /** `schema.estimate` (ADR-064) — edited from an ending's Instant estimate section. */
  estimate?: EstimateSettings;
  onEstimateChange?: (next: EstimateSettings | undefined) => void;
  /** Adds an "out of area" ending for this address question, and a jump to it. */
  onAddOutOfAreaEnding?: (addressId: string) => void;
  /** The form being edited — sign-up slots show how many signed up per slot (ADR-066). */
  formId?: string;
};

/** Some condition in the form tests this address's service area. */
function routesOutOfArea(allQuestions: ReadonlyArray<Question>, addressId: string): boolean {
  const tests = (c: Condition | undefined): boolean => {
    if (!c) return false;
    if ('all' in c) return c.all.some(tests);
    if ('any' in c) return c.any.some(tests);
    if (c.field !== addressId || !('value' in c)) return false;
    const values = Array.isArray(c.value) ? c.value : [c.value];
    return values.includes(OUT_OF_AREA_VALUE) || values.includes(IN_AREA_VALUE);
  };
  return allQuestions.some(
    (q) =>
      ('visibleIf' in q && tests(q.visibleIf)) ||
      ('logic' in q && (q.logic ?? []).some((r) => tests(r.if))),
  );
}

export function Inspector({
  question,
  allQuestions,
  onChange,
  onDelete,
  canDelete,
  estimate,
  onEstimateChange,
  onAddOutOfAreaEnding,
  formId,
}: Props) {
  const currency = estimateCurrency(estimate);
  // Question IDs are auto-generated and stable; they're not surfaced in the
  // Inspector (kept clean per product direction). They remain the answers
  // key in onSubmit and the reference target for logic/piping under the hood.
  return (
    <aside className="slate-rail slate-rail--right">
      <div className="slate-rail-pad">
        <p className="slate-label" style={{ marginBottom: 4 }}>
          Question Type
        </p>
        <div className="slate-type-chip">
          <span className="slate-outline-glyph" aria-hidden>
            <TypeIcon type={question.type} size={15} />
          </span>
          <span>{TYPE_LABEL[question.type]}</span>
        </div>
      </div>

      <Divider />

      <div className="slate-rail-pad slate-inspector-fields" style={{ display: 'grid', gap: 14 }}>
        {'title' in question && typeof question.title === 'string' && (
          <Field label="Title">
            <input
              className="slate-input"
              value={question.title}
              onChange={(e) => onChange({ title: e.target.value } as Partial<Question>)}
            />
          </Field>
        )}
        {'title' in question && typeof question.title === 'function' && (
          <Field label="Title (Dynamic Function)">
            <p style={{ margin: 0, fontSize: 13, color: 'var(--slate-muted)' }}>
              This title changes with the answers, so it’s set in the form’s code and can’t be
              edited here.
            </p>
          </Field>
        )}

        {/* By type, not by key: a cleared subtitle is dropped on save (QA S18). */}
        {(question.type === 'welcome' ||
          question.type === 'thanks' ||
          question.type === 'review') && (
          <Field label="Subtitle (Optional)">
            <AutoGrowTextarea
              key={question.id}
              value={question.subtitle ?? ''}
              onChange={(subtitle) =>
                onChange({ subtitle: subtitle || undefined } as Partial<Question>)
              }
            />
          </Field>
        )}

        {question.type === 'statement' && (
          <Field label="Body">
            <textarea
              className="slate-textarea"
              value={question.body ?? ''}
              onChange={(e) => onChange({ body: e.target.value || undefined } as Partial<Question>)}
              rows={3}
            />
          </Field>
        )}

        {(question.type === 'welcome' ||
          question.type === 'statement' ||
          question.type === 'review' ||
          question.type === 'thanks') && (
          <Field label="Button Label">
            <input
              className="slate-input"
              value={question.cta ?? ''}
              placeholder={
                question.type === 'welcome'
                  ? 'Start'
                  : question.type === 'thanks'
                    ? 'Submit another'
                    : question.type === 'review'
                      ? 'Looks good'
                      : 'Continue'
              }
              onChange={(e) => onChange({ cta: e.target.value || undefined } as Partial<Question>)}
            />
          </Field>
        )}

        {(question.type === 'short_text' ||
          question.type === 'long_text' ||
          question.type === 'email' ||
          question.type === 'phone' ||
          question.type === 'url' ||
          question.type === 'number' ||
          question.type === 'date' ||
          question.type === 'single_choice' ||
          question.type === 'dropdown' ||
          question.type === 'yes_no' ||
          question.type === 'legal' ||
          question.type === 'nps' ||
          question.type === 'scale' ||
          question.type === 'file_upload' ||
          question.type === 'matrix' ||
          (question.type === 'picture_choice' && !question.multiple)) && (
          <>
            {(question.type === 'short_text' ||
              question.type === 'long_text' ||
              question.type === 'email' ||
              question.type === 'phone' ||
              question.type === 'url' ||
              question.type === 'dropdown') && (
              <Field label="Placeholder">
                <input
                  className="slate-input"
                  value={question.placeholder ?? ''}
                  onChange={(e) =>
                    onChange({ placeholder: e.target.value || undefined } as Partial<Question>)
                  }
                />
              </Field>
            )}
            <Checkbox
              checked={
                (question as { required?: boolean }).required ??
                (question.type === 'single_choice' ||
                  question.type === 'dropdown' ||
                  question.type === 'yes_no' ||
                  question.type === 'legal' ||
                  question.type === 'picture_choice')
              }
              onChange={(v) => onChange({ required: v } as Partial<Question>)}
              label="Required"
            />
          </>
        )}

        {question.type === 'date' && (
          <>
            <Checkbox
              checked={Boolean(question.includeTime)}
              onChange={(v) => onChange({ includeTime: v || undefined } as Partial<Question>)}
              label="Ask for a Time Too"
            />
            <Checkbox
              checked={Boolean(question.range)}
              onChange={(v) => onChange({ range: v || undefined } as Partial<Question>)}
              label="Start and End (Date Range)"
            />
          </>
        )}

        {question.type === 'date' && (
          <Field label="Format">
            <SlateSelect
              value={question.format ?? 'MM/DD/YYYY'}
              options={[
                { value: 'MM/DD/YYYY', label: 'MM/DD/YYYY' },
                { value: 'DD/MM/YYYY', label: 'DD/MM/YYYY' },
              ]}
              aria-label="Date format"
              onChange={(format) => onChange({ format } as Partial<Question>)}
            />
          </Field>
        )}

        {question.type === 'date' && <DateLimitsGuard question={question} onChange={onChange} />}

        {question.type === 'yes_no' && (
          <YesNoStyleSetting question={question} onChange={onChange} />
        )}

        {question.type === 'yes_no' && (
          <Row>
            <Field label="Yes Label">
              <input
                className="slate-input"
                value={question.yesLabel ?? ''}
                placeholder="Yes"
                onChange={(e) =>
                  onChange({ yesLabel: e.target.value || undefined } as Partial<Question>)
                }
              />
            </Field>
            <Field label="No Label">
              <input
                className="slate-input"
                value={question.noLabel ?? ''}
                placeholder="No"
                onChange={(e) =>
                  onChange({ noLabel: e.target.value || undefined } as Partial<Question>)
                }
              />
            </Field>
          </Row>
        )}

        {question.type === 'legal' && (
          <>
            <Field label="Terms / Consent Copy">
              <textarea
                className="slate-textarea"
                value={question.body ?? ''}
                onChange={(e) =>
                  onChange({ body: e.target.value || undefined } as Partial<Question>)
                }
                rows={3}
              />
            </Field>
            <Row>
              <Field label="Accept Label">
                <input
                  className="slate-input"
                  value={question.acceptLabel ?? ''}
                  placeholder="I accept"
                  onChange={(e) =>
                    onChange({ acceptLabel: e.target.value || undefined } as Partial<Question>)
                  }
                />
              </Field>
              <Field label="Decline Label">
                <input
                  className="slate-input"
                  value={question.declineLabel ?? ''}
                  placeholder="I don't accept"
                  onChange={(e) =>
                    onChange({ declineLabel: e.target.value || undefined } as Partial<Question>)
                  }
                />
              </Field>
            </Row>
          </>
        )}

        {question.type === 'nps' && (
          <Row>
            <Field label="Low Anchor">
              <input
                className="slate-input"
                value={question.minLabel ?? ''}
                placeholder="Not at all likely"
                onChange={(e) =>
                  onChange({ minLabel: e.target.value || undefined } as Partial<Question>)
                }
              />
            </Field>
            <Field label="High Anchor">
              <input
                className="slate-input"
                value={question.maxLabel ?? ''}
                placeholder="Extremely likely"
                onChange={(e) =>
                  onChange({ maxLabel: e.target.value || undefined } as Partial<Question>)
                }
              />
            </Field>
          </Row>
        )}

        {(question.type === 'short_text' || question.type === 'long_text') && (
          <>
            <Field label="Max Length (Characters)" hint="Leave empty, or 0, for no limit.">
              <SlateNumberInput
                value={question.maxLength}
                placeholder="No limit"
                // Below 1 (0, -5, 0.5) is no limit, never a limit of 1; 2.7 is 2 (R18).
                onChange={(n) =>
                  onChange({
                    maxLength: n !== undefined && n >= 1 ? Math.floor(n) : undefined,
                  } as Partial<Question>)
                }
              />
            </Field>
            {question.maxLength !== undefined &&
            !(Number.isInteger(question.maxLength) && question.maxLength >= 1) ? (
              <GuardNote
                action={
                  question.maxLength >= 1
                    ? {
                        label: `Use ${Math.floor(question.maxLength)}`,
                        onClick: () =>
                          onChange({
                            maxLength: Math.floor(question.maxLength!),
                          } as Partial<Question>),
                      }
                    : {
                        label: 'Clear it',
                        onClick: () => onChange({ maxLength: undefined } as Partial<Question>),
                      }
                }
              >
                {question.maxLength >= 1
                  ? `Answers can be up to ${plural(Math.floor(question.maxLength), 'character', 'characters')}: a limit is a whole number.`
                  : `${String(question.maxLength)} means no limit.`}
              </GuardNote>
            ) : null}
          </>
        )}

        {question.type === 'phone' && (
          <PhoneCountrySetting question={question} onChange={onChange} />
        )}

        {question.type === 'number' && (
          <>
            <Field label="Style">
              <SlateSelect
                value={question.display ?? 'input'}
                options={[
                  { value: 'input', label: 'Type a number' },
                  { value: 'stepper', label: 'Quantity stepper (− / +)' },
                ]}
                aria-label="Number style"
                onChange={(display) =>
                  onChange({
                    display: display === 'stepper' ? 'stepper' : undefined,
                  } as Partial<Question>)
                }
              />
            </Field>
            <Row>
              <Field label="Min">
                <SlateNumberInput
                  value={question.min}
                  onChange={(n) => onChange({ min: n } as Partial<Question>)}
                />
              </Field>
              <Field label="Max">
                <SlateNumberInput
                  value={question.max}
                  onChange={(n) => onChange({ max: n } as Partial<Question>)}
                />
              </Field>
            </Row>
            {question.min !== undefined &&
            question.max !== undefined &&
            question.min > question.max ? (
              <GuardNote
                action={{
                  label: 'Swap them',
                  onClick: () =>
                    onChange({ min: question.max, max: question.min } as Partial<Question>),
                }}
              >
                Min ({question.min}) is more than Max ({question.max}), so neither limit is used.
              </GuardNote>
            ) : null}
            <Row>
              <Field
                label="Step"
                hint={question.display === 'stepper' ? 'Each − / + tap' : undefined}
              >
                <SlateNumberInput
                  above={0}
                  value={question.step}
                  placeholder="1"
                  onChange={(n) => onChange({ step: n } as Partial<Question>)}
                />
              </Field>
              <Field label="Before / After" hint="e.g. $ … or … sq ft">
                <span className="slate-inspector-affixes">
                  <input
                    className="slate-input"
                    value={question.prefix ?? ''}
                    placeholder="$"
                    maxLength={12}
                    aria-label="Shown before the number"
                    onChange={(e) =>
                      onChange({ prefix: e.target.value || undefined } as Partial<Question>)
                    }
                  />
                  <input
                    className="slate-input"
                    value={question.unit ?? ''}
                    placeholder="units"
                    maxLength={24}
                    aria-label="Shown after the number"
                    onChange={(e) =>
                      onChange({ unit: e.target.value || undefined } as Partial<Question>)
                    }
                  />
                </span>
              </Field>
            </Row>
            {question.step !== undefined && !(question.step > 0) ? (
              <GuardNote
                action={{
                  label: 'Use 1',
                  onClick: () => onChange({ step: undefined } as Partial<Question>),
                }}
              >
                Step has to be more than 0.
              </GuardNote>
            ) : null}
            <UnitPriceSetting question={question} onChange={onChange} currency={currency} />
          </>
        )}

        {question.type === 'contact_info' && (
          <ContactSettings question={question} onChange={onChange} />
        )}

        {question.type === 'address' && (
          <AddressSettings
            question={question}
            onChange={onChange}
            hasOutOfAreaRoute={routesOutOfArea(allQuestions, question.id)}
            onAddOutOfAreaEnding={
              onAddOutOfAreaEnding ? () => onAddOutOfAreaEnding(question.id) : undefined
            }
          />
        )}

        {question.type === 'signature' && (
          <SignatureSettings question={question} onChange={onChange} />
        )}

        {/* Wave C (ADR-065) */}
        {question.type === 'image_pin' && (
          <ImagePinSettings question={question} onChange={onChange} />
        )}

        {question.type === 'voice_note' && (
          <VoiceNoteSettings question={question} onChange={onChange} />
        )}

        {question.type === 'location' && (
          <LocationSettings
            question={question}
            onChange={onChange}
            form={allQuestions}
            hasOutOfAreaRoute={routesOutOfArea(allQuestions, question.id)}
            onAddOutOfAreaEnding={
              onAddOutOfAreaEnding ? () => onAddOutOfAreaEnding(question.id) : undefined
            }
          />
        )}

        {question.type === 'availability' && (
          <AvailabilitySettings question={question} onChange={onChange} />
        )}

        {/* Wave D (ADR-066) */}
        {question.type === 'signup_slots' && (
          <SignupSlotsSettings question={question} onChange={onChange} formId={formId} />
        )}

        {question.type === 'photo_checklist' && (
          <>
            <Field
              label="Photos to Take"
              hint="One line per shot, in the order they should take them. Each opens the phone's camera."
            >
              <OptionsEditor
                key={question.id}
                options={question.items as Option[]}
                onChange={(items) => onChange({ items } as Partial<Question>)}
                noun={{ one: 'photo', many: 'photos' }}
              />
            </Field>
            <Checkbox
              checked={question.required !== false}
              onChange={(v) => onChange({ required: v ? undefined : false } as Partial<Question>)}
              label="Every Photo Is Required"
            />
          </>
        )}

        {question.type === 'scale' && (
          <>
            <Row>
              <Field label="Min Value">
                <SlateNumberInput
                  value={question.min}
                  integer
                  allowEmpty={false}
                  onChange={(n) => {
                    if (n === undefined) return;
                    onChange({ min: n } as Partial<Question>);
                  }}
                />
              </Field>
              <Field label="Max Value">
                <SlateNumberInput
                  value={question.max}
                  integer
                  allowEmpty={false}
                  onChange={(n) => {
                    if (n === undefined) return;
                    onChange({ max: n } as Partial<Question>);
                  }}
                />
              </Field>
            </Row>
            <ScaleGuards question={question} onChange={onChange} />
            <Row>
              <Field label="Min Label">
                <input
                  className="slate-input"
                  value={question.minLabel ?? ''}
                  onChange={(e) =>
                    onChange({ minLabel: e.target.value || undefined } as Partial<Question>)
                  }
                />
              </Field>
              <Field label="Max Label">
                <input
                  className="slate-input"
                  value={question.maxLabel ?? ''}
                  onChange={(e) =>
                    onChange({ maxLabel: e.target.value || undefined } as Partial<Question>)
                  }
                />
              </Field>
            </Row>
            <Field
              label="Style"
              hint={
                (question.display === 'stars' || question.display === 'emoji') &&
                scalePoints(question) > 7
                  ? `${scalePoints(question)} points is a lot of ${question.display === 'stars' ? 'stars' : 'faces'} on a phone — 5 reads best.`
                  : question.display === 'slider'
                    ? 'They drag, then press OK.'
                    : undefined
              }
            >
              <SlateSelect
                value={question.display ?? 'numbers'}
                options={[
                  { value: 'numbers', label: 'Numbers' },
                  { value: 'stars', label: 'Stars' },
                  { value: 'emoji', label: 'Faces' },
                  { value: 'slider', label: 'Slider' },
                ]}
                aria-label="Scale style"
                onChange={(display) =>
                  onChange({
                    display: display === 'numbers' ? undefined : display,
                    sliderIcon: display === 'slider' ? question.sliderIcon : undefined,
                    // Stars count from one: "1 star" saves 1 (QA F20), and 5 reads best.
                    ...(display === 'stars' && question.display !== 'stars'
                      ? starsRange(question)
                      : {}),
                  } as Partial<Question>)
                }
              />
            </Field>
            {question.display === 'slider' && (
              <Field label="Above the Slider">
                <SlateSelect
                  value={question.sliderIcon ?? 'emoji'}
                  options={[
                    { value: 'emoji', label: 'A face that reacts' },
                    { value: 'stars', label: 'Stars that fill' },
                    { value: 'none', label: 'Just the number' },
                  ]}
                  aria-label="Above the slider"
                  onChange={(sliderIcon) =>
                    onChange({
                      sliderIcon: sliderIcon === 'emoji' ? undefined : sliderIcon,
                    } as Partial<Question>)
                  }
                />
              </Field>
            )}
          </>
        )}

        {question.type === 'file_upload' && (
          <>
            <Checkbox
              checked={question.multiple !== false}
              onChange={(v) =>
                onChange({
                  multiple: v,
                  maxFiles: v ? (question.maxFiles ?? 10) : undefined,
                } as Partial<Question>)
              }
              label="Allow Multiple Files"
            />
            <Row>
              <Field
                label="Accept"
                hint="Leave empty for any file. To limit it, list file endings: pdf, jpg, png."
              >
                <input
                  className="slate-input"
                  value={question.accept ?? ''}
                  placeholder="Any file"
                  onChange={(e) =>
                    onChange({ accept: e.target.value || undefined } as Partial<Question>)
                  }
                />
              </Field>
              <Field label="Max Size (MB)" hint={`1 to ${FILE_SIZE_MAX_MB} MB.`}>
                <SlateNumberInput
                  min={1}
                  max={FILE_SIZE_MAX_MB}
                  value={question.maxSizeMb}
                  placeholder={String(FILE_SIZE_MAX_MB)}
                  onChange={(n) => onChange({ maxSizeMb: n } as Partial<Question>)}
                />
              </Field>
            </Row>
            {question.maxSizeMb !== undefined &&
            !(question.maxSizeMb > 0 && question.maxSizeMb <= FILE_SIZE_MAX_MB) ? (
              <GuardNote
                action={{
                  label: `Use ${FILE_SIZE_MAX_MB} MB`,
                  onClick: () => onChange({ maxSizeMb: FILE_SIZE_MAX_MB } as Partial<Question>),
                }}
              >
                {question.maxSizeMb > FILE_SIZE_MAX_MB
                  ? `Uploads stop at ${FILE_SIZE_MAX_MB} MB, whatever this says.`
                  : `${String(question.maxSizeMb)} MB means the usual ${FILE_SIZE_MAX_MB} MB limit.`}
              </GuardNote>
            ) : null}
            <AcceptGuard question={question} onChange={onChange} />
            {question.multiple !== false && (
              <>
                <Field label="Max Files">
                  <SlateNumberInput
                    min={1}
                    max={FILE_COUNT_MAX}
                    integer
                    value={question.maxFiles}
                    placeholder="10"
                    onChange={(n) => onChange({ maxFiles: n } as Partial<Question>)}
                  />
                </Field>
                {question.maxFiles !== undefined &&
                !(Number.isInteger(question.maxFiles) && question.maxFiles >= 1) ? (
                  // The note, the banner and the fix name one number (COPY-R4): 2.5 is 2.
                  <MaxFilesGuard maxFiles={question.maxFiles} onChange={onChange} />
                ) : null}
              </>
            )}
          </>
        )}

        {question.type === 'single_choice' && (
          <Field
            label="Style"
            hint={
              question.display === 'cards'
                ? 'Each option is a card with its price, a few features and a badge. Phones stack them.'
                : undefined
            }
          >
            <SlateSelect
              value={question.display === 'cards' ? 'cards' : 'list'}
              options={[
                { value: 'list', label: 'List' },
                { value: 'cards', label: 'Package cards' },
              ]}
              aria-label="Choice style"
              onChange={(display) =>
                onChange({
                  display: display === 'cards' ? 'cards' : undefined,
                } as Partial<Question>)
              }
            />
          </Field>
        )}

        {(question.type === 'single_choice' ||
          question.type === 'multi_choice' ||
          question.type === 'dropdown' ||
          question.type === 'ranking') && (
          <Field label="Options">
            <OptionsEditor
              key={question.id}
              options={question.options as Option[]}
              onChange={(opts) => onChange({ options: opts } as Partial<Question>)}
              withScore={question.type !== 'ranking'}
              currency={question.type !== 'ranking' ? currency : undefined}
              cards={question.type === 'single_choice' && question.display === 'cards'}
            />
          </Field>
        )}

        {(question.type === 'single_choice' ||
          question.type === 'multi_choice' ||
          question.type === 'dropdown') && <OtherSetting question={question} onChange={onChange} />}

        {question.type === 'picture_choice' && (
          <>
            <PictureStyleSetting question={question} onChange={onChange} />
            {question.display === 'swipe' ? null : (
              <Checkbox
                checked={Boolean(question.multiple)}
                onChange={(v) =>
                  onChange(
                    // Carry "Required" across (QA CH-08): single-select's required is
                    // multi-select's "at least one", and back.
                    (v
                      ? {
                          multiple: true,
                          min:
                            question.required !== false && question.min === undefined
                              ? 1
                              : question.min,
                        }
                      : {
                          multiple: false,
                          required: (question.min ?? 0) >= 1 ? undefined : false,
                        }) as Partial<Question>,
                  )
                }
                label="Allow Multiple Selections"
              />
            )}
            <Field label="Options (Label / Image URL)">
              <PictureOptionsEditor
                key={question.id}
                options={question.options as PictureOption[]}
                onChange={(opts) => onChange({ options: opts } as Partial<Question>)}
                currency={currency}
              />
            </Field>
            {question.display === 'swipe' ? null : (
              <OtherSetting question={question} onChange={onChange} />
            )}
            {question.multiple && <PickLimits question={question} onChange={onChange} />}
          </>
        )}

        {question.type === 'matrix' && (
          <>
            <Checkbox
              checked={Boolean(question.multiple)}
              onChange={(v) => onChange({ multiple: v } as Partial<Question>)}
              label="Allow Multiple Per Row"
            />
            <Field label="Rows">
              <OptionsEditor
                options={question.rows as Option[]}
                onChange={(rows) => onChange({ rows } as Partial<Question>)}
                noun={{ one: 'row', many: 'rows' }}
              />
            </Field>
            <Field label="Columns">
              <OptionsEditor
                options={question.columns as Option[]}
                onChange={(columns) => onChange({ columns } as Partial<Question>)}
                noun={{ one: 'column', many: 'columns' }}
              />
            </Field>
          </>
        )}

        {question.type === 'multi_choice' && <PickLimits question={question} onChange={onChange} />}

        {question.type === 'thanks' && <RedirectSetting question={question} onChange={onChange} />}

        {question.type === 'thanks' && onEstimateChange && (
          <EstimateSection
            question={question}
            onChange={onChange}
            allQuestions={allQuestions}
            settings={estimate}
            onSettingsChange={onEstimateChange}
          />
        )}

        {canPrefill(question) && (
          <PrefillSetting question={question} allQuestions={allQuestions} onChange={onChange} />
        )}

        {question.type !== 'welcome' && (
          <>
            <div style={{ height: 1, background: 'var(--slate-border)', margin: '8px 0' }} />
            <CollapsibleSection
              label={question.type === 'thanks' ? 'When to show this ending' : 'When to show'}
              hint="Everyone sees this by default. Add a rule to show it only when earlier answers match."
              summary={
                visibilityRuleCount(question.visibleIf) > 0
                  ? `${visibilityRuleCount(question.visibleIf)} visibility ${visibilityRuleCount(question.visibleIf) === 1 ? 'rule' : 'rules'}`
                  : 'Always visible'
              }
              defaultOpen={visibilityRuleCount(question.visibleIf) > 0}
              questionId={question.id}
            >
              <ConditionBuilder
                value={question.visibleIf}
                onChange={(visibleIf) => onChange({ visibleIf } as Partial<Question>)}
                questions={allQuestions}
                currentId={question.id}
              />
            </CollapsibleSection>
          </>
        )}

        {question.type !== 'welcome' &&
          question.type !== 'thanks' &&
          question.type !== 'review' && (
            <CollapsibleSection
              label="Skip ahead"
              hint="After they answer, jump to another question. First matching rule wins; otherwise they go to the next question in order."
              summary={
                skipRuleCount(question) > 0
                  ? `${skipRuleCount(question)} skip ${skipRuleCount(question) === 1 ? 'rule' : 'rules'}`
                  : 'Next question in order'
              }
              defaultOpen={skipRuleCount(question) > 0}
              questionId={question.id}
            >
              <JumpRulesEditor
                rules={('logic' in question ? question.logic : undefined) ?? []}
                onChange={(logic) => onChange({ logic } as Partial<Question>)}
                questions={allQuestions}
                currentId={question.id}
              />
            </CollapsibleSection>
          )}

        {canDelete && (
          <>
            <div style={{ height: 1, background: 'var(--slate-border)', margin: '8px 0' }} />
            <button type="button" className="slate-btn slate-btn--danger" onClick={onDelete}>
              Delete
            </button>
          </>
        )}
      </div>
    </aside>
  );
}

/** How many points a scale has (min to max by step). */
function scalePoints(q: { min: number; max: number; step?: number }): number {
  const step = q.step && q.step > 0 ? q.step : 1;
  return q.max >= q.min ? Math.floor((q.max - q.min) / step + 1e-9) + 1 : 0;
}

type Patch = (patch: Partial<Question>) => void;

const isAre = (n: number) => (n === 1 ? 'is' : 'are');

/**
 * Required, Min and Max for a multi-select (QA CH-04, CH-08, S3, GAP-09). Whole
 * numbers only; "Required" means at least one pick; anything nobody could
 * meet is said right under the fields, with a one-tap fix.
 */
function PickLimits({ question, onChange }: { question: MultiPick; onChange: Patch }) {
  const swipe = isSwipe(question);
  const w = pickWords(question);
  const problem = pickProblem(question);
  const choices = choiceCount(question);
  const set = (patch: { min?: number; max?: number }) => onChange(patch as Partial<Question>);
  const choicesText = `${choices} ${choices === 1 ? w.choice : w.choices}${w.other}`;
  return (
    <>
      <Checkbox
        checked={(question.min ?? 0) >= 1}
        onChange={(v) => set({ min: v ? Math.max(1, question.min ?? 0) : undefined })}
        label={swipe ? 'Required (At Least One Like)' : 'Required (At Least One)'}
      />
      <Row>
        <Field label={swipe ? 'Min Likes' : 'Min Selections'}>
          <SlateNumberInput
            min={0}
            integer
            value={question.min}
            placeholder="0"
            onChange={(n) => set({ min: n })}
          />
        </Field>
        <Field label={swipe ? 'Max Likes' : 'Max Selections'}>
          <SlateNumberInput
            min={1}
            integer
            value={question.max}
            placeholder="No limit"
            onChange={(n) => set({ max: n })}
          />
        </Field>
      </Row>
      {problem?.kind === 'max_whole' ? (
        <GuardNote action={{ label: 'Clear Max', onClick: () => set({ max: undefined }) }}>
          Max has to be a whole number, 1 or more.
        </GuardNote>
      ) : problem?.kind === 'min_whole' ? (
        <GuardNote action={{ label: 'Clear Min', onClick: () => set({ min: undefined }) }}>
          Min has to be a whole number, 0 or more.
        </GuardNote>
      ) : problem?.kind === 'min_over_choices' ? (
        <GuardNote
          action={{ label: `Set Min to ${choices}`, onClick: () => set({ min: choices }) }}
        >
          There {isAre(choices)} only {choicesText}, so nobody could {swipe ? 'like' : 'pick'}{' '}
          {problem.min}.
        </GuardNote>
      ) : problem?.kind === 'max_under_min' ? (
        <GuardNote
          action={{
            label: 'Swap them',
            onClick: () => set({ min: problem.max, max: problem.min }),
          }}
        >
          Max ({problem.max}) is less than Min ({problem.min}), so nobody could finish.
        </GuardNote>
      ) : problem?.kind === 'max_over_choices' ? (
        <GuardNote quiet>
          There {isAre(choices)} only {choicesText}, so Max {problem.max} never comes into play.
        </GuardNote>
      ) : null}
    </>
  );
}

/** Stars count from 1 ("1 star" saves 1), and 5 reads best on a phone (QA F20). */
function starsRange(q: ScaleQuestion): { min: number; max: number } {
  const min = q.min < 1 ? 1 : q.min;
  const points = scalePointCount({ ...q, min });
  return { min, max: q.max < min || points > 7 ? min + 4 : q.max };
}

/**
 * File types the form's filter can't read (R22): it leaves them out rather
 * than refusing every file, and says so here with a one-tap fix.
 */
function AcceptGuard({
  question,
  onChange,
}: {
  question: { accept?: string };
  onChange: (patch: Partial<Question>) => void;
}) {
  const unread = unreadableAccept(question.accept);
  if (!unread.length) return null;
  const kept = readableAccept(question.accept);
  return (
    <GuardNote
      quiet
      action={{
        label: kept ? 'Keep the rest' : 'Clear it',
        onClick: () => onChange({ accept: kept } as Partial<Question>),
      }}
    >
      {unread.map((t) => `“${t}”`).join(', ')}{' '}
      {unread.length === 1 ? 'isn’t a file ending' : 'aren’t file endings'} the form can read, so{' '}
      {unread.length === 1 ? 'it’s' : 'they’re'} left out. List endings like pdf, jpg or png.
    </GuardNote>
  );
}

/** "1 file", "2 files". */
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** A Max Files that isn't a whole number of 1 or more: what the form counts it as, and that fix. */
function MaxFilesGuard({ maxFiles, onChange }: { maxFiles: number; onChange: Patch }) {
  const counted = maxFiles >= 1 ? Math.floor(maxFiles) : 10;
  return (
    <GuardNote
      action={{
        label: `Use ${counted}`,
        onClick: () => onChange({ maxFiles: counted } as Partial<Question>),
      }}
    >
      {maxFiles >= 1
        ? `This counts as ${plural(counted, 'file', 'files')}: a limit is a whole number.`
        : `${String(maxFiles)} counts as 10, the usual limit.`}
    </GuardNote>
  );
}

/**
 * A date question's limits set the wrong way round (from code or a backup; the
 * inspector has no fields for them): the form ignores both, said with a one-tap
 * fix so they can always be put right here (review fixes, STU-3).
 */
function DateLimitsGuard({
  question,
  onChange,
}: {
  question: Extract<Question, { type: 'date' }>;
  onChange: Patch;
}) {
  const { min, max, format } = question;
  if (!min || !max || !(min > max)) return null;
  return (
    <GuardNote
      action={{
        label: 'Swap them',
        onClick: () => onChange({ min: max, max: min } as Partial<Question>),
      }}
    >
      {`The earliest date (${formatDateAnswer(min, format)}) is after the latest (${formatDateAnswer(max, format)}), so neither limit is used.`}
    </GuardNote>
  );
}

/** What can't work on a scale, said under Min / Max Value with a fix (QA F7, S16, F20). */
function ScaleGuards({ question, onChange }: { question: ScaleQuestion; onChange: Patch }) {
  const { min, max } = question;
  const points = scalePointCount(question);
  if (min > max) {
    return (
      <GuardNote
        action={{
          label: 'Swap them',
          onClick: () => onChange({ min: max, max: min } as Partial<Question>),
        }}
      >
        Min Value ({min}) is more than Max Value ({max}), so the scale runs from {max} to {min}.
      </GuardNote>
    );
  }
  if (Number.isNaN(points)) {
    return (
      <GuardNote
        action={{
          label: 'Count by 1',
          onClick: () => onChange({ step: undefined } as Partial<Question>),
        }}
      >
        This scale counts in steps of {String(question.step)}, so it can’t show its points.
      </GuardNote>
    );
  }
  // A slider draws no cells (R4): 0–100 is fine; only a step too fine to land on is said.
  if (question.display === 'slider') {
    if (points <= SLIDER_STOPS_MAX) return null;
    return (
      <GuardNote
        action={{
          label: 'Use 100 stops',
          onClick: () => onChange({ step: (max - min) / 100 } as Partial<Question>),
        }}
      >
        That’s {points.toLocaleString('en-US')} stops on the slider, too many to land on. Use a
        bigger step.
      </GuardNote>
    );
  }
  if (points > SCALE_POINTS_MAX) {
    return (
      <GuardNote
        quiet={points <= SCALE_CELLS_MAX}
        action={{
          label: `Use ${min} to ${min + 10}`,
          onClick: () => onChange({ max: min + 10, step: undefined } as Partial<Question>),
        }}
      >
        {points > SCALE_CELLS_MAX
          ? `That’s ${points.toLocaleString('en-US')} points: the form can show ${SCALE_CELLS_MAX}. Use fewer, or the Slider style.`
          : `That’s ${points.toLocaleString('en-US')} points to tap through. ${SCALE_POINTS_MAX} or fewer reads better; the Slider style suits a long range.`}
      </GuardNote>
    );
  }
  if (question.display === 'stars' && min < 1) {
    return (
      <GuardNote
        action={{
          label: 'Start at 1',
          onClick: () => onChange(starsRange(question) as Partial<Question>),
        }}
      >
        Stars start at 1. Starting at {min}, the first star saves {min}.
      </GuardNote>
    );
  }
  return null;
}

/**
 * Where to send people after they submit (QA F3, S12). A bare domain gets
 * https:// in front; anything that can't be a web page link isn't kept, and
 * says so in plain words.
 */
function RedirectSetting({
  question,
  onChange,
}: {
  question: Extract<Question, { type: 'thanks' }>;
  onChange: Patch;
}) {
  const stored = question.redirectUrl ?? '';
  const [text, setText] = useState(stored);
  const [left, setLeft] = useState(false);
  /** The last value this field saved, to tell its own saves from undo or another ending. */
  const mine = useRef<string | undefined>(question.redirectUrl);
  const save = (redirectUrl: string | undefined) => {
    mine.current = redirectUrl;
    onChange({ redirectUrl } as Partial<Question>);
  };
  useEffect(() => {
    if (question.redirectUrl === mine.current) return;
    mine.current = question.redirectUrl;
    setText(question.redirectUrl ?? '');
    setLeft(false);
  }, [question.id, question.redirectUrl]);

  const typed = text.trim();
  const url = typed ? normalizeRedirectUrl(typed) : null;
  const notWeb = typed !== '' && url === null && (left || typed === stored.trim());
  const noScheme = url !== null && url !== typed && typed === stored.trim();
  return (
    <>
      <Field
        label="Redirect URL (Optional)"
        hint={
          notWeb
            ? 'That isn’t a web address, so nobody is sent anywhere. Use a full one, like https://yoursite.com/thanks.'
            : 'After they submit, send them to this page instead.'
        }
      >
        <input
          className="slate-input"
          type="text"
          inputMode="url"
          spellCheck={false}
          autoCapitalize="none"
          autoComplete="off"
          value={text}
          placeholder="https://yoursite.com/thanks"
          aria-invalid={notWeb || noScheme ? true : undefined}
          onChange={(e) => {
            setText(e.target.value);
            setLeft(false);
            const next = e.target.value.trim();
            const u = next ? normalizeRedirectUrl(next) : null;
            if (!next) save(undefined);
            else if (u && u !== stored) save(u);
          }}
          onBlur={() => {
            setLeft(true);
            if (!typed) return;
            if (url) {
              setText(url);
              if (url !== stored) save(url);
            } else if (stored) {
              // Not a web address: never keep it, and never keep sending people to the old one.
              save(undefined);
            }
          }}
        />
      </Field>
      {noScheme && url ? (
        <GuardNote
          action={{
            label: 'Fix',
            onClick: () => {
              setText(url);
              save(url);
            },
          }}
        >
          People will go to {url}. Press Fix to save it that way.
        </GuardNote>
      ) : null}
    </>
  );
}

/** "Other: ___" (ADR-063): the respondent types their own answer. */
function OtherSetting({
  question,
  onChange,
}: {
  question: Question & { allowOther?: boolean; otherLabel?: string };
  onChange: (patch: Partial<Question>) => void;
}) {
  return (
    <>
      <Checkbox
        checked={Boolean(question.allowOther)}
        onChange={(v) =>
          onChange({
            allowOther: v || undefined,
            otherLabel: v ? question.otherLabel : undefined,
          } as Partial<Question>)
        }
        label="Allow “Other” (They Type Their Own)"
      />
      {question.allowOther && (
        <Field label="Other Label" hint="What the extra choice says.">
          <input
            className="slate-input"
            value={question.otherLabel ?? ''}
            placeholder="Other"
            maxLength={40}
            onChange={(e) =>
              onChange({ otherLabel: e.target.value || undefined } as Partial<Question>)
            }
          />
        </Field>
      )}
    </>
  );
}

/** Link parameter name from a title: "First name?" → "first_name". */
function suggestPrefillKey(question: Question, taken: ReadonlySet<string>): string {
  const title = 'title' in question && typeof question.title === 'string' ? question.title : '';
  const base =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .split('_')
      .filter((w) => !['what', 'whats', 'is', 'your', 'the', 'a', 'an', 's'].includes(w))
      .slice(0, 3)
      .join('_')
      .slice(0, 30) || question.type;
  let key = RESERVED_LINK_PARAMS.has(base) ? `${base}_answer` : base;
  let n = 2;
  while (taken.has(key.toLowerCase())) key = `${base}_${n++}`;
  return key;
}

/** Prefill from the link (ADR-063): owner opts in per question and names the parameter. */
function PrefillSetting({
  question,
  allQuestions,
  onChange,
}: {
  question: Question;
  allQuestions: ReadonlyArray<Question>;
  onChange: (patch: Partial<Question>) => void;
}) {
  const key = (question as { prefillKey?: string }).prefillKey;
  const on = key !== undefined;
  const taken = new Set(
    allQuestions
      .filter((q) => q.id !== question.id)
      .map((q) => (q as { prefillKey?: string }).prefillKey?.toLowerCase())
      .filter((k): k is string => Boolean(k)),
  );
  const trimmed = key?.trim() ?? '';
  const problem = !on
    ? null
    : !trimmed
      ? 'Give the link a name for this answer.'
      : !/^[A-Za-z0-9_-]{1,40}$/.test(trimmed)
        ? 'Use only letters, numbers, - and _.'
        : !isValidPrefillKey(trimmed)
          ? 'The link already uses this name for itself. Pick another.'
          : taken.has(trimmed.toLowerCase())
            ? 'Another question already uses this name.'
            : null;
  return (
    <CollapsibleSection
      label="Fill from link"
      hint="Let a link fill this answer in, e.g. from your own site or an email. They can still change it."
      summary={on && trimmed ? `On · ${trimmed}` : 'Off'}
      defaultOpen={on}
      questionId={question.id}
    >
      <Checkbox
        checked={on}
        onChange={(v) =>
          onChange({
            prefillKey: v ? suggestPrefillKey(question, taken) : undefined,
          } as Partial<Question>)
        }
        label="Can Be Prefilled From the Link"
      />
      {on && (
        <Field label="Link Name" hint={problem ?? `Add ?${trimmed}=… to the form link.`}>
          <input
            className={`slate-input${problem ? ' slate-input--error' : ''}`}
            value={key ?? ''}
            maxLength={40}
            spellCheck={false}
            autoCapitalize="none"
            aria-invalid={problem ? true : undefined}
            onChange={(e) =>
              onChange({ prefillKey: e.target.value.replace(/\s+/g, '_') } as Partial<Question>)
            }
          />
        </Field>
      )}
    </CollapsibleSection>
  );
}

function visibilityRuleCount(c: Condition | undefined): number {
  if (!c) return 0;
  if ('field' in c) return 1;
  if ('all' in c) return c.all.length;
  return c.any.length;
}

function skipRuleCount(question: Question): number {
  if (!('logic' in question) || !question.logic) return 0;
  return question.logic.length;
}

const AUTO_GROW_MIN_ROWS = 2;

function contentBoxHeight(el: HTMLTextAreaElement): number {
  const styles = getComputedStyle(el);
  const line = Number.parseFloat(styles.lineHeight) || 24;
  const pad =
    (Number.parseFloat(styles.paddingTop) || 0) + (Number.parseFloat(styles.paddingBottom) || 0);
  const border =
    (Number.parseFloat(styles.borderTopWidth) || 0) +
    (Number.parseFloat(styles.borderBottomWidth) || 0);
  const min = AUTO_GROW_MIN_ROWS * line + pad + border;
  const prevHeight = el.style.height;
  const prevMin = el.style.minHeight;
  el.style.minHeight = '0px';
  el.style.height = 'auto';
  const content = el.scrollHeight + border;
  el.style.height = prevHeight;
  el.style.minHeight = prevMin;
  return Math.max(min, content);
}

function AutoGrowTextarea({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const dragFloorRef = useRef(0);

  const fitToContent = () => {
    const el = ref.current;
    if (!el) return;
    const content = contentBoxHeight(el);
    const next = Math.max(content, dragFloorRef.current);
    // min-height locks native resize so the box can't shrink under the copy.
    el.style.minHeight = `${content}px`;
    el.style.height = `${next}px`;
  };

  useLayoutEffect(() => {
    fitToContent();
  }, [value]);

  return (
    <textarea
      ref={ref}
      className="slate-textarea slate-textarea--auto"
      value={value}
      rows={AUTO_GROW_MIN_ROWS}
      onChange={(e) => onChange(e.target.value)}
      onPointerUp={() => {
        const el = ref.current;
        if (!el) return;
        const content = contentBoxHeight(el);
        dragFloorRef.current = el.offsetHeight > content + 4 ? el.offsetHeight : 0;
        fitToContent();
      }}
    />
  );
}

/**
 * In place under an options list (QA CH-05, S5, S6): two options that tick
 * together (a repeated value), with a one-tap fix, and options with no name.
 */
function OptionNotes<T extends Option>({
  options,
  onChange,
  noun,
}: {
  options: ReadonlyArray<T>;
  onChange: (opts: T[]) => void;
  noun: { one: string; many: string };
}) {
  const blank = options.some((o) => !(o.label ?? '').trim());
  return (
    <>
      {hasSameValues(options) ? (
        <GuardNote action={{ label: 'Fix', onClick: () => onChange(withUniqueValues(options)) }}>
          Two {noun.many} count as one: picking one picks both.
        </GuardNote>
      ) : null}
      {blank ? <GuardNote>Give every {noun.one} a name.</GuardNote> : null}
    </>
  );
}

const OPTION_NOUN = { one: 'option', many: 'options' };

function OptionsEditor({
  options,
  onChange,
  withScore = false,
  currency,
  cards = false,
  noun = OPTION_NOUN,
}: {
  options: Option[];
  onChange: (opts: Option[]) => void;
  /** Whether scoring is applicable for this question type (feeds {{score}}, ADR-016). */
  withScore?: boolean;
  /** Prices for the instant estimate (ADR-064); omit where prices don't apply. */
  currency?: string;
  /** Package cards: per-option badge, description and features. */
  cards?: boolean;
  /** What one of these is called in notes: option, row, column, photo. */
  noun?: { one: string; many: string };
}) {
  // Scoring is opt-in: the points column only appears once the form actually
  // uses it (any option has a numeric score). Derived from data — no local
  // state — so it stays correct when switching between questions.
  const scoring = withScore && options.some((o) => typeof o.score === 'number');
  const pricing = usePricing(options);
  const showPrices = currency !== undefined && (pricing.show || cards);

  const update = (i: number, patch: Partial<Option>) => {
    onChange(options.map((o, idx) => (idx === i ? { ...o, ...patch } : o)));
  };
  // At least one stays: a choice with nothing to choose traps respondents (QA S6).
  const remove = (i: number) => {
    if (options.length > 1) onChange(options.filter((_, idx) => idx !== i));
  };
  const move = (i: number, dir: 'up' | 'down') => {
    const target = dir === 'up' ? i - 1 : i + 1;
    if (target < 0 || target >= options.length) return;
    const next = [...options];
    [next[i]!, next[target]!] = [next[target]!, next[i]!];
    onChange(next);
  };
  // A value no option has (QA CH-05): never a repeat that ticks two rows at once.
  const add = () => {
    onChange([...options, { label: newOptionLabel(options), value: newOptionValue(options) }]);
  };
  const enableScoring = () => onChange(options.map((o) => ({ ...o, score: o.score ?? 0 })));
  const disableScoring = () =>
    onChange(
      options.map((o) => {
        const next = { ...o };
        delete next.score;
        return next;
      }),
    );

  return (
    <div style={{ display: 'grid', gap: 4 }}>
      {options.map((opt, i) => (
        <div
          key={i}
          style={{
            display: 'grid',
            gridTemplateColumns: scoring ? '1fr 96px auto' : '1fr auto',
            gap: 4,
            alignItems: 'center',
          }}
        >
          <input
            className="slate-input"
            value={opt.label}
            placeholder={`Name this ${noun.one}`}
            aria-label={`${noun.one[0]!.toUpperCase()}${noun.one.slice(1)} ${i + 1} name`}
            aria-invalid={(opt.label ?? '').trim() ? undefined : true}
            onChange={(e) => update(i, { label: e.target.value })}
            style={{ padding: '6px 8px', fontSize: 13 }}
          />
          {scoring && (
            <SlateNumberInput
              compact
              value={opt.score}
              placeholder="pts"
              aria-label="Score points"
              onChange={(n) => update(i, { score: n })}
            />
          )}
          <div style={{ display: 'flex', gap: 0 }}>
            <button
              type="button"
              className="slate-icon-btn"
              onClick={() => move(i, 'up')}
              disabled={i === 0}
              aria-label="Move up"
            >
              ↑
            </button>
            <button
              type="button"
              className="slate-icon-btn"
              onClick={() => move(i, 'down')}
              disabled={i === options.length - 1}
              aria-label="Move down"
            >
              ↓
            </button>
            <button
              type="button"
              className="slate-icon-btn"
              onClick={() => remove(i)}
              disabled={options.length <= 1}
              title={options.length <= 1 ? `Keep at least one ${noun.one}` : undefined}
              aria-label={`Remove ${noun.one}`}
            >
              ×
            </button>
          </div>
          {showPrices && currency !== undefined ? (
            <span className="slate-option-extra" style={{ gridColumn: '1 / -1' }}>
              <PriceInputs
                low={opt.price}
                high={opt.priceMax}
                currency={currency}
                label={`Price for ${opt.label}`}
                onChange={(price, priceMax) => update(i, { price, priceMax })}
              />
            </span>
          ) : null}
          {cards ? (
            <span className="slate-option-extra" style={{ gridColumn: '1 / -1' }}>
              <CardDetails
                key={`${i}-${opt.value}`}
                option={opt}
                onChange={(patch) => update(i, patch)}
              />
            </span>
          ) : null}
        </div>
      ))}
      <OptionNotes options={options} onChange={onChange} noun={noun} />
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4, flexWrap: 'wrap' }}
      >
        <button
          type="button"
          className="slate-btn slate-btn--ghost slate-btn--compact"
          onClick={add}
        >
          <span className="slate-btn-plus">+</span> Add Option
        </button>
        {withScore && (
          <button
            type="button"
            className="slate-link"
            style={{ fontSize: 12 }}
            onClick={scoring ? disableScoring : enableScoring}
          >
            {scoring ? 'Remove Scoring' : 'Add Scoring'}
          </button>
        )}
        {currency !== undefined && !cards && (
          <button
            type="button"
            className="slate-link"
            style={{ fontSize: 12 }}
            onClick={() => {
              if (showPrices) {
                pricing.close();
                onChange(withoutPrices(options));
              } else pricing.open();
            }}
          >
            {showPrices ? 'Remove Prices' : 'Add Prices'}
          </button>
        )}
      </div>
    </div>
  );
}

function PictureOptionsEditor({
  options,
  onChange,
  currency,
}: {
  options: PictureOption[];
  onChange: (opts: PictureOption[]) => void;
  /** Prices for the instant estimate (ADR-064). */
  currency: string;
}) {
  // Scoring is opt-in here too — points only appear once used (ADR-016).
  const scoring = options.some((o) => typeof o.score === 'number');
  const pricing = usePricing(options);

  const update = (i: number, patch: Partial<PictureOption>) => {
    onChange(options.map((o, idx) => (idx === i ? { ...o, ...patch } : o)));
  };
  // At least one stays (QA S6), and a new option never repeats a value (QA CH-05).
  const remove = (i: number) => {
    if (options.length > 1) onChange(options.filter((_, idx) => idx !== i));
  };
  const add = () => {
    const value = newOptionValue(options);
    onChange([
      ...options,
      {
        label: newOptionLabel(options),
        value,
        src: `https://picsum.photos/seed/${value}/400/300`,
      },
    ]);
  };
  const enableScoring = () => onChange(options.map((o) => ({ ...o, score: o.score ?? 0 })));
  const disableScoring = () =>
    onChange(
      options.map((o) => {
        const next = { ...o };
        delete next.score;
        return next;
      }),
    );

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {options.map((opt, i) => (
        <div
          key={i}
          style={{
            display: 'grid',
            gap: 4,
            padding: 8,
            border: '1px solid var(--slate-border)',
            borderRadius: 'var(--slate-radius-sm)',
          }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: scoring ? '1fr 96px auto' : '1fr auto',
              gap: 4,
            }}
          >
            <input
              className="slate-input"
              value={opt.label}
              placeholder="Name this option"
              aria-label={`Option ${i + 1} name`}
              aria-invalid={(opt.label ?? '').trim() ? undefined : true}
              onChange={(e) => update(i, { label: e.target.value })}
              style={{ padding: '6px 8px', fontSize: 13 }}
            />
            {scoring && (
              <SlateNumberInput
                compact
                value={opt.score}
                placeholder="pts"
                aria-label="Score points"
                onChange={(n) => update(i, { score: n })}
              />
            )}
            <button
              type="button"
              className="slate-icon-btn"
              onClick={() => remove(i)}
              disabled={options.length <= 1}
              title={options.length <= 1 ? 'Keep at least one option' : undefined}
              aria-label="Remove option"
            >
              ×
            </button>
          </div>
          <input
            className="slate-input"
            value={opt.src}
            placeholder="https://… link to a picture"
            aria-label={`Picture link for ${opt.label || `option ${i + 1}`}`}
            aria-invalid={pictureLinkProblem(opt.src) ? true : undefined}
            style={{ padding: '6px 8px', fontFamily: 'var(--slate-font-mono)', fontSize: 12 }}
            onChange={(e) => update(i, { src: e.target.value })}
          />
          {pictureLinkProblem(opt.src) ? (
            <GuardNote quiet>{pictureLinkProblem(opt.src)}</GuardNote>
          ) : null}
          {pricing.show ? (
            <PriceInputs
              low={opt.price}
              high={opt.priceMax}
              currency={currency}
              label={`Price for ${opt.label}`}
              onChange={(price, priceMax) => update(i, { price, priceMax })}
            />
          ) : null}
        </div>
      ))}
      <OptionNotes options={options} onChange={onChange} noun={OPTION_NOUN} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <button
          type="button"
          className="slate-btn slate-btn--ghost slate-btn--compact"
          onClick={add}
        >
          <span className="slate-btn-plus">+</span> Add Option
        </button>
        <button
          type="button"
          className="slate-link"
          style={{ fontSize: 12 }}
          onClick={scoring ? disableScoring : enableScoring}
        >
          {scoring ? 'Remove Scoring' : 'Add Scoring'}
        </button>
        <button
          type="button"
          className="slate-link"
          style={{ fontSize: 12 }}
          onClick={() => {
            if (pricing.show) {
              pricing.close();
              onChange(withoutPrices(options));
            } else pricing.open();
          }}
        >
          {pricing.show ? 'Remove Prices' : 'Add Prices'}
        </button>
      </div>
    </div>
  );
}

function Divider() {
  return (
    <div style={{ height: 1, background: 'var(--slate-border)', margin: '0 12px' }} aria-hidden />
  );
}
