import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FillGate } from '../examples/_admin/components/FillGate.js';
import { handlePreloadError } from '../examples/_admin/preloadError.js';
import { GATE_OFFLINE, WRONG_PASSWORD } from '../examples/_admin/fillCopy.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('password gate (COPY-11)', () => {
  it('never stays on “Checking…”: a thrown unlock shows plain words and keeps the password', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const onUnlock = vi.fn(async () => {
      throw new SyntaxError('Unexpected token \'<\', "<!doctype "... is not valid JSON');
    });
    const user = userEvent.setup();
    render(<FillGate formName="Crew night" onUnlock={onUnlock} />);
    const input = screen.getByLabelText('Enter the password to continue');
    await user.type(input, 'pool');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(GATE_OFFLINE);
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled();
    expect(input).toHaveValue('pool');
    expect(screen.queryByText(/token|JSON/)).toBeNull();
  });

  it('a wrong password is cleared for the next try', async () => {
    const user = userEvent.setup();
    render(<FillGate formName="Crew night" onUnlock={async () => WRONG_PASSWORD} />);
    const input = screen.getByLabelText('Enter the password to continue');
    await user.type(input, 'nope');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(input).toHaveValue(''));
    expect(screen.getByRole('alert')).toHaveTextContent(WRONG_PASSWORD);
  });
});

describe('a part that fails to download (X2)', () => {
  const memory = () => {
    const m = new Map<string, string>();
    return {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
    };
  };

  it('a respondent’s page never reloads by itself — the import is left to fail', () => {
    const event = { preventDefault: vi.fn() };
    const reload = vi.fn();
    expect(handlePreloadError(event, true, memory(), reload)).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it('the studio reloads once per tab for a redeploy, then lets it fail', () => {
    const storage = memory();
    const first = { preventDefault: vi.fn() };
    const reload = vi.fn();
    expect(handlePreloadError(first, false, storage, reload)).toBe(true);
    expect(first.preventDefault).toHaveBeenCalled();
    expect(reload).toHaveBeenCalledTimes(1);
    const second = { preventDefault: vi.fn() };
    expect(handlePreloadError(second, false, storage, reload)).toBe(false);
    // Not prevented: the import rejects, so the field can say so instead of hanging.
    expect(second.preventDefault).not.toHaveBeenCalled();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('without storage there is no reload at all, so nothing can loop', () => {
    const event = { preventDefault: vi.fn() };
    const reload = vi.fn();
    const broken = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => undefined,
    };
    expect(handlePreloadError(event, false, broken, reload)).toBe(false);
    expect(handlePreloadError(event, false, null, reload)).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
});
