/**
 * Package cards for single choice (ADR-064): each option is a card with its
 * price, a short feature list and an optional badge ("Most popular"). The
 * answer is the same option value as the list style, so switching styles
 * never loses answers, and prices feed the instant estimate. Loaded on demand.
 *
 * Cards are `.slate-choice` buttons underneath, so every theme's choice look
 * (surfaces, selection, Swiss inversion, decoration backdrops) carries over.
 * Phones stack them; wider screens lay them side by side. Letter keys, the
 * commit beat and "Other" work as on the list.
 */

'use client';

import { useCallback, useId, useState, type CSSProperties } from 'react';
import type { SingleChoiceQuestion } from '@/types/Question.js';
import { CHOICE_LETTERS } from '@/utils/letters.js';
import { useChoiceCommit } from '@/hooks/useChoiceCommit.js';
import { useRegisterFormConfirm, useRegisterOtherKey } from '@/hooks/useRegisterFormConfirm.js';
import { resolveOtherText } from '@/logic/other.js';
import { formatMoney, formatPrice } from '@/logic/estimate.js';
import { shakeInvalid } from '@/utils/motion.js';
import { ChoiceBadge } from '../ChoiceBadge.js';
import { OTHER_EMPTY, OtherTextBox, keyRange, useOtherChoice } from '../OtherChoice.js';
import type { ExtFieldProps } from '../lazyFields.js';
import { resolveTitle } from '../_resolveTitle.js';
import '@/styles/extensions.css';

/** Feature lines shown per card (the rest stay in the studio). */
const FEATURES_MAX = 6;

/** The two ends of a price, so a narrow card breaks the range at the dash only. */
function priceParts(
  price: number | undefined,
  priceMax: number | undefined,
  currency: string,
): [string, string | null] | null {
  if (typeof price !== 'number' || !Number.isFinite(price)) return null;
  const high = typeof priceMax === 'number' && priceMax > price ? priceMax : null;
  const fraction = Number.isInteger(price) && (high === null || Number.isInteger(high)) ? 0 : 2;
  return [
    formatMoney(price, currency, fraction),
    high === null ? null : formatMoney(high, currency, fraction),
  ];
}

export default function ChoiceCardsField({
  question,
  answers,
  value,
  onCommit,
  onAdvance,
  onType,
  currency = 'USD',
}: ExtFieldProps<SingleChoiceQuestion>) {
  const titleId = useId();
  const selected = typeof value === 'string' ? value : undefined;
  const { committed, markCommitted } = useChoiceCommit(selected);
  const other = useOtherChoice(question, selected, titleId);
  const isOption = (v: string | undefined) => question.options.some((o) => o.value === v);

  // A new pick of a listed option (click or letter key) closes the Other box.
  const [seen, setSeen] = useState(selected);
  if (selected !== seen) {
    setSeen(selected);
    if (other.open && isOption(selected)) other.close();
  }

  const otherCommitted = other.open && committed !== null && !isOption(committed);

  const commitOther = useCallback(() => {
    if (!other.text.trim()) {
      other.setError(OTHER_EMPTY);
      shakeInvalid(other.inputRef.current);
      return;
    }
    const { value: v } = resolveOtherText(question.options, other.text);
    markCommitted(v);
    onCommit(v);
  }, [other, question.options, markCommitted, onCommit]);

  // OK commits the typed Other; an optional, unanswered question can be skipped.
  const skip = !other.open && question.required === false && !selected ? onAdvance : undefined;
  const confirm = other.open ? commitOther : skip;
  useRegisterFormConfirm(confirm!, Boolean(confirm));
  useRegisterOtherKey(other.openBox, other.enabled);

  const count = question.options.length + (other.enabled ? 1 : 0);

  return (
    <div>
      <h1 id={titleId} className="slate-title">
        {resolveTitle(question.title, answers)}
      </h1>

      <div
        className={`slate-pkgs${count <= 2 ? ' slate-pkgs--pair' : ''}${committed ? ' slate-pkgs--committed' : ''}`}
        role="radiogroup"
        aria-labelledby={titleId}
      >
        {question.options.map((opt, i) => {
          const isSelected = !other.open && selected === opt.value;
          const isCommitted = isSelected && committed === opt.value;
          const price = formatPrice(opt.price, opt.priceMax, currency);
          const parts = priceParts(opt.price, opt.priceMax, currency);
          const features = (opt.features ?? [])
            .filter((f) => typeof f === 'string' && f.trim())
            .slice(0, FEATURES_MAX);
          const detailId = `${titleId}-d${i}`;
          const hasDetail = Boolean(opt.description || features.length);
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={isSelected}
              aria-label={[opt.label, price, opt.badge].filter(Boolean).join(', ')}
              aria-describedby={hasDetail ? detailId : undefined}
              onClick={() => {
                other.close();
                markCommitted(opt.value);
                onCommit(opt.value);
              }}
              className={`slate-choice slate-pkg${opt.badge ? ' slate-pkg--badged' : ''}${isSelected ? ' slate-choice--selected' : ''}${isCommitted ? ' slate-choice--committed slate-pkg--committed' : ''}`}
              style={{ '--slate-i': i } as CSSProperties}
            >
              {opt.badge ? (
                <span className="slate-pkg-badge" aria-hidden="true">
                  {opt.badge}
                </span>
              ) : null}
              <span className="slate-pkg-head" aria-hidden="true">
                <ChoiceBadge letter={CHOICE_LETTERS[i] ?? ''} committed={isCommitted} />
                <span className="slate-pkg-name">{opt.label}</span>
              </span>
              {parts ? (
                <span className="slate-pkg-price" aria-hidden="true">
                  <span>{parts[0]}</span>
                  {parts[1] ? (
                    <>
                      <span className="slate-pkg-dash">{'\u2009–\u2009'}</span>
                      <span>{parts[1]}</span>
                    </>
                  ) : null}
                </span>
              ) : null}
              {hasDetail ? (
                <span id={detailId} className="slate-pkg-detail">
                  {opt.description ? (
                    <span className="slate-pkg-desc">{opt.description}</span>
                  ) : null}
                  {features.length ? (
                    <span className="slate-pkg-features">
                      {features.map((f, k) => (
                        <span key={k} className="slate-pkg-feature">
                          <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                            <path d="M3.5 8.4 6.6 11.4 12.5 4.8" />
                          </svg>
                          <span>{f}</span>
                        </span>
                      ))}
                    </span>
                  ) : null}
                </span>
              ) : null}
            </button>
          );
        })}
        {other.enabled ? (
          <button
            type="button"
            role="radio"
            aria-checked={other.open}
            aria-controls={other.open ? other.boxId : undefined}
            onClick={other.openBox}
            className={`slate-choice slate-pkg slate-pkg--other${other.open ? ' slate-choice--selected' : ''}${otherCommitted ? ' slate-choice--committed slate-pkg--committed' : ''}`}
            style={{ '--slate-i': question.options.length } as CSSProperties}
          >
            <span className="slate-pkg-head">
              <ChoiceBadge letter={other.letter} committed={otherCommitted} />
              <span className="slate-pkg-name">{other.label}</span>
            </span>
          </button>
        ) : null}
      </div>
      <OtherTextBox other={other} onEnter={commitOther} onType={onType} />
      {other.error ? (
        <p className="slate-err" aria-live="polite">
          {other.error}
        </p>
      ) : null}
      {confirm ? (
        <div className="slate-actions">
          {skip ? (
            <button type="button" className="slate-ok-btn slate-ok-btn--skip" onClick={skip}>
              Skip
            </button>
          ) : (
            <button type="button" className="slate-ok-btn" onClick={commitOther}>
              OK <span aria-hidden>✓</span>
            </button>
          )}
          <span className="slate-hint slate-key-hint">press Enter ↵</span>
        </div>
      ) : (
        <p className="slate-hint slate-key-hint" style={{ marginTop: 20 }}>
          press {keyRange(count)}, or click to choose
        </p>
      )}
    </div>
  );
}
