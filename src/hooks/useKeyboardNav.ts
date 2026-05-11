/**
 * Global keyboard handler for the form engine. See BUILD_BRIEF.md §10.3.
 *
 *   Enter (in body)            → advance from welcome/statement
 *   A–F (any focus)            → select choice option N (auto-advance for single_choice — caller decides)
 *   0–9 (in body)              → select scale value if in range
 *   Esc (opt-in)               → back
 *
 * Field-internal Enter handling (text inputs, textareas) lives inside each
 * Field component — those need to see cursor position / shift modifier and
 * own the input element directly. This hook only intercepts the *global*
 * keys and skips when the user is typing.
 */

'use client';

import { useEffect } from 'react';
import type { Question } from '@/types/Question.js';
import { indexFromLetter } from '@/utils/letters.js';

type Opts = {
  currentQ: Question | null;
  enabled?: boolean;
  escapeBack?: boolean;
  onAdvance: () => void;
  onBack: () => void;
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
  onSelectChoice,
  onSelectScale,
}: Opts): void {
  useEffect(() => {
    if (!enabled || !currentQ) return undefined;

    const handler = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      // Esc → back (opt-in only; default off to prevent accidental loss)
      if (e.key === 'Escape' && escapeBack) {
        e.preventDefault();
        onBack();
        return;
      }

      const typing = isTypingTarget(e.target);

      // Enter advances chrome screens regardless of focus (button, link, body).
      if (
        e.key === 'Enter' &&
        !e.shiftKey &&
        (currentQ.type === 'welcome' || currentQ.type === 'statement') &&
        !typing
      ) {
        e.preventDefault();
        onAdvance();
        return;
      }

      // Choice selection — A–F.
      if (
        (currentQ.type === 'single_choice' || currentQ.type === 'multi_choice') &&
        onSelectChoice &&
        !typing
      ) {
        const idx = indexFromLetter(e.key);
        if (idx >= 0 && idx < currentQ.options.length) {
          e.preventDefault();
          onSelectChoice(idx);
          return;
        }
      }

      // Scale selection — 0–9 (within the question's [min, max] window).
      if (currentQ.type === 'scale' && onSelectScale && !typing) {
        if (/^[0-9]$/.test(e.key)) {
          const value = Number.parseInt(e.key, 10);
          if (value >= currentQ.min && value <= currentQ.max) {
            e.preventDefault();
            onSelectScale(value);
            return;
          }
        }
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [currentQ, enabled, escapeBack, onAdvance, onBack, onSelectChoice, onSelectScale]);
}
