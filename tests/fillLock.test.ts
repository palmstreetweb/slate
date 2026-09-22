import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { fillUnlockToken, isValidUnlockToken } from '../neon/functions/submit-response/fillLock.ts';
import * as signCopy from '../neon/functions/storage-sign/fillLock.ts';
import { rowToFormRecord, slugRowToPublishedForm } from '../examples/_admin/neon/mappers.js';
import { FORM_OWNER_COLUMNS, type DbFormRow } from '../examples/_admin/neon/database.types.js';
import {
  clearFillUnlockToken,
  fillUnlockKey,
  readFillUnlockToken,
  writeFillUnlockToken,
} from '../examples/_admin/fillUnlock.js';
import type { Schema } from '../src/index.js';

const HASH = '$2a$08$abcdefghijklmnopqrstuuJ7gq0l1m9cQ4n3o8c5w2y1z0x9v8u7t';
const schema = { questions: [] } as unknown as Schema;

describe('fill unlock token (Function side)', () => {
  it('matches hmac-sha256(data = form id, key = hash) as hex', () => {
    const expected = createHmac('sha256', HASH).update('f_abc').digest('hex');
    expect(fillUnlockToken('f_abc', HASH)).toBe(expected);
    expect(fillUnlockToken('f_abc', HASH)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('accepts only the exact token for that form + hash', () => {
    const token = fillUnlockToken('f_abc', HASH);
    expect(isValidUnlockToken('f_abc', HASH, token)).toBe(true);
    expect(isValidUnlockToken('f_other', HASH, token)).toBe(false);
    // Changing the password changes the hash, which voids old tokens.
    expect(isValidUnlockToken('f_abc', `${HASH}x`, token)).toBe(false);
  });

  it('fails closed on missing or malformed tokens', () => {
    for (const bad of [undefined, null, '', 'nope', 42, {}, 'A'.repeat(64), 'a'.repeat(63)]) {
      expect(isValidUnlockToken('f_abc', HASH, bad)).toBe(false);
    }
  });

  it('storage-sign carries the same implementation', () => {
    const token = fillUnlockToken('f_abc', HASH);
    expect(signCopy.fillUnlockToken('f_abc', HASH)).toBe(token);
    expect(signCopy.isValidUnlockToken('f_abc', HASH, token)).toBe(true);
  });
});

describe('get_form_by_slug mapper', () => {
  const base = { id: 'f_1', name: 'Crew sign-up', slug: '48210377' };

  it('locked row → name only, schema null', () => {
    expect(slugRowToPublishedForm({ ...base, locked: true, schema: null })).toEqual({
      ...base,
      locked: true,
      schema: null,
    });
  });

  it('never passes a schema through on a locked row', () => {
    const out = slugRowToPublishedForm({ ...base, locked: true, schema });
    expect(out?.schema).toBeNull();
  });

  it('unlocked row → schema', () => {
    expect(slugRowToPublishedForm({ ...base, locked: false, schema })).toEqual({
      ...base,
      locked: false,
      schema,
    });
  });

  it('pre-012 row (no locked column) still opens', () => {
    expect(slugRowToPublishedForm({ ...base, schema })?.locked).toBe(false);
  });

  it('unlocked without a schema is unavailable', () => {
    expect(slugRowToPublishedForm({ ...base, locked: false, schema: null })).toBeNull();
  });
});

describe('owner hydrate never sees the hash', () => {
  it('selects explicit columns, fill_locked but not fill_password_hash', () => {
    const cols = FORM_OWNER_COLUMNS.split(',');
    expect(cols).toContain('fill_locked');
    expect(cols).not.toContain('fill_password_hash');
    expect(cols).not.toContain('*');
  });

  it('FormRecord carries fillLocked only', () => {
    const row = {
      id: 'f_1',
      name: 'N',
      slug: '12345678',
      schema,
      published_schema: null,
      status: 'draft',
      owner_id: 'u',
      created_at: 'a',
      updated_at: 'b',
      deleted_at: null,
      fill_locked: true,
      // Even if a stray `*` select ever returned it, the mapper drops it.
      fill_password_hash: HASH,
    } as DbFormRow;
    const record = rowToFormRecord(row);
    expect(record.fillLocked).toBe(true);
    expect(JSON.stringify(record)).not.toContain(HASH);
    expect(rowToFormRecord({ ...row, fill_locked: false })).not.toHaveProperty('fillLocked');
  });
});

describe('respondent unlock token storage', () => {
  const token = 'ab'.repeat(32);
  beforeEach(() => window.sessionStorage.clear());

  it('round-trips under slate-fill-unlock:{formId} in sessionStorage only', () => {
    writeFillUnlockToken('f_1', token);
    expect(fillUnlockKey('f_1')).toBe('slate-fill-unlock:f_1');
    expect(window.sessionStorage.getItem('slate-fill-unlock:f_1')).toBe(token);
    expect(window.localStorage.getItem('slate-fill-unlock:f_1')).toBeNull();
    expect(readFillUnlockToken('f_1')).toBe(token);
    expect(readFillUnlockToken('f_2')).toBeNull();
    clearFillUnlockToken('f_1');
    expect(readFillUnlockToken('f_1')).toBeNull();
  });

  it('refuses to store anything that is not a token (e.g. a password)', () => {
    writeFillUnlockToken('f_1', 'hunter2');
    expect(window.sessionStorage.length).toBe(0);
  });
});
