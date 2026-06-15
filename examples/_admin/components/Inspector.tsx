/**
 * Right-rail inspector. Shows the editable properties for the currently
 * selected question. Per-question-type fields rendered via a switch on
 * `question.type`. No collapsing — always shows everything for the
 * selected question.
 */

import type { Option, PictureOption, Question } from '@/index.js';
import { TYPE_GLYPH, TYPE_LABEL } from '../questionTypeMeta.js';
import { ConditionBuilder, JumpRulesEditor } from './LogicEditor.js';
import { SlateSelect } from './SlateSelect.js';

type Props = {
  question: Question;
  /** Full question list — feeds logic-editor field and jump-target dropdowns. */
  allQuestions: ReadonlyArray<Question>;
  onChange: (patch: Partial<Question>) => void;
  onDelete: () => void;
  canDelete: boolean;
};

export function Inspector({ question, allQuestions, onChange, onDelete, canDelete }: Props) {
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
            {TYPE_GLYPH[question.type]}
          </span>
          <span>{TYPE_LABEL[question.type]}</span>
        </div>
      </div>

      <Divider />

      <div className="slate-rail-pad" style={{ display: 'grid', gap: 14 }}>
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
            <p style={{ margin: 0, fontSize: 12, color: 'var(--slate-muted)' }}>
              This title is a function — edit the schema in code to change it, or replace with a static string.
            </p>
          </Field>
        )}

        {'subtitle' in question && (
          <Field label="Subtitle (Optional)">
            <textarea
              className="slate-textarea"
              value={question.subtitle ?? ''}
              onChange={(e) =>
                onChange({ subtitle: e.target.value || undefined } as Partial<Question>)
              }
              rows={2}
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
          question.type === 'dropdown' ||
          question.type === 'yes_no' ||
          question.type === 'legal' ||
          question.type === 'nps' ||
          question.type === 'file_upload' ||
          question.type === 'matrix' ||
          (question.type === 'picture_choice' && !question.multiple)) && (
          <Row>
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
                (question.type === 'dropdown' ||
                  question.type === 'yes_no' ||
                  question.type === 'legal' ||
                  question.type === 'picture_choice')
              }
              onChange={(v) => onChange({ required: v } as Partial<Question>)}
              label="Required"
            />
          </Row>
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
              onChange={(format) =>
                onChange({ format } as Partial<Question>)
              }
            />
          </Field>
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
          <Field label="Max Length (Characters)">
            <input
              className="slate-input"
              type="number"
              value={question.maxLength ?? ''}
              onChange={(e) =>
                onChange({
                  maxLength: e.target.value ? Number(e.target.value) : undefined,
                } as Partial<Question>)
              }
            />
          </Field>
        )}

        {question.type === 'phone' && (
          <Field label="Default Country (ISO 3166-1 Alpha-2)">
            <input
              className="slate-input"
              value={question.defaultCountry ?? 'US'}
              maxLength={2}
              onChange={(e) =>
                onChange({ defaultCountry: e.target.value.toUpperCase() } as Partial<Question>)
              }
            />
          </Field>
        )}

        {question.type === 'number' && (
          <Row>
            <Field label="Min">
              <input
                className="slate-input"
                type="number"
                value={question.min ?? ''}
                onChange={(e) =>
                  onChange({
                    min: e.target.value ? Number(e.target.value) : undefined,
                  } as Partial<Question>)
                }
              />
            </Field>
            <Field label="Max">
              <input
                className="slate-input"
                type="number"
                value={question.max ?? ''}
                onChange={(e) =>
                  onChange({
                    max: e.target.value ? Number(e.target.value) : undefined,
                  } as Partial<Question>)
                }
              />
            </Field>
          </Row>
        )}

        {question.type === 'scale' && (
          <>
            <Row>
              <Field label="Min Value">
                <input
                  className="slate-input"
                  type="number"
                  value={question.min}
                  onChange={(e) => {
                    const raw = e.target.value;
                    if (raw === '') return;
                    const n = Number(raw);
                    if (!Number.isNaN(n)) onChange({ min: n } as Partial<Question>);
                  }}
                />
              </Field>
              <Field label="Max Value">
                <input
                  className="slate-input"
                  type="number"
                  value={question.max}
                  onChange={(e) => {
                    const raw = e.target.value;
                    if (raw === '') return;
                    const n = Number(raw);
                    if (!Number.isNaN(n)) onChange({ max: n } as Partial<Question>);
                  }}
                />
              </Field>
            </Row>
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
          </>
        )}

        {question.type === 'file_upload' && (
          <Row>
            <Field label="Accept (File Types)" hint="e.g. image/*,.pdf">
              <input
                className="slate-input"
                value={question.accept ?? ''}
                onChange={(e) =>
                  onChange({ accept: e.target.value || undefined } as Partial<Question>)
                }
              />
            </Field>
            <Field label="Max Size (MB)">
              <input
                className="slate-input"
                type="number"
                value={question.maxSizeMb ?? ''}
                onChange={(e) =>
                  onChange({
                    maxSizeMb: e.target.value ? Number(e.target.value) : undefined,
                  } as Partial<Question>)
                }
              />
            </Field>
          </Row>
        )}

        {(question.type === 'single_choice' ||
          question.type === 'multi_choice' ||
          question.type === 'dropdown' ||
          question.type === 'ranking') && (
          <Field label="Options">
            <OptionsEditor
              options={question.options as Option[]}
              onChange={(opts) => onChange({ options: opts } as Partial<Question>)}
              withScore={question.type !== 'ranking'}
            />
          </Field>
        )}

        {question.type === 'picture_choice' && (
          <>
            <Checkbox
              checked={Boolean(question.multiple)}
              onChange={(v) => onChange({ multiple: v } as Partial<Question>)}
              label="Allow Multiple Selections"
            />
            <Field label="Options (Label / Image URL)">
              <PictureOptionsEditor
                options={question.options as PictureOption[]}
                onChange={(opts) => onChange({ options: opts } as Partial<Question>)}
              />
            </Field>
            {question.multiple && (
              <Row>
                <Field label="Min Selections">
                  <input
                    className="slate-input"
                    type="number"
                    value={question.min ?? ''}
                    onChange={(e) =>
                      onChange({
                        min: e.target.value ? Number(e.target.value) : undefined,
                      } as Partial<Question>)
                    }
                  />
                </Field>
                <Field label="Max Selections">
                  <input
                    className="slate-input"
                    type="number"
                    value={question.max ?? ''}
                    onChange={(e) =>
                      onChange({
                        max: e.target.value ? Number(e.target.value) : undefined,
                      } as Partial<Question>)
                    }
                  />
                </Field>
              </Row>
            )}
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
              />
            </Field>
            <Field label="Columns">
              <OptionsEditor
                options={question.columns as Option[]}
                onChange={(columns) => onChange({ columns } as Partial<Question>)}
              />
            </Field>
          </>
        )}

        {question.type === 'multi_choice' && (
          <Row>
            <Field label="Min Selections">
              <input
                className="slate-input"
                type="number"
                value={question.min ?? ''}
                onChange={(e) =>
                  onChange({
                    min: e.target.value ? Number(e.target.value) : undefined,
                  } as Partial<Question>)
                }
              />
            </Field>
            <Field label="Max Selections">
              <input
                className="slate-input"
                type="number"
                value={question.max ?? ''}
                onChange={(e) =>
                  onChange({
                    max: e.target.value ? Number(e.target.value) : undefined,
                  } as Partial<Question>)
                }
              />
            </Field>
          </Row>
        )}

        {question.type === 'thanks' && (
          <Field
            label="Redirect URL (Optional)"
            hint="Navigate here after a successful submit."
          >
            <input
              className="slate-input"
              value={question.redirectUrl ?? ''}
              placeholder="https://example.com/thank-you"
              onChange={(e) =>
                onChange({ redirectUrl: e.target.value || undefined } as Partial<Question>)
              }
            />
          </Field>
        )}

        {question.type !== 'welcome' && (
          <>
            <div style={{ height: 1, background: 'var(--slate-border)', margin: '8px 0' }} />
            <Field
              label={question.type === 'thanks' ? 'Show This Ending When…' : 'Show This Question When…'}
              hint="Leave empty to always show."
            >
              <ConditionBuilder
                value={question.visibleIf}
                onChange={(visibleIf) => onChange({ visibleIf } as Partial<Question>)}
                questions={allQuestions}
              />
            </Field>
          </>
        )}

        {question.type !== 'welcome' && question.type !== 'thanks' && question.type !== 'review' && (
          <Field
            label="Logic Jumps"
            hint="On advance, the first matching rule wins. No match = next question."
          >
            <JumpRulesEditor
              rules={('logic' in question ? question.logic : undefined) ?? []}
              onChange={(logic) => onChange({ logic } as Partial<Question>)}
              questions={allQuestions}
              currentId={question.id}
            />
          </Field>
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

function Row({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>{children}</div>;
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: 'block' }}>
      <span className="slate-label">{label}</span>
      {children}
      {hint && <p className="slate-help">{hint}</p>}
    </label>
  );
}

function Checkbox({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="slate-checkbox" style={{ alignSelf: 'end', marginBottom: 6 }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function OptionsEditor({
  options,
  onChange,
  withScore = false,
}: {
  options: Option[];
  onChange: (opts: Option[]) => void;
  /** Whether scoring is applicable for this question type (feeds {{score}}, ADR-016). */
  withScore?: boolean;
}) {
  // Scoring is opt-in: the points column only appears once the form actually
  // uses it (any option has a numeric score). Derived from data — no local
  // state — so it stays correct when switching between questions.
  const scoring = withScore && options.some((o) => typeof o.score === 'number');

  const update = (i: number, patch: Partial<Option>) => {
    onChange(options.map((o, idx) => (idx === i ? { ...o, ...patch } : o)));
  };
  const remove = (i: number) => onChange(options.filter((_, idx) => idx !== i));
  const move = (i: number, dir: 'up' | 'down') => {
    const target = dir === 'up' ? i - 1 : i + 1;
    if (target < 0 || target >= options.length) return;
    const next = [...options];
    [next[i]!, next[target]!] = [next[target]!, next[i]!];
    onChange(next);
  };
  const add = () => {
    const i = options.length;
    onChange([
      ...options,
      { label: `Option ${String.fromCharCode(65 + i)}`, value: `opt_${i + 1}` },
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
    <div style={{ display: 'grid', gap: 4 }}>
      {options.map((opt, i) => (
        <div
          key={i}
          style={{
            display: 'grid',
            gridTemplateColumns: scoring ? '1fr 56px auto' : '1fr auto',
            gap: 4,
            alignItems: 'center',
          }}
        >
          <input
            className="slate-input"
            value={opt.label}
            placeholder="Label"
            onChange={(e) => update(i, { label: e.target.value })}
            style={{ padding: '6px 8px', fontSize: 12 }}
          />
          {scoring && (
            <input
              className="slate-input"
              type="number"
              value={opt.score ?? ''}
              placeholder="pts"
              aria-label="Score points"
              style={{ padding: '6px 6px', fontSize: 11 }}
              onChange={(e) =>
                update(i, { score: e.target.value === '' ? undefined : Number(e.target.value) })
              }
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
              aria-label="Remove option"
            >
              ×
            </button>
          </div>
        </div>
      ))}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4 }}>
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
            style={{ fontSize: 11 }}
            onClick={scoring ? disableScoring : enableScoring}
          >
            {scoring ? 'Remove Scoring' : 'Add Scoring'}
          </button>
        )}
      </div>
    </div>
  );
}

function PictureOptionsEditor({
  options,
  onChange,
}: {
  options: PictureOption[];
  onChange: (opts: PictureOption[]) => void;
}) {
  // Scoring is opt-in here too — points only appear once used (ADR-016).
  const scoring = options.some((o) => typeof o.score === 'number');

  const update = (i: number, patch: Partial<PictureOption>) => {
    onChange(options.map((o, idx) => (idx === i ? { ...o, ...patch } : o)));
  };
  const remove = (i: number) => onChange(options.filter((_, idx) => idx !== i));
  const add = () => {
    const i = options.length;
    onChange([
      ...options,
      {
        label: `Option ${String.fromCharCode(65 + i)}`,
        value: `opt_${i + 1}`,
        src: 'https://picsum.photos/seed/' + (i + 1) + '/400/300',
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
              gridTemplateColumns: scoring ? '1fr 56px auto' : '1fr auto',
              gap: 4,
            }}
          >
            <input
              className="slate-input"
              value={opt.label}
              placeholder="Label"
              onChange={(e) => update(i, { label: e.target.value })}
              style={{ padding: '6px 8px', fontSize: 12 }}
            />
            {scoring && (
              <input
                className="slate-input"
                type="number"
                value={opt.score ?? ''}
                placeholder="pts"
                aria-label="Score points"
                style={{ padding: '6px 6px', fontSize: 11 }}
                onChange={(e) =>
                  update(i, { score: e.target.value === '' ? undefined : Number(e.target.value) })
                }
              />
            )}
            <button
              type="button"
              className="slate-icon-btn"
              onClick={() => remove(i)}
              aria-label="Remove option"
            >
              ×
            </button>
          </div>
          <input
            className="slate-input"
            value={opt.src}
            placeholder="https://image-url..."
            style={{ padding: '6px 8px', fontFamily: 'var(--slate-font-mono)', fontSize: 11 }}
            onChange={(e) => update(i, { src: e.target.value })}
          />
        </div>
      ))}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
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
          style={{ fontSize: 11 }}
          onClick={scoring ? disableScoring : enableScoring}
        >
          {scoring ? 'Remove Scoring' : 'Add Scoring'}
        </button>
      </div>
    </div>
  );
}

function Divider() {
  return (
    <div
      style={{ height: 1, background: 'var(--slate-border)', margin: '0 12px' }}
      aria-hidden
    />
  );
}
