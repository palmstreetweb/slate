import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, renderHook, screen } from '@testing-library/react';

const state = vi.hoisted(() => ({
  index: [] as Array<{ id: string; formId: string; receivedAt: string }>,
  subsListener: null as null | (() => void),
  // Stable like the real provider's API; a fresh object per render would
  // re-run StudioInbox's ingest effect forever.
  toast: { push: () => {} },
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
vi.mock('../examples/_admin/uiSounds.js', () => ({ playUiSound: vi.fn() }));
vi.mock('../examples/_admin/toast.js', () => ({ useToast: () => state.toast }));
vi.mock('../examples/_admin/_router.js', () => ({ navigate: vi.fn() }));

import {
  KNOWN_KEY,
  UNREAD_KEY,
  hasKnown,
  markRead,
  markUnread,
  readKnown,
  readUnread,
  setUnread,
  subscribeUnread,
  useUnread,
  writeKnown,
} from '../examples/_admin/responses/unreadStore.js';
import { StudioInbox } from '../examples/_admin/shell/StudioInbox.js';

beforeEach(() => {
  window.localStorage.clear();
  state.index = [];
  state.subsListener = null;
});

function otherTabWrites(ids: string[] | null) {
  if (ids === null) window.localStorage.removeItem(UNREAD_KEY);
  else window.localStorage.setItem(UNREAD_KEY, JSON.stringify(ids));
  window.dispatchEvent(new StorageEvent('storage', { key: UNREAD_KEY }));
}

describe('unread store', () => {
  it('keeps the storage keys the bell has always used', () => {
    expect(KNOWN_KEY).toBe('slate-admin-known-subs');
    expect(UNREAD_KEY).toBe('slate-admin-unread-subs');
  });

  it('markUnread prepends without duplicates; markRead removes', () => {
    setUnread(['a', 'b']);
    markUnread('c');
    expect(readUnread()).toEqual(['c', 'a', 'b']);
    markUnread('b');
    expect(readUnread()).toEqual(['b', 'c', 'a']);
    markRead(['c', 'zzz']);
    expect(readUnread()).toEqual(['b', 'a']);
  });

  it('caps unread at 200 (newest kept) and known at 2000', () => {
    const many = Array.from({ length: 250 }, (_, i) => `u${i}`);
    setUnread(many);
    expect(readUnread()).toHaveLength(200);
    expect(readUnread()[0]).toBe('u0');
    markUnread('fresh');
    expect(readUnread()).toHaveLength(200);
    expect(readUnread()[0]).toBe('fresh');

    writeKnown(Array.from({ length: 2100 }, (_, i) => `k${i}`));
    expect(readKnown()).toHaveLength(2000);
  });

  it('hasKnown is false until the first seed, even for an empty list', () => {
    expect(hasKnown()).toBe(false);
    writeKnown([]);
    expect(hasKnown()).toBe(true);
    expect(readKnown()).toEqual([]);
  });

  it('survives corrupt or foreign values', () => {
    window.localStorage.setItem(UNREAD_KEY, '{not json');
    expect(readUnread()).toEqual([]);
    window.localStorage.setItem(UNREAD_KEY, JSON.stringify(['a', 3, null, 'b']));
    expect(readUnread()).toEqual(['a', 'b']);
  });

  it('notifies same-tab listeners on real changes only', () => {
    const fn = vi.fn();
    const off = subscribeUnread(fn);
    setUnread(['a']);
    markUnread('b');
    markRead(['a']);
    expect(fn).toHaveBeenCalledTimes(3);
    markRead(['not-there']);
    markRead([]);
    markUnread('b'); // already first
    expect(fn).toHaveBeenCalledTimes(3);
    off();
    setUnread([]);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('hears other tabs through the storage event', () => {
    const fn = vi.fn();
    const off = subscribeUnread(fn);
    otherTabWrites(['x']);
    window.dispatchEvent(new StorageEvent('storage', { key: 'slate-theme' }));
    window.dispatchEvent(new StorageEvent('storage', { key: null }));
    expect(fn).toHaveBeenCalledTimes(2);
    off();
  });
});

describe('useUnread', () => {
  it('stays live for this tab and other tabs, with a stable Set between changes', () => {
    setUnread(['a']);
    const { result, rerender } = renderHook(() => useUnread());
    expect([...result.current]).toEqual(['a']);

    const first = result.current;
    rerender();
    expect(result.current).toBe(first);

    act(() => markUnread('b'));
    expect([...result.current]).toEqual(['b', 'a']);

    act(() => otherTabWrites(['z']));
    expect([...result.current]).toEqual(['z']);

    act(() => otherTabWrites(null));
    expect(result.current.size).toBe(0);
  });
});

describe('notifications bell shares the store', () => {
  const entry = (id: string) => ({ id, formId: 'f1', receivedAt: new Date().toISOString() });

  it('clears its badge live when the Responses page marks responses read', () => {
    state.index = [entry('a'), entry('b')];
    writeKnown(['a', 'b']);
    setUnread(['a', 'b']);
    render(createElement(StudioInbox));
    expect(screen.getByRole('button', { name: 'Notifications, 2 new' })).toBeInTheDocument();

    act(() => markRead(['a']));
    expect(screen.getByRole('button', { name: 'Notifications, 1 new' })).toBeInTheDocument();

    act(() => markRead(['b']));
    expect(screen.getByRole('button', { name: 'Notifications' })).toBeInTheDocument();
  });

  it('marks new arrivals unread, which the page then sees', () => {
    state.index = [entry('a')];
    writeKnown(['a']);
    const page = renderHook(() => useUnread());
    render(createElement(StudioInbox));
    expect(page.result.current.size).toBe(0);

    state.index = [entry('n'), entry('a')];
    act(() => state.subsListener?.());
    expect([...page.result.current]).toEqual(['n']);
    expect(readKnown()).toEqual(['n', 'a']);
    expect(screen.getByRole('button', { name: 'Notifications, 1 new' })).toBeInTheDocument();
  });

  it('seeds silently on first run: existing responses are not "new"', () => {
    state.index = [entry('a'), entry('b')];
    render(createElement(StudioInbox));
    expect(readKnown()).toEqual(['a', 'b']);
    expect(readUnread()).toEqual([]);
  });
});
