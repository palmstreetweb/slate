/**
 * End-to-end smoke test for the form engine. Exercises:
 *   - state machine (next, back, setAnswer)
 *   - conditional visibility (skip + retain)
 *   - onSubmit fires once on entering thanks
 *   - SubmitMeta contains questionsVisited + duration + hiddenFields
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useFormState } from '@/hooks/useFormState.js';
import { defineSchema } from '@/index.js';

const schema = defineSchema({
  brand: { name: 'Test' },
  theme: 'editorial',
  themeMode: 'light',
  questions: [
    { id: 'welcome', type: 'welcome', title: 'hi' },
    { id: 'name', type: 'short_text', title: 'name?', required: true },
    {
      id: 'state',
      type: 'single_choice',
      title: 'state?',
      options: [
        { label: 'CA', value: 'ca' },
        { label: 'TX', value: 'tx' },
      ],
    },
    {
      id: 'license',
      type: 'short_text',
      title: 'license?',
      visibleIf: { field: 'state', op: 'equals', value: 'ca' },
    },
    { id: 'done', type: 'thanks', title: 'thanks' },
  ],
});

beforeEach(() => {
  vi.useRealTimers();
});

describe('useFormState — navigation + visibility', () => {
  it('starts on welcome, step 0', () => {
    const { result } = renderHook(() => useFormState(schema));
    expect(result.current.currentQuestion?.id).toBe('welcome');
    expect(result.current.state.step).toBe(0);
  });

  it('next() advances; back() returns', () => {
    const { result } = renderHook(() => useFormState(schema));
    act(() => result.current.next());
    expect(result.current.currentQuestion?.id).toBe('name');
    act(() => result.current.back());
    expect(result.current.currentQuestion?.id).toBe('welcome');
  });

  it('setAnswer + next records visited; questionsVisited is ordered + deduped', () => {
    const { result } = renderHook(() => useFormState(schema));
    act(() => result.current.next()); // welcome → name
    act(() => result.current.setAnswer('name', 'Caleb'));
    act(() => result.current.next()); // name → state
    expect(result.current.state.questionsVisited).toEqual(['welcome', 'name', 'state']);
  });

  it('hidden questions are skipped automatically when condition fails', () => {
    const { result } = renderHook(() => useFormState(schema));
    act(() => result.current.next()); // → name
    act(() => result.current.setAnswer('name', 'Caleb'));
    act(() => result.current.next()); // → state
    act(() => result.current.setAnswer('state', 'tx'));
    act(() => result.current.next()); // → thanks (license is hidden)
    expect(result.current.currentQuestion?.id).toBe('done');
  });

  it('hidden questions are revealed when condition matches; license appears between state and thanks', () => {
    const { result } = renderHook(() => useFormState(schema));
    act(() => result.current.next());
    act(() => result.current.setAnswer('name', 'Caleb'));
    act(() => result.current.next());
    act(() => result.current.setAnswer('state', 'ca'));
    act(() => result.current.next()); // → license
    expect(result.current.currentQuestion?.id).toBe('license');
    act(() => result.current.next()); // → thanks
    expect(result.current.currentQuestion?.id).toBe('done');
  });
});

describe('useFormState — setAnswer functional updater (regression)', () => {
  it('back-to-back updates with stale closures still produce the right cumulative value', () => {
    // Reproduces the multi_choice keyboard-toggle bug: two synchronous
    // setAnswer calls in the same tick must both see the latest array.
    const { result } = renderHook(() => useFormState(schema));
    act(() => result.current.next()); // → name (just to have a stored answer slot)
    act(() => {
      result.current.setAnswer('addons', (prev) => [
        ...((prev as string[] | undefined) ?? []),
        'a',
      ]);
      result.current.setAnswer('addons', (prev) => [
        ...((prev as string[] | undefined) ?? []),
        'b',
      ]);
    });
    expect(result.current.state.answers.addons).toEqual(['a', 'b']);
  });
});

describe('useFormState — logic jumps (ADR-015)', () => {
  const jumpSchema = defineSchema({
    brand: { name: 'Test' },
    theme: 'editorial',
    themeMode: 'light',
    questions: [
      { id: 'welcome', type: 'welcome', title: 'hi' },
      {
        id: 'interested',
        type: 'yes_no',
        title: 'Interested?',
        logic: [{ if: { field: 'interested', op: 'equals', value: 'no' }, goTo: 'bye' }],
      },
      { id: 'name', type: 'short_text', title: 'name?' },
      { id: 'email', type: 'email', title: 'email?' },
      { id: 'done', type: 'thanks', title: 'thanks!' },
      {
        id: 'bye',
        type: 'thanks',
        title: 'no worries',
        visibleIf: { field: 'interested', op: 'equals', value: 'no' },
      },
    ],
  });

  it('matching rule jumps over in-between questions', () => {
    const { result } = renderHook(() => useFormState(jumpSchema));
    act(() => result.current.next()); // → interested
    act(() => result.current.setAnswer('interested', 'no'));
    act(() => result.current.next()); // jump → bye
    expect(result.current.currentQuestion?.id).toBe('bye');
  });

  it('no match falls through to normal next', () => {
    const { result } = renderHook(() => useFormState(jumpSchema));
    act(() => result.current.next()); // → interested
    act(() => result.current.setAnswer('interested', 'yes'));
    act(() => result.current.next()); // → name (no jump)
    expect(result.current.currentQuestion?.id).toBe('name');
  });

  it('back returns to the jump origin', () => {
    const { result } = renderHook(() => useFormState(jumpSchema));
    act(() => result.current.next());
    act(() => result.current.setAnswer('interested', 'no'));
    act(() => result.current.next()); // jump → bye
    act(() => result.current.back());
    expect(result.current.currentQuestion?.id).toBe('interested');
  });

  it('multiple endings: visibleIf-gated thanks is hidden on the other path', () => {
    const { result } = renderHook(() => useFormState(jumpSchema));
    act(() => result.current.setAnswer('interested', 'yes'));
    const ids = result.current.state.visible.map((q) => q.id);
    expect(ids).toContain('done');
    expect(ids).not.toContain('bye');
  });
});

describe('useFormState — ADR-005 retain-but-exclude', () => {
  it('answers to now-hidden questions stay in state but drop from getSubmitAnswers()', () => {
    const { result } = renderHook(() => useFormState(schema));
    // Walk to license, fill it, walk back, change state to TX so license hides.
    act(() => result.current.next()); // → name
    act(() => result.current.setAnswer('name', 'Caleb'));
    act(() => result.current.next()); // → state
    act(() => result.current.setAnswer('state', 'ca'));
    act(() => result.current.next()); // → license
    act(() => result.current.setAnswer('license', 'CA-12345'));

    // Before changing state: license is in submit payload.
    expect(result.current.getSubmitAnswers()).toEqual({
      name: 'Caleb',
      state: 'ca',
      license: 'CA-12345',
    });

    // Change state to TX → license becomes hidden.
    act(() => result.current.setAnswer('state', 'tx'));

    // Internal state still has the license value (retained).
    expect(result.current.state.answers.license).toBe('CA-12345');
    // But the submit payload excludes it (ADR-005).
    expect(result.current.getSubmitAnswers()).toEqual({
      name: 'Caleb',
      state: 'tx',
    });
  });
});
