import { beforeEach, describe, expect, it } from 'vitest';
import QRCode from 'qrcode';
import { hrefFor, matchRoute, routeKey } from '../examples/_admin/_router.js';
import {
  colorProblem,
  DEFAULT_QR_STYLE,
  destinationProblem,
  displayName,
  downloadBaseName,
  normalizeDestination,
  normalizeHex,
  qrColors,
  qrContent,
  qrLevels,
  qrShortUrl,
  sanitizeQrStyle,
} from '../examples/_admin/qr/qrModel.js';
import {
  buildQrGeometry,
  qrGeometryToSvg,
  QR_INK,
  QR_PAPER,
  QR_SWISS_RED,
  QrTooLongError,
} from '../examples/_admin/qr/qrRender.js';
import { qrDrawProblem } from '../examples/_admin/qr/qrExport.js';
import {
  clearQrStore,
  createQrCode,
  deleteQrCodesForever,
  getQrQuota,
  listQrCodes,
  listTrashedQrCodes,
  loadQrCodes,
  restoreQrCode,
  setQrDestination,
  trashQrCode,
  updateQrCode,
} from '../examples/_admin/qr/qrStore.js';

describe('QR routes (ADR-075 §1)', () => {
  it('matches the list, new and edit routes', () => {
    expect(matchRoute('/qr')).toEqual({ name: 'qrList' });
    expect(matchRoute('/qr/new')).toEqual({ name: 'qrEditor', qrId: null });
    expect(matchRoute('/qr/abc-123/edit')).toEqual({ name: 'qrEditor', qrId: 'abc-123' });
  });

  it('round-trips route keys', () => {
    for (const path of ['/qr', '/qr/new', '/qr/abc-123/edit']) {
      expect(routeKey(matchRoute(path))).toBe(path);
    }
  });

  it('leaves /q/ short links and stray paths to the not-found page', () => {
    expect(matchRoute('/q/abcdefgh').name).toBe('notfound');
    expect(matchRoute('/qr/abc').name).toBe('notfound');
    expect(hrefFor('qr')).toBe('/qr');
  });
});

describe('destinations (ADR-075 §8)', () => {
  it('upgrades a bare host to https and keeps what follows it', () => {
    expect(normalizeDestination('example.com/menu?a=1#x')).toBe('https://example.com/menu?a=1#x');
    expect(normalizeDestination('HTTP://Example.com/A')).toBe('http://Example.com/A');
  });

  it('refuses what the database would refuse, in plain words', () => {
    expect(destinationProblem('')).toMatch(/Paste the link/);
    expect(destinationProblem('example .com')).toMatch(/spaces/);
    expect(destinationProblem('mailto:a@b.co')).toMatch(/https:\/\//);
    expect(destinationProblem('javascript:alert(1)')).toMatch(/https:\/\//);
    expect(destinationProblem('https://user:pw@example.com')).toMatch(/username or password/);
    expect(destinationProblem('notalink')).toMatch(/doesn’t look like a web link/);
    expect(destinationProblem(`https://example.com/${'a'.repeat(2048)}`)).toMatch(/at most/);
    expect(destinationProblem('example.com/menu')).toBeNull();
  });

  it('refuses a code that points at another Slate short link', () => {
    expect(destinationProblem(qrShortUrl('abcdefgh'))).toMatch(/another Slate code/);
    expect(destinationProblem('https://slateforms.vercel.app/forms/12345678')).toBeNull();
  });

  it('matches the database rule for every link it accepts', () => {
    const db = /^https?:\/\/[^\s/?#@]+([/?#][^\s]*)?$/;
    for (const raw of [
      'example.com',
      'a.co/b?c=d',
      'https://x.io#frag',
      'http://localhost:3000/a',
    ]) {
      expect(destinationProblem(raw)).toBeNull();
      expect(normalizeDestination(raw)).toMatch(db);
    }
  });
});

describe('style rules (ADR-075 §9)', () => {
  it('normalizes hex colors', () => {
    expect(normalizeHex('#ABC')).toBe('#aabbcc');
    expect(normalizeHex('112233')).toBe('#112233');
    expect(normalizeHex('red')).toBeNull();
  });

  it('refuses low contrast and light-on-dark pairs', () => {
    expect(colorProblem('#2a2520', '#faf6ee')).toBeNull();
    expect(colorProblem('#d8d8d8', '#faf6ee')).toMatch(/too close/);
    expect(colorProblem('#ffffff', '#111111')).toMatch(/darker code color/);
  });

  it('sanitizes stored styles back to something drawable', () => {
    expect(sanitizeQrStyle(null)).toEqual(DEFAULT_QR_STYLE);
    expect(sanitizeQrStyle({ preset: 'nope', fg: '#fff', bg: '#000' })).toEqual(DEFAULT_QR_STYLE);
    const logo = 'data:image/png;base64,iVBORw0KGgo=';
    expect(
      sanitizeQrStyle({
        preset: 'soft',
        fg: '#14532D',
        bg: '#ecfdf5',
        logo,
        caption: `  ${'x'.repeat(60)}  `,
      }),
    ).toEqual({ preset: 'soft', fg: '#14532d', bg: '#ecfdf5', logo, caption: 'x'.repeat(40) });
    expect(sanitizeQrStyle({ logo: 'data:image/svg+xml;base64,PHN2Zz4=' }).logo).toBeUndefined();
    expect(sanitizeQrStyle({ logo: `data:image/png;base64,${'A'.repeat(100_001)}` }).logo).toBe(
      undefined,
    );
  });

  it('keeps Swiss red centers only while they stand out', () => {
    expect(qrColors(DEFAULT_QR_STYLE).accent.toLowerCase()).toBe(QR_SWISS_RED.toLowerCase());
    expect(qrColors({ preset: 'swiss', fg: '#000000', bg: '#ff8a80' }).accent).toBe('#000000');
  });

  it('asks for strong error correction whenever something covers the middle', () => {
    expect(qrLevels(DEFAULT_QR_STYLE)).toEqual(['M', 'L']);
    expect(qrLevels({ ...DEFAULT_QR_STYLE, preset: 'branded' })).toEqual(['H', 'Q']);
    expect(qrLevels({ ...DEFAULT_QR_STYLE, logo: 'data:image/png;base64,AA==' })).toEqual([
      'H',
      'Q',
    ]);
  });
});

describe('content and names', () => {
  it('puts the short link in dynamic codes and the link itself in static ones', () => {
    expect(qrContent({ kind: 'dynamic', code: 'abcdefgh', targetUrl: 'https://x.io' })).toBe(
      'https://slateforms.vercel.app/q/abcdefgh',
    );
    expect(qrContent({ kind: 'static', code: null, targetUrl: 'https://x.io' })).toBe(
      'https://x.io',
    );
  });

  it('names unnamed codes after their link, and files after the name', () => {
    expect(displayName({ name: '', targetUrl: 'https://www.example.com/menu' })).toBe(
      'example.com',
    );
    expect(displayName({ name: '', targetUrl: null })).toBe('Untitled QR code');
    expect(downloadBaseName({ name: 'Lunch menu — Fri!', targetUrl: null })).toBe(
      'lunch-menu-fri-qr',
    );
  });
});

describe('geometry (one pass for PNG and SVG)', () => {
  const base = {
    preset: 'swiss' as const,
    colors: { dark: QR_INK, light: QR_PAPER, accent: QR_SWISS_RED },
    size: 720,
    margin: 0,
    levels: ['M', 'L'] as const,
  };

  it('draws one square per dark module outside the finders', () => {
    const text = 'https://slateforms.vercel.app/q/abcdefgh';
    const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
    const n = qr.modules.size;
    let dark = 0;
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const inFinder = (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);
        if (!inFinder && qr.modules.get(r, c)) dark++;
      }
    }
    const g = buildQrGeometry(text, base);
    // Three finders of three squares each.
    expect(g.shapes).toHaveLength(dark + 9);
    expect(g.width).toBe(720);
  });

  it('clears the middle for a logo and leaves room for a caption', () => {
    const text = 'https://example.com';
    const plain = buildQrGeometry(text, { ...base, levels: ['H'] });
    const withLogo = buildQrGeometry(text, {
      ...base,
      levels: ['H'],
      logoHref: 'data:image/png;base64,AA==',
      caption: 'Scan me',
    });
    expect(withLogo.shapes.length).toBeLessThan(plain.shapes.length);
    expect(withLogo.logo).not.toBeNull();
    expect(withLogo.height).toBeGreaterThan(withLogo.width);
    expect(withLogo.caption?.text).toBe('Scan me');
  });

  it('writes an SVG with the same colors, escaped caption and the logo', () => {
    const g = buildQrGeometry('https://example.com', {
      ...base,
      preset: 'soft',
      levels: ['H'],
      logoHref: 'data:image/png;base64,AA==',
      caption: 'Fish & <chips>',
    });
    const svg = qrGeometryToSvg(g);
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).toContain(`fill="${QR_PAPER}"`);
    expect(svg).toContain(`fill="${QR_INK}"`);
    expect(svg).toContain('Fish &amp; &lt;chips&gt;');
    expect(svg).toContain('href="data:image/png;base64,AA=="');
    expect(svg).not.toContain('<chips>');
  });

  it('says when a link is too long, and why', () => {
    expect(() => buildQrGeometry('x'.repeat(5000), base)).toThrow(QrTooLongError);
    // Fits at M (2,331 bytes) but not at Q (1,663), the least a logo allows.
    const long = `https://example.com/${'a'.repeat(1900)}`;
    expect(qrDrawProblem(long, DEFAULT_QR_STYLE)).toBeNull();
    expect(qrDrawProblem(long, { ...DEFAULT_QR_STYLE, preset: 'branded' })).toMatch(/logo/);
  });
});

describe('offline store', () => {
  beforeEach(() => {
    window.localStorage.clear();
    clearQrStore();
  });

  it('creates, edits, trashes, restores and deletes codes', async () => {
    await loadQrCodes();
    const s = await createQrCode({
      name: 'Menu',
      kind: 'static',
      targetUrl: 'https://example.com/menu',
      style: DEFAULT_QR_STYLE,
    });
    const d = await createQrCode({
      name: 'Reviews',
      kind: 'dynamic',
      targetUrl: 'https://example.com/review',
      style: DEFAULT_QR_STYLE,
    });
    expect(s.code).toBeNull();
    expect(d.code).toMatch(/^[a-hjkmnp-z2-9]{8}$/);
    expect(listQrCodes()).toHaveLength(2);
    expect(getQrQuota()).toEqual({ used: 2, max: 100 });

    await updateQrCode(s.id, { name: 'Lunch menu' });
    await setQrDestination(d.id, 'https://example.com/new');
    await expect(updateQrCode(d.id, { targetUrl: 'https://x.io' })).rejects.toThrow();

    await trashQrCode(s.id);
    expect(listQrCodes().map((r) => r.name)).toEqual(['Reviews']);
    expect(listTrashedQrCodes().map((r) => r.name)).toEqual(['Lunch menu']);
    // Trash still counts toward the limit.
    expect(getQrQuota().used).toBe(2);
    await restoreQrCode(s.id);
    expect(listTrashedQrCodes()).toHaveLength(0);

    // Survives a reload of the store.
    clearQrStore();
    await loadQrCodes();
    expect(listQrCodes().find((r) => r.id === d.id)?.targetUrl).toBe('https://example.com/new');
    expect(listQrCodes().find((r) => r.id === d.id)?.code).toBe(d.code);

    await deleteQrCodesForever([s.id, d.id]);
    expect(listQrCodes()).toHaveLength(0);
    expect(getQrQuota().used).toBe(0);
  });
});
