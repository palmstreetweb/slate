/**
 * Signatures as vector strokes (ADR-064): encoding, the strict parser the
 * server shares, size limits, "a real stroke, not a dot", and validation.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Question } from '@/index.js';
import {
  SIG_PATH_MAX,
  SIG_POINTS_MAX,
  inkStats,
  isRealSignature,
  parseSignaturePath,
  signaturePathOf,
  signatureTypedOf,
  type Point,
} from '@/logic/signature.js';
import { encodeSignature, simplifyStroke } from '@/logic/signatureEncode.js';
import { validate } from '@/logic/validation.js';
import { parseSignaturePathCore as serverParse } from '../neon/functions/submit-response/signature.js';

const sig: Question = { id: 's', type: 'signature', title: 'Sign', required: true };

/** A loopy "signature": a sine wave across the box, sampled finely. */
function wave(points = 400, from = 20, to = 480): Point[] {
  return Array.from({ length: points }, (_, i) => {
    const x = from + ((to - from) * i) / (points - 1);
    return [x, 100 + 60 * Math.sin(i / 9) + 8 * Math.sin(i * 1.7)] as Point;
  });
}

describe('encodeSignature', () => {
  it('round-trips through the parser within the box, quantized', () => {
    const strokes = [
      wave(),
      [
        [100, 40],
        [140, 42],
        [180, 45],
      ] as Point[],
    ];
    const path = encodeSignature(strokes);
    expect(path).toMatch(/^M\d+ \d+l/);
    const parsed = parseSignaturePath(path)!;
    expect(parsed).toHaveLength(2);
    for (const s of parsed) {
      for (const [x, y] of s) {
        expect(Number.isInteger(x) && Number.isInteger(y)).toBe(true);
        expect(x >= 0 && x <= 500 && y >= 0 && y <= 200).toBe(true);
      }
    }
    // Simplification keeps the shape: first and last points survive.
    expect(parsed[0]![0]).toEqual([20, Math.round(wave()[0]![1])]);
  });

  it('simplifies: 400 finely sampled points on a smooth stroke become far fewer', () => {
    const smooth = Array.from(
      { length: 400 },
      (_, i) => [20 + i * 1.15, 100 + 60 * Math.sin(i / 25)] as Point,
    );
    const path = encodeSignature([smooth]);
    expect(parseSignaturePath(path)![0]!.length).toBeLessThan(80);
    expect(path.length).toBeLessThan(700);
  });

  it('a wild scribble is simplified harder until it fits SIG_PATH_MAX', () => {
    const r = (() => {
      let s = 7;
      return () => (s = (s * 16807) % 2147483647) / 2147483647;
    })();
    const scribble = Array.from({ length: 40 }, () =>
      Array.from({ length: 300 }, () => [r() * 500, r() * 200] as Point),
    );
    const path = encodeSignature(scribble);
    expect(path.length).toBeLessThanOrEqual(SIG_PATH_MAX);
    expect(parseSignaturePath(path)).not.toBeNull();
  });

  it('clamps points drawn past the edge into the box', () => {
    const path = encodeSignature([
      [
        [-30, -5],
        [600, 250],
      ],
    ]);
    expect(parseSignaturePath(path)).toEqual([
      [
        [0, 0],
        [500, 200],
      ],
    ]);
  });

  it('no ink encodes to nothing', () => {
    expect(encodeSignature([])).toBe('');
    expect(encodeSignature([[]])).toBe('');
  });

  it('RDP keeps corners and drops straight-line interior points', () => {
    const line: Point[] = [
      [0, 0],
      [10, 0],
      [20, 0],
      [30, 0],
      [30, 30],
    ];
    expect(simplifyStroke(line, 0.5)).toEqual([
      [0, 0],
      [30, 0],
      [30, 30],
    ]);
  });
});

describe('parseSignaturePath (shared with the server)', () => {
  it('accepts exactly what the engine writes', () => {
    expect(parseSignaturePath('M10 20')).toEqual([[[10, 20]]]);
    expect(parseSignaturePath('M10 20l5 -3 -2 4M40 50')).toEqual([
      [
        [10, 20],
        [15, 17],
        [13, 21],
      ],
      [[40, 50]],
    ]);
  });

  it.each([
    ['empty', ''],
    ['markup', '<script>alert(1)</script>'],
    ['another command', 'M10 20C1 2 3 4 5 6'],
    ['decimals', 'M10.5 20'],
    ['trailing space', 'M10 20l1 1 '],
    ['double space', 'M10  20'],
    ['missing y', 'M10'],
    ['odd pair', 'M10 20l1'],
    ['lower-case m', 'm10 20'],
    ['out of the box', 'M900 20'],
    ['walks out of the box', 'M490 20l30 0'],
    ['five digits', 'M10000 20'],
    ['a newline', 'M10 20\nl1 1'],
    ['not a string', 42 as unknown as string],
  ])('refuses %s', (_label, path) => {
    expect(parseSignaturePath(path)).toBeNull();
    expect(serverParse(path)).toBeNull();
  });

  it('refuses paths over the size, stroke or point caps', () => {
    expect(parseSignaturePath(`M1 1l${'1 0 '.repeat(4000)}1 0`)).toBeNull();
    const manyPoints = `M0 100l${Array.from({ length: SIG_POINTS_MAX + 5 }, () => '0 0').join(' ')}`;
    expect(parseSignaturePath(manyPoints)).toBeNull();
    expect(parseSignaturePath('M1 1'.repeat(81))).toBeNull();
  });

  it('the server copy is byte-for-byte the engine’s', () => {
    const section = (path: string) => {
      const text = readFileSync(resolve(path), 'utf8');
      const start = text.indexOf(
        '/* ---------- shared with the server (keep identical) ---------- */',
      );
      const end = text.indexOf('/* ---------- engine-only helpers ---------- */');
      return (end === -1 ? text.slice(start) : text.slice(start, end)).trim();
    };
    expect(section('neon/functions/submit-response/signature.ts')).toBe(
      section('src/logic/signature.ts'),
    );
  });
});

describe('a real stroke, not a dot', () => {
  it('a dot, a tap and a tiny tick are not signatures; a line and a wave are', () => {
    expect(isRealSignature(parseSignaturePath('M100 100'))).toBe(false);
    expect(isRealSignature(parseSignaturePath('M100 100l2 1'))).toBe(false);
    expect(isRealSignature(parseSignaturePath('M100 100l10 5 -8 3'))).toBe(false);
    expect(isRealSignature(parseSignaturePath('M100 100l60 0'))).toBe(true);
    expect(isRealSignature(parseSignaturePath(encodeSignature([wave()])))).toBe(true);
    expect(isRealSignature(null)).toBe(false);
  });

  it('inkStats measures length and span', () => {
    expect(
      inkStats([
        [
          [0, 0],
          [3, 4],
        ],
      ]),
    ).toEqual({ length: 5, width: 3, height: 4 });
  });
});

describe('validate(signature)', () => {
  it('required: blank or {} asks to sign', () => {
    expect(validate(sig, undefined)?.message).toBe('Please sign here');
    expect(validate(sig, {})?.message).toBe('Please sign here');
    expect(validate({ ...sig, required: false } as Question, undefined)).toBeNull();
  });

  it('a dot fails even when optional; a real drawing passes', () => {
    expect(validate(sig, { path: 'M100 100' })?.code).toBe('too_small');
    expect(validate({ ...sig, required: false } as Question, { path: 'M100 100' })?.code).toBe(
      'too_small',
    );
    expect(validate(sig, { path: 'M20 150l60 -80 60 80 60 -80' })).toBeNull();
    expect(validate(sig, { path: 'M20 20C1 1' })?.code).toBe('shape');
  });

  it('a typed name needs two letters, and only when typing is allowed', () => {
    expect(validate(sig, { typed: 'Ada Lovelace' })).toBeNull();
    expect(validate(sig, { typed: 'A' })?.code).toBe('typed');
    expect(validate({ ...sig, allowTyped: false } as Question, { typed: 'Ada' })?.code).toBe(
      'shape',
    );
    expect(validate(sig, { typed: 'x'.repeat(101) })?.code).toBe('too_long');
  });

  it('reads the path or the typed name out of an answer', () => {
    expect(signaturePathOf({ path: 'M1 1' })).toBe('M1 1');
    expect(signaturePathOf({ typed: 'A' })).toBeNull();
    expect(signatureTypedOf({ typed: '  Ada ' })).toBe('Ada');
    expect(signatureTypedOf('Ada')).toBeNull();
  });
});
