/**
 * Review fixes of 2026-10-05 (CON-05, SEC-4): on a page that keeps no answers
 * across a reload, "Try again" asks for a question's part again in place, as
 * it did before the QA pass, and a bundler that requests a failed chunk again
 * brings the question back with every answer kept — the engine never reloads
 * a host's page by itself.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Form, defineSchema } from '@/index.js';

const chunk = vi.hoisted(() => ({ offline: true }));

// The dropdown's part can't download while "offline", then arrives.
vi.mock('@/components/questions/ext/DropdownExt.js', async (importOriginal) => {
  if (chunk.offline) {
    throw new TypeError('Failed to fetch dynamically imported module: /assets/DropdownExt-x.js');
  }
  return importOriginal();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Try again on a page that keeps no answers (CON-05, SEC-4)', () => {
  it('brings the question back in place, with the answers kept and no reload', async () => {
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <Form
        schema={defineSchema({
          brand: { name: 'Test' },
          theme: 'classic',
          themeMode: 'light',
          questions: [
            { id: 'name', type: 'short_text', title: 'Your name?' },
            {
              id: 'city',
              type: 'dropdown',
              title: 'Your city?',
              options: [
                { label: 'Austin', value: 'austin' },
                { label: 'Boston', value: 'boston' },
              ],
            },
            { id: 'done', type: 'thanks', title: 'Done!' },
          ],
        })}
        onSubmit={onSubmit}
      />,
    );
    await user.type(await screen.findByRole('textbox'), 'Ann{Enter}');
    expect(
      await screen.findByText(
        'This question didn’t load. Check your connection and try again, or reload the page.',
      ),
    ).toBeInTheDocument();
    // The connection is back.
    chunk.offline = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('combobox')).toBeInTheDocument();
    expect(screen.queryByText(/didn’t load/)).toBeNull();
    expect(reload).not.toHaveBeenCalled();
    // The answer given before is still there.
    await user.click(screen.getByRole('button', { name: /back/i }));
    expect(await screen.findByRole('textbox')).toHaveValue('Ann');
  });
});
