/**
 * Audit fixes (2026-10-09), studio B2: the bell remembers at most 2,000 response
 * ids. An account with more than that must not see the overflow come back as
 * "new" on every poll — ring, sound, toast and unread badge, with "Mark all
 * read" undone a minute later.
 */

import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';

const state = vi.hoisted(() => ({
  index: [] as Array<{ id: string; formId: string; receivedAt: string }>,
  subsListener: null as null | (() => void),
  toasts: [] as string[],
  toast: { push: (t: { title: string }) => state.toasts.push(t.title) },
  sound: vi.fn(),
}));

vi.mock('../examples/_admin/_submissionStore.js', () => ({
  listSubmissionIndex: () => state.index,
  getSubmission: () => undefined,
  subscribe: (fn: () => void) => {
    state.subsListener = fn;
    return () => {
      state.subsListener = null;
    };
  },
}));
vi.mock('../examples/_admin/_formsStore.js', () => ({
  listForms: () => [{ id: 'f1', name: 'Pool sign-up', schema: { questions: [] } }],
  getForm: () => ({ id: 'f1', name: 'Pool sign-up', schema: { questions: [] } }),
}));
vi.mock('../examples/_admin/neon/env.js', () => ({ isNeonConfigured: () => false }));
vi.mock('../examples/_admin/uiSounds.js', () => ({ playUiSound: state.sound }));
vi.mock('../examples/_admin/toast.js', () => ({ useToast: () => state.toast }));
vi.mock('../examples/_admin/_router.js', () => ({ navigate: vi.fn() }));
// localStorage-only mode reports hydrated at once, so the ingest after the
// seed announces like a live poll would.
vi.mock('../examples/_admin/delight/firstResponse.js', () => ({
  firstResponseForms: () => [],
  markFirstCelebrated: () => {},
}));

import {
  KNOWN_CAP,
  freshIds,
  readKnown,
  readUnread,
  writeKnown,
} from '../examples/_admin/responses/unreadStore.js';
import { StudioInbox } from '../examples/_admin/shell/StudioInbox.js';

const at = (minutesAgo: number) =>
  new Date(Date.UTC(2026, 9, 9, 12, 0) - minutesAgo * 60_000).toISOString();
const entry = (id: string, minutesAgo: number) => ({ id, formId: 'f1', receivedAt: at(minutesAgo) });
/** `n` responses, newest first, one a minute. */
const many = (n: number) => Array.from({ length: n }, (_, i) => entry(`r${i}`, i + 1));

beforeEach(() => {
  window.localStorage.clear();
  state.index = [];
  state.subsListener = null;
  state.toasts = [];
  state.sound.mockClear();
});

describe('more responses than the bell remembers (audit B2)', () => {
  it('seeds silently past the cap and finds nothing new on the next ingest', () => {
    state.index = many(KNOWN_CAP + 500);
    render(createElement(StudioInbox));
    expect(readKnown()).toHaveLength(KNOWN_CAP);
    expect(readUnread()).toEqual([]);

    act(() => state.subsListener?.());
    act(() => state.subsListener?.());
    expect(readUnread()).toEqual([]);
    expect(state.toasts).toEqual([]);
    expect(state.sound).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Notifications' })).toBeInTheDocument();
  });

  it('still announces a response that really is new, and only that one', () => {
    state.index = many(KNOWN_CAP + 500);
    render(createElement(StudioInbox));
    state.index = [entry('brand-new', 0.5), ...state.index];
    act(() => state.subsListener?.());
    expect(readUnread()).toEqual(['brand-new']);
    expect(screen.getByRole('button', { name: 'Notifications, 1 new' })).toBeInTheDocument();
    // The next ingest, with nothing newer, is quiet again.
    act(() => state.subsListener?.());
    expect(readUnread()).toEqual(['brand-new']);
    expect(readKnown()[0]).toBe('brand-new');
  });

  it('a known list that grew past the cap over time keeps the overflow known too', () => {
    // 1,900 known on this browser already; 300 arrive at once, then another poll.
    state.index = many(1900);
    writeKnown(state.index.map((e) => e.id));
    render(createElement(StudioInbox));
    const burst = Array.from({ length: 300 }, (_, i) => entry(`n${i}`, 0.001 * (i + 1)));
    state.index = [...burst, ...state.index];
    act(() => state.subsListener?.());
    expect(readUnread()).toHaveLength(200);
    expect(readKnown()).toHaveLength(KNOWN_CAP);
    state.toasts = [];
    act(() => state.subsListener?.());
    expect(state.toasts).toEqual([]);
    expect(readUnread()).toHaveLength(200);
  });
});

describe('freshIds', () => {
  it('treats ids at or before the floor as seen, even when the list forgot them', () => {
    const active = [entry('new', 1), entry('old', 50), entry('older', 60)];
    expect(freshIds(active, [], null)).toEqual(['new', 'old', 'older']);
    expect(freshIds(active, ['new'], at(50))).toEqual([]);
    expect(freshIds(active, [], at(50))).toEqual(['new']);
  });
});
