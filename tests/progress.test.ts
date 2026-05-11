import { describe, it, expect } from 'vitest';
import { progress, visibleAnswersForSubmit, visibleQuestions } from '@/logic/progress.js';
import type { Question } from '@/types/Question.js';

const Q = {
  welcome: { id: 'welcome', type: 'welcome', title: 'hi' } as const,
  name: { id: 'name', type: 'short_text', title: 'name?', required: true } as const,
  state: {
    id: 'state',
    type: 'single_choice',
    title: 'state?',
    options: [
      { label: 'CA', value: 'ca' },
      { label: 'NY', value: 'ny' },
      { label: 'TX', value: 'tx' },
    ],
  } as const,
  // visible only when state is CA or NY
  license: {
    id: 'license',
    type: 'short_text',
    title: 'license?',
    visibleIf: { field: 'state', op: 'in', value: ['ca', 'ny'] as const },
  } as const,
  thanks: { id: 'thanks', type: 'thanks', title: 'bye' } as const,
};

describe('progress.visibleQuestions', () => {
  const all: Question[] = [Q.welcome, Q.name, Q.state, Q.license, Q.thanks];

  it('with no visibleIf-trigger answer, hidden questions stay hidden', () => {
    const v = visibleQuestions(all, {});
    expect(v.map((q) => q.id)).toEqual(['welcome', 'name', 'state', 'thanks']);
  });

  it('reveals when condition is met', () => {
    const v = visibleQuestions(all, { state: 'ca' });
    expect(v.map((q) => q.id)).toEqual(['welcome', 'name', 'state', 'license', 'thanks']);
  });

  it('hides again when condition stops matching', () => {
    const v = visibleQuestions(all, { state: 'tx' });
    expect(v.map((q) => q.id)).toEqual(['welcome', 'name', 'state', 'thanks']);
  });
});

describe('progress.progress', () => {
  const all: Question[] = [Q.welcome, Q.name, Q.state, Q.license, Q.thanks];

  it('chrome screens excluded from denominator', () => {
    // visible (no license) = welcome, name, state, thanks. Counted = 2 (name + state).
    const v = visibleQuestions(all, {});
    expect(progress(v, 0)).toBe(0); // on welcome, none passed
    expect(progress(v, 1)).toBe(0); // on name, still 0 passed (welcome was chrome)
    expect(progress(v, 2)).toBe(50); // on state, name is passed (1/2)
    expect(progress(v, 3)).toBe(100); // on thanks, both passed
  });

  it('reflects condition-revealed questions', () => {
    const v = visibleQuestions(all, { state: 'ca' });
    // Counted = 3 (name + state + license). On license (idx 3), 2 are passed.
    expect(progress(v, 3)).toBeCloseTo(66.66, 1);
  });

  it('zero counted questions → 0', () => {
    expect(progress([Q.welcome, Q.thanks], 1)).toBe(0);
  });

  it('clamps over-step to 100', () => {
    const v = visibleQuestions(all, {});
    expect(progress(v, 99)).toBe(100);
  });
});

describe('progress.visibleAnswersForSubmit', () => {
  it('excludes answers to hidden questions (ADR-005 retain-but-exclude)', () => {
    const all: Question[] = [Q.welcome, Q.name, Q.state, Q.license, Q.thanks];
    const allAnswers = { name: 'Caleb', state: 'tx', license: 'CA-12345-FROM-EARLIER' };
    const v = visibleQuestions(all, allAnswers);
    const out = visibleAnswersForSubmit(v, allAnswers);
    // license is hidden because state=tx; excluded from payload even though
    // its prior answer is retained in `allAnswers`.
    expect(out).toEqual({ name: 'Caleb', state: 'tx' });
  });

  it('omits chrome screens (welcome / statement / thanks)', () => {
    const all: Question[] = [Q.welcome, Q.name, Q.thanks];
    const out = visibleAnswersForSubmit(all, { welcome: 'x', name: 'Caleb', thanks: 'y' });
    expect(out).toEqual({ name: 'Caleb' });
  });

  it('omits keys whose value is undefined', () => {
    const all: Question[] = [Q.name];
    const out = visibleAnswersForSubmit(all, { name: undefined });
    expect(out).toEqual({});
  });
});
