/** @vitest-environment node */
import { describe, expect, it } from 'vitest';
import { NO_OWNER, planBackfill } from '../scripts/storageBackfill.js';

// ADR-067: the one-off backfill registers existing objects so they count,
// keep displaying and are deleted with their response.

const u = (n: number) => `0f8fad5b-d9cb-469f-a165-${String(n).padStart(12, '0')}`;
const key = (form: string, n: number, scope = 'draft') => `${scope}/${form}/${u(n)}/photo${n}.jpg`;
const forms = new Map([
  ['f_live01', { ownerId: 'u_a' }],
  ['f_live02', { ownerId: 'u_b' }],
]);

describe('planBackfill', () => {
  it('claims referenced objects for the earliest response of their own form, at their real size', () => {
    const plan = planBackfill({
      objects: [{ key: key('f_live01', 1), size: 2_000_000, lastModified: '2026-09-20T10:00:00Z' }],
      existing: [],
      forms,
      refs: [
        {
          submissionId: 's_late',
          formId: 'f_live01',
          key: key('f_live01', 1),
          receivedAt: '2026-09-21T00:00:00Z',
        },
        {
          submissionId: 's_first',
          formId: 'f_live01',
          key: key('f_live01', 1),
          receivedAt: '2026-09-20T11:00:00Z',
        },
        // A ref in another form's response never claims (the claim rule is same-form only).
        {
          submissionId: 's_other',
          formId: 'f_live02',
          key: key('f_live01', 1),
          receivedAt: '2026-09-19T00:00:00Z',
        },
      ],
      orphans: 'register',
    });
    expect(plan.insert).toEqual([
      {
        key: key('f_live01', 1),
        owner_id: 'u_a',
        form_id: 'f_live01',
        scope: 'draft',
        bytes: 2_000_000,
        state: 'claimed',
        submission_id: 's_first',
        created_at: '2026-09-20T10:00:00Z',
      },
    ]);
    expect(plan.summary.claimed).toEqual({ n: 1, bytes: 2_000_000 });
    expect(plan.summary.byOwner).toEqual({ u_a: { claimed: 2_000_000, pending: 0 } });
  });

  it('orphans: registered pending from now (the sweep deletes them in 24 h), or skipped', () => {
    const input = {
      objects: [
        { key: key('f_live02', 2, 'public'), size: 11 },
        { key: key('f_gone01', 3), size: 500 },
      ],
      existing: [],
      forms,
      refs: [],
    };
    const reg = planBackfill({ ...input, orphans: 'register' });
    expect(reg.insert.map((r) => [r.owner_id, r.state, r.created_at])).toEqual([
      ['u_b', 'pending', null],
      [NO_OWNER, 'pending', null],
    ]);
    expect(reg.summary.orphans).toEqual({ n: 2, bytes: 511, ofDeletedForms: 1 });
    const skip = planBackfill({ ...input, orphans: 'skip' });
    expect(skip.insert).toEqual([]);
    expect(skip.summary.orphans.n).toBe(2);
  });

  it('leaves registered objects alone but fills in unknown sizes; skips keys the app never writes', () => {
    const plan = planBackfill({
      objects: [
        { key: key('f_live01', 4), size: 900 },
        { key: key('f_live01', 5), size: 700 },
        { key: 'stray/readme.txt', size: 3 },
        { key: 'public/f_live01/not-a-uuid/x.jpg', size: 3 },
      ],
      existing: [
        { key: key('f_live01', 4), bytes: 0 },
        { key: key('f_live01', 5), bytes: 700 },
      ],
      forms,
      refs: [{ submissionId: 's_1', formId: 'f_live01', key: key('f_live01', 9), receivedAt: 'x' }],
      orphans: 'register',
    });
    expect(plan.insert).toEqual([]);
    expect(plan.sizes).toEqual([{ key: key('f_live01', 4), bytes: 900 }]);
    expect(plan.summary).toMatchObject({ alreadyRegistered: 2, skippedOddKeys: 2, deadRefs: 1 });
  });
});
