/** @vitest-environment node */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import * as submitCopy from '../neon/functions/submit-response/requestIp.js';
import * as signCopy from '../neon/functions/storage-sign/requestIp.js';

// ADR-058: rightmost X-Forwarded-For only, normalized; no XFF means 'noip'.

const headers = (h: Record<string, string>) => (name: string) => h[name.toLowerCase()];

describe.each([
  ['submit-response', submitCopy],
  ['storage-sign', signCopy],
])('%s requestIp', (_name, m) => {
  it('the rightmost entry wins; a spoofed first entry is ignored', () => {
    expect(m.clientIp(headers({ 'x-forwarded-for': '1.2.3.4, 203.0.113.7' }))).toBe('203.0.113.7');
  });

  it('strips an IPv4 port', () => {
    expect(m.rateKeyForIp('203.0.113.7:4431')).toBe('203.0.113.7');
  });

  it.each([
    '2001:db8:1:2:aaaa::1',
    '2001:0db8:0001:0002::ff',
    '[2001:db8:1:2::9]:443',
    '2001:db8:1:2::1%eth0',
  ])('groups %s by /64', (ip) => {
    expect(m.rateKeyForIp(ip)).toBe('2001:db8:1:2::/64');
  });

  it('maps ::ffff:a.b.c.d to IPv4', () => {
    expect(m.rateKeyForIp('::ffff:198.51.100.9')).toBe('198.51.100.9');
  });

  it.each(['<script>', 'héllo-wörld', 'x'.repeat(100)])(
    '%s → raw: plus ≤ 64 safe characters',
    (raw) => {
      const k = m.rateKeyForIp(raw);
      expect(k).toMatch(/^raw:[0-9A-Za-z.:_-]{1,64}$/);
    },
  );

  it('no XFF (even with X-Real-IP) → noip, logged once', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2030-01-01T00:00:00Z'));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(m.clientIp(headers({ 'x-real-ip': '9.9.9.9' }))).toBe('noip');
      expect(m.clientIp(headers({ 'cf-connecting-ip': '9.9.9.9' }))).toBe('noip');
      expect(err).toHaveBeenCalledTimes(1);
      expect(String(err.mock.calls[0]![0])).toContain('[rate] no X-Forwarded-For');
    } finally {
      err.mockRestore();
      vi.useRealTimers();
    }
  });
});

describe('requestIp copies', () => {
  it('are identical apart from the header comment', () => {
    const strip = (p: string) => readFileSync(p, 'utf8').replace(/^\/\*\*[\s\S]*?\*\/\n/, '');
    expect(strip('neon/functions/submit-response/requestIp.ts')).toBe(
      strip('neon/functions/storage-sign/requestIp.ts'),
    );
  });
});
