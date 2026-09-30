/**
 * Sign-up slots (ADR-066), the pure parts: the rules shared byte for byte
 * with the submit Function, the core's validation / conditions / piping /
 * schemaCheck, and the view helpers the field and the studio read.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Question, SignupSlotsQuestion } from '@/index.js';
import { WAITLIST_VALUE, checkSchema } from '@/index.js';
import { SLOTS_MAX, signupAnswerCore, signupMaxPicks, signupSlotsOf } from '@/logic/signup.js';
import { signupPicks } from '@/logic/signupAnswer.js';
import {
  moveSignupAnswer,
  offeredSlots,
  remainingText,
  slotDayLabel,
  slotDayShort,
  slotDays,
  slotName,
  slotTimeText,
  slotWhenText,
  spotsLeft,
} from '@/logic/signupView.js';
import { validate } from '@/logic/validation.js';
import { evaluate } from '@/logic/conditional.js';
import { formatAnswerFor, pipe } from '@/logic/piping.js';
import * as server from '../neon/functions/submit-response/signup.js';

const q = (over: Partial<SignupSlotsQuestion> = {}): SignupSlotsQuestion => ({
  id: 'swim',
  type: 'signup_slots',
  title: 'Pick a time',
  slots: [
    {
      label: 'Morning',
      value: 's_am',
      capacity: 8,
      date: '2026-10-03',
      start: '10:00',
      end: '11:00',
    },
    {
      label: 'Noon',
      value: 's_noon',
      capacity: 1,
      date: '2026-10-03',
      start: '12:00',
      end: '13:00',
    },
    { label: 'Bring drinks', value: 's_drinks', capacity: 3 },
  ],
  ...over,
});
const rec = (x: unknown) => x as Record<string, unknown>;

function sharedSection(path: string): string {
  const text = readFileSync(resolve(path), 'utf8');
  const start = text.indexOf('/* ---------- shared with the server (keep identical) ---------- */');
  const end = text.indexOf('/* ---------- engine-only helpers ---------- */');
  return (end === -1 ? text.slice(start) : text.slice(start, end)).trim();
}

describe('the submit Function copies the shared sign-up rules byte for byte', () => {
  it('signup.ts', () => {
    const engine = sharedSection('src/logic/signup.ts');
    expect(engine.length).toBeGreaterThan(1500);
    expect(sharedSection('neon/functions/submit-response/signup.ts')).toBe(engine);
  });

  it('and the two agree on random answers', () => {
    for (let i = 0; i < 300; i++) {
      const pick = () => ['s_am', 's_noon', 's_drinks', 'nope', 7, '', null][(i * 7 + 3) % 7];
      const v = {
        slots: Array.from({ length: i % 5 }, pick),
        wait: Array.from({ length: (i >> 2) % 4 }, pick),
      };
      const question = rec(q({ maxPicks: (i % 4) + 1, waitlist: i % 3 === 0 }));
      expect(server.signupAnswerCore(question, v)).toEqual(signupAnswerCore(question, v));
    }
  });
});

describe('signupSlotsOf — the slots a question really offers (020 applies the same rule)', () => {
  it('keeps valid slots in order, first of each value, trimmed labels', () => {
    expect(
      signupSlotsOf({
        slots: [
          { label: '  A  ', value: 'a', capacity: 2 },
          { label: 'dup', value: 'a', capacity: 5 },
          { label: 'B', value: 'b', capacity: 1000 },
          { label: 'C', value: 'c', capacity: 1001 },
          { label: 'D', value: 'd', capacity: 0 },
          { label: 'E', value: 'e', capacity: 2.5 },
          { label: 'F', value: 'f', capacity: '3' },
          { label: 'G', value: 'bad value', capacity: 3 },
          { label: 'H', value: 'x'.repeat(65), capacity: 3 },
          'junk',
          null,
          { value: 'h', capacity: 8.0 },
        ],
      }),
    ).toEqual([
      { value: 'a', label: 'A', capacity: 2 },
      { value: 'b', label: 'B', capacity: 1000 },
      { value: 'h', label: '', capacity: 8 },
    ]);
  });

  it('an invalid first entry does not block a later valid one with the same value', () => {
    expect(
      signupSlotsOf({
        slots: [
          { value: 'a', capacity: 'x' },
          { value: 'a', capacity: 4 },
        ],
      }),
    ).toEqual([{ value: 'a', label: '', capacity: 4 }]);
  });

  it('only the first 50 entries count', () => {
    const slots = Array.from({ length: 60 }, (_, i) => ({ value: `s${i}`, capacity: 1 }));
    expect(signupSlotsOf({ slots })).toHaveLength(SLOTS_MAX);
    expect(signupSlotsOf({ slots: 'nope' })).toEqual([]);
    expect(signupSlotsOf({})).toEqual([]);
  });

  it('most picks: 1 by default, never more than offered, capped at 50', () => {
    expect(signupMaxPicks({}, 3)).toBe(1);
    expect(signupMaxPicks({ maxPicks: 2 }, 3)).toBe(2);
    expect(signupMaxPicks({ maxPicks: 9 }, 3)).toBe(3);
    expect(signupMaxPicks({ maxPicks: 0 }, 3)).toBe(1);
    expect(signupMaxPicks({ maxPicks: 2.5 }, 3)).toBe(1);
    expect(signupMaxPicks({ maxPicks: 80 }, 80)).toBe(50);
  });
});

describe('signupAnswerCore — the canonical answer', () => {
  it('keeps offered slots once, in order, at most maxPicks', () => {
    expect(signupAnswerCore(rec(q()), { slots: ['s_am'] })).toEqual({ slots: ['s_am'] });
    expect(signupAnswerCore(rec(q()), { slots: ['nope', 's_am', 's_am', 's_noon'] })).toEqual({
      slots: ['s_am'],
    });
    expect(
      signupAnswerCore(rec(q({ maxPicks: 2 })), { slots: ['s_drinks', 's_am', 's_noon'] }),
    ).toEqual({ slots: ['s_drinks', 's_am'] });
  });

  it('waitlists only with the waitlist on, never for a slot also taken, inside maxPicks', () => {
    expect(signupAnswerCore(rec(q()), { slots: [], wait: ['s_noon'] })).toBeUndefined();
    expect(signupAnswerCore(rec(q({ waitlist: true })), { slots: [], wait: ['s_noon'] })).toEqual({
      slots: [],
      wait: ['s_noon'],
    });
    expect(
      signupAnswerCore(rec(q({ waitlist: true, maxPicks: 2 })), {
        slots: ['s_am'],
        wait: ['s_am', 's_noon', 's_drinks'],
      }),
    ).toEqual({ slots: ['s_am'], wait: ['s_noon'] });
    expect(
      signupAnswerCore(rec(q({ waitlist: true })), { slots: ['s_am'], wait: ['s_noon'] }),
    ).toEqual({ slots: ['s_am'] });
  });

  it('anything that is not a record, or leaves nothing, is dropped', () => {
    for (const v of ['s_am', ['s_am'], null, 3, { slots: 's_am' }, { slots: [] }, {}]) {
      expect(signupAnswerCore(rec(q()), v)).toBeUndefined();
    }
  });
});

describe('the core: validation, conditions, piping', () => {
  it('validates required, most picks, unknown and repeated slots, waitlists', () => {
    expect(validate(q(), undefined)?.code).toBe('required');
    expect(validate(q({ required: false }), undefined)).toBeNull();
    expect(validate(q(), { slots: ['s_am'] })).toBeNull();
    expect(validate(q(), { slots: ['s_am', 's_noon'] })?.code).toBe('max_selections');
    expect(validate(q({ maxPicks: 2 }), { slots: ['s_am', 's_noon'] })).toBeNull();
    expect(validate(q(), { slots: ['nope'] })?.code).toBe('shape');
    expect(validate(q({ maxPicks: 3 }), { slots: ['s_am', 's_am'] })?.code).toBe('shape');
    expect(validate(q(), { slots: [], wait: ['s_noon'] })?.code).toBe('shape');
    expect(validate(q({ waitlist: true }), { slots: [], wait: ['s_noon'] })).toBeNull();
  });

  it('a slot value means "took that slot"; WAITLIST_VALUE means "joined a waitlist"', () => {
    const answers = { swim: { slots: ['s_am'], wait: ['s_noon'] } };
    expect(evaluate({ field: 'swim', op: 'equals', value: 's_am' }, answers)).toBe(true);
    expect(evaluate({ field: 'swim', op: 'equals', value: 's_noon' }, answers)).toBe(false);
    expect(evaluate({ field: 'swim', op: 'not_equals', value: 's_noon' }, answers)).toBe(true);
    expect(evaluate({ field: 'swim', op: 'in', value: ['s_drinks', 's_am'] }, answers)).toBe(true);
    expect(evaluate({ field: 'swim', op: 'equals', value: WAITLIST_VALUE }, answers)).toBe(true);
    expect(
      evaluate(
        { field: 'swim', op: 'equals', value: WAITLIST_VALUE },
        { swim: { slots: ['s_am'] } },
      ),
    ).toBe(false);
    expect(evaluate({ field: 'swim', op: 'is_empty' }, { swim: { slots: [] } })).toBe(true);
    expect(evaluate({ field: 'swim', op: 'is_not_empty' }, answers)).toBe(true);
  });

  it('pipes as the slot names, waitlists marked', () => {
    const question = q({
      slots: [
        ...q().slots,
        { label: '', value: 's_bare', capacity: 2, date: '2026-10-04', start: '09:00' },
      ],
    });
    expect(formatAnswerFor(question, { slots: ['s_am', 's_bare'], wait: ['s_noon'] })).toBe(
      'Morning, 2026-10-04 09:00, Noon (waitlist)',
    );
    expect(
      pipe('See you at {{field:swim}}!', { swim: { slots: ['s_am'] } }, 0, [question as Question]),
    ).toBe('See you at Morning!');
    expect(signupPicks({ slots: ['a', 3], wait: 'x' })).toEqual({ slots: ['a'], wait: [] });
  });
});

describe('schemaCheck (ADR-066)', () => {
  it('flags a question with no slot it can offer, and slots it can’t', () => {
    const kinds = (question: SignupSlotsQuestion) => checkSchema([question]).map((i) => i.kind);
    expect(kinds(q())).toEqual([]);
    expect(kinds(q({ slots: [] }))).toEqual(['no_slots']);
    expect(kinds(q({ slots: [{ label: 'A', value: 'a', capacity: 0 }] }))).toEqual(['no_slots']);
    expect(kinds(q({ slots: [...q().slots, { label: '', value: 'x', capacity: 2 }] }))).toEqual([
      'bad_slots',
    ]);
    expect(
      kinds(
        q({ slots: [...q().slots, { label: 'X', value: 'x', capacity: 2, date: '2026-02-30' }] }),
      ),
    ).toEqual(['bad_slots']);
    expect(
      kinds(q({ slots: [...q().slots, { label: 'X', value: 'x', capacity: 2, start: '25:00' }] })),
    ).toEqual(['bad_slots']);
    expect(kinds(q({ slots: [...q().slots, { label: 'X', value: 's_am', capacity: 2 }] }))).toEqual(
      ['bad_slots'],
    );
  });

  it('its own count of usable slots agrees with signupSlotsOf on random lists', () => {
    const values = ['a', 'b', 'a', 'bad key', '', 'c', 'x'.repeat(65)];
    const caps = [1, 8, 1000, 1001, 0, 2.5, -1, 40];
    for (let i = 0; i < 400; i++) {
      const n = (i * 13) % 55;
      const slots = Array.from({ length: n }, (_, k) => ({
        label: 'L',
        value: values[(i + k * 3) % values.length]!,
        capacity: caps[(i * 7 + k) % caps.length]!,
      }));
      const usable = signupSlotsOf({ slots }).length;
      const kinds = checkSchema([q({ slots })]).map((x) => x.kind);
      const want = usable === 0 ? ['no_slots'] : usable < slots.length ? ['bad_slots'] : [];
      expect(kinds).toEqual(want);
    }
  });
});

describe('view helpers', () => {
  it('reads days and times the way the field and the studio show them', () => {
    expect(slotDayLabel('2026-10-03')).toBe('Saturday, October 3');
    expect(slotDayShort('2026-10-04')).toBe('Sun, Oct 4');
    expect(slotDayLabel('2026-02-30')).toBe('');
    expect(slotTimeText({ start: '10:00', end: '11:00' })).toBe('10–11 AM');
    expect(slotTimeText({ start: '11:30', end: '13:00' })).toBe('11:30 AM – 1 PM');
    expect(slotTimeText({ start: '09:15' })).toBe('9:15 AM');
    expect(slotTimeText({ start: '00:00', end: '00:45' })).toBe('12–12:45 AM');
    expect(slotTimeText({ end: '10:00' })).toBe('');
    expect(slotWhenText({ date: '2026-10-03', start: '14:00', end: '15:30' })).toBe(
      'Sat, Oct 3 · 2–3:30 PM',
    );
    expect(slotName({ label: '', value: 'k', capacity: 1, date: '2026-10-03' })).toBe('Sat, Oct 3');
    expect(slotName({ label: '', value: 'k', capacity: 1 })).toBe('k');
  });

  it('spots left: clamped, whole, and never read off the prototype', () => {
    const slot = { value: 'constructor', capacity: 8 };
    expect(spotsLeft({}, slot)).toBeUndefined();
    expect(spotsLeft(undefined, slot)).toBeUndefined();
    expect(spotsLeft({ constructor: 3 }, slot)).toBe(3);
    expect(spotsLeft({ constructor: 99 }, slot)).toBe(8);
    expect(spotsLeft({ constructor: -2 }, slot)).toBe(0);
    expect(spotsLeft({ constructor: Number.NaN }, slot)).toBeUndefined();
    expect(remainingText(undefined, 8)).toBe('8 spots');
    expect(remainingText(undefined, 1)).toBe('1 spot');
    expect(remainingText(0, 8)).toBe('Full');
    expect(remainingText(1, 8)).toBe('1 spot left');
    expect(remainingText(3, 8)).toBe('3 of 8 left');
  });

  it('groups consecutive slots by day and lists only offered slots', () => {
    const groups = slotDays(offeredSlots(q()));
    expect(groups.map((g) => [g.day, g.slots.map((s) => s.value)])).toEqual([
      ['Saturday, October 3', ['s_am', 's_noon']],
      ['', ['s_drinks']],
    ]);
    expect(
      offeredSlots(q({ slots: [...q().slots, { label: 'X', value: 'x', capacity: 0 }] })),
    ).toHaveLength(3);
  });

  it('moves someone between slots, or off a waitlist', () => {
    expect(moveSignupAnswer({ slots: ['a', 'b'] }, 'a', 'c')).toEqual({ slots: ['b', 'c'] });
    expect(moveSignupAnswer({ slots: [], wait: ['a'] }, 'a', 'a')).toEqual({ slots: ['a'] });
    expect(moveSignupAnswer({ slots: ['b'], wait: ['a', 'c'] }, 'a', 'b')).toEqual({
      slots: ['b'],
      wait: ['c'],
    });
  });
});

describe('token discipline (CLAUDE.md, ADR-059)', () => {
  const css = readFileSync(resolve('src/styles/extensions-d.css'), 'utf8');
  const field = readFileSync(resolve('src/components/questions/ext/SignupSlotsField.tsx'), 'utf8');
  const noComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '');

  it('the field and its stylesheet use colour tokens only', () => {
    for (const text of [noComments(css), field]) {
      expect(text).not.toMatch(/#[0-9a-f]{3,8}\b/i);
      expect(text).not.toMatch(/\brgba?\(\s*\d/i);
      expect(text).not.toMatch(/\bhsla?\(/i);
    }
  });

  it('every rule is wrapper-scoped, and animation runs only in the motion block', () => {
    const body = noComments(css);
    const motionAt = body.indexOf('@media (prefers-reduced-motion: no-preference)');
    expect(motionAt).toBeGreaterThan(0);
    const selectors = body
      .slice(0, motionAt)
      .replace(/@keyframes[\s\S]*?\n}\n/g, '')
      .replace(/@media[^{]*\{/g, '')
      .match(/^[^@\s}][^{]*\{/gm)!;
    for (const s of selectors) expect(s).toMatch(/^\[data-slate-forms\]/);
    expect(body.slice(0, motionAt)).not.toMatch(/\banimation\s*:/);
    expect(body.slice(0, motionAt)).not.toMatch(/\btransition\s*:/);
    expect(body.slice(motionAt)).toMatch(/:not\(\[data-reduced-motion\]\)/);
  });
});
