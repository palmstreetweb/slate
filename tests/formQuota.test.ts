import { describe, expect, it } from 'vitest';
import {
  FORM_QUOTA_MARKER,
  FORM_QUOTA_MAX,
  FormQuotaError,
  formQuotaUserMessage,
  isFormQuotaError,
  quotaFromUnknown,
} from '../examples/_admin/formQuota.ts';

describe('form quota errors', () => {
  it('parses PostgREST raise exception payloads', () => {
    const quota = quotaFromUnknown({
      code: 'P0001',
      message: FORM_QUOTA_MARKER,
      details: 'used=50 limit=50',
      hint: 'Permanently delete forms from Trash to make room.',
    });
    expect(quota).toEqual({ used: 50, max: 50 });
    expect(isFormQuotaError({ message: FORM_QUOTA_MARKER, details: 'used=12 limit=50' })).toBe(
      true,
    );
  });

  it('round-trips FormQuotaError', () => {
    const err = new FormQuotaError({ used: 50, max: 50 });
    expect(isFormQuotaError(err)).toBe(true);
    expect(quotaFromUnknown(err)).toEqual({ used: 50, max: 50 });
  });

  it('ignores unrelated neon errors', () => {
    expect(quotaFromUnknown({ message: 'Could not save form' })).toBeNull();
    expect(isFormQuotaError(new Error('jwt expired'))).toBe(false);
  });

  it('explains trash vs delete forever', () => {
    const atCap = formQuotaUserMessage({ used: FORM_QUOTA_MAX, max: FORM_QUOTA_MAX }, 3);
    expect(atCap).toContain(String(FORM_QUOTA_MAX));
    expect(atCap).toContain('Trash');
    expect(atCap).toContain('Delete forever');
  });
});
