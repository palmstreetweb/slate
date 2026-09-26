/**
 * Delight pass 1 (ADR-059): question hand-off, choice commit, invalid-input
 * shake, completion celebration, progress spark, counter roll and the
 * self-drawing decorations. jsdom runs no CSS animations, so these tests pin
 * the DOM contract the CSS keys on, the timing and focus rules, and the
 * reduced-motion fallbacks.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { Form, defineSchema } from '@/index.js';
import type { Schema } from '@/types/Schema.js';
import { ReducedMotionOverrideContext } from '@/hooks/useReducedMotion.js';
import { ProgressBar } from '@/components/chrome/ProgressBar.js';
import { FooterCounter } from '@/components/chrome/FooterCounter.js';
import { ConstellationDecoration } from '@/components/decorations/ConstellationDecoration.js';
import { GrowthDecoration } from '@/components/decorations/GrowthDecoration.js';
import { AuroraDecoration } from '@/components/decorations/AuroraDecoration.js';
import { SwissDecoration } from '@/components/decorations/SwissDecoration.js';
import { LEAVE_MAX_MS } from '@/utils/questionHandoff.js';
import { shakeInvalid } from '@/utils/motion.js';
import * as pixieMallet from '@/utils/pixieMallet.js';
import { playFormFinale } from '@/utils/formSounds.js';

function calm(children: ReactNode) {
  return (
    <ReducedMotionOverrideContext.Provider value={true}>{children}</ReducedMotionOverrideContext.Provider>
  );
}

function textSchema() {
  return defineSchema({
    brand: { name: 'Motion Co' },
    theme: 'classic',
    themeMode: 'light',
    questions: [
      { id: 'welcome', type: 'welcome', title: 'Hey there.', cta: 'Start' },
      { id: 'name', type: 'short_text', title: 'Your name?', required: true },
      { id: 'email', type: 'email', title: 'Your email?', required: true },
      { id: 'done', type: 'thanks', title: 'All set.' },
    ],
  });
}

function choiceSchema() {
  return defineSchema({
    brand: { name: 'Motion Co' },
    theme: 'classic',
    themeMode: 'light',
    questions: [
      {
        id: 'service',
        type: 'single_choice',
        title: 'Which service?',
        options: [
          { label: 'Sealcoating', value: 'sealcoat' },
          { label: 'Striping', value: 'striping' },
          { label: 'Repair', value: 'repair' },
        ],
      },
      { id: 'name', type: 'short_text', title: 'Your name?' },
      { id: 'done', type: 'thanks', title: 'All set.' },
    ],
  });
}

function thanksOnly(theme: string, extra: Partial<Schema> = {}): Schema {
  return {
    brand: { name: 'Motion Co' },
    theme,
    themeMode: 'light',
    questions: [
      { id: 'q', type: 'yes_no', title: 'Ready?' },
      { id: 'done', type: 'thanks', title: 'All set.' },
    ],
    ...extra,
  } as Schema;
}

function leavingCopy(container: HTMLElement): HTMLElement | null {
  return container.querySelector('.slate-q-leave');
}

describe('question hand-off (brief §10.2 outgoing 220ms)', () => {
  it('keeps the outgoing question as an inert, aria-hidden copy, then removes it', async () => {
    const user = userEvent.setup();
    const { container } = render(<Form schema={textSchema()} onSubmit={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /start/i }));
    await screen.findByText('Your name?');

    const leaving = leavingCopy(container);
    expect(leaving).not.toBeNull();
    expect(leaving).toHaveAttribute('aria-hidden', 'true');
    expect(leaving).toHaveAttribute('inert');
    expect(leaving).toHaveClass('slate-q-leave');
    expect(leaving).not.toHaveClass('slate-q-enter');
    expect(leaving).toHaveAttribute('data-direction', 'forward');
    expect(leaving!.textContent).toContain('Hey there.');
    // It sits in the stage's own host, never outside the wrapper.
    expect(leaving!.closest('.slate-q-leave-host')).not.toBeNull();
    expect(leaving!.closest('[data-slate-forms]')).not.toBeNull();
    // Screen readers and role queries only ever see the live question.
    expect(screen.queryByRole('button', { name: /start/i })).not.toBeInTheDocument();

    await waitFor(() => expect(leavingCopy(container)).toBeNull(), {
      timeout: LEAVE_MAX_MS + 400,
    });
  });

  it('strips ids and names so the copy never collides with the live question', async () => {
    const user = userEvent.setup();
    const { container } = render(<Form schema={textSchema()} onSubmit={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /start/i }));
    await user.type(await screen.findByRole('textbox'), 'Caleb');
    await user.keyboard('{Enter}');
    await screen.findByText('Your email?');

    const leaving = leavingCopy(container)!;
    expect(leaving.querySelectorAll('[id], [name], [for]')).toHaveLength(0);
    // The typed value survives into the copy, so the field doesn't blank out.
    expect((leaving.querySelector('input') as HTMLInputElement).value).toBe('Caleb');
  });

  it('never holds focus: the next input is focused ~380ms in (brief §10.5)', async () => {
    const user = userEvent.setup();
    const { container } = render(<Form schema={textSchema()} onSubmit={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /start/i }));
    await user.type(await screen.findByRole('textbox'), 'Caleb');
    await user.keyboard('{Enter}');
    await screen.findByText('Your email?');

    const leaving = leavingCopy(container)!;
    expect(leaving.contains(document.activeElement)).toBe(false);

    const email = screen.getByRole('textbox');
    await waitFor(() => expect(email).toHaveFocus(), { timeout: 1000 });
    expect(leaving.contains(document.activeElement)).toBe(false);
  });

  it('marks backward exits so they leave downward', async () => {
    const user = userEvent.setup();
    const { container } = render(<Form schema={textSchema()} onSubmit={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /start/i }));
    await screen.findByText('Your name?');
    await user.click(screen.getByRole('button', { name: /back/i }));
    await screen.findByText('Hey there.');
    expect(leavingCopy(container)).toHaveAttribute('data-direction', 'backward');
  });

  it('swaps instantly with no copy under reduced motion', async () => {
    const user = userEvent.setup();
    const { container } = render(calm(<Form schema={textSchema()} onSubmit={vi.fn()} />));
    expect(container.querySelector('[data-slate-forms]')).toHaveAttribute('data-reduced-motion');
    await user.click(screen.getByRole('button', { name: /start/i }));
    await screen.findByText('Your name?');
    expect(leavingCopy(container)).toBeNull();
  });
});

describe('choice commit', () => {
  it('flips the picked badge to a check and marks the others to step back', async () => {
    const user = userEvent.setup();
    const { container } = render(<Form schema={choiceSchema()} onSubmit={vi.fn()} />);

    await user.click(screen.getByRole('radio', { name: /striping/i }));

    const group = container.querySelector('.slate-stage-content .slate-choices')!;
    expect(group).toHaveClass('slate-choices--committed');
    const picked = screen.getByRole('radio', { name: /striping/i });
    expect(picked).toHaveClass('slate-choice--committed');
    expect(picked.querySelector('.slate-badge-check')).not.toBeNull();
    // The letter is still there for the flip's first half.
    expect(picked.querySelector('.slate-badge-key')).toHaveTextContent('B');
    for (const name of [/sealcoating/i, /repair/i]) {
      const other = screen.getByRole('radio', { name });
      expect(other).not.toHaveClass('slate-choice--committed');
      expect(other.querySelector('.slate-badge-check')).toBeNull();
    }
    // Still auto-advances after the beat.
    expect(await screen.findByText('Your name?')).toBeInTheDocument();
  });

  it('commits from a letter key too', async () => {
    const user = userEvent.setup();
    render(<Form schema={choiceSchema()} onSubmit={vi.fn()} />);
    await user.keyboard('c');
    expect(screen.getByRole('radio', { name: /repair/i })).toHaveClass('slate-choice--committed');
  });

  it('does not replay the beat for an answer that was already selected (Back)', async () => {
    const user = userEvent.setup();
    const { container } = render(<Form schema={choiceSchema()} onSubmit={vi.fn()} />);
    await user.click(screen.getByRole('radio', { name: /striping/i }));
    await screen.findByText('Your name?');
    await user.click(screen.getByRole('button', { name: /back/i }));
    await screen.findByText('Which service?');

    const live = container.querySelector('.slate-stage-content')!;
    expect(live.querySelector('.slate-choices--committed')).toBeNull();
    expect(screen.getByRole('radio', { name: /striping/i })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });
});

describe('invalid input', () => {
  let animate: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    animate = vi.fn();
    (HTMLElement.prototype as unknown as { animate: unknown }).animate = animate;
  });
  afterEach(() => {
    delete (HTMLElement.prototype as unknown as { animate?: unknown }).animate;
  });

  it('shakes the field by 3px on every failed attempt', async () => {
    const user = userEvent.setup();
    render(<Form schema={textSchema()} onSubmit={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /start/i }));
    const input = await screen.findByRole('textbox');

    animate.mockClear();
    await user.click(screen.getByRole('button', { name: /ok/i }));
    expect(await screen.findByText(/please fill this in/i)).toBeInTheDocument();
    expect(animate).toHaveBeenCalledTimes(1);
    expect(animate.mock.contexts[0]).toBe(input);
    const frames = animate.mock.calls[0]![0] as Keyframe[];
    expect(frames.map((f) => f.transform)).toContain('translateX(-3px)');

    // Same error again: the message doesn't change, the shake still replays.
    await user.click(screen.getByRole('button', { name: /ok/i }));
    expect(animate).toHaveBeenCalledTimes(2);
  });

  it('does not shake under reduced motion', async () => {
    const user = userEvent.setup();
    render(calm(<Form schema={textSchema()} onSubmit={vi.fn()} />));
    await user.click(screen.getByRole('button', { name: /start/i }));
    await screen.findByRole('textbox');
    animate.mockClear();
    await user.click(screen.getByRole('button', { name: /ok/i }));
    await screen.findByText(/please fill this in/i);
    expect(animate).not.toHaveBeenCalled();
  });

  it('shakeInvalid is a safe no-op without the Web Animations API', () => {
    delete (HTMLElement.prototype as unknown as { animate?: unknown }).animate;
    expect(() => shakeInvalid(document.createElement('div'))).not.toThrow();
    expect(() => shakeInvalid(null)).not.toThrow();
  });
});

describe('completion celebration', () => {
  function deferred() {
    let resolve!: () => void;
    let reject!: (e: Error) => void;
    const promise = new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  async function reachThanks(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('radio', { name: /yes/i }));
    await screen.findByText('All set.');
  }

  it('waits for submit success: no chip, no confetti, bar held below 100 while submitting', async () => {
    const user = userEvent.setup();
    const submit = deferred();
    const { container } = render(
      <Form schema={thanksOnly('constellation')} onSubmit={() => submit.promise} />,
    );
    await reachThanks(user);

    expect(await screen.findByText(/submitting/i)).toBeInTheDocument();
    expect(container.querySelector('.slate-confetti')).toBeNull();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
    expect(screen.getByTestId('slate-constellation-decoration')).not.toHaveClass(
      'slate-decoration--complete',
    );

    await act(async () => submit.resolve());

    expect(await screen.findByText(/response received/i)).toBeInTheDocument();
    expect(container.querySelectorAll('.slate-confetti-piece')).toHaveLength(14);
    expect(container.querySelector('.slate-confirm-check')).not.toBeNull();
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '100');
    expect(bar).toHaveClass('slate-progress--complete');
    // Narrative decoration finishes its picture: the whole star map lights.
    const map = screen.getByTestId('slate-constellation-decoration');
    expect(map).toHaveClass('slate-decoration--complete');
    expect(map.querySelectorAll('.slate-deco-star')).toHaveLength(14);
  });

  it('announces success in one persistent polite live region', async () => {
    const user = userEvent.setup();
    const submit = deferred();
    const { container } = render(
      <Form schema={thanksOnly('classic')} onSubmit={() => submit.promise} />,
    );
    await reachThanks(user);
    const region = container.querySelector('.slate-thanks-status')!;
    expect(region).toHaveAttribute('aria-live', 'polite');
    await act(async () => submit.resolve());
    await screen.findByText(/response received/i);
    expect(container.querySelector('.slate-thanks-status')).toBe(region);
    expect(region).toHaveTextContent(/response received/i);
    // Confetti is decoration: hidden from assistive tech.
    expect(region.querySelector('.slate-confetti')).toHaveAttribute('aria-hidden', 'true');
  });

  it('does not celebrate a failed submit', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <Form
        schema={thanksOnly('bloom')}
        onSubmit={() => Promise.reject(new Error('Server exploded'))}
      />,
    );
    await reachThanks(user);
    expect(await screen.findByText('Server exploded')).toBeInTheDocument();
    expect(container.querySelector('.slate-confetti')).toBeNull();
    expect(container.querySelector('.slate-deco-bloom')).toBeNull();
    expect(screen.getByRole('progressbar')).not.toHaveClass('slate-progress--complete');
  });

  it('keeps a static check and skips the confetti under reduced motion', async () => {
    const user = userEvent.setup();
    const { container } = render(
      calm(<Form schema={thanksOnly('swiss')} onSubmit={vi.fn().mockResolvedValue(undefined)} />),
    );
    await reachThanks(user);
    expect(await screen.findByText(/response received/i)).toBeInTheDocument();
    expect(container.querySelector('.slate-confirm-check')).not.toBeNull();
    expect(container.querySelector('.slate-confetti')).toBeNull();
  });

  it('plays the finale chord once on success, only when sound is on', async () => {
    const spy = vi.spyOn(pixieMallet, 'playSound').mockImplementation(() => {});
    const user = userEvent.setup();
    render(
      <Form
        schema={thanksOnly('classic', { sound: 'marimba' })}
        onSubmit={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    await reachThanks(user);
    await screen.findByText(/response received/i);
    const finales = spy.mock.calls.filter(([, recipe]) => (recipe?.duration ?? 0) > 1);
    expect(finales).toHaveLength(1);
    spy.mockRestore();
  });

  it('stays silent when the form has no sound', async () => {
    const spy = vi.spyOn(pixieMallet, 'playSound').mockImplementation(() => {});
    const user = userEvent.setup();
    render(<Form schema={thanksOnly('classic')} onSubmit={vi.fn().mockResolvedValue(undefined)} />);
    await reachThanks(user);
    await screen.findByText(/response received/i);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('playFormFinale is a no-op when off', () => {
    const spy = vi.spyOn(pixieMallet, 'playSound').mockImplementation(() => {});
    playFormFinale('off');
    playFormFinale(undefined);
    expect(spy).not.toHaveBeenCalled();
    playFormFinale(true);
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });
});

describe('progress spark + counter roll', () => {
  afterEach(() => {
    delete (HTMLElement.prototype as unknown as { animate?: unknown }).animate;
  });

  it('moves the fill by scaleX, not width', () => {
    const { container } = render(<ProgressBar value={40} />);
    const bar = container.querySelector<HTMLElement>('.slate-progress-bar')!;
    expect(bar.style.transform).toBe('scaleX(0.4)');
    expect(bar.style.width).toBe('');
    expect(container.querySelector<HTMLElement>('.slate-progress-spark')!.style.transform).toBe(
      'translateX(-60%)',
    );
  });

  it('flares the tip on advance only', () => {
    const animate = vi.fn();
    (HTMLElement.prototype as unknown as { animate: unknown }).animate = animate;
    const { rerender } = render(<ProgressBar value={20} />);
    expect(animate).not.toHaveBeenCalled();
    rerender(<ProgressBar value={40} />);
    expect(animate).toHaveBeenCalledTimes(1);
    rerender(<ProgressBar value={20} />);
    expect(animate).toHaveBeenCalledTimes(1);
  });

  it('never flares under reduced motion', () => {
    const animate = vi.fn();
    (HTMLElement.prototype as unknown as { animate: unknown }).animate = animate;
    const { rerender } = render(calm(<ProgressBar value={20} />));
    rerender(calm(<ProgressBar value={60} />));
    expect(animate).not.toHaveBeenCalled();
  });

  it('rolls the counter up going forward and down going back', () => {
    const { container, rerender } = render(<FooterCounter current={1} total={5} />);
    expect(container.querySelector('.slate-footer')).toHaveTextContent('1 / 5');
    rerender(<FooterCounter current={2} total={5} />);
    expect(container.querySelector('.slate-footer-num')).toHaveAttribute('data-roll', 'up');
    expect(container.querySelector('.slate-footer')).toHaveTextContent('2 / 5');
    rerender(<FooterCounter current={1} total={5} />);
    expect(container.querySelector('.slate-footer-num')).toHaveAttribute('data-roll', 'down');
  });
});

describe('self-drawing decorations', () => {
  it('constellation: every connector is dash-drawn and only new ones are staggered', () => {
    const { container, rerender } = render(<ConstellationDecoration step={2} />);
    const lines = () => Array.from(container.querySelectorAll<SVGLineElement>('.slate-deco-draw'));
    expect(lines()).toHaveLength(2);
    for (const l of lines()) {
      expect(Number(l.getAttribute('stroke-dasharray'))).toBeGreaterThan(0);
    }
    rerender(<ConstellationDecoration step={3} />);
    const [first, second, third] = lines();
    // Already-drawn lines keep a zero delay, so they never re-run.
    expect(first!.style.getPropertyValue('--slate-draw-delay')).toBe('0ms');
    expect(second!.style.getPropertyValue('--slate-draw-delay')).toBe('0ms');
    expect(third!.style.getPropertyValue('--slate-draw-delay')).toBe('0ms');
    rerender(<ConstellationDecoration step={3} complete />);
    const all = lines();
    expect(all).toHaveLength(13);
    expect(all[4]!.style.getPropertyValue('--slate-draw-delay')).toBe('110ms');
  });

  it('bloom: complete opens three flowers; before that a bud sits at the tip', () => {
    const { container, rerender } = render(<GrowthDecoration step={1} />);
    expect(container.querySelectorAll('.slate-deco-bloom')).toHaveLength(0);
    expect(container.querySelectorAll('.slate-deco-grow').length).toBeGreaterThan(0);
    rerender(<GrowthDecoration step={1} complete />);
    expect(container.querySelectorAll('.slate-deco-bloom')).toHaveLength(3);
  });

  it('aurora: cross-fades by layering the new scene over the old, then drops the old', async () => {
    vi.useFakeTimers();
    try {
      const { container, rerender } = render(
        <div data-slate-forms="">
          <AuroraDecoration step={0} />
        </div>,
      );
      expect(container.querySelectorAll('svg.slate-decoration')).toHaveLength(1);
      rerender(
        <div data-slate-forms="">
          <AuroraDecoration step={1} />
        </div>,
      );
      const layers = container.querySelectorAll('svg.slate-decoration');
      expect(layers).toHaveLength(2);
      expect(layers[1]).toHaveClass('slate-deco-fade-in');
      expect(screen.getAllByTestId('slate-aurora-decoration')).toHaveLength(1);
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });
      expect(container.querySelectorAll('svg.slate-decoration')).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('aurora: swaps instantly under reduced motion', () => {
    const { container, rerender } = render(calm(<AuroraDecoration step={0} />));
    rerender(calm(<AuroraDecoration step={1} />));
    expect(container.querySelectorAll('svg.slate-decoration')).toHaveLength(1);
  });

  it('swiss: each composition remounts as a scene so its shapes slide in', () => {
    const { container, rerender } = render(<SwissDecoration step={0} />);
    const first = container.querySelector('.slate-deco-scene');
    expect(first).not.toBeNull();
    rerender(<SwissDecoration step={1} />);
    const second = container.querySelector('.slate-deco-scene');
    expect(second).not.toBe(first);
  });
});

describe('wrapper scope', () => {
  it('never writes motion state to <html>', async () => {
    const before = document.documentElement.getAttributeNames().sort();
    render(<Form schema={thanksOnly('memphis')} onSubmit={vi.fn().mockResolvedValue(undefined)} />);
    fireEvent.click(screen.getByRole('radio', { name: /yes/i }));
    await screen.findByText(/response received/i);
    expect(document.documentElement.getAttributeNames().sort()).toEqual(before);
  });
});
