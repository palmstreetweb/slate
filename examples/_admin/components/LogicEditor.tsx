/**
 * Visual logic editing for the Inspector (roadmap Phase 4):
 *
 *   - ConditionBuilder — edits a `Condition` (visibleIf) as a flat list of
 *     leaf rules joined by all/any. Nested composites are code-only; the
 *     builder shows a notice instead of mangling them.
 *   - JumpRulesEditor — edits `logic: [{ if, goTo }]` rules, each with a
 *     single leaf condition and a jump-target dropdown.
 */

import type { Condition, LogicRule, Question } from '@/index.js';
import { SlateSelect } from './SlateSelect.js';

type LeafOp =
  | 'equals'
  | 'not_equals'
  | 'gt'
  | 'lt'
  | 'gte'
  | 'lte'
  | 'is_empty'
  | 'is_not_empty';

type Leaf = { field: string; op: LeafOp; value: string };

const OP_LABEL: Record<LeafOp, string> = {
  equals: 'equals',
  not_equals: 'does not equal',
  gt: '>',
  lt: '<',
  gte: '≥',
  lte: '≤',
  is_empty: 'is empty',
  is_not_empty: 'is not empty',
};

const NUMERIC_OPS = new Set<LeafOp>(['gt', 'lt', 'gte', 'lte']);
const VALUELESS_OPS = new Set<LeafOp>(['is_empty', 'is_not_empty']);
const NUMERIC_TYPES = new Set(['number', 'scale', 'nps']);

function isAnswerBearing(q: Question): boolean {
  return q.type !== 'welcome' && q.type !== 'statement' && q.type !== 'thanks';
}

/** Human-readable name for a question — its title, never the internal id. */
function displayName(q: Question): string {
  const title = 'title' in q && typeof q.title === 'string' ? q.title.trim() : '';
  const base = title || `Untitled ${q.type.replace(/_/g, ' ')}`;
  return base.length > 44 ? `${base.slice(0, 43)}…` : base;
}

/**
 * The selectable answers for a question, so logic conditions can be picked by
 * label instead of forcing the author to know the internal option value.
 * Returns null for free-form/numeric/other types (those use a plain input).
 */
function optionsFor(
  q: Question | undefined,
): ReadonlyArray<{ label: string; value: string }> | null {
  if (!q) return null;
  switch (q.type) {
    case 'single_choice':
    case 'multi_choice':
    case 'dropdown':
    case 'ranking':
    case 'picture_choice':
      return (q.options as ReadonlyArray<{ label: string; value: string }>).map((o) => ({
        label: o.label,
        value: o.value,
      }));
    case 'yes_no':
      return [
        { label: q.yesLabel ?? 'Yes', value: 'yes' },
        { label: q.noLabel ?? 'No', value: 'no' },
      ];
    case 'legal':
      return [
        { label: q.acceptLabel ?? 'I accept', value: 'accept' },
        { label: q.declineLabel ?? "I don't accept", value: 'decline' },
      ];
    default:
      return null;
  }
}

function isLeafCondition(c: Condition): c is Extract<Condition, { field: string }> {
  return 'field' in c;
}

/** Leaf Condition → editable row. Returns null for shapes the UI can't edit. */
function toLeaf(c: Condition): Leaf | null {
  if (!isLeafCondition(c)) return null;
  if (c.op === 'in' || c.op === 'not_in') return null; // code-only
  if (c.op === 'is_empty' || c.op === 'is_not_empty') {
    return { field: c.field, op: c.op, value: '' };
  }
  // `op` isn't a unit-type discriminant, so TS can't narrow away the
  // valueless variants above — assert the remaining shape.
  const leaf = c as { field: string; op: LeafOp; value: string | number };
  return { field: leaf.field, op: leaf.op, value: String(leaf.value) };
}

/** Editable row → leaf Condition, typing the value off the target question. */
function fromLeaf(leaf: Leaf, questions: ReadonlyArray<Question>): Condition {
  if (VALUELESS_OPS.has(leaf.op)) {
    return { field: leaf.field, op: leaf.op as 'is_empty' | 'is_not_empty' };
  }
  if (NUMERIC_OPS.has(leaf.op)) {
    return {
      field: leaf.field,
      op: leaf.op as 'gt' | 'lt' | 'gte' | 'lte',
      value: Number(leaf.value) || 0,
    };
  }
  const target = questions.find((q) => q.id === leaf.field);
  const numeric = target !== undefined && NUMERIC_TYPES.has(target.type);
  return {
    field: leaf.field,
    op: leaf.op as 'equals' | 'not_equals',
    value: numeric ? Number(leaf.value) || 0 : leaf.value,
  };
}

type Parsed =
  | { editable: true; combinator: 'all' | 'any'; leaves: Leaf[] }
  | { editable: false };

function parseCondition(c: Condition | undefined): Parsed {
  if (c === undefined) return { editable: true, combinator: 'all', leaves: [] };
  if (isLeafCondition(c)) {
    const leaf = toLeaf(c);
    return leaf ? { editable: true, combinator: 'all', leaves: [leaf] } : { editable: false };
  }
  const combinator = 'all' in c ? 'all' : 'any';
  const children = 'all' in c ? c.all : c.any;
  const leaves: Leaf[] = [];
  for (const child of children) {
    const leaf = toLeaf(child);
    if (!leaf) return { editable: false };
    leaves.push(leaf);
  }
  return { editable: true, combinator, leaves };
}

function buildCondition(
  combinator: 'all' | 'any',
  leaves: Leaf[],
  questions: ReadonlyArray<Question>,
): Condition | undefined {
  const conds = leaves.filter((l) => l.field).map((l) => fromLeaf(l, questions));
  if (conds.length === 0) return undefined;
  if (conds.length === 1) return conds[0];
  return combinator === 'all' ? { all: conds } : { any: conds };
}

function LeafRow({
  leaf,
  questions,
  onChange,
  onRemove,
}: {
  leaf: Leaf;
  questions: ReadonlyArray<Question>;
  onChange: (next: Leaf) => void;
  onRemove: () => void;
}) {
  const fields = questions.filter(isAnswerBearing);
  const target = questions.find((q) => q.id === leaf.field);
  const choices = optionsFor(target);
  const showChoiceSelect = choices !== null && !NUMERIC_OPS.has(leaf.op);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 4 }}>
      <div style={{ display: 'grid', gap: 4 }}>
        <SlateSelect
          value={leaf.field}
          placeholder="— pick a question —"
          options={[
            { value: '', label: '— Pick a Question —' },
            ...fields.map((q) => ({ value: q.id, label: displayName(q) })),
          ]}
          aria-label="Question"
          onChange={(field) => onChange({ ...leaf, field })}
        />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
          <SlateSelect
            value={leaf.op}
            options={(Object.keys(OP_LABEL) as LeafOp[]).map((op) => ({
              value: op,
              label: OP_LABEL[op],
            }))}
            aria-label="Operator"
            onChange={(op) => onChange({ ...leaf, op })}
          />
          {!VALUELESS_OPS.has(leaf.op) &&
            (showChoiceSelect ? (
              <SlateSelect
                value={leaf.value}
                placeholder="— pick an answer —"
                options={[
                  { value: '', label: '— Pick an Answer —' },
                  ...choices.map((o) => ({ value: o.value, label: o.label })),
                ]}
                aria-label="Answer value"
                onChange={(value) => onChange({ ...leaf, value })}
              />
            ) : (
              <input
                className="slate-input"
                value={leaf.value}
                placeholder="value"
                style={{ padding: '6px 8px', fontSize: 12 }}
                onChange={(e) => onChange({ ...leaf, value: e.target.value })}
              />
            ))}
        </div>
      </div>
      <button type="button" className="slate-icon-btn" onClick={onRemove} aria-label="Remove rule">
        ×
      </button>
    </div>
  );
}

export function ConditionBuilder({
  value,
  onChange,
  questions,
}: {
  value: Condition | undefined;
  onChange: (next: Condition | undefined) => void;
  questions: ReadonlyArray<Question>;
}) {
  const parsed = parseCondition(value);

  if (!parsed.editable) {
    return (
      <p style={{ margin: 0, fontSize: 12, color: 'var(--slate-muted)' }}>
        This condition uses nested groups or in/not_in — edit it in the schema code, or{' '}
        <button
          type="button"
          className="slate-btn slate-btn--ghost"
          style={{ fontSize: 12, padding: '2px 6px' }}
          onClick={() => onChange(undefined)}
        >
          clear it
        </button>{' '}
        to rebuild here.
      </p>
    );
  }

  const { combinator, leaves } = parsed;
  const emit = (nextCombinator: 'all' | 'any', nextLeaves: Leaf[]) =>
    onChange(buildCondition(nextCombinator, nextLeaves, questions));

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {leaves.length > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
          <span>Match</span>
          <SlateSelect
            className="slate-select-wrap--auto"
            value={combinator}
            options={[
              { value: 'all', label: 'All' },
              { value: 'any', label: 'Any' },
            ]}
            aria-label="Match combinator"
            onChange={(next) => emit(next, leaves)}
          />
          <span>of the rules:</span>
        </div>
      )}
      {leaves.map((leaf, i) => (
        <LeafRow
          key={i}
          leaf={leaf}
          questions={questions}
          onChange={(next) => emit(combinator, leaves.map((l, idx) => (idx === i ? next : l)))}
          onRemove={() => emit(combinator, leaves.filter((_, idx) => idx !== i))}
        />
      ))}
      <button
        type="button"
        className="slate-btn slate-btn--ghost"
        style={{ justifySelf: 'start', fontSize: 12, padding: '4px 8px' }}
        onClick={() => emit(combinator, [...leaves, { field: '', op: 'equals', value: '' }])}
      >
        + Add rule
      </button>
    </div>
  );
}

export function JumpRulesEditor({
  rules,
  onChange,
  questions,
  currentId,
}: {
  rules: ReadonlyArray<LogicRule>;
  onChange: (next: LogicRule[] | undefined) => void;
  questions: ReadonlyArray<Question>;
  currentId: string;
}) {
  const targets = questions.filter((q) => q.id !== currentId && q.type !== 'welcome');
  const emit = (next: LogicRule[]) => onChange(next.length === 0 ? undefined : next);

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {rules.map((rule, i) => {
        const leaf = toLeaf(rule.if);
        return (
          <div
            key={i}
            style={{
              display: 'grid',
              gap: 6,
              padding: 8,
              border: '1px solid var(--slate-border)',
              borderRadius: 'var(--slate-radius-sm)',
            }}
          >
            {leaf ? (
              <LeafRow
                leaf={leaf}
                questions={questions}
                onChange={(next) =>
                  emit(
                    rules.map((r, idx) =>
                      idx === i ? { ...r, if: fromLeaf(next, questions) } : r,
                    ),
                  )
                }
                onRemove={() => emit(rules.filter((_, idx) => idx !== i))}
              />
            ) : (
              <p style={{ margin: 0, fontSize: 12, color: 'var(--slate-muted)' }}>
                Composite condition — edit in schema code.
              </p>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
              <span>→ jump to</span>
              <SlateSelect
                value={rule.goTo}
                style={{ flex: 1 }}
                placeholder="— pick a target —"
                options={[
                  { value: '', label: '— Pick a Target —' },
                  ...targets.map((q) => ({ value: q.id, label: displayName(q) })),
                ]}
                aria-label="Jump target"
                onChange={(goTo) =>
                  emit(rules.map((r, idx) => (idx === i ? { ...r, goTo } : r)))
                }
              />
            </div>
          </div>
        );
      })}
      <button
        type="button"
        className="slate-btn slate-btn--ghost"
        style={{ justifySelf: 'start', fontSize: 12, padding: '4px 8px' }}
        onClick={() =>
          emit([...rules, { if: { field: currentId, op: 'equals', value: '' }, goTo: '' }])
        }
      >
        + Add jump rule
      </button>
    </div>
  );
}
