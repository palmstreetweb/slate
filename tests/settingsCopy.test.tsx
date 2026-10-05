/** Settings → Account (COPY-16): a session without an email never reads "Signed in as unknown." */

import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const state = vi.hoisted(() => ({ email: undefined as string | undefined }));

vi.mock('../examples/_admin/shell/AdminShell.js', () => ({
  AdminShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock('../examples/_admin/neon/env.js', () => ({ isNeonConfigured: () => true }));
vi.mock('../examples/_admin/neon/AuthProvider.js', () => ({
  useAuth: () => ({ user: state.email ? { email: state.email } : {} }),
}));
vi.mock('../examples/_admin/shell/useSignOutFlow.js', () => ({
  useSignOutFlow: () => ({ runSignOut: vi.fn(), leaving: false, overlay: null }),
}));
vi.mock('../examples/_admin/adminThemeContext.js', () => ({
  useAdminTheme: () => ({
    mode: 'light',
    setMode: vi.fn(),
    uiTheme: 'warm',
    setUiTheme: vi.fn(),
  }),
}));
vi.mock('../examples/_admin/uiSounds.js', () => ({
  isUiSoundMuted: () => false,
  playUiSound: vi.fn(),
  setUiSoundMuted: vi.fn(),
}));

const { Settings } = await import('../examples/_admin/pages/Settings.js');

describe('Settings account line', () => {
  it('names the email when there is one', () => {
    state.email = 'owner@example.com';
    render(<Settings />);
    expect(
      screen.getByText(/Signed in as owner@example\.com\. Data syncs to Slate cloud\./),
    ).toBeTruthy();
  });

  it('says “Signed in.” when the session has no email', () => {
    state.email = undefined;
    render(<Settings />);
    expect(screen.getByText(/^Signed in\. Data syncs to Slate cloud\.$/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/unknown/);
  });
});
