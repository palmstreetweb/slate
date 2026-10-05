/**
 * Delight passes 4 + 5, studio side (ADR-060): publish ignition, the Draft →
 * Live flip, arrivals (bell swing, row wash), the first-response toast, the
 * odometer and count-up, reveal-on-view, and the calm-motion paths.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, renderHook, screen } from '@testing-library/react';
import { useState } from 'react';

const sounds = vi.hoisted(() => ({ play: vi.fn() }));

vi.mock('../examples/_admin/neon/env.js', () => ({ isNeonConfigured: () => false }));
vi.mock('../examples/_admin/uiSounds.js', () => ({ playUiSound: sounds.play }));
vi.mock('../examples/_admin/_router.js', () => ({ navigate: vi.fn() }));
vi.mock('../examples/_admin/neon/formsRemote.js', () => ({ refreshFormsRemote: vi.fn() }));
vi.mock('../examples/_admin/neon/submissionsRemote.js', () => ({
  refreshSubmissionsRemote: vi.fn(),
}));
vi.mock('../examples/_admin/_formsStore.js', () => ({
  getForm: (id: string) => ({
    id,
    name: id === 'f1' ? 'Spring intake' : 'Other form',
    schema: { questions: [] },
  }),
  listForms: () => [],
}));

import {
  IGNITION_HOLD_MS,
  IGNITION_LEAVE_MS,
  IGNITION_SPIN_MS,
  FlipPill,
  PublishButton,
  usePublishIgnition,
} from '../examples/_admin/delight/ignition.js';
import { Odometer, odometerReels } from '../examples/_admin/delight/Odometer.js';
import { CountUp, countFrame, easeOutCubic } from '../examples/_admin/delight/CountUp.js';
import {
  ARRIVAL_WINDOW_MS,
  isArrival,
  noteArrivals,
  resetArrivals,
} from '../examples/_admin/delight/arrivals.js';
import {
  FIRST_RESPONSE_KEY,
  firstResponseForms,
  hasCelebratedFirst,
  markFirstCelebrated,
} from '../examples/_admin/delight/firstResponse.js';
import { useReveal } from '../examples/_admin/delight/useReveal.js';
import { ToastProvider, useToast } from '../examples/_admin/toast.js';
import { StudioInbox } from '../examples/_admin/shell/StudioInbox.js';
import { addSubmission, resetSubmissionsStorage } from '../examples/_admin/_submissionStore.js';
import { writeKnown } from '../examples/_admin/responses/unreadStore.js';

function meta() {
  const now = new Date();
  return {
    startedAt: now,
    completedAt: now,
    durationMs: 1000,
    questionsVisited: [],
    hiddenFields: {},
    score: 0,
  } as unknown as Parameters<typeof addSubmission>[2];
}

/** Makes `prefers-reduced-motion: reduce` match (or not) for the next renders. */
function setOsReduce(reduce: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: reduce && query.includes('reduce'),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  window.localStorage.clear();
  resetArrivals();
  sounds.play.mockClear();
  setOsReduce(false);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('publish ignition', () => {
  it('publishes at once, then plays spinner → check → bow-out → idle', () => {
    vi.useFakeTimers();
    const publish = vi.fn(() => true);
    const onLive = vi.fn();
    const { result } = renderHook(() => usePublishIgnition());

    let ok = false;
    act(() => {
      ok = result.current.start(publish, { onLive });
    });
    expect(ok).toBe(true);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(result.current.phase).toBe('working');
    expect(onLive).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(IGNITION_SPIN_MS));
    expect(result.current.phase).toBe('done');
    expect(onLive).toHaveBeenCalledTimes(1);

    act(() => vi.advanceTimersByTime(IGNITION_HOLD_MS));
    expect(result.current.phase).toBe('leaving');
    act(() => vi.advanceTimersByTime(IGNITION_LEAVE_MS));
    expect(result.current.phase).toBe('idle');
  });

  it('stays idle and skips onLive when publishing fails', () => {
    vi.useFakeTimers();
    const onLive = vi.fn();
    const { result } = renderHook(() => usePublishIgnition());
    let ok = true;
    act(() => {
      ok = result.current.start(() => false, { onLive });
    });
    expect(ok).toBe(false);
    act(() => vi.advanceTimersByTime(5000));
    expect(result.current.phase).toBe('idle');
    expect(onLive).not.toHaveBeenCalled();
  });

  it('still says "live" if the button unmounts during the spinner', () => {
    vi.useFakeTimers();
    const onLive = vi.fn();
    const { result, unmount } = renderHook(() => usePublishIgnition());
    act(() => {
      result.current.start(() => true, { onLive });
    });
    unmount();
    act(() => vi.advanceTimersByTime(IGNITION_SPIN_MS + IGNITION_HOLD_MS + 500));
    expect(onLive).toHaveBeenCalledTimes(1);
  });

  it('with calm motion jumps straight to the check and never bows out', () => {
    vi.useFakeTimers();
    setOsReduce(true);
    const onLive = vi.fn();
    const { result } = renderHook(() => usePublishIgnition());
    act(() => {
      result.current.start(() => true, { onLive });
    });
    expect(result.current.phase).toBe('done');
    expect(onLive).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(IGNITION_HOLD_MS));
    expect(result.current.phase).toBe('idle');
  });

  it('a cloud publish holds “Publishing…” until its write lands, then the check (STU-5)', async () => {
    vi.useFakeTimers();
    const onLive = vi.fn();
    const onFailed = vi.fn();
    let land = () => {};
    const landed = new Promise<void>((resolve) => {
      land = resolve;
    });
    const { result } = renderHook(() => usePublishIgnition());
    act(() => {
      result.current.start(() => landed, { onLive, onFailed });
    });
    expect(result.current.phase).toBe('working');
    // Past the spinner beat, the write is still out: no check, no "You're live".
    await act(() => vi.advanceTimersByTimeAsync(1500));
    expect(result.current.phase).toBe('working');
    expect(onLive).not.toHaveBeenCalled();
    await act(async () => land());
    expect(result.current.phase).toBe('done');
    expect(onLive).toHaveBeenCalledTimes(1);
    expect(onFailed).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(IGNITION_HOLD_MS + IGNITION_LEAVE_MS));
    expect(result.current.phase).toBe('idle');
  });

  it('a write that lands at once still plays the spinner beat before the check', async () => {
    vi.useFakeTimers();
    const onLive = vi.fn();
    const { result } = renderHook(() => usePublishIgnition());
    act(() => {
      result.current.start(() => Promise.resolve(), { onLive });
    });
    await act(() => vi.advanceTimersByTimeAsync(IGNITION_SPIN_MS - 20));
    expect(onLive).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(40));
    expect(onLive).toHaveBeenCalledTimes(1);
  });

  it('a write that fails after the spinner beat never says live (normal motion, 1 s)', async () => {
    vi.useFakeTimers();
    const onLive = vi.fn();
    const onFailed = vi.fn();
    const { result } = renderHook(() => usePublishIgnition());
    act(() => {
      result.current.start(
        () =>
          new Promise<void>((_, reject) => setTimeout(() => reject(new Error('offline')), 1020)),
        { onLive, onFailed },
      );
    });
    await act(() => vi.advanceTimersByTimeAsync(3000));
    expect(onLive).not.toHaveBeenCalled();
    expect(onFailed).toHaveBeenCalledTimes(1);
    expect(result.current.phase).toBe('idle');
  });

  it('with calm motion a failing write never says live either (50 ms)', async () => {
    vi.useFakeTimers();
    setOsReduce(true);
    const onLive = vi.fn();
    const onFailed = vi.fn();
    const { result } = renderHook(() => usePublishIgnition());
    act(() => {
      result.current.start(
        () => new Promise<void>((_, reject) => setTimeout(() => reject(new Error('offline')), 50)),
        { onLive, onFailed },
      );
    });
    // No spinner, but no check either: "Publishing…" holds still until the write is known.
    expect(result.current.phase).toBe('working');
    expect(onLive).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(onLive).not.toHaveBeenCalled();
    expect(onFailed).toHaveBeenCalledTimes(1);
    expect(result.current.phase).toBe('idle');
  });

  it('still says live once the write lands, if the button unmounted meanwhile', async () => {
    vi.useFakeTimers();
    const onLive = vi.fn();
    let land = () => {};
    const { result, unmount } = renderHook(() => usePublishIgnition());
    act(() => {
      result.current.start(
        () =>
          new Promise<void>((resolve) => {
            land = resolve;
          }),
        { onLive },
      );
    });
    unmount();
    await act(() => vi.advanceTimersByTimeAsync(IGNITION_SPIN_MS + 100));
    await act(async () => land());
    expect(onLive).toHaveBeenCalledTimes(1);
  });

  it('renders the phases as labels, with a glyph only while busy', () => {
    const { rerender } = render(
      <PublishButton phase="idle" onClick={() => {}}>
        Publish
      </PublishButton>,
    );
    const btn = screen.getByRole('button', { name: 'Publish' });
    expect(btn.querySelector('svg')).toBeNull();
    expect(btn).not.toBeDisabled();

    rerender(
      <PublishButton phase="working" onClick={() => {}}>
        Publish
      </PublishButton>,
    );
    expect(screen.getByRole('button', { name: 'Publishing…' })).toBeDisabled();
    expect(screen.getByRole('button')).toHaveAttribute('aria-busy', 'true');

    rerender(
      <PublishButton phase="done" onClick={() => {}}>
        Publish
      </PublishButton>,
    );
    const done = screen.getByRole('button', { name: 'Live' });
    expect(done).toHaveClass('slate-ignite--done');
    expect(done.querySelector('.slate-ignite-check')).not.toBeNull();
  });
});

describe('FlipPill', () => {
  it('never flips on first render, flips when the label changes', () => {
    const { container, rerender } = render(<FlipPill label="Draft" className="slate-pub-pill" />);
    expect(container.querySelector('.slate-flip-in')).toBeNull();
    rerender(<FlipPill label="Live" className="slate-pub-pill slate-pub-pill--live" />);
    expect(container.querySelector('.slate-flip-in')).toHaveTextContent('Live');
  });

  it('does not flip with calm motion', () => {
    setOsReduce(true);
    const { container, rerender } = render(<FlipPill label="Draft" className="p" />);
    rerender(<FlipPill label="Live" className="p" />);
    expect(container.querySelector('.slate-flip-in')).toBeNull();
    expect(container).toHaveTextContent('Live');
  });
});

describe('odometer', () => {
  it('builds reels that roll upward and wrap through 9 → 0', () => {
    expect(odometerReels(9, 12)).toEqual([
      ['', '1'],
      ['9', '0', '1', '2'],
    ]);
    expect(odometerReels(3, 4)).toEqual([['3', '4']]);
    expect(odometerReels(14, 15)).toEqual([['1'], ['4', '5']]);
    // Unchanged digits stay single; long reels are trimmed to 10.
    expect(odometerReels(0, 9)[0]).toHaveLength(10);
    expect(odometerReels(120, 121)).toEqual([['1'], ['2'], ['0', '1']]);
  });

  it('is plain text at rest and rolls only on an increase', () => {
    const { container, rerender } = render(<Odometer value={3} />);
    expect(container.querySelector('.slate-odo--rolling')).toBeNull();
    expect(container).toHaveTextContent('3');

    rerender(<Odometer value={4} />);
    const rolling = container.querySelector('.slate-odo--rolling');
    expect(rolling).not.toBeNull();
    // The true number is readable text; the reels are hidden from AT.
    expect(rolling!.querySelector('.slate-sr')).toHaveTextContent('4');
    expect(rolling!.querySelector('.slate-odo-digits')).toHaveAttribute('aria-hidden', 'true');

    rerender(<Odometer value={2} />);
    expect(container.querySelector('.slate-odo--rolling')).toBeNull();
    expect(container).toHaveTextContent('2');
  });

  it('never rolls inside a calm wrapper', () => {
    const Wrap = ({ n }: { n: number }) => (
      <div data-slate-forms="" data-reduced-motion="">
        <Odometer value={n} />
      </div>
    );
    const { container, rerender } = render(<Wrap n={1} />);
    rerender(<Wrap n={5} />);
    expect(container.querySelector('.slate-odo--rolling')).toBeNull();
    expect(container).toHaveTextContent('5');
  });
});

describe('count-up', () => {
  it('eases out and lands exactly on the value', () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5);
    expect(countFrame(0, 18, 0)).toBe(0);
    expect(countFrame(0, 18, 300)).toBeGreaterThan(9);
    expect(countFrame(0, 18, 600)).toBe(18);
    expect(countFrame(5, 2, 10_000)).toBe(2);
  });

  it('always exposes the true value to screen readers', () => {
    const { container } = render(<CountUp value={18} />);
    expect(container.querySelector('.slate-sr')).toHaveTextContent('18');
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });

  it('shows the value at once with calm motion', () => {
    setOsReduce(true);
    const { container } = render(<CountUp value={42} />);
    expect(container.querySelector('[aria-hidden="true"]')).toHaveTextContent('42');
  });
});

describe('reveal on view', () => {
  function Card() {
    const ref = useReveal<HTMLDivElement>();
    return <div ref={ref} data-testid="card" />;
  }

  it('marks the card revealed at once where IntersectionObserver is missing', () => {
    // jsdom has no IntersectionObserver: the bars must never stay hidden.
    render(<Card />);
    expect(screen.getByTestId('card')).toHaveAttribute('data-reveal', 'in');
  });

  it('holds the card pending until it intersects', () => {
    const observed: Element[] = [];
    let fire: (entries: Array<{ isIntersecting: boolean; target: Element }>) => void = () => {};
    class FakeIO {
      constructor(cb: typeof fire) {
        fire = cb;
      }
      observe(el: Element) {
        observed.push(el);
      }
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal('IntersectionObserver', FakeIO);
    try {
      render(<Card />);
      const card = screen.getByTestId('card');
      expect(card).toHaveAttribute('data-reveal', 'pending');
      expect(observed).toContain(card);
      act(() => fire([{ isIntersecting: true, target: card }]));
      expect(card).toHaveAttribute('data-reveal', 'in');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('arrivals', () => {
  it('counts a row as arrived for its 2 s wash only', () => {
    noteArrivals(['a'], 1000);
    expect(isArrival('a', 1000 + ARRIVAL_WINDOW_MS - 1)).toBe(true);
    expect(isArrival('a', 1000 + ARRIVAL_WINDOW_MS)).toBe(false);
    expect(isArrival('b', 1000)).toBe(false);
  });
});

describe('first response', () => {
  const index = [
    { id: 's3', formId: 'f2' },
    { id: 's2', formId: 'f1' },
    { id: 's1', formId: 'f2' },
  ];

  it('picks forms whose every response is new, once', () => {
    // f1 has only s2 (fresh) → first; f2 had s1 already → not first.
    expect(firstResponseForms(['s3', 's2'], index)).toEqual(['f1']);
    markFirstCelebrated(['f1']);
    expect(hasCelebratedFirst('f1')).toBe(true);
    expect(firstResponseForms(['s3', 's2'], index)).toEqual([]);
    expect(JSON.parse(window.localStorage.getItem(FIRST_RESPONSE_KEY)!)).toEqual(['f1']);
  });

  it('survives storage that throws or holds junk', () => {
    window.localStorage.setItem(FIRST_RESPONSE_KEY, '{not json');
    expect(hasCelebratedFirst('f1')).toBe(false);
    const get = vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const set = vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    try {
      expect(() => markFirstCelebrated(['f1'])).not.toThrow();
      expect(firstResponseForms(['s2'], index)).toEqual(['f1']);
    } finally {
      get.mockRestore();
      set.mockRestore();
    }
  });
});

describe('toasts', () => {
  function Push({ input }: { input: Parameters<ReturnType<typeof useToast>['push']>[0] }) {
    const toast = useToast();
    const [done, setDone] = useState(false);
    if (!done) {
      queueMicrotask(() => {
        toast.push(input);
      });
      setDone(true);
    }
    return null;
  }

  it('a celebrate toast carries the 1st medal and pass-1 confetti', async () => {
    render(
      <ToastProvider>
        <Push
          input={{ title: 'First response!', tone: 'success', sound: 'none', celebrate: true }}
        />
      </ToastProvider>,
    );
    const title = await screen.findByText('First response!');
    const toast = title.closest('.slate-toast')!;
    expect(toast).toHaveClass('slate-toast--celebrate');
    const medal = toast.querySelector('.slate-toast-medal')!;
    expect(medal).toHaveAttribute('aria-hidden', 'true');
    expect(medal.querySelectorAll('.slate-confetti .slate-confetti-piece').length).toBeGreaterThan(
      8,
    );
    // sound: 'none' is silent, even on a success toast.
    expect(sounds.play).not.toHaveBeenCalled();
  });
});

describe('StudioInbox arrivals', () => {
  beforeEach(() => {
    resetSubmissionsStorage();
    writeKnown([]);
  });

  it('rings the bell, marks the row arrived and celebrates a form’s first response once', async () => {
    const { container } = render(
      <ToastProvider>
        <StudioInbox />
      </ToastProvider>,
    );
    expect(container.querySelector('.slate-bell--swing')).toBeNull();

    let first = '';
    act(() => {
      first = addSubmission('f1', { name: 'Nora' }, meta()).id;
    });
    expect(container.querySelector('.slate-bell--swing')).not.toBeNull();
    expect(isArrival(first)).toBe(true);
    expect(await screen.findByText('First response!')).toBeInTheDocument();
    expect(screen.getByText('Spring intake just heard back.')).toBeInTheDocument();
    expect(sounds.play).toHaveBeenCalledWith('arrival');
    expect(hasCelebratedFirst('f1')).toBe(true);

    sounds.play.mockClear();
    const bellBefore = container.querySelector('.slate-bell');
    act(() => {
      addSubmission('f1', { name: 'Kai' }, meta());
    });
    // A second response rings again (new bell node) but never re-celebrates.
    expect(container.querySelector('.slate-bell')).not.toBe(bellBefore);
    expect(screen.getAllByText('First response!')).toHaveLength(1);
    expect(sounds.play).not.toHaveBeenCalledWith('arrival');
  });
});
