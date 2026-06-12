/** Answer piping resolver (ADR-014). */

import { describe, it, expect } from 'vitest';
import { pipe, formatAnswer, pipeQuestionCopy } from '@/logic/piping.js';
import type { Question } from '@/types/Question.js';

describe('formatAnswer', () => {
  it('passes strings and stringifies numbers', () => {
    expect(formatAnswer('hello')).toBe('hello');
    expect(formatAnswer(7)).toBe('7');
  });

  it('joins arrays with ", "', () => {
    expect(formatAnswer(['a', 'b', 'c'])).toBe('a, b, c');
  });

  it('formats File as its name', () => {
    expect(formatAnswer(new File(['x'], 'resume.pdf'))).toBe('resume.pdf');
  });

  it('formats matrix answers as row: col pairs', () => {
    expect(formatAnswer({ quality: 'great', speed: ['ok', 'fast'] })).toBe(
      'quality: great, speed: ok, fast',
    );
  });

  it('empty for undefined / null', () => {
    expect(formatAnswer(undefined)).toBe('');
    expect(formatAnswer(null)).toBe('');
  });
});

describe('pipe', () => {
  it('replaces {{field:id}} with the answer', () => {
    expect(pipe('Hi {{field:name}}!', { name: 'Caleb' })).toBe('Hi Caleb!');
  });

  it('tolerates whitespace inside the braces', () => {
    expect(pipe('Hi {{ field:name }}!', { name: 'Caleb' })).toBe('Hi Caleb!');
  });

  it('unknown / unanswered fields resolve to empty string', () => {
    expect(pipe('Hi {{field:nope}}!', {})).toBe('Hi !');
  });

  it('replaces {{score}} with the score argument', () => {
    expect(pipe('You scored {{score}} points', {}, 42)).toBe('You scored 42 points');
  });

  it('multiple tokens in one template', () => {
    expect(pipe('{{field:a}} + {{field:b}} = {{score}}', { a: 'x', b: 'y' }, 3)).toBe(
      'x + y = 3',
    );
  });

  it('plain strings pass through untouched', () => {
    const s = 'No templates here';
    expect(pipe(s, { name: 'x' })).toBe(s);
  });
});

describe('pipeQuestionCopy', () => {
  it('resolves title, subtitle, and body', () => {
    const q: Question = {
      id: 's',
      type: 'statement',
      title: 'Thanks {{field:name}}',
      body: 'Score so far: {{score}}',
    };
    const out = pipeQuestionCopy(q, { name: 'Ada' }, 9) as typeof q;
    expect(out.title).toBe('Thanks Ada');
    expect(out.body).toBe('Score so far: 9');
  });

  it('runs function-style DynamicTitle first, then pipes its output', () => {
    const q: Question = {
      id: 'email',
      type: 'email',
      title: (a) => `Hi ${String(a.name)}, score {{score}}?`,
    };
    const out = pipeQuestionCopy(q, { name: 'Ada' }, 5) as { title: string };
    expect(out.title).toBe('Hi Ada, score 5?');
  });

  it('does not mutate the original question', () => {
    const q: Question = { id: 't', type: 'thanks', title: 'Bye {{field:name}}' };
    pipeQuestionCopy(q, { name: 'Ada' });
    expect(q.title).toBe('Bye {{field:name}}');
  });
});
