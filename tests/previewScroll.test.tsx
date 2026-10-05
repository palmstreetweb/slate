/**
 * Scrolling in previews and between questions (QA pass, 2026-10-04):
 * - the editor's live preview keeps the owner's picks, so a multi choice with
 *   a minimum can be tried without "Pick at least 2" over an empty list;
 * - a new question opens at its top when the page was scrolled past the form;
 * - a validation error under a long list is brought into view with OK.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Form, defineSchema } from '@/index.js';
import type { Question } from '@/types/Question.js';
import { shakeInvalid } from '@/utils/motion.js';
import { Canvas } from '../examples/_admin/components/Canvas.js';

// jsdom has no scrollIntoView; browsers do. Give the prototype one to spy on.
if (!HTMLElement.prototype.scrollIntoView) {
  HTMLElement.prototype.scrollIntoView = function scrollIntoView() {};
}

afterEach(() => {
  vi.restoreAllMocks();
});

function canvasSchema() {
  return defineSchema({
    brand: { name: 'Preview Co' },
    theme: 'classic',
    themeMode: 'light',
    questions: [
      {
        id: 'extras',
        type: 'multi_choice',
        title: 'Which extras?',
        min: 2,
        options: [
          { label: 'Crack fill', value: 'crack' },
          { label: 'Striping', value: 'stripe' },
          { label: 'Sealcoat', value: 'seal' },
        ],
      },
      { id: 'name', type: 'short_text', title: 'Your name?' },
      { id: 'done', type: 'thanks', title: 'All set.' },
    ],
  });
}

describe('editor live preview (Canvas)', () => {
  it('keeps picks, so a minimum can be met instead of erroring over an empty list', async () => {
    const user = userEvent.setup();
    const schema = canvasSchema();
    const q = schema.questions[0] as Question;
    const { container } = render(
      <Canvas formId="f_canvas_test" schema={schema} selectedQuestion={q} />,
    );

    // Multi choice loads on demand (ADR-069).
    await user.click(await screen.findByRole('checkbox', { name: /crack fill/i }));
    await user.click(screen.getByRole('checkbox', { name: /striping/i }));
    expect(screen.getByRole('checkbox', { name: /crack fill/i })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('checkbox', { name: /striping/i })).toHaveAttribute(
      'aria-checked',
      'true',
    );

    await user.click(screen.getByRole('button', { name: /^ok/i }));
    expect(container.querySelector('.slate-err')).toBeNull();
  });

  it('still says what is missing when the minimum is not met', async () => {
    const user = userEvent.setup();
    const schema = canvasSchema();
    const { container } = render(
      <Canvas formId="f_canvas_test" schema={schema} selectedQuestion={schema.questions[0] as Question} />,
    );
    await user.click(await screen.findByRole('checkbox', { name: /crack fill/i }));
    await user.click(screen.getByRole('button', { name: /^ok/i }));
    await waitFor(() =>
      expect(container.querySelector('.slate-err')).toHaveTextContent('Pick at least 2'),
    );
  });

  it('opens each selected question fresh and at its top', async () => {
    const user = userEvent.setup();
    const schema = canvasSchema();
    const { container, rerender } = render(
      <Canvas formId="f_canvas_test" schema={schema} selectedQuestion={schema.questions[0] as Question} />,
    );
    await user.click(await screen.findByRole('checkbox', { name: /crack fill/i }));
    const scroller = container.querySelector('.slate-canvas-frame > [data-slate-forms]') as HTMLElement;
    scroller.scrollTop = 400;

    rerender(
      <Canvas formId="f_canvas_test" schema={schema} selectedQuestion={schema.questions[1] as Question} />,
    );
    expect(scroller.scrollTop).toBe(0);
    rerender(
      <Canvas formId="f_canvas_test" schema={schema} selectedQuestion={schema.questions[0] as Question} />,
    );
    expect(screen.getByRole('checkbox', { name: /crack fill/i })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  it('lets the scroller be the frame height (min-height 0 beats the form’s 100vh)', () => {
    const schema = canvasSchema();
    const { container } = render(
      <Canvas formId="f_canvas_test" schema={schema} selectedQuestion={schema.questions[0] as Question} />,
    );
    const scroller = container.querySelector('.slate-canvas-frame > [data-slate-forms]') as HTMLElement;
    expect(scroller.style.minHeight).toBe('0px');
    expect(scroller.style.overflowY).toBe('auto');
  });
});

function twoStepSchema() {
  return defineSchema({
    brand: { name: 'Scroll Co' },
    theme: 'classic',
    themeMode: 'light',
    questions: [
      { id: 'name', type: 'short_text', title: 'Your name?', required: true },
      { id: 'email', type: 'email', title: 'Your email?', required: true },
      { id: 'done', type: 'thanks', title: 'All set.' },
    ],
  });
}

describe('a new question opens at its top', () => {
  it('scrolls the form back into view after a step when the page was scrolled past it', async () => {
    const user = userEvent.setup();
    const into = vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {});
    const { container } = render(<Form schema={twoStepSchema()} onSubmit={vi.fn()} />);
    expect(into).not.toHaveBeenCalled();

    const wrapper = container.querySelector('[data-slate-forms]') as HTMLElement;
    vi.spyOn(wrapper, 'getBoundingClientRect').mockReturnValue({ top: -900 } as DOMRect);
    await user.type(screen.getByRole('textbox'), 'Caleb');
    await user.keyboard('{Enter}');
    await screen.findByText('Your email?');
    expect(into.mock.contexts).toContain(wrapper);
  });

  it('leaves the page alone when the form is already in view', async () => {
    const user = userEvent.setup();
    const into = vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {});
    const { container } = render(<Form schema={twoStepSchema()} onSubmit={vi.fn()} />);
    const wrapper = container.querySelector('[data-slate-forms]') as HTMLElement;
    vi.spyOn(wrapper, 'getBoundingClientRect').mockReturnValue({ top: 0 } as DOMRect);
    await user.type(screen.getByRole('textbox'), 'Caleb');
    await user.keyboard('{Enter}');
    await screen.findByText('Your email?');
    expect(into.mock.contexts).not.toContain(wrapper);
  });
});

describe('errors are brought into view', () => {
  it('scrolls the OK row (with the message above it) into view', () => {
    const raf = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((cb: FrameRequestCallback) => {
        cb(0);
        return 0;
      });
    const stage = document.createElement('div');
    stage.className = 'slate-stage-content';
    stage.innerHTML =
      '<div class="field"></div><p class="slate-err">! Pick at least 2</p><div class="slate-actions"><button>OK</button></div>';
    document.body.appendChild(stage);
    const actions = stage.querySelector('.slate-actions') as HTMLElement;
    const into = vi.fn();
    actions.scrollIntoView = into;

    act(() => shakeInvalid(stage.querySelector('.field')));
    expect(raf).toHaveBeenCalled();
    expect(into).toHaveBeenCalledWith({ block: 'nearest' });
    stage.remove();
  });

  it('falls back to the message when there is no OK row', () => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    const stage = document.createElement('div');
    stage.className = 'slate-stage-content';
    stage.innerHTML = '<div class="field"></div><p class="slate-err">! Please answer every row</p>';
    document.body.appendChild(stage);
    const err = stage.querySelector('.slate-err') as HTMLElement;
    const into = vi.fn();
    err.scrollIntoView = into;
    act(() => shakeInvalid(stage.querySelector('.field')));
    expect(into).toHaveBeenCalledWith({ block: 'nearest' });
    stage.remove();
  });
});
