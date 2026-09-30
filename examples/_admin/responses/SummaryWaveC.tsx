/**
 * Summary cards for Wave C (ADR-065): a heatmap of when people are free
 * across every availability answer (with the best times named), and every
 * pin from every response over the owner's photo. Both reveal the way the
 * bar charts do (ADR-060): cells and pins fade up when the card scrolls in;
 * calm motion shows them drawn.
 */

'use client';

import { memo, useId, useMemo, type CSSProperties } from 'react';
import type { Question } from '@/index.js';
import { WEEKDAY_LONG, WEEKDAY_SHORT, clockLabel } from '@/logic/availability.js';
import { PIN_IMAGE_DATA_MAX, safeImageSrc } from '@/utils/brandLogo.js';
import type { StoredSubmission } from '../_submissionStore.js';
import { titleOf } from '../responsesFormat.js';
import { useReveal } from '../delight/useReveal.js';
import { availabilityHeat, pinCloud } from './model.js';

type Q<T extends Question['type']> = Extract<Question, { type: T }>;

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function CardHead({ id, number, title, meta }: { id: string; number: number; title: string; meta: string }) {
  return (
    <header className="rsp-sum-chart-head">
      <h3 className="rsp-sum-chart-title" id={id}>
        <span className="rsp-sum-qnum">Q{number}</span>
        <span className="rsp-sum-chart-text" title={title} dir="auto">
          {title}
        </span>
      </h3>
      <span className="rsp-sum-chart-meta">
        <span>{meta}</span>
      </span>
    </header>
  );
}

/** When most people are free: a heatmap of every painted week. */
export const AvailabilityHeatCard = memo(function AvailabilityHeatCard({
  question,
  number,
  subs,
}: {
  question: Q<'availability'>;
  number: number;
  subs: ReadonlyArray<StoredSubmission>;
}) {
  const titleId = useId();
  const revealRef = useReveal<HTMLElement>();
  const heat = useMemo(() => availabilityHeat(question, subs), [question, subs]);
  const { grid } = heat;
  const every = grid.slot >= 60 ? 1 : 60 / grid.slot;
  const slotText = (day: string, slot: number) =>
    `${WEEKDAY_SHORT[day] ?? day} ${clockLabel(grid.start + slot * grid.slot)}–${clockLabel(
      grid.start + (slot + 1) * grid.slot,
    )}`;
  return (
    <article
      ref={revealRef}
      className="rsp-sum-chart rsp-sum-heat"
      aria-labelledby={titleId}
      style={{ '--rsp-days': grid.days.length } as CSSProperties}
    >
      <CardHead
        id={titleId}
        number={number}
        title={titleOf(question)}
        meta={plural(heat.answered, 'answer', 'answers')}
      />
      {heat.answered === 0 ? (
        <p className="rsp-sum-heat-empty">No times painted yet.</p>
      ) : (
        <>
          <div className="rsp-sum-heat-grid" role="img" aria-label="When people are free, darker is more people">
            <span />
            {grid.days.map((d) => (
              <span key={d} className="rsp-sum-heat-day">
                {WEEKDAY_SHORT[d] ?? d}
              </span>
            ))}
            {Array.from({ length: grid.count }, (_, s) => (
              <div key={s} className="rsp-sum-heat-row">
                <span className="rsp-sum-heat-time">
                  {s % every === 0 ? clockLabel(grid.start + s * grid.slot) : ''}
                </span>
                {grid.days.map((d, di) => {
                  const n = heat.counts.get(d)?.[s] ?? 0;
                  return (
                    <span
                      key={d}
                      className={`rsp-sum-heat-cell${n ? '' : ' is-zero'}`}
                      style={
                        {
                          '--h': heat.max ? n / heat.max : 0,
                          '--rsp-i': di + s,
                        } as CSSProperties
                      }
                      title={`${WEEKDAY_LONG[d] ?? d} ${clockLabel(grid.start + s * grid.slot)}: ${n} of ${heat.answered}`}
                    />
                  );
                })}
              </div>
            ))}
          </div>
          {heat.best.length ? (
            <ol className="rsp-sum-heat-best" aria-label="Best times">
              {heat.best.map((b) => (
                <li key={`${b.day}${b.slot}`}>
                  <span>{slotText(b.day, b.slot)}</span>
                  <span className="rsp-sum-heat-n">
                    {b.count} of {heat.answered}
                  </span>
                </li>
              ))}
            </ol>
          ) : null}
        </>
      )}
    </article>
  );
});

/** Where people pinned: every pin from every response over the photo. */
export const PinCloudCard = memo(function PinCloudCard({
  question,
  number,
  subs,
}: {
  question: Q<'image_pin'>;
  number: number;
  subs: ReadonlyArray<StoredSubmission>;
}) {
  const titleId = useId();
  const revealRef = useReveal<HTMLElement>();
  const cloud = useMemo(() => pinCloud(question, subs), [question, subs]);
  const src = safeImageSrc(question.image, PIN_IMAGE_DATA_MAX);
  return (
    <article ref={revealRef} className="rsp-sum-chart rsp-sum-pins" aria-labelledby={titleId}>
      <CardHead
        id={titleId}
        number={number}
        title={titleOf(question)}
        meta={`${plural(cloud.pins.length, 'pin', 'pins')} · ${plural(cloud.answered, 'answer', 'answers')}`}
      />
      <div className="rsp-sum-pins-photo" role="img" aria-label={`${cloud.pins.length} pins on the photo`}>
        {src ? <img src={src} alt="" referrerPolicy="no-referrer" /> : <span className="rsp-sum-pins-blank" />}
        {cloud.pins.map((p, i) => (
          <span
            key={i}
            className="rsp-sum-pin"
            style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%`, '--rsp-i': i % 24 } as CSSProperties}
          />
        ))}
      </div>
    </article>
  );
});
