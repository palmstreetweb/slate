/**
 * Summary card for sign-up slots (ADR-066): a roster per slot — who took each
 * spot, oldest first, with a fill bar and "5 of 8" — and each slot's waitlist
 * in the order people joined. Every person has a ⋯ menu to move them to
 * another slot, or to give a waitlisted person a spot. Slots the form no
 * longer offers (removed after people took them) are listed last, so nobody
 * drops out of sight. Bars grow in when the card scrolls into view
 * (ADR-060); calm motion shows them drawn.
 *
 * The card reads the same answers the database counts from (migration 020's
 * claims trigger), so the roster and the fill page's "spots left" agree.
 */

'use client';

import { memo, useId, useMemo, type CSSProperties } from 'react';
import type { Question } from '@/index.js';
import { slotDayLabel, slotTimeText } from '@/logic/signupView.js';
import type { StoredSubmission } from '../_submissionStore.js';
import { titleOf } from '../responsesFormat.js';
import { signupRoster, type RosterEntry, type RosterSlot } from '../signupSlots.js';
import { useReveal } from '../delight/useReveal.js';
import { respondentName, responseNumbers } from './model.js';
import { MoreMenu, type MoreMenuItem } from './MoreMenu.js';

type SignupQ = Extract<Question, { type: 'signup_slots' }>;

export type MoveSignup = (args: {
  sub: StoredSubmission;
  question: SignupQ;
  from: string;
  to: string;
  toName: string;
  capacity: number;
}) => void;

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function countText(r: RosterSlot): string {
  if (!r.slot) return plural(r.taken.length, 'person', 'people');
  const over = r.taken.length - r.capacity;
  if (over > 0) return `${r.taken.length} of ${r.capacity} · ${over} over`;
  if (r.taken.length === r.capacity) return `Full · ${r.capacity} of ${r.capacity}`;
  return `${r.taken.length} of ${r.capacity}`;
}

function PersonRow({
  entry,
  row,
  roster,
  question,
  waiting,
  place,
  onMove,
}: {
  entry: RosterEntry;
  row: RosterSlot;
  roster: RosterSlot[];
  question: SignupQ;
  waiting: boolean;
  place: number;
  onMove?: MoveSignup;
}) {
  const items: MoreMenuItem[] = [];
  if (onMove) {
    if (waiting && row.slot) {
      const left = row.capacity - row.taken.length;
      items.push({
        id: 'take',
        label: left > 0 ? `Give them a spot in ${row.name}` : `Give them a spot anyway (full)`,
        onSelect: () =>
          onMove({
            sub: entry.sub,
            question,
            from: row.value,
            to: row.value,
            toName: row.name,
            capacity: row.capacity,
          }),
      });
    }
    const hadTake = items.length > 0;
    for (const other of roster) {
      if (!other.slot || other.value === row.value) continue;
      const left = other.capacity - other.taken.length;
      items.push({
        id: `move-${other.value}`,
        label: `Move to ${other.name} · ${left > 0 ? `${left} left` : 'full'}`,
        // A hairline between "give them a spot here" and the moves elsewhere.
        separatorBefore: hadTake && items.length === 1,
        onSelect: () =>
          onMove({
            sub: entry.sub,
            question,
            from: row.value,
            to: other.value,
            toName: other.name,
            capacity: other.capacity,
          }),
      });
    }
  }
  return (
    <li className="rsp-roster-person">
      {waiting ? (
        <span className="rsp-roster-place" aria-hidden="true">
          {place}
        </span>
      ) : null}
      <span className="rsp-roster-who" title={entry.name}>
        {entry.name}
      </span>
      {items.length ? <MoreMenu items={items} label={`Move ${entry.name}`} /> : null}
    </li>
  );
}

/** Who took each slot, and who's waiting. */
export const SignupRosterCard = memo(function SignupRosterCard({
  question,
  number,
  subs,
  questions,
  onMove,
}: {
  question: SignupQ;
  number: number;
  subs: ReadonlyArray<StoredSubmission>;
  /** Every answer question, to name each person the way the Inbox does. */
  questions: ReadonlyArray<Question>;
  onMove?: MoveSignup;
}) {
  const titleId = useId();
  const revealRef = useReveal<HTMLElement>();
  const roster = useMemo(() => {
    const numbers = responseNumbers(subs);
    return signupRoster(question, subs, (sub) =>
      respondentName(questions, sub.answers, numbers.get(sub.id) ?? 0),
    );
  }, [question, subs, questions]);
  const offered = roster.filter((r) => r.slot);
  const taken = offered.reduce((n, r) => n + Math.min(r.taken.length, r.capacity), 0);
  const capacity = offered.reduce((n, r) => n + r.capacity, 0);
  const waiting = roster.reduce((n, r) => n + r.waiting.length, 0);
  const meta = [
    `${taken} of ${plural(capacity, 'spot', 'spots')} taken`,
    waiting ? `${waiting} waiting` : '',
  ]
    .filter(Boolean)
    .join(' · ');

  // Consecutive slots on the same day share a heading; removed slots come last, under their own.
  const groups: Array<{ day: string; rows: RosterSlot[] }> = [];
  for (const r of roster) {
    const day = r.slot ? slotDayLabel(r.slot.date) : 'No longer on the form';
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.rows.push(r);
    else groups.push({ day, rows: [r] });
  }
  let index = -1;

  return (
    <article ref={revealRef} className="rsp-sum-chart rsp-sum-roster" aria-labelledby={titleId}>
      <header className="rsp-sum-chart-head">
        <h3 className="rsp-sum-chart-title" id={titleId}>
          <span className="rsp-sum-qnum">Q{number}</span>
          <span className="rsp-sum-chart-text" title={titleOf(question)} dir="auto">
            {titleOf(question)}
          </span>
        </h3>
        <span className="rsp-sum-chart-meta">
          <span>{meta}</span>
        </span>
      </header>
      {groups.map((g, gi) => (
        <section
          key={`${g.day}-${gi}`}
          className="rsp-roster-group"
          aria-label={g.day || undefined}
        >
          {g.day ? <h4 className="rsp-roster-day">{g.day}</h4> : null}
          <ol className="rsp-roster">
            {g.rows.map((r) => {
              index += 1;
              const time = r.slot && r.slot.label?.trim() ? slotTimeText(r.slot) : '';
              const fill = r.slot ? Math.min(1, r.taken.length / r.capacity) : 0;
              const state = !r.slot
                ? ' is-removed'
                : r.taken.length > r.capacity
                  ? ' is-over'
                  : r.taken.length === r.capacity
                    ? ' is-full'
                    : '';
              return (
                <li key={r.value} className={`rsp-roster-slot${state}`}>
                  <div className="rsp-roster-head">
                    <span className="rsp-roster-name">
                      {r.name}
                      {time ? <span className="rsp-roster-time">{time}</span> : null}
                    </span>
                    <span className="rsp-roster-count">{countText(r)}</span>
                  </div>
                  {r.slot ? (
                    <span
                      className="rsp-roster-bar"
                      role="img"
                      aria-label={`${r.taken.length} of ${r.capacity} spots taken`}
                    >
                      <i style={{ width: `${fill * 100}%`, '--rsp-i': index } as CSSProperties} />
                    </span>
                  ) : null}
                  {r.taken.length ? (
                    <ol className="rsp-roster-people" aria-label={`Signed up for ${r.name}`}>
                      {r.taken.map((e) => (
                        <PersonRow
                          key={e.sub.id}
                          entry={e}
                          row={r}
                          roster={roster}
                          question={question}
                          waiting={false}
                          place={0}
                          onMove={onMove}
                        />
                      ))}
                    </ol>
                  ) : r.slot ? (
                    <p className="rsp-roster-empty">Nobody yet</p>
                  ) : null}
                  {r.waiting.length ? (
                    <div className="rsp-roster-wait">
                      <p className="rsp-roster-wait-label">Waitlist · {r.waiting.length}</p>
                      <ol className="rsp-roster-people" aria-label={`Waitlist for ${r.name}`}>
                        {r.waiting.map((e, k) => (
                          <PersonRow
                            key={e.sub.id}
                            entry={e}
                            row={r}
                            roster={roster}
                            question={question}
                            waiting
                            place={k + 1}
                            onMove={onMove}
                          />
                        ))}
                      </ol>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </article>
  );
});
