import { describe, expect, it, vi } from 'vitest';

// ADR-058: new or changed fill passwords need 6 to 72 characters. The SQL
// refuses shorter ones with FILL_PASSWORD_LENGTH; the studio shows the rule.

vi.mock('../examples/_admin/neon/client.js', () => ({
  getNeon: () => ({
    rpc: async () => ({
      data: null,
      error: {
        code: 'P0001',
        message: 'FILL_PASSWORD_LENGTH',
        hint: 'Use 6 to 72 characters.',
      },
    }),
  }),
}));
vi.mock('../examples/_admin/neon/ensureAuth.js', () => ({
  ensureAuthForDataApi: async () => ({}),
  waitForAuthReady: async () => ({ ok: true, authUid: 'owner-1' }),
}));

import { setFormFillPasswordRemote } from '../examples/_admin/neon/formsRemote.js';

describe('setFormFillPasswordRemote (ADR-058)', () => {
  it('maps FILL_PASSWORD_LENGTH to the 6-character rule', async () => {
    await expect(setFormFillPasswordRemote('f_1', '12345')).resolves.toEqual({
      ok: false,
      message: 'Use 6 to 72 characters.',
    });
  });
});
