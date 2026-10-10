import { beforeEach, describe, expect, it, vi } from 'vitest';

// ADR-071 (migration 022): the database assigns every new form's slug. The
// studio sends a placeholder, reads the slug back from the insert, and shows
// that one. Before 022 (ADR-057) the database instead refused a clashing slug
// with 23505 / 23514 and the studio drew again; a 23505 can still happen when
// two inserts land on the same number at the unique index, so the resend stays.

const db = vi.hoisted(() => ({
  errors: [] as Array<{ code: string; message: string; details?: string }>,
  /** What the server assigns on each attempt (null = echo the client's draw, like pre-022). */
  assigned: [] as Array<string | null>,
  slugs: [] as string[],
  selected: [] as string[],
}));

vi.mock('../examples/_admin/neon/client.js', () => ({
  getNeon: () => ({
    from: () => ({
      insert: (row: { slug: string }) => {
        db.slugs.push(row.slug);
        return {
          select: (cols: string) => {
            db.selected.push(cols);
            return {
              single: async () => {
                const error = db.errors.shift() ?? null;
                if (error) return { data: null, error };
                const assigned = db.assigned.shift();
                return { data: { slug: assigned === null ? row.slug : assigned }, error: null };
              },
            };
          },
        };
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
  db.assigned = [];
  db.slugs = [];
  db.selected = [];
});

describe('the server assigns the slug (ADR-071)', () => {
  it('the new form carries the slug the database returned, not the studio’s draw', async () => {
    db.assigned = ['31415926'];
    const form = await createFormRemote({ name: 'Pool sign-up', schema });
    expect(db.slugs).toHaveLength(1);
    expect(db.slugs[0]).toMatch(/^[1-9][0-9]{7}$/);
    expect(db.selected).toEqual(['slug']);
    expect(form?.slug).toBe('31415926');
    expect(form?.slug).not.toBe(db.slugs[0]);
  });

  it('keeps its own draw only when the insert returns no slug (a stale schema cache)', async () => {
    db.assigned = [null];
    const form = await createFormRemote({ name: 'Pool sign-up', schema });
    expect(form?.slug).toBe(db.slugs[0]);
  });
});

describe('a slug the database still refuses (ADR-057, the unique-index race)', () => {
  it.each([
    [
      'retired by a permanent delete (pre-022 database)',
      {
        code: '23505',
        message: 'slug is retired',
        details: 'The slug of a permanently deleted form is never reused.',
      },
    ],
    [
      'two inserts landing on one number',
      {
        code: '23505',
        message: 'duplicate key value violates unique constraint "forms_slug_uidx"',
        details: 'Key (slug)=(12345678) already exists.',
      },
    ],
    ['not a valid new slug (pre-022 database)', { code: '23514', message: 'invalid slug' }],
    [
      'outside the slug shape',
      {
        code: '23514',
        message: 'new row for relation "forms" violates check constraint "forms_slug_format"',
      },
    ],
  ])('sends again when it is %s, and shows what landed', async (_label, error) => {
    db.errors = [error];
    db.assigned = ['27182818'];
    const form = await createFormRemote({ name: 'Pool sign-up', schema });
    expect(db.slugs).toHaveLength(2);
    expect(db.slugs[1]).not.toBe(db.slugs[0]);
    expect(form?.slug).toBe('27182818');
  });

  it('does not resend for errors that are not about the slug', async () => {
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
