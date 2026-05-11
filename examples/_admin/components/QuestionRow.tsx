import type { Option, Question } from '@/index.js';

type Props = {
  question: Question;
  index: number;
  total: number;
  expanded: boolean;
  onToggle: () => void;
  onChange: (patch: Partial<Question>) => void;
  onDelete: () => void;
  onMoveUp: (() => void) | null;
  onMoveDown: (() => void) | null;
};

const TYPE_LABEL: Record<Question['type'], string> = {
  welcome: 'Welcome',
  statement: 'Statement',
  thanks: 'Thanks',
  short_text: 'Short text',
  long_text: 'Long text',
  email: 'Email',
  phone: 'Phone',
  number: 'Number',
  single_choice: 'Single choice',
  multi_choice: 'Multi choice',
  scale: 'Scale',
};

export function QuestionRow({
  question,
  index,
  total: _total,
  expanded,
  onToggle,
  onChange,
  onDelete,
  onMoveUp,
  onMoveDown,
}: Props) {
  const titleAsString =
    'title' in question && typeof question.title === 'string'
      ? question.title
      : 'title' in question && typeof question.title === 'function'
        ? '(dynamic title — function)'
        : '';

  return (
    <div
      className="studio-card"
      style={{ borderColor: expanded ? 'var(--psw-accent)' : 'var(--psw-border)' }}
    >
      {/* ---------- collapsed header ---------- */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'auto auto 1fr auto auto',
          alignItems: 'center',
          gap: 12,
          padding: '10px 14px',
        }}
      >
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 22,
            height: 22,
            borderRadius: 4,
            background: 'var(--psw-bg-3)',
            color: 'var(--psw-muted)',
            fontFamily: 'var(--psw-font-mono)',
            fontSize: 11,
            fontWeight: 600,
          }}
        >
          {String(index + 1).padStart(2, '0')}
        </span>
        <span className="studio-badge">{TYPE_LABEL[question.type]}</span>
        <button
          type="button"
          onClick={onToggle}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--psw-text)',
            font: 'inherit',
            fontSize: 14,
            fontWeight: 500,
            textAlign: 'left',
            cursor: 'pointer',
            padding: 0,
            overflow: 'hidden',
            whiteSpace: 'nowrap',
            textOverflow: 'ellipsis',
          }}
        >
          {titleAsString || <span style={{ color: 'var(--psw-dim)' }}>(no title)</span>}
        </button>
        <span style={{ fontSize: 11, color: 'var(--psw-dim)', fontFamily: 'var(--psw-font-mono)' }}>
          id: {question.id}
        </span>
        <div style={{ display: 'flex', gap: 2 }}>
          {onMoveUp && (
            <button type="button" className="studio-btn studio-btn--ghost studio-btn--icon" onClick={onMoveUp} aria-label="Move up" title="Move up">
              <ArrowIcon dir="up" />
            </button>
          )}
          {onMoveDown && (
            <button type="button" className="studio-btn studio-btn--ghost studio-btn--icon" onClick={onMoveDown} aria-label="Move down" title="Move down">
              <ArrowIcon dir="down" />
            </button>
          )}
          <button type="button" className="studio-btn studio-btn--ghost studio-btn--icon" onClick={onToggle} aria-label={expanded ? 'Collapse' : 'Expand'}>
            <ChevronIcon dir={expanded ? 'up' : 'down'} />
          </button>
        </div>
      </div>

      {/* ---------- expanded body ---------- */}
      {expanded && (
        <div
          style={{
            borderTop: '1px solid var(--psw-border)',
            padding: 16,
            display: 'grid',
            gap: 14,
          }}
        >
          <QuestionFields question={question} onChange={onChange} />
          <div style={{ display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid var(--psw-border)', paddingTop: 12 }}>
            <button type="button" className="studio-btn studio-btn--danger" onClick={onDelete}>
              Delete question
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- per-type field renderer ---------- */

function QuestionFields({
  question,
  onChange,
}: {
  question: Question;
  onChange: (patch: Partial<Question>) => void;
}) {
  return (
    <>
      <Row>
        <Field label="Question ID" hint="Used as the answers key in onSubmit. Letters/numbers/underscore.">
          <input
            className="studio-input"
            value={question.id}
            onChange={(e) => onChange({ id: e.target.value.replace(/[^a-zA-Z0-9_]/g, '_') } as Partial<Question>)}
          />
        </Field>
      </Row>

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
      {'title' in question && typeof question.title !== 'string' && (
        <Field label="Title (dynamic function)">
          <p style={{ margin: 0, fontSize: 12, color: 'var(--psw-muted)' }}>
            This title is a function and can&apos;t be edited from the UI yet — edit the schema in code, or replace with a static string.
          </p>
        </Field>
      )}

      {'subtitle' in question && (
        <Field label="Subtitle (optional)">
          <textarea
            className="studio-textarea"
            value={question.subtitle ?? ''}
            onChange={(e) => onChange({ subtitle: e.target.value || undefined } as Partial<Question>)}
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

      {(question.type === 'welcome' || question.type === 'statement' || question.type === 'thanks') && (
        <Field label="CTA button label">
          <input
            className="studio-input"
            value={question.cta ?? ''}
            placeholder={question.type === 'welcome' ? 'Start' : question.type === 'thanks' ? 'Submit another' : 'Continue'}
            onChange={(e) => onChange({ cta: e.target.value || undefined } as Partial<Question>)}
          />
        </Field>
      )}

      {(question.type === 'short_text' ||
        question.type === 'long_text' ||
        question.type === 'email' ||
        question.type === 'phone' ||
        question.type === 'number') && (
        <Row>
          {(question.type === 'short_text' || question.type === 'long_text' || question.type === 'email' || question.type === 'phone') && (
            <Field label="Placeholder">
              <input
                className="studio-input"
                value={question.placeholder ?? ''}
                onChange={(e) => onChange({ placeholder: e.target.value || undefined } as Partial<Question>)}
              />
            </Field>
          )}
          <Field label="Required">
            <Checkbox
              checked={Boolean((question as { required?: boolean }).required)}
              onChange={(v) => onChange({ required: v } as Partial<Question>)}
              label="Required"
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
              onChange({ maxLength: e.target.value ? Number(e.target.value) : undefined } as Partial<Question>)
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
                onChange({ min: e.target.value ? Number(e.target.value) : undefined } as Partial<Question>)
              }
            />
          </Field>
          <Field label="Max">
            <input
              className="studio-input"
              type="number"
              value={question.max ?? ''}
              onChange={(e) =>
                onChange({ max: e.target.value ? Number(e.target.value) : undefined } as Partial<Question>)
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
                onChange={(e) => onChange({ minLabel: e.target.value || undefined } as Partial<Question>)}
              />
            </Field>
            <Field label="Max label">
              <input
                className="studio-input"
                value={question.maxLabel ?? ''}
                onChange={(e) => onChange({ maxLabel: e.target.value || undefined } as Partial<Question>)}
              />
            </Field>
          </Row>
        </>
      )}

      {(question.type === 'single_choice' || question.type === 'multi_choice') && (
        <Field label="Options">
          <OptionsEditor
            options={question.options as Option[]}
            onChange={(opts) => onChange({ options: opts } as Partial<Question>)}
          />
        </Field>
      )}

      {question.type === 'multi_choice' && (
        <Row>
          <Field label="Min selections">
            <input
              className="studio-input"
              type="number"
              value={question.min ?? ''}
              onChange={(e) =>
                onChange({ min: e.target.value ? Number(e.target.value) : undefined } as Partial<Question>)
              }
            />
          </Field>
          <Field label="Max selections">
            <input
              className="studio-input"
              type="number"
              value={question.max ?? ''}
              onChange={(e) =>
                onChange({ max: e.target.value ? Number(e.target.value) : undefined } as Partial<Question>)
              }
            />
          </Field>
        </Row>
      )}
    </>
  );
}

/* ---------- helpers ---------- */

function Row({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>{children}</div>;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
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
    <label className="studio-checkbox" style={{ marginTop: 6 }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function OptionsEditor({
  options,
  onChange,
}: {
  options: Option[];
  onChange: (opts: Option[]) => void;
}) {
  const update = (i: number, patch: Partial<Option>) => {
    const next = options.map((o, idx) => (idx === i ? { ...o, ...patch } : o));
    onChange(next);
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
    onChange([...options, { label: `Option ${String.fromCharCode(65 + i)}`, value: `opt_${i + 1}` }]);
  };

  return (
    <div style={{ display: 'grid', gap: 6 }}>
      {options.map((opt, i) => (
        <div
          key={i}
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 160px auto',
            gap: 6,
            alignItems: 'center',
          }}
        >
          <input
            className="studio-input"
            value={opt.label}
            placeholder="Label shown to user"
            onChange={(e) => update(i, { label: e.target.value })}
          />
          <input
            className="studio-input"
            value={opt.value}
            placeholder="value (stored)"
            style={{ fontFamily: 'var(--psw-font-mono)', fontSize: 12 }}
            onChange={(e) => update(i, { value: e.target.value.replace(/\s+/g, '_') })}
          />
          <div style={{ display: 'flex', gap: 2 }}>
            <button
              type="button"
              className="studio-btn studio-btn--ghost studio-btn--icon"
              onClick={() => move(i, 'up')}
              disabled={i === 0}
              aria-label="Move up"
            >
              <ArrowIcon dir="up" />
            </button>
            <button
              type="button"
              className="studio-btn studio-btn--ghost studio-btn--icon"
              onClick={() => move(i, 'down')}
              disabled={i === options.length - 1}
              aria-label="Move down"
            >
              <ArrowIcon dir="down" />
            </button>
            <button
              type="button"
              className="studio-btn studio-btn--ghost studio-btn--icon"
              onClick={() => remove(i)}
              aria-label="Remove option"
            >
              ×
            </button>
          </div>
        </div>
      ))}
      <button type="button" className="studio-btn" onClick={add} style={{ justifySelf: 'start' }}>
        + Add option
      </button>
    </div>
  );
}

function ChevronIcon({ dir }: { dir: 'up' | 'down' }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      style={{ transform: dir === 'up' ? 'rotate(180deg)' : undefined }}
      aria-hidden="true"
    >
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ArrowIcon({ dir }: { dir: 'up' | 'down' }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      style={{ transform: dir === 'down' ? 'rotate(180deg)' : undefined }}
      aria-hidden="true"
    >
      <path d="M12 19V5M5 12l7-7 7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
