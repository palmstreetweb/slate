import { describe, expect, it } from 'vitest';
import type { FormRecord } from '../examples/_admin/_formsStore.js';
import type { StoredSubmission } from '../examples/_admin/_submissionStore.js';
import {
  buildBackup,
  parseBackup,
  serializeBackup,
} from '../examples/_admin/dataBackup.js';

describe('dataBackup', () => {
  const forms: FormRecord[] = [
    {
      id: 'f_1',
      name: 'Test',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      schema: { brand: { name: 'Test' }, theme: 'classic', themeMode: 'light', questions: [] },
    },
  ];
  const submissions: StoredSubmission[] = [];

  it('round-trips through JSON', () => {
    const backup = buildBackup(forms, submissions);
    const parsed = parseBackup(serializeBackup(backup));
    expect(parsed?.forms).toHaveLength(1);
    expect(parsed?.forms[0]?.name).toBe('Test');
  });

  it('rejects invalid backup', () => {
    expect(parseBackup('{}')).toBeNull();
    expect(parseBackup('not json')).toBeNull();
  });
});
