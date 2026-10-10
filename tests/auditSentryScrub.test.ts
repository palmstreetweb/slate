// @vitest-environment node
/**
 * Audit fixes (2026-10-09), F4: nothing sent to Sentry carries a URL's query
 * string. The fetch breadcrumb recorded the URL as fetched, which in the studio
 * can be a presigned storage link good for an hour.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { scrubBreadcrumb, scrubEvent, stripQuery } from '../examples/sentryScrub.js';

const signed =
  'https://bucket.s3.amazonaws.com/public/f1/u1/photo.jpg?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=abc123';

describe('query strings never leave for Sentry (audit F4)', () => {
  it('stripQuery cuts at the query or fragment and leaves plain URLs alone', () => {
    expect(stripQuery(signed)).toBe('https://bucket.s3.amazonaws.com/public/f1/u1/photo.jpg');
    expect(stripQuery('https://a.test/p#frag')).toBe('https://a.test/p');
    expect(stripQuery('/api/generate')).toBe('/api/generate');
  });

  it('a fetch breadcrumb loses the signature, and keeps everything else', () => {
    const crumb = {
      category: 'fetch',
      type: 'http',
      data: { method: 'GET', url: signed, status_code: 200 },
      timestamp: 1,
    };
    const out = scrubBreadcrumb(crumb);
    expect(out.data).toEqual({
      method: 'GET',
      url: 'https://bucket.s3.amazonaws.com/public/f1/u1/photo.jpg',
      status_code: 200,
    });
    expect(out.category).toBe('fetch');
    expect(out.timestamp).toBe(1);
    expect(JSON.stringify(out)).not.toContain('X-Amz-Signature');
  });

  it('navigation breadcrumbs and messages are scrubbed too; others pass through unchanged', () => {
    const nav = scrubBreadcrumb({
      category: 'navigation',
      data: { from: '/forms/abc/edit?token=secret', to: '/forms/abc/submissions' },
    });
    expect(nav.data).toEqual({ from: '/forms/abc/edit', to: '/forms/abc/submissions' });

    const msg = scrubBreadcrumb({
      category: 'console',
      message: `GET ${signed} failed`,
    });
    expect(msg.message).toBe('GET https://bucket.s3.amazonaws.com/public/f1/u1/photo.jpg failed');

    const plain = { category: 'ui.click', message: 'button.slate-btn' };
    expect(scrubBreadcrumb(plain)).toBe(plain);
  });

  it('an event loses its request query and every breadcrumb’s', () => {
    const event = {
      event_id: 'e1',
      request: { url: 'https://slateforms.vercel.app/forms/abc?src=flyer', query_string: 'src=flyer' },
      breadcrumbs: [
        { category: 'fetch', data: { url: signed } },
        { category: 'ui.click', message: 'button' },
      ],
    };
    const out = scrubEvent(event);
    expect(out.request).toEqual({ url: 'https://slateforms.vercel.app/forms/abc' });
    expect(out.breadcrumbs![0]!.data!.url).toBe(
      'https://bucket.s3.amazonaws.com/public/f1/u1/photo.jpg',
    );
    expect(out.breadcrumbs![1]).toEqual({ category: 'ui.click', message: 'button' });
    expect(out.event_id).toBe('e1');
    expect(JSON.stringify(out)).not.toMatch(/X-Amz|src=flyer/);
  });

  it('the site wires both hooks into init', () => {
    const source = readFileSync(new URL('../examples/sentry.ts', import.meta.url), 'utf8');
    expect(source).toMatch(/beforeBreadcrumb:\s*\(crumb\)\s*=>\s*scrubBreadcrumb\(crumb\)/);
    expect(source).toMatch(/beforeSend:\s*\(event\)\s*=>\s*scrubEvent\(event\)/);
  });
});
