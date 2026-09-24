// @vitest-environment node
/**
 * vercel.json header rules (ADR-054). Vercel applies EVERY header rule whose
 * `source` matches, so the framing policy must come from sources that never
 * overlap — not from rule order.
 *
 * Vercel compiles each `source` with path-to-regexp 6.x
 * (`@vercel/routing-utils` → `sourceToRegex`, options
 * `{ strict: true, sensitive: true, delimiter: '/' }`) and matches the result
 * against the request path. That package isn't in node_modules, so
 * `sourceToRegex` below is a line-for-line port of its `lexer`, `parse` and
 * `tokensToRegexp` for exactly those options. The first block pins the port to
 * outputs path-to-regexp 6 produces for sources in this file.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

type Header = { key: string; value: string };
type Rule = { source: string; headers: Header[] };

const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')) as {
  headers: Rule[];
  rewrites: { source: string; destination: string }[];
};

// ---------- path-to-regexp 6.x port (strict, sensitive, delimiter '/') ----------

type LexToken = {
  type: 'OPEN' | 'CLOSE' | 'PATTERN' | 'NAME' | 'CHAR' | 'ESCAPED_CHAR' | 'MODIFIER' | 'END';
  value: string;
};
type Key = {
  name: string | number;
  prefix: string;
  suffix: string;
  pattern: string;
  modifier: string;
};

function lexer(str: string): LexToken[] {
  const tokens: LexToken[] = [];
  let i = 0;
  while (i < str.length) {
    const char = str[i]!;
    if (char === '*' || char === '+' || char === '?') {
      tokens.push({ type: 'MODIFIER', value: str[i++]! });
      continue;
    }
    if (char === '\\') {
      i++;
      tokens.push({ type: 'ESCAPED_CHAR', value: str[i++]! });
      continue;
    }
    if (char === '{') {
      tokens.push({ type: 'OPEN', value: str[i++]! });
      continue;
    }
    if (char === '}') {
      tokens.push({ type: 'CLOSE', value: str[i++]! });
      continue;
    }
    if (char === ':') {
      let name = '';
      let j = i + 1;
      while (j < str.length && /[0-9A-Za-z_]/.test(str[j]!)) name += str[j++];
      if (!name) throw new TypeError(`Missing parameter name at ${i}`);
      tokens.push({ type: 'NAME', value: name });
      i = j;
      continue;
    }
    if (char === '(') {
      let count = 1;
      let pattern = '';
      let j = i + 1;
      if (str[j] === '?') throw new TypeError(`Pattern cannot start with "?" at ${j}`);
      while (j < str.length) {
        if (str[j] === '\\') {
          pattern += str[j++]! + str[j++]!;
          continue;
        }
        if (str[j] === ')') {
          count--;
          if (count === 0) {
            j++;
            break;
          }
        } else if (str[j] === '(') {
          count++;
          if (str[j + 1] !== '?') throw new TypeError(`Capturing groups are not allowed at ${j}`);
        }
        pattern += str[j++];
      }
      if (count) throw new TypeError(`Unbalanced pattern at ${i}`);
      if (!pattern) throw new TypeError(`Missing pattern at ${i}`);
      tokens.push({ type: 'PATTERN', value: pattern });
      i = j;
      continue;
    }
    tokens.push({ type: 'CHAR', value: str[i++]! });
  }
  tokens.push({ type: 'END', value: '' });
  return tokens;
}

function escapeString(str: string): string {
  return str.replace(/([.+*?=^!:${}()[\]|/\\])/g, '\\$1');
}

function parse(str: string): (string | Key)[] {
  const tokens = lexer(str);
  const prefixes = './';
  const defaultPattern = `[^${escapeString('/')}]+?`;
  const result: (string | Key)[] = [];
  let key = 0;
  let i = 0;
  let path = '';
  const tryConsume = (type: LexToken['type']) =>
    i < tokens.length && tokens[i]!.type === type ? tokens[i++]!.value : undefined;
  const mustConsume = (type: LexToken['type']) => {
    const value = tryConsume(type);
    if (value !== undefined) return value;
    throw new TypeError(`Unexpected ${tokens[i]!.type}, expected ${type}`);
  };
  const consumeText = () => {
    let out = '';
    let value: string | undefined;
    while ((value = tryConsume('CHAR') || tryConsume('ESCAPED_CHAR'))) out += value;
    return out;
  };

  while (i < tokens.length) {
    const char = tryConsume('CHAR');
    const name = tryConsume('NAME');
    const pattern = tryConsume('PATTERN');
    if (name || pattern) {
      let prefix = char || '';
      if (prefixes.indexOf(prefix) === -1) {
        path += prefix;
        prefix = '';
      }
      if (path) {
        result.push(path);
        path = '';
      }
      result.push({
        name: name || key++,
        prefix,
        suffix: '',
        pattern: pattern || defaultPattern,
        modifier: tryConsume('MODIFIER') || '',
      });
      continue;
    }
    const value = char || tryConsume('ESCAPED_CHAR');
    if (value) {
      path += value;
      continue;
    }
    if (path) {
      result.push(path);
      path = '';
    }
    const open = tryConsume('OPEN');
    if (open) {
      const prefix = consumeText();
      const groupName = tryConsume('NAME') || '';
      const groupPattern = tryConsume('PATTERN') || '';
      const suffix = consumeText();
      mustConsume('CLOSE');
      result.push({
        name: groupName || (groupPattern ? key++ : ''),
        pattern: groupName && !groupPattern ? defaultPattern : groupPattern,
        prefix,
        suffix,
        modifier: tryConsume('MODIFIER') || '',
      });
      continue;
    }
    mustConsume('END');
  }
  return result;
}

/**
 * `tokensToRegexp` for Vercel's options: anchored, strict (no optional
 * trailing slash), case-sensitive (no `i` flag). Returns the pattern string.
 */
function compileSource(source: string): string {
  let route = '^';
  for (const token of parse(source)) {
    if (typeof token === 'string') {
      route += escapeString(token);
      continue;
    }
    const prefix = escapeString(token.prefix);
    const suffix = escapeString(token.suffix);
    if (token.pattern) {
      if (prefix || suffix) {
        if (token.modifier === '+' || token.modifier === '*') {
          const mod = token.modifier === '*' ? '?' : '';
          route += `(?:${prefix}((?:${token.pattern})(?:${suffix}${prefix}(?:${token.pattern}))*)${suffix})${mod}`;
        } else {
          route += `(?:${prefix}(${token.pattern})${suffix})${token.modifier}`;
        }
      } else {
        if (token.modifier === '+' || token.modifier === '*') {
          throw new TypeError(`Can not repeat "${token.name}" without a prefix and suffix`);
        }
        route += `(${token.pattern})${token.modifier}`;
      }
    } else {
      route += `(?:${prefix}${suffix})${token.modifier}`;
    }
  }
  return `${route}$`;
}

function sourceToRegex(source: string): RegExp {
  return new RegExp(compileSource(source));
}

// ---------- effective headers per path ----------

function rulesFor(path: string): Rule[] {
  return vercel.headers.filter((rule) => sourceToRegex(rule.source).test(path));
}

/** Every header Vercel would send for `path`, key → values (all matching rules). */
function headersFor(path: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const rule of rulesFor(path)) {
    for (const { key, value } of rule.headers) {
      out.set(key.toLowerCase(), [...(out.get(key.toLowerCase()) ?? []), value]);
    }
  }
  return out;
}

function directives(csp: string): Map<string, string> {
  return new Map(
    csp
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const [name, ...rest] = part.split(/\s+/);
        return [name!, rest.join(' ')] as const;
      }),
  );
}

const PUBLIC_FILL = ['/forms/12345678', '/forms/805-seal-coating-for-brent', '/forms/newsletter'];
const EVERYTHING_ELSE = [
  '/',
  '/forms/f_abc/edit',
  '/forms/f_abc/preview',
  '/forms/f_abc/submissions',
  '/forms/new',
  '/forms/new/',
  '/forms/12345678/',
  '/forms/',
  '/forms',
  '/Forms/12345678',
  '/settings',
  '/r',
  '/lab/drop',
  '/index.html',
  '/assets/x.js',
  '/api/generate',
  '/brand/',
];

describe('path-to-regexp port matches Vercel', () => {
  it.each([
    ['/', '^\\/$'],
    ['/index.html', '^\\/index\\.html$'],
    ['/assets/(.*)', '^\\/assets(?:\\/(.*))$'],
    ['/(.*)', '^(?:\\/(.*))$'],
    // Patterns inside `( )` pass through verbatim; only literal text is escaped.
    ['/((?!brand/|api/).*)', '^(?:\\/((?!brand/|api/).*))$'],
    ['/forms/((?!new$)[^/]+)', '^\\/forms(?:\\/((?!new$)[^/]+))$'],
  ])('%s compiles to %s', (source, expected) => {
    expect(compileSource(source)).toBe(expected);
  });

  it('rejects what Vercel rejects (bare capturing groups)', () => {
    expect(() => sourceToRegex('/(a(b))')).toThrow(/Capturing groups/);
    expect(() => sourceToRegex('/(?!x)')).toThrow(/cannot start with/);
  });

  it('every source in vercel.json compiles', () => {
    for (const { source } of [...vercel.headers, ...vercel.rewrites]) {
      expect(() => sourceToRegex(source)).not.toThrow();
    }
  });
});

describe('vercel.json framing (ADR-054)', () => {
  it.each(PUBLIC_FILL)('%s may be framed by any site', (path) => {
    const h = headersFor(path);
    expect(h.get('content-security-policy')).toHaveLength(1);
    expect(directives(h.get('content-security-policy')![0]!).get('frame-ancestors')).toBe('*');
    expect(h.has('x-frame-options')).toBe(false);
  });

  it.each(EVERYTHING_ELSE)('%s still refuses every frame', (path) => {
    const h = headersFor(path);
    expect(h.get('content-security-policy')).toHaveLength(1);
    expect(directives(h.get('content-security-policy')![0]!).get('frame-ancestors')).toBe("'none'");
    expect(h.get('x-frame-options')).toEqual(['DENY']);
  });

  it('the two CSPs differ only in frame-ancestors', () => {
    const open = directives(headersFor('/forms/12345678').get('content-security-policy')![0]!);
    const closed = directives(headersFor('/settings').get('content-security-policy')![0]!);
    open.delete('frame-ancestors');
    closed.delete('frame-ancestors');
    expect([...open]).toEqual([...closed]);
    expect(closed.get('script-src')).toBe("'self'");
    expect(closed.has('upgrade-insecure-requests')).toBe(true);
  });

  it.each([...PUBLIC_FILL, ...EVERYTHING_ELSE])(
    '%s keeps nosniff, referrer, permissions and HSTS exactly once',
    (path) => {
      const h = headersFor(path);
      expect(h.get('x-content-type-options')).toEqual(['nosniff']);
      expect(h.get('referrer-policy')).toEqual(['strict-origin-when-cross-origin']);
      expect(h.get('permissions-policy')).toEqual([
        'camera=(self), microphone=(), geolocation=(), payment=()',
      ]);
      expect(h.get('strict-transport-security')).toEqual(['max-age=31536000; includeSubDomains']);
    },
  );

  it('cache rules are unchanged', () => {
    expect(headersFor('/assets/x.js').get('cache-control')).toEqual([
      'public, max-age=31536000, immutable',
    ]);
    expect(headersFor('/').get('cache-control')).toEqual(['no-cache']);
    expect(headersFor('/index.html').get('cache-control')).toEqual(['no-cache']);
    expect(headersFor('/forms/12345678').has('cache-control')).toBe(false);
  });

  it('framable paths are exactly the ones the router serves as public fill', async () => {
    const { matchRoute } = await import('../examples/_admin/_router.js');
    for (const path of [...PUBLIC_FILL, ...EVERYTHING_ELSE]) {
      const framable = headersFor(path).get('x-frame-options') === undefined;
      // A trailing slash or odd case can still reach fill in the router, but
      // then it is refused a frame: fail closed, never the other way round.
      if (framable) expect(matchRoute(path).name).toBe('fill');
    }
  });
});
