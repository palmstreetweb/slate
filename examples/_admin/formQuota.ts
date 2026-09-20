/**
 * Per-user form cap (ADR-038). The database is the hard stop; this module is
 * copy + error parsing so the UI can explain a rejected insert.
 */

export const FORM_QUOTA_MAX = 50;
export const FORM_QUOTA_MARKER = 'FORM_QUOTA_EXCEEDED';

export type FormQuota = {
  used: number;
  max: number;
};

export class FormQuotaError extends Error {
  readonly used: number;
  readonly max: number;

  constructor(quota: FormQuota) {
    super(FORM_QUOTA_MARKER);
    this.name = 'FormQuotaError';
    this.used = quota.used;
    this.max = quota.max;
  }
}

export function isFormQuotaError(err: unknown): boolean {
  if (err instanceof FormQuotaError) return true;
  if (err && typeof err === 'object' && (err as { name?: string }).name === 'FormQuotaError') {
    return true;
  }
  return quotaFromUnknown(err) !== null;
}

export function quotaFromUnknown(err: unknown): FormQuota | null {
  if (err instanceof FormQuotaError) {
    return { used: err.used, max: err.max };
  }
  if (err && typeof err === 'object' && (err as { name?: string }).name === 'FormQuotaError') {
    const q = err as { used?: unknown; max?: unknown };
    if (typeof q.used === 'number' && typeof q.max === 'number') {
      return { used: q.used, max: q.max };
    }
  }
  const text = neonishText(err);
  if (!text.includes(FORM_QUOTA_MARKER)) {
    return null;
  }
  const parsed = /used\s*=\s*(\d+).*limit\s*=\s*(\d+)/i.exec(text);
  if (parsed) {
    return { used: Number(parsed[1]), max: Number(parsed[2]) };
  }
  return { used: FORM_QUOTA_MAX, max: FORM_QUOTA_MAX };
}

export function formQuotaUserMessage(quota: FormQuota, trashCount = 0): string {
  const max = quota.max > 0 ? quota.max : FORM_QUOTA_MAX;
  const trash =
    trashCount > 0
      ? ` Trash currently holds ${trashCount}. Delete forever from Trash to make room.`
      : ' Move a form to Trash, then delete it forever to make room.';
  return `This account can keep ${max} forms, including ones in Trash.${trash}`;
}

function neonishText(err: unknown): string {
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object') {
    const e = err as Record<string, unknown>;
    return [e.message, e.details, e.hint, e.code].filter((p) => typeof p === 'string').join(' ');
  }
  return '';
}
