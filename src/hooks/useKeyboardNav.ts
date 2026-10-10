/**
 * Global keyboard handler for the form engine. See BUILD_BRIEF.md §10.3.
 *
 *   Enter (in body)            → advance from welcome/statement/review, or
 *                                confirm OK steps (multi_choice, text fields, …)
 *   A–Z (any focus)            → select choice option N (auto-advance for single_choice — caller decides);
 *                                the letter after the last option is "Other" when offered (ADR-063)
 *   Y / N (in body)            → select yes_no answer (A/B also work)
 *   A / B (in body)            → select legal accept/decline
 *   0–9 (in body)              → select scale / nps value if in range
 *   ← / → on swipe cards       → owned by the card deck (ADR-065); letters don't pick cards
 *   Esc (opt-in)               → back
 *
 * Field-internal Enter handling (text inputs, textareas) lives inside each
 * Field component — those need to see cursor position / shift modifier and
 * own the input element directly. This hook only intercepts the *global*
 * keys and skips when the user is typing.
 */

'use client';

import { useEffect, useRef } from 'react';
import type { Question } from '@/types/Question.js';
import { indexFromLetter } from '@/utils/letters.js';
import { isScaleStepValue } from '@/utils/scaleStep.js';
import { allowsOther } from '@/logic/other.js';

const DIGIT_COMPOSE_MS = 350;

type Opts = {
  currentQ: Question | null;
  enabled?: boolean;
  escapeBack?: boolean;
  onAdvance: () => void;
  onBack: () => void;
  /** OK / submit for the active step. Return true when handled (suppresses default). */
  onConfirm?: () => boolean;
  onSelectChoice?: (optionIndex: number) => void;
  onSelectScale?: (value: number) => void;
};

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.isContentEditable) return true;
  return false;
}

export function useKeyboardNav({
  currentQ,
  enabled = true,
  escapeBack = false,
  onAdvance,
  onBack,
  onConfirm,
  onSelectChoice,
  onSelectScale,
}: Opts): void {
  const digitBufferRef = useRef('');
  const digitTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled || !currentQ) return undefined;

    const clearDigitBuffer = () => {
      digitBufferRef.current = '';
      if (digitTimerRef.current !== null) {
        window.clearTimeout(digitTimerRef.current);
        digitTimerRef.current = null;
      }
    };

    const handler = (e: KeyboardEvent) => {
      // A held key (auto-repeat) never picks, toggles or confirms anything:
      // it would run through the form, or flip a pick thirty times a second.
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;

      // Esc → back (opt-in only; default off to prevent accidental loss)
      if (e.key === 'Escape' && escapeBack) {
        e.preventDefault();
        onBack();
        return;
      }

      // Enter on a focused button, link or option is that control's own
      // (Back, the theme toggle, Resume, +/−, AM/PM, a tile): the browser's
      // click does the work, so the form must not confirm or advance over it.
      if (
        e.key === 'Enter' &&
        (e.target as Element | null)?.closest?.(
          'button,a[href],[role=radio],[role=checkbox],[role=option],[role=slider],[role=switch]',
        )
      ) {
        return;
      }

      const typing = isTypingTarget(e.target);

      // Enter — chrome screens advance; OK steps confirm via the registered handler.
      if (e.key === 'Enter' && !e.shiftKey && !typing) {
        if (
          currentQ.type === 'welcome' ||
          currentQ.type === 'statement' ||
          currentQ.type === 'review'
        ) {
          e.preventDefault();
          onAdvance();
          return;
        }
        if (onConfirm?.()) {
          e.preventDefault();
          return;
        }
      }

      // Choice selection — A–Z, one key per option. Swipe cards (ADR-065) are a
      // deck, not a grid: the deck owns ← / →, so letters don't jump ahead.
      if (
        (currentQ.type === 'single_choice' ||
          currentQ.type === 'multi_choice' ||
          (currentQ.type === 'picture_choice' &&
            !(currentQ.display === 'swipe' && currentQ.multiple))) &&
        onSelectChoice &&
        !typing
      ) {
        const idx = indexFromLetter(e.key);
        // One more key than options when the question offers Other (its index is options.length).
        const keys = currentQ.options.length + (allowsOther(currentQ) ? 1 : 0);
        if (idx >= 0 && idx < keys) {
          e.preventDefault();
          onSelectChoice(idx);
          return;
        }
      }

      // Yes/No — Y/N shortcuts (A/B also map to yes/no for muscle memory).
      if (currentQ.type === 'yes_no' && onSelectChoice && !typing) {
        const k = e.key.toUpperCase();
        if (k === 'Y') {
          e.preventDefault();
          onSelectChoice(0);
          return;
        }
        if (k === 'N') {
          e.preventDefault();
          onSelectChoice(1);
          return;
        }
        const idx = indexFromLetter(e.key);
        if (idx === 0 || idx === 1) {
          e.preventDefault();
          onSelectChoice(idx);
          return;
        }
      }

      // Legal — A (accept) / B (decline).
      if (currentQ.type === 'legal' && onSelectChoice && !typing) {
        const idx = indexFromLetter(e.key);
        if (idx === 0 || idx === 1) {
          e.preventDefault();
          onSelectChoice(idx);
          return;
        }
      }

      // Scale / NPS — digits compose while another could still make a value in
      // range ("1" of 10, "10" of 100), and commit once no more could, or when
      // the pause ends. Not aligned together, the key stands on its own.
      if ((currentQ.type === 'scale' || currentQ.type === 'nps') && onSelectScale && !typing) {
        if (/^[0-9]$/.test(e.key)) {
          const min = currentQ.type === 'nps' ? 0 : currentQ.min;
          const max = currentQ.type === 'nps' ? 10 : currentQ.max;
          const step = currentQ.type === 'scale' ? (currentQ.step ?? 1) : 1;
          const aligned = (v: number) => isScaleStepValue(v, min, max, step);
          const commit = (v: number) => {
            e.preventDefault();
            clearDigitBuffer();
            onSelectScale(v);
          };

          const composed = Number.parseInt(digitBufferRef.current + e.key, 10);
          if (composed > 0 && composed * 10 <= max) {
            e.preventDefault();
            clearDigitBuffer();
            digitBufferRef.current = String(composed);
            digitTimerRef.current = window.setTimeout(() => {
              const v = Number.parseInt(digitBufferRef.current, 10);
              clearDigitBuffer();
              if (aligned(v)) onSelectScale(v);
            }, DIGIT_COMPOSE_MS);
            return;
          }
          if (aligned(composed)) {
            commit(composed);
            return;
          }
          const single = Number.parseInt(e.key, 10);
          if (aligned(single)) {
            commit(single);
            return;
          }
        }
      }
    };

    window.addEventListener('keydown', handler, true);
    return () => {
      window.removeEventListener('keydown', handler, true);
      clearDigitBuffer();
    };
  }, [currentQ, enabled, escapeBack, onAdvance, onBack, onConfirm, onSelectChoice, onSelectScale]);
}
