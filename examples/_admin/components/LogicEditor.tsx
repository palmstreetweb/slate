/**
 * Visual logic editing for the Inspector (roadmap Phase 4):
 *
 *   - ConditionBuilder — edits a `Condition` (visibleIf) as a flat list of
 *     leaf rules joined by all/any. Nested composites are code-only; the
 *     builder shows a notice instead of mangling them.
 *   - JumpRulesEditor — edits `logic: [{ if, goTo }]` rules, each with a
 *     single leaf condition and a jump-target dropdown.
 */

import { useEffect, useState } from 'react';
import type { Condition, LogicRule, Question } from '@/index.js';
import { SlateSelect } from './SlateSelect.js';

function isCompleteJumpRule(rule: LogicRule): boolean {
  return rule.goTo.trim().length > 0;
}

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
  equals: 'is',
  not_equals: 'is not',
  gt: 'is greater than',
  lt: 'is less than',
  gte: 'is at least',
  lte: 'is at most',
  is_empty: 'is blank',
  is_not_empty: 'has an answer',
};

const NUMERIC_OPS = new Set<LeafOp>(['gt', 'lt', 'gte', 'lte']);
const VALUELESS_OPS = new Set<LeafOp>(['is_empty', 'is_not_empty']);
const NUMERIC_TYPES = new Set(['number', 'scale', 'nps']);
const CHOICE_TYPES = new Set([
  'single_choice',
  'multi_choice',
  'dropdown',
  'yes_no',
  'legal',
  'picture_choice',
  'ranking',
]);

function opsForQuestion(q: Question | undefined): LeafOp[] {
  if (!q) return ['equals', 'not_equals', 'is_empty', 'is_not_empty'];
  if (NUMERIC_TYPES.has(q.type)) {
    return ['equals', 'not_equals', 'gt', 'lt', 'gte', 'lte', 'is_empty', 'is_not_empty'];
  }
  if (CHOICE_TYPES.has(q.type)) {
    return ['equals', 'not_equals', 'is_empty', 'is_not_empty'];
  }
  return ['equals', 'not_equals', 'is_empty', 'is_not_empty'];
}

function isAnswerBearing(q: Question): boolean {
  return q.type !== 'welcome' && q.type !== 'statement' && q.type !== 'thanks';
}

function defaultConditionField(questions: ReadonlyArray<Question>): string {
  const bearing = questions.find(isAnswerBearing);
  return bearing?.id ?? questions[0]?.id ?? '';
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

function valueLabel(leaf: Leaf, questions: ReadonlyArray<Question>): string {
  if (VALUELESS_OPS.has(leaf.op)) return '';
  const target = questions.find((q) => q.id === leaf.field);
  const choices = optionsFor(target);
  const match = choices?.find((o) => o.value === leaf.value);
  return match?.label ?? (leaf.value.trim() || '…');
}

/** Plain-language summary of one rule row. */
function describeLeaf(leaf: Leaf, questions: ReadonlyArray<Question>): string | null {
  if (!leaf.field) return null;
  const target = questions.find((q) => q.id === leaf.field);
  const name = target ? displayName(target) : 'a question';
  const op = OP_LABEL[leaf.op];
  if (VALUELESS_OPS.has(leaf.op)) return `${name} ${op}`;
  const value = valueLabel(leaf, questions);
  if (!value || value === '…') return null;
  return `${name} ${op} “${value}”`;
}

function LeafRow({
  leaf,
  questions,
  onChange,
  onRemove,
  mode = 'visibility',
  currentId,
}: {
  leaf: Leaf;
  questions: ReadonlyArray<Question>;
  onChange: (next: Leaf) => void;
  onRemove: () => void;
  mode?: 'visibility' | 'jump';
  currentId?: string;
}) {
  const fields = questions.filter(isAnswerBearing);
  const target = questions.find((q) => q.id === leaf.field);
  const choices = optionsFor(target);
  const showChoiceSelect = choices !== null && !NUMERIC_OPS.has(leaf.op);
  const preview = describeLeaf(leaf, questions);
  const allowedOps = opsForQuestion(target);
  const safeOp = allowedOps.includes(leaf.op) ? leaf.op : allowedOps[0];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'start' }}>
      <div style={{ display: 'grid', gap: 8 }}>
        {mode === 'visibility' ? (
          <p className="slate-logic-rule-head">When this is true…</p>
        ) : null}
          <div>
            <span className="slate-logic-field-label">
              {mode === 'jump' && leaf.field === currentId ? 'On this question' : 'Earlier answer'}
            </span>
            <SlateSelect
              value={leaf.field}
              placeholder="Pick a question"
              options={[
                { value: '', label: 'Pick a question…' },
                ...fields.map((q) => ({ value: q.id, label: displayName(q) })),
              ]}
              aria-label="Question"
              onChange={(field) => {
                const nextTarget = questions.find((q) => q.id === field);
                const nextOps = opsForQuestion(nextTarget);
                onChange({
                  ...leaf,
                  field,
                  op: nextOps.includes(leaf.op) ? leaf.op : nextOps[0],
                });
              }}
            />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div>
              <span className="slate-logic-field-label">Condition</span>
              <SlateSelect
                value={safeOp}
                options={allowedOps.map((op) => ({
                  value: op,
                  label: OP_LABEL[op],
                }))}
                aria-label="Condition"
                onChange={(op) => onChange({ ...leaf, op })}
              />
            </div>
            {!VALUELESS_OPS.has(safeOp) &&
              (showChoiceSelect ? (
                <div>
                  <span className="slate-logic-field-label">Answer</span>
                  <SlateSelect
                    value={leaf.value}
                    placeholder="Pick an answer"
                    options={[
                      { value: '', label: 'Pick an answer…' },
                      ...(choices ?? []).map((o) => ({ value: o.value, label: o.label })),
                    ]}
                    aria-label="Answer"
                    onChange={(value) => onChange({ ...leaf, value })}
                  />
                </div>
              ) : (
                <div>
                  <span className="slate-logic-field-label">Value</span>
                  <input
                    className="slate-input"
                    value={leaf.value}
                    placeholder="Enter a value"
                    onChange={(e) => onChange({ ...leaf, value: e.target.value })}
                  />
                </div>
              ))}
          </div>
        {preview && mode === 'visibility' ? (
          <p className="slate-logic-preview">
            Show when <strong>{preview}</strong>
          </p>
        ) : null}
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
      <p style={{ margin: 0, fontSize: 13, color: 'var(--slate-muted)' }}>
        This condition uses nested groups or in/not_in — edit it in the schema code, or{' '}
        <button
          type="button"
          className="slate-btn slate-btn--ghost slate-btn--compact"
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
      {leaves.length === 0 ? (
        <p className="slate-logic-empty">Always visible — everyone will see this question.</p>
      ) : null}
      {leaves.length > 1 && (
        <div className="slate-logic-combinator">
          <span>Show when</span>
          <SlateSelect
            className="slate-select-wrap--auto"
            value={combinator}
            options={[
              { value: 'all', label: 'every' },
              { value: 'any', label: 'any' },
            ]}
            aria-label="Match combinator"
            onChange={(next) => emit(next, leaves)}
          />
          <span>rule matches:</span>
        </div>
      )}
      {leaves.map((leaf, i) => (
        <div key={i} className="slate-logic-rule">
          <LeafRow
            leaf={leaf}
            questions={questions}
            mode="visibility"
            onChange={(next) => emit(combinator, leaves.map((l, idx) => (idx === i ? next : l)))}
            onRemove={() => emit(combinator, leaves.filter((_, idx) => idx !== i))}
          />
        </div>
      ))}
      <button
        type="button"
        className="slate-btn slate-btn--ghost slate-btn--compact"
        style={{ justifySelf: 'start' }}
        onClick={() =>
          emit(combinator, [
            ...leaves,
            { field: defaultConditionField(questions), op: 'equals', value: '' },
          ])
        }
      >
        <span className="slate-btn-plus">+</span> Add visibility rule
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
  const persisted = rules.filter(isCompleteJumpRule);
  const [pending, setPending] = useState<LogicRule[]>([]);

  // Hoist any saved incomplete rules into draft UI state and drop them from schema.
  useEffect(() => {
    const incomplete = rules.filter((r) => !isCompleteJumpRule(r));
    setPending(incomplete);
    if (incomplete.length > 0) {
      onChange(persisted.length > 0 ? persisted : undefined);
    }
    // Only re-run when switching questions — not on every rules edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId]);

  const displayRules = [...persisted, ...pending];
  const emitPersisted = (next: LogicRule[]) =>
    onChange(next.length === 0 ? undefined : next.filter(isCompleteJumpRule));

  const updateRule = (index: number, patch: Partial<LogicRule>) => {
    if (index < persisted.length) {
      const next = persisted.map((r, idx) => (idx === index ? { ...r, ...patch } : r));
      const updated = next[index];
      if (updated && !isCompleteJumpRule(updated)) {
        emitPersisted(persisted.filter((_, idx) => idx !== index));
        setPending((prev) => [...prev, updated]);
        return;
      }
      emitPersisted(next);
      return;
    }

    const pendingIndex = index - persisted.length;
    setPending((prev) => {
      const next = prev.map((r, idx) => (idx === pendingIndex ? { ...r, ...patch } : r));
      const updated = next[pendingIndex];
      if (updated && isCompleteJumpRule(updated)) {
        emitPersisted([...persisted, updated]);
        return next.filter((_, idx) => idx !== pendingIndex);
      }
      return next;
    });
  };

  const removeRule = (index: number) => {
    if (index < persisted.length) {
      emitPersisted(persisted.filter((_, idx) => idx !== index));
      return;
    }
    const pendingIndex = index - persisted.length;
    setPending((prev) => prev.filter((_, idx) => idx !== pendingIndex));
  };

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {displayRules.length === 0 ? (
        <p className="slate-logic-empty">
          Goes to the next question in order — add a rule to skip ahead based on their answer.
        </p>
      ) : null}
      {displayRules.map((rule, i) => {
        const leaf = toLeaf(rule.if);
        const targetName = targets.find((q) => q.id === rule.goTo);
        const conditionText = leaf ? describeLeaf(leaf, questions) : null;
        const destination = targetName ? displayName(targetName) : null;
        return (
          <div key={i} className="slate-logic-rule">
            <p className="slate-logic-rule-head">Skip rule {i + 1}</p>
            {leaf ? (
              <LeafRow
                leaf={leaf}
                questions={questions}
                mode="jump"
                currentId={currentId}
                onChange={(next) =>
                  updateRule(i, { if: fromLeaf(next, questions) })
                }
                onRemove={() => removeRule(i)}
              />
            ) : (
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                <p style={{ margin: 0, fontSize: 13, color: 'var(--slate-muted)' }}>
                  This rule uses advanced logic — edit it in the schema code.
                </p>
                <button
                  type="button"
                  className="slate-btn slate-btn--ghost slate-btn--compact"
                  onClick={() => removeRule(i)}
                >
                  Remove
                </button>
              </div>
            )}
            <div>
              <span className="slate-logic-field-label">Then skip to</span>
              <SlateSelect
                value={rule.goTo}
                placeholder="Pick a question"
                options={[
                  { value: '', label: 'Pick a question…' },
                  ...targets.map((q) => ({ value: q.id, label: displayName(q) })),
                ]}
                aria-label="Jump target"
                onChange={(goTo) => updateRule(i, { goTo })}
              />
            </div>
            {conditionText && destination ? (
              <p className="slate-logic-preview">
                If <strong>{conditionText}</strong>, skip to <strong>{destination}</strong>.
              </p>
            ) : null}
          </div>
        );
      })}
      <button
        type="button"
        className="slate-btn slate-btn--ghost slate-btn--compact"
        style={{ justifySelf: 'start' }}
        onClick={() =>
          setPending((prev) => [
            ...prev,
            { if: { field: currentId, op: 'equals', value: '' }, goTo: '' },
          ])
        }
      >
        <span className="slate-btn-plus">+</span> Add skip rule
      </button>
    </div>
  );
}
