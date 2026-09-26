/** @vitest-environment node */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import * as submitCopy from '../neon/functions/submit-response/rateGate.js';
import * as signCopy from '../neon/functions/storage-sign/rateGate.js';

// ADR-058: env parsing, owner keys, noip limits, size units and the one-statement charge.

const fakePool = (rows: unknown[]) => {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const pool = {
    query: async (sql: string, params: unknown[]) => {
      calls.push({ sql, params });
      return { rows };
    },
  } as unknown as Pool;
  return { pool, calls };
};

describe.each([
  ['submit-response', submitCopy],
  ['storage-sign', signCopy],
])('%s rateGate', (_name, m) => {
  afterEach(() => vi.unstubAllEnvs());

  it.each(['', 'abc', '0', '-5', '1.5', '2000000'])('intEnv(%j) keeps the default', (v) => {
    vi.stubEnv('S8_TEST_ENV', v);
    expect(m.intEnv('S8_TEST_ENV', 42, 1_000_000)).toBe(42);
  });

  it('intEnv accepts an integer in range', () => {
    vi.stubEnv('S8_TEST_ENV', '1500');
    expect(m.intEnv('S8_TEST_ENV', 42)).toBe(1500);
  });

  it('ownerKey keeps a uuid, hashes long or odd ids, and says none for null', () => {
    const uuid = '3f2c1b9e-8a7d-4c6b-9e5f-1a2b3c4d5e6f';
    expect(m.ownerKey(uuid)).toBe(uuid);
    expect(m.ownerKey('a'.repeat(65))).toMatch(/^h[0-9a-f]{32}$/);
    expect(m.ownerKey('a/b')).toMatch(/^h[0-9a-f]{32}$/);
    expect(m.ownerKey(null)).toBe('none');
    expect(m.ownerKey('')).toBe('none');
  });

  it('ipMax gives noip a tenth, at least 1', () => {
    expect(m.ipMax('noip', 2000)).toBe(200);
    expect(m.ipMax('noip', 5)).toBe(1);
    expect(m.ipMax('203.0.113.7', 2000)).toBe(2000);
  });

  it('units rounds up, at least 1', () => {
    expect(m.units(1, 4096)).toBe(1);
    expect(m.units(20000, 4096)).toBe(5);
    expect(m.units(0, 4096)).toBe(1);
  });

  it('aboutMinutes', () => {
    expect(m.aboutMinutes(30)).toBe('about 1 minute');
    expect(m.aboutMinutes(3600)).toBe('about 60 minutes');
  });

  it('charge sends one statement with four arrays (plus the form id)', async () => {
    const { pool, calls } = fakePool([
      { allowed: true, denied_index: 0, retry_after_seconds: 0, published_schema: { q: 1 } },
    ]);
    const v = await m.charge(
      pool,
      [
        { key: 'a', win: 600, max: 10 },
        { key: 'b', win: 3600, max: 20, cost: 3 },
      ],
      'f_1',
    );
    expect(v).toEqual({ ok: true, schema: { q: 1 } });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.params).toEqual([['a', 'b'], [600, 3600], [10, 20], [1, 3], 'f_1']);
    expect(calls[0]!.sql).toContain('consume_submit_rates');
    const plain = fakePool([{ allowed: true, denied_index: 0, retry_after_seconds: 0 }]);
    await m.charge(plain.pool, [{ key: 'a', win: 600, max: 10 }]);
    expect(plain.calls[0]!.params).toHaveLength(4);
    expect(plain.calls[0]!.sql).not.toContain('published_schema');
  });

  it('maps denied_index 2 to index 1', async () => {
    const { pool } = fakePool([{ allowed: false, denied_index: 2, retry_after_seconds: 120 }]);
    await expect(
      m.charge(pool, [
        { key: 'a', win: 600, max: 10 },
        { key: 'b', win: 600, max: 10 },
      ]),
    ).resolves.toEqual({ ok: false, index: 1, retryAfter: 120 });
  });

  it('throws on zero rows or an out-of-range index', async () => {
    const b = [{ key: 'a', win: 600, max: 10 }];
    await expect(m.charge(fakePool([]).pool, b)).rejects.toThrow();
    await expect(
      m.charge(fakePool([{ allowed: false, denied_index: 2, retry_after_seconds: 1 }]).pool, b),
    ).rejects.toThrow();
    await expect(
      m.charge(fakePool([{ allowed: false, denied_index: 0, retry_after_seconds: 1 }]).pool, b),
    ).rejects.toThrow();
  });
});

describe('rateGate copies', () => {
  it('are identical apart from the header comment', () => {
    const strip = (p: string) => readFileSync(p, 'utf8').replace(/^\/\*\*[\s\S]*?\*\/\n/, '');
    expect(strip('neon/functions/submit-response/rateGate.ts')).toBe(
      strip('neon/functions/storage-sign/rateGate.ts'),
    );
  });
});
