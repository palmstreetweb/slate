/**
 * Type-only inference smoke tests. `expectTypeOf` is a compile-time check —
 * runtime is a no-op. The whole point is that this file failing to compile
 * == an inference regression in `defineSchema` / `AnswersOf`.
 */

import { describe, it, expectTypeOf } from 'vitest';
import { defineSchema, type AnswersOf, type Answers } from '@/index.js';

describe('defineSchema → AnswersOf inference', () => {
  it('required short_text → string (not undefined)', () => {
    const _schema = defineSchema({
      brand: { name: 'X' },
      theme: 'editorial',
      themeMode: 'toggle',
      questions: [
        { id: 'name', type: 'short_text', title: 'Name?', required: true },
        { id: 'done', type: 'thanks', title: 'Done.' },
      ],
    });
    type A = AnswersOf<typeof _schema.questions>;
    expectTypeOf<A['name']>().toEqualTypeOf<string>();
  });

  it('optional short_text → string | undefined', () => {
    const _schema = defineSchema({
      brand: { name: 'X' },
      theme: 'editorial',
      themeMode: 'toggle',
      questions: [
        { id: 'notes', type: 'short_text', title: 'Notes?' },
        { id: 'done', type: 'thanks', title: 'Done.' },
      ],
    });
    type A = AnswersOf<typeof _schema.questions>;
    expectTypeOf<A['notes']>().toEqualTypeOf<string | undefined>();
  });

  it('single_choice → literal union of option values (defaults to required)', () => {
    const _schema = defineSchema({
      brand: { name: 'X' },
      theme: 'swiss',
      themeMode: 'toggle',
      questions: [
        {
          id: 'service',
          type: 'single_choice',
          title: 'Which?',
          options: [
            { label: 'Sealcoating', value: 'sealcoat' },
            { label: 'Striping', value: 'striping' },
          ],
        },
        { id: 'done', type: 'thanks', title: 'Done.' },
      ],
    });
    type A = AnswersOf<typeof _schema.questions>;
    expectTypeOf<A['service']>().toEqualTypeOf<'sealcoat' | 'striping'>();
  });

  it('multi_choice → array of literal option values', () => {
    const _schema = defineSchema({
      brand: { name: 'X' },
      theme: 'swiss',
      themeMode: 'toggle',
      questions: [
        {
          id: 'features',
          type: 'multi_choice',
          title: 'Pick any',
          options: [
            { label: 'Crack fill', value: 'crack' },
            { label: 'Striping', value: 'stripe' },
            { label: 'Sealcoat', value: 'seal' },
          ],
        },
        { id: 'done', type: 'thanks', title: 'Done.' },
      ],
    });
    type A = AnswersOf<typeof _schema.questions>;
    expectTypeOf<A['features']>().toEqualTypeOf<Array<'crack' | 'stripe' | 'seal'> | undefined>();
  });

  it('number + scale → number; welcome/statement/thanks excluded from answers', () => {
    const _schema = defineSchema({
      brand: { name: 'X' },
      theme: 'editorial',
      themeMode: 'toggle',
      questions: [
        { id: 'welcome', type: 'welcome', title: 'Hi.' },
        { id: 'sqft', type: 'number', title: 'Sq ft?', required: true, min: 0 },
        { id: 'rating', type: 'scale', title: 'Rate', min: 0, max: 10, required: true },
        { id: 'note', type: 'statement', title: 'Note', body: 'FYI...' },
        { id: 'done', type: 'thanks', title: 'Done.' },
      ],
    });
    type A = AnswersOf<typeof _schema.questions>;
    expectTypeOf<A['sqft']>().toEqualTypeOf<number>();
    expectTypeOf<A['rating']>().toEqualTypeOf<number>();

    // Compile-time: chrome screens must NOT appear in the answers map.
    type Keys = keyof A;
    expectTypeOf<Keys>().toEqualTypeOf<'sqft' | 'rating'>();
  });

  it('LooseAnswers (Answers) is the runtime-shaped fallback', () => {
    // Widened in Phase 3: File for file_upload (ADR-012) and MatrixAnswer
    // (Record<row, col | col[]>) for matrix (ADR-013).
    expectTypeOf<Answers>().toEqualTypeOf<
      Record<
        string,
        string | string[] | number | File | Record<string, string | string[]> | undefined
      >
    >();
  });
});
