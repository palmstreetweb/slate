/**
 * Inspector section for Wave D (ADR-066): sign-up slots. Each slot has a
 * name, its spots (1–1,000) and, optionally, a day, a start and an end, and a
 * short note. The question has a most-per-person, a waitlist switch and a
 * "show spots left" switch.
 *
 * Slot keys are made once (`newSlotValue`) and kept through renames, so
 * people who signed up stay in their slot. Each slot shows how many have
 * signed up; removing one with people in it asks first (they keep their
 * response and show as "No longer on the form" in the roster). Slot changes
 * reach the fill page when the form is published, like every other edit.
 */

import { useEffect, useState } from 'react';
import type { Question, SignupSlot, SignupSlotsQuestion } from '@/index.js';
import { SLOTS_MAX, SLOT_CAPACITY_MAX } from '@/logic/signup.js';
import { useConfirm } from '../_confirm.js';
import {
  ensureFormSubmissions,
  listSubmissions,
  subscribe as subscribeSubmissions,
} from '../_submissionStore.js';
import { newSlotValue, takenCounts } from '../signupSlots.js';
import { SlateNumberInput } from './SlateNumberInput.js';
import { Checkbox, Field, Row } from './inspectorParts.js';

type Patch = (patch: Partial<Question>) => void;

/** People signed up per slot, live: re-read whenever the responses change. */
function useTakenCounts(formId: string | undefined, question: SignupSlotsQuestion) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!formId) return undefined;
    void ensureFormSubmissions(formId);
    return subscribeSubmissions(() => setTick((n) => n + 1));
  }, [formId]);
  void tick;
  return formId ? takenCounts(question, listSubmissions(formId)) : new Map<string, number>();
}

function minutes(t: string | undefined): number | null {
  const m = t ? /^(\d{2}):(\d{2})$/.exec(t) : null;
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function clock(total: number): string {
  const t = Math.max(0, Math.min(23 * 60 + 59, total));
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

/**
 * The next slot: same day and spots as the last one, starting when it ends
 * and lasting as long ("10–11am" → "11am–12pm"), under a fresh key.
 */
export function nextSlot(slots: ReadonlyArray<SignupSlot>): SignupSlot {
  const last = slots[slots.length - 1];
  const value = newSlotValue(slots.map((s) => s.value));
  const label = `Slot ${slots.length + 1}`;
  if (!last) return { label, value, capacity: 8 };
  const start = minutes(last.start);
  const end = minutes(last.end);
  const next: SignupSlot = { label, value, capacity: last.capacity };
  if (last.date) next.date = last.date;
  if (start !== null && end !== null && end > start) {
    next.start = clock(end);
    next.end = clock(end + (end - start));
  } else if (start !== null) {
    next.start = clock(start + 60);
  }
  return next;
}

function SlotRow({
  slot,
  index,
  count,
  taken,
  onChange,
  onMove,
  onRemove,
}: {
  slot: SignupSlot;
  index: number;
  count: number;
  taken: number;
  onChange: (patch: Partial<SignupSlot>) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
}) {
  const over = taken > slot.capacity;
  const name = slot.label.trim() || `Slot ${index + 1}`;
  return (
    <div className="slate-insp-slot">
      <div className="slate-insp-slot-top">
        <input
          className="slate-input"
          value={slot.label}
          placeholder="e.g. Sat 10–11am, or Bring drinks"
          aria-label={`Slot ${index + 1} name`}
          maxLength={120}
          onChange={(e) => onChange({ label: e.target.value })}
        />
        <div className="slate-insp-slot-btns">
          <button
            type="button"
            className="slate-icon-btn"
            onClick={() => onMove(-1)}
            disabled={index === 0}
            aria-label={`Move ${name} up`}
          >
            ↑
          </button>
          <button
            type="button"
            className="slate-icon-btn"
            onClick={() => onMove(1)}
            disabled={index === count - 1}
            aria-label={`Move ${name} down`}
          >
            ↓
          </button>
          <button
            type="button"
            className="slate-icon-btn"
            onClick={onRemove}
            disabled={count === 1}
            aria-label={`Remove ${name}`}
          >
            ×
          </button>
        </div>
      </div>
      <div className="slate-insp-slot-grid">
        <label className="slate-insp-slot-cell">
          <span className="slate-label">Spots</span>
          <SlateNumberInput
            compact
            value={slot.capacity}
            min={1}
            max={SLOT_CAPACITY_MAX}
            allowEmpty={false}
            aria-label={`Spots in ${name}`}
            onChange={(n) => {
              if (n === undefined) return;
              onChange({ capacity: Math.max(1, Math.min(SLOT_CAPACITY_MAX, Math.round(n))) });
            }}
          />
        </label>
        <label className="slate-insp-slot-cell slate-insp-slot-cell--date">
          <span className="slate-label">Day</span>
          <input
            className="slate-input"
            type="date"
            value={slot.date ?? ''}
            aria-label={`Day of ${name} (optional)`}
            onChange={(e) => onChange({ date: e.target.value || undefined })}
          />
        </label>
        <label className="slate-insp-slot-cell">
          <span className="slate-label">Starts</span>
          <input
            className="slate-input"
            type="time"
            value={slot.start ?? ''}
            aria-label={`${name} starts (optional)`}
            onChange={(e) => onChange({ start: e.target.value || undefined })}
          />
        </label>
        <label className="slate-insp-slot-cell">
          <span className="slate-label">Ends</span>
          <input
            className="slate-input"
            type="time"
            value={slot.end ?? ''}
            aria-label={`${name} ends (optional)`}
            onChange={(e) => onChange({ end: e.target.value || undefined })}
          />
        </label>
      </div>
      <input
        className="slate-input slate-insp-slot-note"
        value={slot.description ?? ''}
        placeholder="A short note (optional) — e.g. Meet at the side gate"
        aria-label={`Note under ${name}`}
        maxLength={200}
        onChange={(e) => onChange({ description: e.target.value || undefined })}
      />
      <p className={`slate-insp-slot-taken${over ? ' is-over' : ''}`} role="status">
        {taken === 0
          ? 'Nobody yet'
          : over
            ? `${taken} signed up — ${taken - slot.capacity} more than its ${slot.capacity} spots`
            : `${taken} of ${slot.capacity} signed up`}
      </p>
    </div>
  );
}

export function SignupSlotsSettings({
  question,
  onChange,
  formId,
}: {
  question: SignupSlotsQuestion;
  onChange: Patch;
  /** For live "3 signed up" counts per slot. */
  formId?: string;
}) {
  const confirm = useConfirm();
  const slots = Array.isArray(question.slots) ? question.slots : [];
  const counts = useTakenCounts(formId, question);
  const setSlots = (next: SignupSlot[]) => onChange({ slots: next } as Partial<Question>);
  const update = (i: number, patch: Partial<SignupSlot>) =>
    setSlots(
      slots.map((s, k) => {
        if (k !== i) return s;
        const next: SignupSlot = { ...s, ...patch };
        for (const key of ['date', 'start', 'end', 'description'] as const) {
          if (next[key] === undefined) delete next[key];
        }
        return next;
      }),
    );
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= slots.length) return;
    const next = [...slots];
    [next[i], next[j]] = [next[j]!, next[i]!];
    setSlots(next);
  };
  const remove = async (i: number) => {
    const slot = slots[i]!;
    const taken = counts.get(slot.value) ?? 0;
    if (taken > 0) {
      const ok = await confirm({
        title: `Remove “${slot.label.trim() || `Slot ${i + 1}`}”?`,
        message: `${taken === 1 ? '1 person has' : `${taken} people have`} signed up for it. They keep their responses and show in the roster as “No longer on the form”. To keep them booked, move them to another slot from Responses → Summary first.`,
        confirmLabel: 'Remove slot',
        danger: true,
      });
      if (!ok) return;
    }
    setSlots(slots.filter((_, k) => k !== i));
  };
  const maxPicks = question.maxPicks ?? 1;

  return (
    <>
      <Field label="What It’s For (Optional)" hint="A line under the title, e.g. where to meet.">
        <textarea
          className="slate-textarea"
          value={question.body ?? ''}
          rows={2}
          onChange={(e) => onChange({ body: e.target.value || undefined } as Partial<Question>)}
        />
      </Field>
      <div className="slate-inspector-field">
        <span className="slate-label">Slots</span>
        <div className="slate-insp-slots">
          {slots.map((s, i) => (
            <SlotRow
              key={s.value || i}
              slot={s}
              index={i}
              count={slots.length}
              taken={counts.get(s.value) ?? 0}
              onChange={(patch) => update(i, patch)}
              onMove={(dir) => move(i, dir)}
              onRemove={() => void remove(i)}
            />
          ))}
          <button
            type="button"
            className="slate-btn slate-btn--ghost slate-btn--compact"
            disabled={slots.length >= SLOTS_MAX}
            onClick={() => setSlots([...slots, nextSlot(slots)])}
          >
            <span className="slate-btn-plus">+</span> Add Slot
          </button>
        </div>
        <p className="slate-help">
          Spots are taken when a response is sent, so a slot never holds more than its spots.
          Changes reach the form when you publish; people already signed up keep their spot.
        </p>
      </div>
      <Row>
        <Field
          label="Most Per Person"
          hint={maxPicks > 1 ? 'Waitlists count toward it.' : 'One slot each.'}
        >
          <SlateNumberInput
            value={question.maxPicks}
            min={1}
            max={Math.max(1, Math.min(SLOTS_MAX, slots.length))}
            placeholder="1"
            onChange={(n) =>
              onChange({
                maxPicks: n !== undefined && n > 1 ? Math.min(SLOTS_MAX, Math.round(n)) : undefined,
              } as Partial<Question>)
            }
          />
        </Field>
        <span />
      </Row>
      <Checkbox
        checked={question.waitlist === true}
        onChange={(v) => onChange({ waitlist: v || undefined } as Partial<Question>)}
        label="Offer a Waitlist When a Slot Is Full"
      />
      <Checkbox
        checked={question.showRemaining !== false}
        onChange={(v) => onChange({ showRemaining: v ? undefined : false } as Partial<Question>)}
        label="Show How Many Spots Are Left"
      />
      <Checkbox
        checked={question.required !== false}
        onChange={(v) => onChange({ required: v ? undefined : false } as Partial<Question>)}
        label="Required"
      />
    </>
  );
}
