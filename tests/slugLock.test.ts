import { beforeEach, describe, expect, it, vi } from 'vitest';

// ADR-057: the database refuses a new form's slug when another form holds it
// (live or trashed), when a permanent delete retired it, or when it isn't an
// 8-digit slug. The studio must draw again instead of losing the new form.

const db = vi.hoisted(() => ({
  errors: [] as Array<{ code: string; message: string; details?: string }>,
  slugs: [] as string[],
}));

vi.mock('../examples/_admin/neon/client.js', () => ({
  getNeon: () => ({
    from: () => ({
      insert: async (row: { slug: string }) => {
        db.slugs.push(row.slug);
        return { error: db.errors.shift() ?? null };
      },
    }),
  }),
}));
vi.mock('../examples/_admin/neon/ensureAuth.js', () => ({
  ensureAuthForDataApi: async () => ({}),
  waitForAuthReady: async () => ({ ok: true, authUid: 'owner-1' }),
}));

import { createFormRemote } from '../examples/_admin/neon/formsRemote.js';

const schema = {
  brand: { name: 'Pool' },
  theme: 'classic',
  themeMode: 'light',
  questions: [],
} as unknown as Parameters<typeof createFormRemote>[0]['schema'];

beforeEach(() => {
  db.errors = [];
  db.slugs = [];
});

describe('new form slug refused by the database (ADR-057)', () => {
  it.each([
    [
      'retired by a permanent delete',
      {
        code: '23505',
        message: 'slug is retired',
        details: 'The slug of a permanently deleted form is never reused.',
      },
    ],
    [
      'held by a trashed form',
      {
        code: '23505',
        message: 'duplicate key value violates unique constraint "forms_slug_uidx"',
        details: 'Key (slug)=(12345678) already exists.',
      },
    ],
    ['not a valid new slug', { code: '23514', message: 'invalid slug' }],
    [
      'outside the slug shape',
      {
        code: '23514',
        message: 'new row for relation "forms" violates check constraint "forms_slug_format"',
      },
    ],
  ])('draws a fresh 8-digit slug when it is %s', async (_label, error) => {
    db.errors = [error];
    const form = await createFormRemote({ name: 'Pool sign-up', schema });
    expect(db.slugs).toHaveLength(2);
    expect(db.slugs[1]).not.toBe(db.slugs[0]);
    expect(form?.slug).toBe(db.slugs[1]);
    expect(form?.slug).toMatch(/^[1-9][0-9]{7}$/);
  });

  it('does not redraw for errors that are not about the slug', async () => {
    db.errors = [
      {
        code: '23514',
        message: 'new row for relation "forms" violates check constraint "forms_status_check"',
      },
    ];
    const form = await createFormRemote({ name: 'Pool sign-up', schema });
    expect(form).toBeNull();
    expect(db.slugs).toHaveLength(1);
  });
});
