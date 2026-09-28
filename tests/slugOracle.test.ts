/** @vitest-environment node */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// ADR-061 static guards: the respondent path stays one SDK-free GET, the preconnect
// warms the host it actually calls, and the new SQL is never open to Data API roles.

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

describe('slug-oracle guards (ADR-061)', () => {
  it('the fill fetch uses neither the SDK, a token, nor the Data API RPC', () => {
    for (const file of ['examples/_admin/neon/publicForm.ts', 'examples/main.tsx']) {
      const src = read(file);
      expect(src, file).not.toMatch(/@neondatabase|token\/anonymous|rpc\/|authorization/i);
    }
  });

  it('index.html preconnects the submitresponse Function, not the Data API', () => {
    const html = read('examples/index.html');
    const hosts = [...html.matchAll(/rel="preconnect"\s+href="([^"]+)"/g)].map((m) => m[1]);
    expect(hosts.some((h) => /^https:\/\/[a-z0-9-]+-submitresponse\.compute\./.test(h!))).toBe(
      true,
    );
    expect(hosts.some((h) => h!.includes('.apirest.'))).toBe(false);
  });

  it('017: the lookup and the miss table are for the Functions only', () => {
    const sql = read('neon/migrations/017_slug_oracle.sql');
    expect(sql).toMatch(/force row level security/);
    expect(sql).toMatch(
      /revoke all on function public\.lookup_public_form\(text, text, integer, integer\) from anonymous, authenticated/,
    );
    expect(sql).not.toMatch(
      /grant [a-z, ]+ on (function|table) public\.(lookup_public_form|slug_miss_buckets)/i,
    );
    // get_form_by_slug keeps its signature (CREATE OR REPLACE keeps the overlap grants).
    expect(sql).not.toMatch(/drop function[^;]*get_form_by_slug/i);
  });

  it('018 revokes the old RPC from both Data API roles and says how to roll back', () => {
    const sql = read('neon/migrations/018_revoke_get_form_by_slug.sql');
    expect(sql).toMatch(
      /revoke execute on function public\.get_form_by_slug\(text\) from anonymous, authenticated/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.get_form_by_slug\(text\) to anonymous, authenticated/,
    );
  });
});
