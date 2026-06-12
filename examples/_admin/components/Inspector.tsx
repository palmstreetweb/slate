/**
 * Right-rail inspector. Shows the editable properties for the currently
 * selected question. Per-question-type fields rendered via a switch on
 * `question.type`. No collapsing — always shows everything for the
 * selected question.
 */

import type { Option, PictureOption, Question } from '@/index.js';
import { ConditionBuilder, JumpRulesEditor } from './LogicEditor.js';

const TYPE_LABEL: Record<Question['type'], string> = {
  welcome: 'Welcome screen',
  statement: 'Statement',
  thanks: 'Thank you screen',
  short_text: 'Short text',
  long_text: 'Long text',
  email: 'Email',
  phone: 'Phone',
  url: 'Website',
  number: 'Number',
  date: 'Date',
  file_upload: 'File upload',
  single_choice: 'Single choice',
  multi_choice: 'Multi choice',
  dropdown: 'Dropdown',
  picture_choice: 'Picture choice',
  ranking: 'Ranking',
  matrix: 'Matrix',
  yes_no: 'Yes / No',
  legal: 'Legal / consent',
  scale: 'Scale',
  nps: 'NPS (0–10)',
};

type Props = {
  question: Question;
  /** Full question list — feeds logic-editor field and jump-target dropdowns. */
  allQuestions: ReadonlyArray<Question>;
  onChange: (patch: Partial<Question>) => void;
  onDelete: () => void;
  canDelete: boolean;
};

export function Inspector({ question, allQuestions, onChange, onDelete, canDelete }: Props) {
  // Chrome screens (welcome, statement, thanks) aren't answer-bearing and
  // can't be referenced by visibleIf — their internal `id` is irrelevant
  // to the form author, so we hide all the ID UI for them. Input questions
  // still expose the ID since it's the key in onSubmit's answers payload.
  const showId =
    question.type !== 'welcome' &&
    question.type !== 'statement' &&
    question.type !== 'thanks';

  return (
    <aside className="studio-rail studio-rail--right">
      <div className="studio-rail-pad">
        <p className="studio-label" style={{ marginBottom: 4 }}>
          Question type
        </p>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '6px 10px',
            background: 'var(--psw-bg-3)',
            borderRadius: 'var(--studio-radius-sm)',
            fontSize: 13,
            fontWeight: 500,
          }}
        >
          <span>{TYPE_LABEL[question.type]}</span>
          {showId && (
            <span style={{ fontSize: 11, color: 'var(--psw-dim)', fontFamily: 'var(--psw-font-mono)' }}>
              id: {question.id}
            </span>
          )}
        </div>
      </div>

      <Divider />

      <div className="studio-rail-pad" style={{ display: 'grid', gap: 14 }}>
        {showId && (
          <Field label="Question ID" hint="Used as the answers key in onSubmit. Letters/numbers/underscore.">
            <input
              className="studio-input"
              value={question.id}
              onChange={(e) =>
                onChange({ id: e.target.value.replace(/[^a-zA-Z0-9_]/g, '_') } as Partial<Question>)
              }
            />
          </Field>
        )}

        {'title' in question && typeof question.title === 'string' && (
          <Field label="Title">
            <textarea
              className="studio-textarea"
              value={question.title}
              onChange={(e) => onChange({ title: e.target.value } as Partial<Question>)}
              rows={2}
            />
          </Field>
        )}
        {'title' in question && typeof question.title === 'function' && (
          <Field label="Title (dynamic function)">
            <p style={{ margin: 0, fontSize: 12, color: 'var(--psw-muted)' }}>
              This title is a function — edit the schema in code to change it, or replace with a static string.
            </p>
          </Field>
        )}

        {'subtitle' in question && (
          <Field label="Subtitle (optional)">
            <textarea
              className="studio-textarea"
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
              className="studio-textarea"
              value={question.body ?? ''}
              onChange={(e) => onChange({ body: e.target.value || undefined } as Partial<Question>)}
              rows={3}
            />
          </Field>
        )}

        {(question.type === 'welcome' ||
          question.type === 'statement' ||
          question.type === 'thanks') && (
          <Field label="Button label">
            <input
              className="studio-input"
              value={question.cta ?? ''}
              placeholder={
                question.type === 'welcome'
                  ? 'Start'
                  : question.type === 'thanks'
                    ? 'Submit another'
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
                  className="studio-input"
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
            <select
              className="studio-select"
              value={question.format ?? 'MM/DD/YYYY'}
              onChange={(e) =>
                onChange({
                  format: e.target.value as 'MM/DD/YYYY' | 'DD/MM/YYYY',
                } as Partial<Question>)
              }
            >
              <option value="MM/DD/YYYY">MM/DD/YYYY</option>
              <option value="DD/MM/YYYY">DD/MM/YYYY</option>
            </select>
          </Field>
        )}

        {question.type === 'yes_no' && (
          <Row>
            <Field label="Yes label">
              <input
                className="studio-input"
                value={question.yesLabel ?? ''}
                placeholder="Yes"
                onChange={(e) =>
                  onChange({ yesLabel: e.target.value || undefined } as Partial<Question>)
                }
              />
            </Field>
            <Field label="No label">
              <input
                className="studio-input"
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
            <Field label="Terms / consent copy">
              <textarea
                className="studio-textarea"
                value={question.body ?? ''}
                onChange={(e) =>
                  onChange({ body: e.target.value || undefined } as Partial<Question>)
                }
                rows={3}
              />
            </Field>
            <Row>
              <Field label="Accept label">
                <input
                  className="studio-input"
                  value={question.acceptLabel ?? ''}
                  placeholder="I accept"
                  onChange={(e) =>
                    onChange({ acceptLabel: e.target.value || undefined } as Partial<Question>)
                  }
                />
              </Field>
              <Field label="Decline label">
                <input
                  className="studio-input"
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
            <Field label="Low anchor">
              <input
                className="studio-input"
                value={question.minLabel ?? ''}
                placeholder="Not at all likely"
                onChange={(e) =>
                  onChange({ minLabel: e.target.value || undefined } as Partial<Question>)
                }
              />
            </Field>
            <Field label="High anchor">
              <input
                className="studio-input"
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
          <Field label="Max length (characters)">
            <input
              className="studio-input"
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
          <Field label="Default country (ISO 3166-1 alpha-2)">
            <input
              className="studio-input"
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
                className="studio-input"
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
                className="studio-input"
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
              <Field label="Min value">
                <input
                  className="studio-input"
                  type="number"
                  value={question.min}
                  onChange={(e) => onChange({ min: Number(e.target.value) } as Partial<Question>)}
                />
              </Field>
              <Field label="Max value">
                <input
                  className="studio-input"
                  type="number"
                  value={question.max}
                  onChange={(e) => onChange({ max: Number(e.target.value) } as Partial<Question>)}
                />
              </Field>
            </Row>
            <Row>
              <Field label="Min label">
                <input
                  className="studio-input"
                  value={question.minLabel ?? ''}
                  onChange={(e) =>
                    onChange({ minLabel: e.target.value || undefined } as Partial<Question>)
                  }
                />
              </Field>
              <Field label="Max label">
                <input
                  className="studio-input"
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
            <Field label="Accept (file types)" hint="e.g. image/*,.pdf">
              <input
                className="studio-input"
                value={question.accept ?? ''}
                onChange={(e) =>
                  onChange({ accept: e.target.value || undefined } as Partial<Question>)
                }
              />
            </Field>
            <Field label="Max size (MB)">
              <input
                className="studio-input"
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
          <Field
            label="Options"
            hint={question.type === 'ranking' ? undefined : 'pts feed the {{score}} total.'}
          >
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
              label="Allow multiple selections"
            />
            <Field label="Options (label / value / image URL)">
              <PictureOptionsEditor
                options={question.options as PictureOption[]}
                onChange={(opts) => onChange({ options: opts } as Partial<Question>)}
              />
            </Field>
            {question.multiple && (
              <Row>
                <Field label="Min selections">
                  <input
                    className="studio-input"
                    type="number"
                    value={question.min ?? ''}
                    onChange={(e) =>
                      onChange({
                        min: e.target.value ? Number(e.target.value) : undefined,
                      } as Partial<Question>)
                    }
                  />
                </Field>
                <Field label="Max selections">
                  <input
                    className="studio-input"
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
              label="Allow multiple per row"
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
            <Field label="Min selections">
              <input
                className="studio-input"
                type="number"
                value={question.min ?? ''}
                onChange={(e) =>
                  onChange({
                    min: e.target.value ? Number(e.target.value) : undefined,
                  } as Partial<Question>)
                }
              />
            </Field>
            <Field label="Max selections">
              <input
                className="studio-input"
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
            label="Redirect URL (optional)"
            hint="Navigate here after a successful submit."
          >
            <input
              className="studio-input"
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
            <div style={{ height: 1, background: 'var(--psw-border)', margin: '8px 0' }} />
            <Field
              label={question.type === 'thanks' ? 'Show this ending when…' : 'Show this question when…'}
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

        {question.type !== 'welcome' && question.type !== 'thanks' && (
          <Field
            label="Logic jumps"
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
            <div style={{ height: 1, background: 'var(--psw-border)', margin: '8px 0' }} />
            <button type="button" className="studio-btn studio-btn--danger" onClick={onDelete}>
              Delete question
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
      <span className="studio-label">{label}</span>
      {children}
      {hint && <p className="studio-help">{hint}</p>}
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
    <label className="studio-checkbox" style={{ alignSelf: 'end', marginBottom: 6 }}>
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
  /** Show a per-option points column (feeds the {{score}} total, ADR-016). */
  withScore?: boolean;
}) {
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

  return (
    <div style={{ display: 'grid', gap: 4 }}>
      {options.map((opt, i) => (
        <div
          key={i}
          style={{
            display: 'grid',
            gridTemplateColumns: withScore ? '1fr 90px 52px auto' : '1fr 110px auto',
            gap: 4,
            alignItems: 'center',
          }}
        >
          <input
            className="studio-input"
            value={opt.label}
            placeholder="Label"
            onChange={(e) => update(i, { label: e.target.value })}
            style={{ padding: '6px 8px', fontSize: 12 }}
          />
          <input
            className="studio-input"
            value={opt.value}
            placeholder="value"
            style={{
              padding: '6px 8px',
              fontFamily: 'var(--psw-font-mono)',
              fontSize: 11,
            }}
            onChange={(e) => update(i, { value: e.target.value.replace(/\s+/g, '_') })}
          />
          {withScore && (
            <input
              className="studio-input"
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
              className="studio-icon-btn"
              onClick={() => move(i, 'up')}
              disabled={i === 0}
              aria-label="Move up"
            >
              ↑
            </button>
            <button
              type="button"
              className="studio-icon-btn"
              onClick={() => move(i, 'down')}
              disabled={i === options.length - 1}
              aria-label="Move down"
            >
              ↓
            </button>
            <button
              type="button"
              className="studio-icon-btn"
              onClick={() => remove(i)}
              aria-label="Remove option"
            >
              ×
            </button>
          </div>
        </div>
      ))}
      <button
        type="button"
        className="studio-btn studio-btn--ghost"
        onClick={add}
        style={{ justifySelf: 'start', fontSize: 12, padding: '4px 8px', marginTop: 4 }}
      >
        + Add option
      </button>
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

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {options.map((opt, i) => (
        <div
          key={i}
          style={{
            display: 'grid',
            gap: 4,
            padding: 8,
            border: '1px solid var(--psw-border)',
            borderRadius: 'var(--studio-radius-sm)',
          }}
        >
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 52px auto', gap: 4 }}>
            <input
              className="studio-input"
              value={opt.label}
              placeholder="Label"
              onChange={(e) => update(i, { label: e.target.value })}
              style={{ padding: '6px 8px', fontSize: 12 }}
            />
            <input
              className="studio-input"
              value={opt.value}
              placeholder="value"
              style={{ padding: '6px 8px', fontFamily: 'var(--psw-font-mono)', fontSize: 11 }}
              onChange={(e) => update(i, { value: e.target.value.replace(/\s+/g, '_') })}
            />
            <input
              className="studio-input"
              type="number"
              value={opt.score ?? ''}
              placeholder="pts"
              aria-label="Score points"
              style={{ padding: '6px 6px', fontSize: 11 }}
              onChange={(e) =>
                update(i, { score: e.target.value === '' ? undefined : Number(e.target.value) })
              }
            />
            <button
              type="button"
              className="studio-icon-btn"
              onClick={() => remove(i)}
              aria-label="Remove option"
            >
              ×
            </button>
          </div>
          <input
            className="studio-input"
            value={opt.src}
            placeholder="https://image-url..."
            style={{ padding: '6px 8px', fontFamily: 'var(--psw-font-mono)', fontSize: 11 }}
            onChange={(e) => update(i, { src: e.target.value })}
          />
        </div>
      ))}
      <button
        type="button"
        className="studio-btn studio-btn--ghost"
        onClick={add}
        style={{ justifySelf: 'start', fontSize: 12, padding: '4px 8px' }}
      >
        + Add option
      </button>
    </div>
  );
}

function Divider() {
  return (
    <div
      style={{ height: 1, background: 'var(--psw-border)', margin: '0 12px' }}
      aria-hidden
    />
  );
}
