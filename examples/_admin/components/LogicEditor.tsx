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
  return { field: c.field, op: c.op, value: String(c.value) };
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
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 4 }}>
      <div style={{ display: 'grid', gap: 4 }}>
        <select
          className="studio-select"
          value={leaf.field}
          onChange={(e) => onChange({ ...leaf, field: e.target.value })}
        >
          <option value="">— pick a question —</option>
          {fields.map((q) => (
            <option key={q.id} value={q.id}>
              {q.id}
            </option>
          ))}
        </select>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
          <select
            className="studio-select"
            value={leaf.op}
            onChange={(e) => onChange({ ...leaf, op: e.target.value as LeafOp })}
          >
            {(Object.keys(OP_LABEL) as LeafOp[]).map((op) => (
              <option key={op} value={op}>
                {OP_LABEL[op]}
              </option>
            ))}
          </select>
          {!VALUELESS_OPS.has(leaf.op) && (
            <input
              className="studio-input"
              value={leaf.value}
              placeholder="value"
              style={{ padding: '6px 8px', fontSize: 12 }}
              onChange={(e) => onChange({ ...leaf, value: e.target.value })}
            />
          )}
        </div>
      </div>
      <button type="button" className="studio-icon-btn" onClick={onRemove} aria-label="Remove rule">
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
      <p style={{ margin: 0, fontSize: 12, color: 'var(--psw-muted)' }}>
        This condition uses nested groups or in/not_in — edit it in the schema code, or{' '}
        <button
          type="button"
          className="studio-btn studio-btn--ghost"
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
          <select
            className="studio-select"
            style={{ width: 'auto' }}
            value={combinator}
            onChange={(e) => emit(e.target.value as 'all' | 'any', leaves)}
          >
            <option value="all">all</option>
            <option value="any">any</option>
          </select>
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
        className="studio-btn studio-btn--ghost"
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
              border: '1px solid var(--psw-border)',
              borderRadius: 'var(--studio-radius-sm)',
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
              <p style={{ margin: 0, fontSize: 12, color: 'var(--psw-muted)' }}>
                Composite condition — edit in schema code.
              </p>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
              <span>→ jump to</span>
              <select
                className="studio-select"
                style={{ flex: 1 }}
                value={rule.goTo}
                onChange={(e) =>
                  emit(rules.map((r, idx) => (idx === i ? { ...r, goTo: e.target.value } : r)))
                }
              >
                <option value="">— pick a target —</option>
                {targets.map((q) => (
                  <option key={q.id} value={q.id}>
                    {q.id} ({q.type})
                  </option>
                ))}
              </select>
            </div>
          </div>
        );
      })}
      <button
        type="button"
        className="studio-btn studio-btn--ghost"
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
