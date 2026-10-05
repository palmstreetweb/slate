/**
 * Visual logic editing for the Inspector (roadmap Phase 4):
 *
 *   - ConditionBuilder — edits a `Condition` (visibleIf) as a flat list of
 *     leaf rules joined by all/any. Nested composites are code-only; the
 *     builder shows a notice instead of mangling them.
 *   - JumpRulesEditor — edits `logic: [{ if, goTo }]` rules, each with a
 *     single leaf condition and a jump-target dropdown.
 *
 * Both keep their rows as drafts (S7): a row reaches the form only once it is
 * finished — a question picked, and an answer or a number that really is one —
 * so a half-made rule never hides a question from respondents. Numbers are
 * kept as typed ("2.", "-") while the form gets the number they make.
 */

import { useState } from 'react';
import type { Condition, LogicRule, Question } from '@/index.js';
import { SlateSelect, type SlateSelectOption } from './SlateSelect.js';
import {
  OP_LABEL,
  answerRemoved,
  describeLeaf,
  displayName,
  fromLeaf,
  indexOf,
  isAnswerBearing,
  isCompleteLeaf,
  isLeafCondition,
  opsForQuestion,
  optionsFor,
  ruleReach,
  toLeaf,
  unfinishedReason,
  valueKind,
  type Leaf,
  type LeafOp,
} from '../logicRules.js';

/**
 * Draft rows that follow `value` until the editor emits its own change. Any
 * other change (undo, redo, another question) starts again from the form.
 */
function useDraft<V, D>(value: V, key: string | undefined, parse: (v: V) => D) {
  const [state, setState] = useState(() => ({ from: value, key, draft: parse(value) }));
  let current = state;
  if (state.from !== value || state.key !== key) {
    current = { from: value, key, draft: parse(value) };
    setState(current);
  }
  const commit = (draft: D, from: V) => setState({ from, key, draft });
  return [current.draft, commit] as const;
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** A new row: the nearest earlier answer when it takes a value, so the row starts unfinished. */
function newLeaf(fields: ReadonlyArray<Question>, questions: ReadonlyArray<Question>): Leaf {
  const nearest = fields[fields.length - 1];
  if (nearest && opsForQuestion(nearest, questions).includes('equals')) {
    return { field: nearest.id, op: 'equals', value: '' };
  }
  return { field: '', op: 'equals', value: '' };
}

function Note({ children, tone }: { children: string; tone: 'warn' | 'muted' }) {
  return (
    <p className={tone === 'warn' ? 'slate-logic-note slate-logic-note--warn' : 'slate-logic-note'}>
      {children}
    </p>
  );
}

function LeafRow({
  leaf,
  questions,
  fields,
  fieldLabel,
  onChange,
  onRemove,
  heading,
  preview,
  warning,
}: {
  leaf: Leaf;
  questions: ReadonlyArray<Question>;
  /** The questions this row may test. */
  fields: ReadonlyArray<Question>;
  fieldLabel: string;
  onChange: (next: Leaf) => void;
  onRemove: () => void;
  heading?: string;
  /** Plain summary of the finished rule, e.g. "Show when Size is “Large”". */
  preview?: string | null;
  /** Why this finished rule can't work as set up, or null. */
  warning?: string | null;
}) {
  const target = questions.find((q) => q.id === leaf.field);
  const choices = optionsFor(target, questions);
  const allowedOps = opsForQuestion(target, questions);
  const safeOp: LeafOp = allowedOps.includes(leaf.op) ? leaf.op : (allowedOps[0] ?? 'equals');
  const shown: Leaf = { ...leaf, op: safeOp };
  const kind = valueKind(shown, questions);
  const unfinished = unfinishedReason(shown, questions);

  const fieldOptions: SlateSelectOption[] = [
    { value: '', label: 'Pick a question…' },
    ...fields.map((q) => ({ value: q.id, label: displayName(q) })),
  ];
  // A saved rule that reads a question out of reach still shows what it reads.
  if (target && !fields.some((q) => q.id === target.id)) {
    fieldOptions.push({ value: target.id, label: displayName(target) });
  }
  const answerOptions: SlateSelectOption[] = [
    { value: '', label: 'Pick an answer…' },
    ...(choices ?? []).map((o) => ({ value: o.value, label: o.label })),
  ];
  if (answerRemoved(shown, questions)) {
    answerOptions.push({ value: leaf.value, label: 'Removed answer' });
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'start' }}>
      <div style={{ display: 'grid', gap: 8 }}>
        {heading ? <p className="slate-logic-rule-head">{heading}</p> : null}
        <div>
          <span className="slate-logic-field-label">{fieldLabel}</span>
          <SlateSelect
            value={leaf.field}
            placeholder="Pick a question"
            options={fieldOptions}
            aria-label="Question"
            onChange={(field) => {
              const nextTarget = questions.find((q) => q.id === field);
              const nextOps = opsForQuestion(nextTarget, questions);
              const op = nextOps.includes(leaf.op) ? leaf.op : (nextOps[0] ?? 'equals');
              // A new question means new answers: only a typed number carries over.
              const nextKind = valueKind({ field, op, value: '' }, questions);
              const keep = kind === 'number' && nextKind === 'number';
              onChange({ field, op, value: keep ? leaf.value : '' });
            }}
          />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div>
            <span className="slate-logic-field-label">Condition</span>
            <SlateSelect<LeafOp>
              value={safeOp}
              options={allowedOps.map((op) => ({ value: op, label: OP_LABEL[op] }))}
              aria-label="Condition"
              onChange={(op) => onChange({ ...leaf, op })}
            />
          </div>
          {kind === 'none' ? null : kind === 'choice' ? (
            <div>
              <span className="slate-logic-field-label">Answer</span>
              <SlateSelect
                value={leaf.value}
                placeholder="Pick an answer"
                options={answerOptions}
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
                placeholder={kind === 'number' ? 'A number' : 'Enter a value'}
                inputMode={kind === 'number' ? 'decimal' : undefined}
                aria-label="Value"
                aria-invalid={kind === 'number' && leaf.value.trim() !== '' && unfinished !== null}
                onChange={(e) => onChange({ ...leaf, value: e.target.value })}
              />
            </div>
          )}
        </div>
        {unfinished ? (
          <Note tone="muted">{unfinished}</Note>
        ) : warning ? (
          <Note tone="warn">{warning}</Note>
        ) : preview ? (
          <p className="slate-logic-preview">{preview}</p>
        ) : null}
      </div>
      <button type="button" className="slate-icon-btn" onClick={onRemove} aria-label="Remove rule">
        ×
      </button>
    </div>
  );
}

/** Why a finished "when to show" row can't work, in plain words; null when it can. */
function visibilityWarning(
  leaf: Leaf,
  questions: ReadonlyArray<Question>,
  currentId: string | undefined,
): string | null {
  if (currentId !== undefined && leaf.field === currentId) {
    return 'A question can’t wait for its own answer, so it would never show. Pick an earlier question.';
  }
  if (currentId !== undefined) {
    const at = indexOf(questions, currentId);
    const used = indexOf(questions, leaf.field);
    if (at !== -1 && used > at) {
      return 'That question comes later, so it isn’t answered yet when this one would show. Pick an earlier question.';
    }
  }
  if (answerRemoved(leaf, questions)) {
    return 'That answer isn’t one of the choices any more. Pick another.';
  }
  return null;
}

type CondDraft = { editable: boolean; combinator: 'all' | 'any'; leaves: Leaf[] };

function parseCondition(c: Condition | undefined): CondDraft {
  if (c === undefined) return { editable: true, combinator: 'all', leaves: [] };
  if (isLeafCondition(c)) {
    const leaf = toLeaf(c);
    return leaf
      ? { editable: true, combinator: 'all', leaves: [leaf] }
      : { editable: false, combinator: 'all', leaves: [] };
  }
  const combinator = 'all' in c ? 'all' : 'any';
  const children = 'all' in c ? c.all : c.any;
  const leaves: Leaf[] = [];
  for (const child of children) {
    const leaf = toLeaf(child);
    if (!leaf) return { editable: false, combinator, leaves: [] };
    leaves.push(leaf);
  }
  return { editable: true, combinator, leaves };
}

function buildCondition(
  combinator: 'all' | 'any',
  leaves: ReadonlyArray<Leaf>,
  questions: ReadonlyArray<Question>,
): Condition | undefined {
  const conds = leaves
    .filter((l) => isCompleteLeaf(l, questions))
    .map((l) => fromLeaf(l, questions));
  if (conds.length === 0) return undefined;
  if (conds.length === 1) return conds[0];
  return combinator === 'all' ? { all: conds } : { any: conds };
}

export function ConditionBuilder({
  value,
  onChange,
  questions,
  currentId,
}: {
  value: Condition | undefined;
  onChange: (next: Condition | undefined) => void;
  questions: ReadonlyArray<Question>;
  /** The question these rules belong to; rules may only read answers given before it. */
  currentId?: string;
}) {
  const [draft, commit] = useDraft(value, currentId, parseCondition);
  const fields =
    currentId === undefined
      ? questions.filter(isAnswerBearing)
      : ruleReach(questions, currentId).visibilityFields;

  if (!draft.editable) {
    return (
      <p style={{ margin: 0, fontSize: 13, color: 'var(--slate-muted)' }}>
        This rule was set up outside the editor, so it can’t be changed here.{' '}
        <button
          type="button"
          className="slate-btn slate-btn--ghost slate-btn--compact"
          onClick={() => onChange(undefined)}
        >
          Clear it
        </button>{' '}
        to start over.
      </p>
    );
  }

  const { combinator, leaves } = draft;
  const emit = (nextCombinator: 'all' | 'any', nextLeaves: Leaf[]) => {
    const next = buildCondition(nextCombinator, nextLeaves, questions);
    const same = sameJson(next, value);
    commit({ editable: true, combinator: nextCombinator, leaves: nextLeaves }, same ? value : next);
    if (!same) onChange(next);
  };

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {leaves.length === 0 ? (
        <p className="slate-logic-empty">Always visible — everyone will see this question.</p>
      ) : null}
      {leaves.length > 1 && (
        <div className="slate-logic-combinator">
          <span>Show when</span>
          <SlateSelect<'all' | 'any'>
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
      {leaves.map((leaf, i) => {
        const summary = describeLeaf(leaf, questions);
        return (
          <div key={i} className="slate-logic-rule">
            <LeafRow
              leaf={leaf}
              questions={questions}
              fields={fields}
              fieldLabel="Earlier answer"
              heading="When this is true…"
              preview={summary ? `Show when ${summary}` : null}
              warning={visibilityWarning(leaf, questions, currentId)}
              onChange={(next) =>
                emit(
                  combinator,
                  leaves.map((l, idx) => (idx === i ? next : l)),
                )
              }
              onRemove={() =>
                emit(
                  combinator,
                  leaves.filter((_, idx) => idx !== i),
                )
              }
            />
          </div>
        );
      })}
      {fields.length === 0 ? (
        <p className="slate-logic-note">
          Rules use answers to earlier questions, and nothing before this one has an answer yet.
        </p>
      ) : (
        <button
          type="button"
          className="slate-btn slate-btn--ghost slate-btn--compact"
          style={{ justifySelf: 'start' }}
          onClick={() => emit(combinator, [...leaves, newLeaf(fields, questions)])}
        >
          <span className="slate-btn-plus">+</span> Add visibility rule
        </button>
      )}
    </div>
  );
}

/**
 * A new skip rule tests this question's own answer, with the first condition it
 * allows; a statement (no answer of its own) starts from the nearest earlier answer.
 */
function newJumpLeaf(
  questions: ReadonlyArray<Question>,
  currentId: string,
  fields: ReadonlyArray<Question>,
): Leaf {
  const current = questions.find((q) => q.id === currentId);
  if (!current || !isAnswerBearing(current)) return newLeaf(fields, questions);
  const ops = opsForQuestion(current, questions);
  return {
    field: currentId,
    op: ops.includes('equals') ? 'equals' : (ops[0] ?? 'equals'),
    value: '',
  };
}

/** One skip rule as the editor holds it: its row (null when set up outside the editor). */
type JumpDraft = { leaf: Leaf | null; rule: LogicRule };

const NO_RULES: ReadonlyArray<LogicRule> = [];

function isCompleteJump(d: JumpDraft, questions: ReadonlyArray<Question>): boolean {
  if (!d.rule.goTo.trim()) return false;
  return d.leaf === null || isCompleteLeaf(d.leaf, questions);
}

function toRule(d: JumpDraft, questions: ReadonlyArray<Question>): LogicRule {
  return d.leaf ? { if: fromLeaf(d.leaf, questions), goTo: d.rule.goTo } : d.rule;
}

/** Why a finished skip rule can't work, in plain words; null when it can. */
function jumpWarning(
  d: JumpDraft,
  questions: ReadonlyArray<Question>,
  currentId: string,
): string | null {
  const at = indexOf(questions, currentId);
  const to = indexOf(questions, d.rule.goTo);
  if (d.rule.goTo === currentId) {
    return 'This rule skips to the same question, so it does nothing. Pick a later one.';
  }
  if (to === -1) return 'The question it skipped to was deleted. Pick another one.';
  if (at !== -1 && to < at) {
    return 'This goes back to an earlier question, so people could go round in circles. Pick a later one.';
  }
  if (d.leaf) {
    const used = indexOf(questions, d.leaf.field);
    if (at !== -1 && used > at) {
      return 'That question comes later, so it isn’t answered yet when this rule runs. Pick this one or an earlier one.';
    }
    if (answerRemoved(d.leaf, questions)) {
      return 'That answer isn’t one of the choices any more. Pick another.';
    }
  }
  return null;
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
  // `logic ?? []` makes a new empty list each render; one constant keeps the drafts.
  const value = rules.length ? rules : NO_RULES;
  const [drafts, commit] = useDraft(value, currentId, (list: ReadonlyArray<LogicRule>) =>
    list.map((rule): JumpDraft => ({ leaf: toLeaf(rule.if), rule })),
  );
  const reach = ruleReach(questions, currentId);

  const emit = (next: JumpDraft[]) => {
    const done = next.filter((d) => isCompleteJump(d, questions)).map((d) => toRule(d, questions));
    const same = sameJson(done, value);
    commit(next, same ? value : done.length ? done : NO_RULES);
    if (!same) onChange(done.length ? done : undefined);
  };

  const update = (index: number, patch: Partial<JumpDraft>) =>
    emit(
      drafts.map((d, i) =>
        i === index ? { ...d, ...patch, rule: { ...d.rule, ...patch.rule } } : d,
      ),
    );

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {drafts.length === 0 ? (
        <p className="slate-logic-empty">
          Goes to the next question in order — add a rule to skip ahead based on their answer.
        </p>
      ) : null}
      {drafts.map((d, i) => {
        const target = questions.find((q) => q.id === d.rule.goTo);
        const targetOptions: SlateSelectOption[] = [
          { value: '', label: 'Pick a question…' },
          ...reach.jumpTargets.map((q) => ({ value: q.id, label: displayName(q) })),
        ];
        // A saved rule that points out of reach still shows where it points.
        if (target && !reach.jumpTargets.some((q) => q.id === target.id)) {
          targetOptions.push({ value: target.id, label: displayName(target) });
        }
        const complete = isCompleteJump(d, questions);
        const warning = complete ? jumpWarning(d, questions, currentId) : null;
        const conditionText = d.leaf ? describeLeaf(d.leaf, questions) : null;
        const leafDone = d.leaf === null || isCompleteLeaf(d.leaf, questions);
        return (
          <div key={i} className="slate-logic-rule">
            <p className="slate-logic-rule-head">Skip rule {i + 1}</p>
            {d.leaf ? (
              <LeafRow
                leaf={d.leaf}
                questions={questions}
                fields={reach.jumpFields}
                fieldLabel={d.leaf.field === currentId ? 'On this question' : 'Earlier answer'}
                onChange={(leaf) => update(i, { leaf })}
                onRemove={() => emit(drafts.filter((_, idx) => idx !== i))}
              />
            ) : (
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 8,
                  alignItems: 'center',
                }}
              >
                <p style={{ margin: 0, fontSize: 13, color: 'var(--slate-muted)' }}>
                  This rule was set up outside the editor, so it can’t be changed here.
                </p>
                <button
                  type="button"
                  className="slate-btn slate-btn--ghost slate-btn--compact"
                  onClick={() => emit(drafts.filter((_, idx) => idx !== i))}
                >
                  Remove
                </button>
              </div>
            )}
            <div>
              <span className="slate-logic-field-label">Then skip to</span>
              <SlateSelect
                value={d.rule.goTo}
                placeholder="Pick a question"
                options={targetOptions}
                aria-label="Jump target"
                onChange={(goTo) => update(i, { rule: { ...d.rule, goTo } })}
              />
            </div>
            {leafDone && !d.rule.goTo.trim() ? (
              <Note tone="muted">Pick where to skip to, to finish this rule.</Note>
            ) : warning ? (
              <Note tone="warn">{warning}</Note>
            ) : complete && conditionText && target ? (
              <p className="slate-logic-preview">
                If <strong>{conditionText}</strong>, skip to <strong>{displayName(target)}</strong>.
              </p>
            ) : null}
          </div>
        );
      })}
      {reach.jumpTargets.length === 0 ? (
        <p className="slate-logic-note">This is the last step, so there’s nothing to skip to.</p>
      ) : (
        <button
          type="button"
          className="slate-btn slate-btn--ghost slate-btn--compact"
          style={{ justifySelf: 'start' }}
          onClick={() => {
            const leaf = newJumpLeaf(questions, currentId, reach.jumpFields);
            emit([
              ...drafts,
              { leaf, rule: { if: { field: leaf.field, op: 'is_not_empty' }, goTo: '' } },
            ]);
          }}
        >
          <span className="slate-btn-plus">+</span> Add skip rule
        </button>
      )}
    </div>
  );
}
