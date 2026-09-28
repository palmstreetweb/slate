import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Schema } from '../src/index.js';
import type * as FormsStore from '../examples/_admin/_formsStore.js';

// ADR-061 addendum: with a customized brand name, a rename leaves the schema unchanged, so the
// studio compares the live name with the published title (forms.published_name) too.

// ---------------------------------------------------------------------------
// Neon client fake for formsRemote (same shape as signInFixes.test.tsx)
// ---------------------------------------------------------------------------
const db = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  /** Columns the fake database knows; a select naming any other one answers 42703. */
  columns: null as Set<string> | null,
  selected: [] as string[],
  upsert: vi.fn(),
}));

vi.mock('../examples/_admin/neon/client.js', () => ({
  getNeon: () => ({
    from: () => ({
      select: (cols: string) => ({
        order: async () => {
          db.selected.push(cols);
          const missing = db.columns && cols.split(',').find((c) => !db.columns!.has(c));
          if (missing) {
            return {
              data: null,
              error: { code: '42703', message: `column forms.${missing} does not exist` },
            };
          }
          return { data: db.rows, error: null };
        },
      }),
      upsert: db.upsert,
    }),
    rpc: async (fn: string) =>
      fn === 'auth_uid' ? { data: 'owner-1', error: null } : { data: null, error: null },
  }),
}));
vi.mock('../examples/_admin/neon/ensureAuth.js', () => ({
  ensureAuthForDataApi: async () => ({ accessToken: 't', email: 'o@example.com' }),
  waitForAuthReady: async () => ({ ok: true, authUid: 'owner-1', clientEmail: null }),
}));

import { hasUnpublishedChanges, type FormRecord } from '../examples/_admin/_formsStore.js';
import { formRecordToRow, rowToFormRecord } from '../examples/_admin/neon/mappers.js';
import { FORM_OWNER_COLUMNS, type DbFormRow } from '../examples/_admin/neon/database.types.js';
import {
  clearFormsRemoteCache,
  getFormRemote,
  hydrateFormsRemote,
  publishFormRemoteSync,
  replaceAllFormsRemoteSync,
  updateFormRemoteSync,
} from '../examples/_admin/neon/formsRemote.js';

const schema = {
  // A customized brand: not the form name, so a rename never touches the schema.
  brand: { name: 'Palm Street' },
  questions: [{ id: 'q', type: 'short_text', title: 'Name' }],
} as unknown as Schema;

const live: FormRecord = {
  id: 'f_1',
  name: 'Crew sign-up',
  slug: '48210377',
  createdAt: 'a',
  updatedAt: 'b',
  schema,
  publishedSchema: schema,
  publishedName: 'Crew sign-up',
  status: 'published',
};

const row = (over: Partial<DbFormRow> = {}): DbFormRow => ({
  id: 'f_1',
  name: 'Crew sign-up',
  slug: '48210377',
  schema,
  published_schema: schema,
  status: 'published',
  owner_id: 'owner-1',
  created_at: '2026-09-20T00:00:00Z',
  updated_at: '2026-09-20T00:00:00Z',
  deleted_at: null,
  fill_locked: false,
  published_name: 'Crew sign-up',
  ...over,
});

/** The row of the last upsert call. */
const lastWrite = () => db.upsert.mock.calls.at(-1)?.[0] as Record<string, unknown> | undefined;

beforeEach(() => {
  clearFormsRemoteCache();
  db.rows = [];
  db.columns = null;
  db.selected = [];
  db.upsert.mockReset();
  db.upsert.mockResolvedValue({ error: null });
});

describe('hasUnpublishedChanges: a rename is an unpublished change', () => {
  it('live and current: nothing to republish', () => {
    expect(hasUnpublishedChanges(live)).toBe(false);
  });

  it('renamed with a customized brand (schema unchanged): Republish', () => {
    expect(hasUnpublishedChanges({ ...live, name: 'Crew sign-up 2027' })).toBe(true);
  });

  it('schema edits still count', () => {
    expect(hasUnpublishedChanges({ ...live, schema: { ...schema, questions: [] } })).toBe(true);
  });

  it('unknown published title (pre-017 database, old local data): the name is not compared', () => {
    const { publishedName: _t, ...old } = live;
    expect(hasUnpublishedChanges({ ...old, name: 'Renamed' })).toBe(false);
  });

  it('drafts and never-published forms are never "stale"', () => {
    expect(hasUnpublishedChanges({ ...live, name: 'Renamed', status: 'draft' })).toBe(false);
    const { publishedSchema: _s, publishedName: _t, ...fresh } = live;
    expect(hasUnpublishedChanges({ ...fresh, name: 'Renamed' })).toBe(false);
  });
});

describe('published_name mapping', () => {
  it('the owner hydrate reads published_name, never the hash', () => {
    const cols = FORM_OWNER_COLUMNS.split(',');
    expect(cols).toContain('published_name');
    expect(cols).not.toContain('fill_password_hash');
  });

  it('row → record carries publishedName only when the database has one', () => {
    expect(rowToFormRecord(row()).publishedName).toBe('Crew sign-up');
    expect(rowToFormRecord(row({ published_name: null }))).not.toHaveProperty('publishedName');
    const { published_name: _n, ...pre017 } = row();
    expect(rowToFormRecord(pre017 as DbFormRow)).not.toHaveProperty('publishedName');
  });

  it('record → row sends published_name only when the database has the column', () => {
    expect(formRecordToRow(live)).not.toHaveProperty('published_name');
    expect(formRecordToRow(live, { publishedName: true }).published_name).toBe('Crew sign-up');
    const { publishedName: _t, ...unknownTitle } = live;
    expect(formRecordToRow(unknownTitle, { publishedName: true })).not.toHaveProperty(
      'published_name',
    );
  });
});

describe('studio round trip (cloud)', () => {
  it('rename → Republish shows; the save keeps the old title; Republish sends the new name', async () => {
    db.rows = [row()];
    await hydrateFormsRemote({ soft: true });
    expect(db.selected[0]).toContain('published_name');
    expect(hasUnpublishedChanges(getFormRemote('f_1'))).toBe(false);

    updateFormRemoteSync('f_1', { name: 'Crew sign-up 2027' });
    expect(hasUnpublishedChanges(getFormRemote('f_1'))).toBe(true);
    await vi.waitFor(() => expect(db.upsert).toHaveBeenCalledTimes(1));
    // An ordinary save re-sends the OLD title; 017's trigger pins it, so the rename stays private.
    expect(lastWrite()).toMatchObject({
      name: 'Crew sign-up 2027',
      published_name: 'Crew sign-up',
    });

    publishFormRemoteSync('f_1');
    expect(getFormRemote('f_1')?.publishedName).toBe('Crew sign-up 2027');
    expect(hasUnpublishedChanges(getFormRemote('f_1'))).toBe(false);
    await vi.waitFor(() => expect(db.upsert).toHaveBeenCalledTimes(2));
    // Republish sends published_name = name, the only client value the trigger accepts.
    expect(lastWrite()).toMatchObject({
      name: 'Crew sign-up 2027',
      published_name: 'Crew sign-up 2027',
      status: 'published',
    });
  });

  it('a hydrate with the new title clears the badge (another tab republished)', async () => {
    db.rows = [row({ name: 'Crew sign-up 2027' })];
    await hydrateFormsRemote({ soft: true });
    expect(hasUnpublishedChanges(getFormRemote('f_1'))).toBe(true);
    db.rows = [row({ name: 'Crew sign-up 2027', published_name: 'Crew sign-up 2027' })];
    await hydrateFormsRemote({ soft: true });
    expect(hasUnpublishedChanges(getFormRemote('f_1'))).toBe(false);
  });

  it('a database without 017 still loads (keeping fill_locked) and never writes published_name', async () => {
    db.columns = new Set(FORM_OWNER_COLUMNS.split(',').filter((c) => c !== 'published_name'));
    const { published_name: _n, ...pre017 } = row({ fill_locked: true });
    db.rows = [pre017];
    await hydrateFormsRemote({ soft: true });
    expect(db.selected).toHaveLength(2);
    expect(db.selected[1]).not.toContain('published_name');
    expect(db.selected[1]).toContain('fill_locked');
    expect(getFormRemote('f_1')?.fillLocked).toBe(true);

    updateFormRemoteSync('f_1', { name: 'Renamed' });
    publishFormRemoteSync('f_1');
    await vi.waitFor(() => expect(db.upsert).toHaveBeenCalled());
    for (const [written] of db.upsert.mock.calls) {
      expect(written).not.toHaveProperty('published_name');
    }
  });

  it('a backup restore mirrors the insert trigger: published rows go live under their own name', () => {
    replaceAllFormsRemoteSync([{ ...live, name: 'Restored', publishedName: 'Old title' }]);
    expect(getFormRemote('f_1')?.publishedName).toBe('Restored');
    expect(hasUnpublishedChanges(getFormRemote('f_1'))).toBe(false);
  });
});

describe('local (offline) publish records the title', () => {
  it('publishForm snapshots the name; a later rename shows Republish', async () => {
    vi.resetModules();
    vi.doMock('../examples/_admin/neon/env.js', () => ({ isNeonConfigured: () => false }));
    window.localStorage.clear();
    const store = await import('../examples/_admin/_formsStore.js');
    const created = store.createForm({ name: 'Crew sign-up', schema });
    expect(created).toBeTruthy();
    const published = store.publishForm(created!.id);
    expect(published?.publishedName).toBe('Crew sign-up');
    expect(store.hasUnpublishedChanges(published)).toBe(false);
    const [renamed] = store.updateForm(created!.id, { name: 'Crew sign-up 2027' });
    expect(store.hasUnpublishedChanges(renamed)).toBe(true);
    expect(store.hasUnpublishedChanges(store.publishForm(created!.id))).toBe(false);
    vi.doUnmock('../examples/_admin/neon/env.js');
  });
});

describe('Share panel offers Republish after a rename', () => {
  it('shows Republish and "Unpublished changes" for a renamed live form', async () => {
    vi.resetModules();
    const form = { ...live, name: 'Crew sign-up 2027' };
    vi.doMock('../examples/_admin/_formsStore.js', async () => {
      const real = await vi.importActual<typeof FormsStore>('../examples/_admin/_formsStore.js');
      return {
        getForm: () => form,
        publishForm: vi.fn(),
        unpublishForm: vi.fn(),
        subscribe: () => () => {},
        hasUnpublishedChanges: real.hasUnpublishedChanges,
        setFormFillPassword: vi.fn(),
      };
    });
    vi.doMock('../examples/_admin/neon/env.js', () => ({ isNeonConfigured: () => true }));
    vi.doMock('../examples/_admin/neon/publicApi.js', () => ({
      publicFillUrl: (slug: string) => `https://slate.test/forms/${slug}`,
    }));
    vi.doMock('../examples/_admin/shareQr.js', () => ({
      readShareQrStyle: () => 'swiss',
      writeShareQrStyle: vi.fn(),
      renderShareQr: () => Promise.resolve('data:image/png;base64,AAAA'),
      SHARE_QR_DISPLAY_PX: 196,
      SHARE_QR_STYLES: [{ id: 'swiss', label: 'Swiss', description: '' }],
    }));
    vi.doMock('../examples/_admin/uiSounds.js', () => ({ playUiSound: vi.fn() }));
    vi.doMock('../examples/_admin/toast.js', () => ({ useToast: () => ({ push: vi.fn() }) }));
    vi.doMock('../examples/_admin/useFocusTrap.js', () => ({ useFocusTrap: vi.fn() }));
    vi.doMock('../examples/_admin/lockBodyScroll.js', () => ({ lockBodyScroll: () => () => {} }));
    const { SharePanel } = await import('../examples/_admin/components/SharePanel.js');

    render(
      <SharePanel open onClose={() => {}} formId="f_1" formName={form.name} schema={schema} />,
    );
    expect(screen.getByRole('button', { name: /Republish/ })).toBeTruthy();
    expect(screen.getByText('Unpublished changes')).toBeTruthy();
    expect(screen.queryByText('Live')).toBeNull();
  });
});
