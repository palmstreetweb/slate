/**
 * The owner's QR codes (ADR-075). Signed in, rows live in `qr_codes` (025)
 * behind owner RLS; offline (VITE_ADMIN_OFFLINE / no Neon URL) they live in
 * this browser so the studio can be tried without an account. Loaded when a
 * QR page opens, not at boot: the forms dashboard stays as fast as before.
 *
 * A dynamic code's destination is never written over the Data API (the
 * database pins it). It goes through POST /api/qr-target, which runs the
 * Web Risk check first (ADR-075 §7).
 */

import { isNeonConfigured } from '../neon/env.js';
import { authHeader } from '../storageUpload.js';
import {
  QR_QUOTA_MAX,
  sanitizeQrStyle,
  type QrKind,
  type QrRecord,
  type QrStyle,
} from './qrModel.js';

type Listener = () => void;

export type QrQuota = { used: number; max: number };

const OFFLINE_KEY = 'slate-qr-codes';
const QUOTA_MARKER = 'QR_QUOTA_EXCEEDED';
const COLUMNS = 'id,name,kind,code,target_url,style,created_at,updated_at,deleted_at';
const CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

export class QrQuotaError extends Error {
  constructor() {
    super(QUOTA_MARKER);
    this.name = 'QrQuotaError';
  }
}

/** The destination door's refusals, in words an owner can act on. */
export class QrTargetError extends Error {
  readonly reason: 'unsafe' | 'invalid' | 'unavailable' | 'failed';
  /** Set when a new dynamic code was made but its destination was refused. */
  record?: QrRecord;
  constructor(reason: QrTargetError['reason'], message: string) {
    super(message);
    this.name = 'QrTargetError';
    this.reason = reason;
  }
}

let records: QrRecord[] = [];
let scans = new Map<string, number>();
let quota: QrQuota | null = null;
let loaded = false;
let inflight: Promise<void> | null = null;
/** Bumps on sign-out so a load that started for the last owner can't land. */
let generation = 0;
const listeners = new Set<Listener>();

function emit(): void {
  for (const l of listeners) l();
}

export function subscribeQr(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function isQrLoaded(): boolean {
  return loaded;
}

export function listQrCodes(): QrRecord[] {
  return records.filter((r) => !r.deletedAt);
}

export function listTrashedQrCodes(): QrRecord[] {
  return records.filter((r) => r.deletedAt);
}

export function getQrCode(id: string): QrRecord | null {
  return records.find((r) => r.id === id) ?? null;
}

/** Total counted scans (dynamic codes only). */
export function qrScanCount(id: string): number {
  return scans.get(id) ?? 0;
}

export function getQrQuota(): QrQuota {
  return quota ?? { used: records.length, max: QR_QUOTA_MAX };
}

/** Trash counts toward the limit (ADR-075 §10). */
export function isAtQrQuota(): boolean {
  const q = getQrQuota();
  return q.used >= q.max;
}

export function isQrQuotaError(err: unknown): boolean {
  if (err instanceof QrQuotaError) return true;
  return errorText(err).includes(QUOTA_MARKER);
}

/** Sign-out: forget the last owner's codes. */
export function clearQrStore(): void {
  generation += 1;
  records = [];
  scans = new Map();
  quota = null;
  loaded = false;
  inflight = null;
  emit();
}

function errorText(err: unknown): string {
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object') {
    const e = err as Record<string, unknown>;
    return [e.message, e.details, e.hint, e.code].filter((p) => typeof p === 'string').join(' ');
  }
  return '';
}

function fromRow(row: Record<string, unknown>): QrRecord {
  return {
    id: String(row.id),
    name: typeof row.name === 'string' ? row.name : '',
    kind: row.kind === 'dynamic' ? 'dynamic' : 'static',
    code: typeof row.code === 'string' ? row.code : null,
    targetUrl: typeof row.target_url === 'string' ? row.target_url : null,
    style: sanitizeQrStyle(row.style),
    createdAt: String(row.created_at ?? new Date().toISOString()),
    updatedAt: String(row.updated_at ?? new Date().toISOString()),
    deletedAt: typeof row.deleted_at === 'string' ? row.deleted_at : null,
  };
}

function sortRecords(): void {
  records.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
}

function upsertLocal(record: QrRecord): void {
  const i = records.findIndex((r) => r.id === record.id);
  if (i === -1) records.push(record);
  else records[i] = record;
  sortRecords();
}

// ── offline ──────────────────────────────────────────────────────────────

function readOffline(): QrRecord[] {
  try {
    const raw = window.localStorage.getItem(OFFLINE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((r): r is Record<string, unknown> => Boolean(r) && typeof r === 'object')
      .map(fromRow);
  } catch {
    return [];
  }
}

function writeOffline(): void {
  try {
    window.localStorage.setItem(
      OFFLINE_KEY,
      JSON.stringify(
        records.map((r) => ({
          id: r.id,
          name: r.name,
          kind: r.kind,
          code: r.code,
          target_url: r.targetUrl,
          style: r.style,
          created_at: r.createdAt,
          updated_at: r.updatedAt,
          deleted_at: r.deletedAt,
        })),
      ),
    );
  } catch {
    // Storage full or blocked: the codes stay for this tab.
  }
}

/** The database draws codes (025); offline mimics it so the preview has a link to show. */
function offlineCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

// ── remote ───────────────────────────────────────────────────────────────

async function neon() {
  const [{ getNeon }, { ensureAuthForDataApi }] = await Promise.all([
    import('../neon/env.js'),
    import('../neon/ensureAuth.js'),
  ]);
  await ensureAuthForDataApi();
  return getNeon();
}

async function fetchQuota(client: Awaited<ReturnType<typeof neon>>): Promise<QrQuota | null> {
  try {
    const { data, error } = await client.rpc('qr_quota_status');
    if (error) return null;
    const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined;
    const used = Number(row?.used);
    const max = Number(row?.quota_limit);
    return Number.isFinite(used) && Number.isFinite(max) && max > 0 ? { used, max } : null;
  } catch {
    return null;
  }
}

async function refreshQuota(): Promise<void> {
  if (!isNeonConfigured()) return;
  const gen = generation;
  const q = await fetchQuota(await neon());
  if (gen !== generation || !q) return;
  quota = q;
  emit();
}

/**
 * Load the owner's codes. Rejects on failure: a failed load is never shown as
 * an empty list.
 */
export function loadQrCodes(opts?: { force?: boolean }): Promise<void> {
  if (loaded && !opts?.force) return Promise.resolve();
  if (inflight) return inflight;
  const gen = generation;
  inflight = (async () => {
    try {
      if (!isNeonConfigured()) {
        records = readOffline();
        sortRecords();
        quota = null;
        loaded = true;
        emit();
        return;
      }
      const client = await neon();
      const [list, days, q] = await Promise.all([
        client.from('qr_codes').select(COLUMNS).order('updated_at', { ascending: false }),
        client.from('qr_scan_days').select('code_id,scans'),
        fetchQuota(client),
      ]);
      if (list.error) throw list.error;
      if (gen !== generation) return;
      records = ((list.data ?? []) as Record<string, unknown>[]).map(fromRow);
      sortRecords();
      // Counts are a nice-to-have: a failed read leaves them at zero.
      const totals = new Map<string, number>();
      if (!days.error) {
        for (const row of (days.data ?? []) as Array<{ code_id?: unknown; scans?: unknown }>) {
          const id = String(row.code_id);
          totals.set(id, (totals.get(id) ?? 0) + (Number(row.scans) || 0));
        }
      }
      scans = totals;
      quota = q;
      loaded = true;
      emit();
    } finally {
      if (gen === generation) inflight = null;
    }
  })();
  return inflight;
}

export type NewQrCode = {
  name: string;
  kind: QrKind;
  /** Static: the link the QR holds. Dynamic: saved through the destination door. */
  targetUrl: string;
  style: QrStyle;
};

/**
 * Create a code. For a dynamic code the row is created first (the database
 * draws its code), then its destination goes through the door; if that step
 * is refused the code exists with no destination, and the QrTargetError says
 * why and carries the new record.
 */
export async function createQrCode(input: NewQrCode): Promise<QrRecord> {
  await loadQrCodes();
  if (isAtQrQuota()) throw new QrQuotaError();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  if (!isNeonConfigured()) {
    const record: QrRecord = {
      id,
      name: input.name.trim(),
      kind: input.kind,
      code: input.kind === 'dynamic' ? offlineCode() : null,
      targetUrl: input.targetUrl,
      style: input.style,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    upsertLocal(record);
    writeOffline();
    emit();
    return record;
  }

  const client = await neon();
  const { data, error } = await client
    .from('qr_codes')
    .insert({
      id,
      name: input.name.trim(),
      kind: input.kind,
      target_url: input.kind === 'static' ? input.targetUrl : null,
      style: input.style,
    })
    .select(COLUMNS)
    .single();
  if (error) {
    if (isQrQuotaError(error)) {
      void refreshQuota();
      throw new QrQuotaError();
    }
    throw error;
  }
  const record = fromRow(data as Record<string, unknown>);
  upsertLocal(record);
  if (quota) quota = { ...quota, used: quota.used + 1 };
  emit();
  if (input.kind === 'dynamic') {
    try {
      return await setQrDestination(record.id, input.targetUrl);
    } catch (err) {
      if (err instanceof QrTargetError) err.record = record;
      throw err;
    }
  }
  return record;
}

export type QrPatch = Partial<Pick<QrRecord, 'name' | 'style'>> & {
  /** Static codes only: a new link is a new image. */
  targetUrl?: string;
};

export async function updateQrCode(id: string, patch: QrPatch): Promise<QrRecord> {
  const current = getQrCode(id);
  if (!current) throw new Error('That QR code isn’t here anymore.');
  if (patch.targetUrl !== undefined && current.kind === 'dynamic') {
    throw new Error('Dynamic destinations go through setQrDestination.');
  }

  if (!isNeonConfigured()) {
    const record: QrRecord = {
      ...current,
      ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
      ...(patch.style ? { style: patch.style } : {}),
      ...(patch.targetUrl !== undefined ? { targetUrl: patch.targetUrl } : {}),
      updatedAt: new Date().toISOString(),
    };
    upsertLocal(record);
    writeOffline();
    emit();
    return record;
  }

  const row: Record<string, unknown> = {};
  if (patch.name !== undefined) row.name = patch.name.trim();
  if (patch.style) row.style = patch.style;
  if (patch.targetUrl !== undefined) row.target_url = patch.targetUrl;
  const client = await neon();
  const { data, error } = await client
    .from('qr_codes')
    .update(row)
    .eq('id', id)
    .select(COLUMNS)
    .single();
  if (error) throw error;
  const record = fromRow(data as Record<string, unknown>);
  upsertLocal(record);
  emit();
  return record;
}

/** A dynamic code's destination, through the Web Risk check in /api/qr-target (ADR-075 §7). */
export async function setQrDestination(id: string, url: string): Promise<QrRecord> {
  const current = getQrCode(id);
  if (!current || current.kind !== 'dynamic') throw new Error('That QR code isn’t here anymore.');

  if (!isNeonConfigured()) {
    const record = { ...current, targetUrl: url, updatedAt: new Date().toISOString() };
    upsertLocal(record);
    writeOffline();
    emit();
    return record;
  }

  let res: Response;
  try {
    res = await fetch('/api/qr-target', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
      body: JSON.stringify({ id, url }),
    });
  } catch {
    throw new QrTargetError(
      'failed',
      'Couldn’t save the link. Check your connection and try again.',
    );
  }
  const body = (await res.json().catch(() => ({}))) as {
    error?: unknown;
    target_url?: unknown;
    updated_at?: unknown;
  };
  if (!res.ok) {
    const message = typeof body.error === 'string' ? body.error : '';
    if (res.status === 422) {
      throw new QrTargetError(
        'unsafe',
        message || 'Google flags that link as unsafe, so Slate won’t send people there.',
      );
    }
    if (res.status === 400) {
      throw new QrTargetError('invalid', message || 'That link can’t be used.');
    }
    if (res.status === 503) {
      throw new QrTargetError(
        'unavailable',
        message || 'Slate can’t check links right now. Try again in a minute.',
      );
    }
    // 401 signed out, 404 gone or in Trash, 429 too many changes: the server's sentence says which.
    if (res.status === 401 || res.status === 404 || res.status === 429) {
      throw new QrTargetError('failed', message || 'Couldn’t save the link. Try again.');
    }
    throw new QrTargetError('failed', 'Couldn’t save the link. Try again.');
  }
  const record: QrRecord = {
    ...current,
    targetUrl: typeof body.target_url === 'string' ? body.target_url : url,
    updatedAt: typeof body.updated_at === 'string' ? body.updated_at : new Date().toISOString(),
  };
  upsertLocal(record);
  emit();
  return record;
}

async function setDeleted(ids: string[], deletedAt: string | null): Promise<void> {
  if (ids.length === 0) return;
  if (isNeonConfigured()) {
    const client = await neon();
    const { error } = await client.from('qr_codes').update({ deleted_at: deletedAt }).in('id', ids);
    if (error) throw error;
  }
  const now = new Date().toISOString();
  for (const id of ids) {
    const r = getQrCode(id);
    if (r) upsertLocal({ ...r, deletedAt, updatedAt: now });
  }
  if (!isNeonConfigured()) writeOffline();
  emit();
}

/** Trashed codes stop opening ("isn't active right now") until restored. */
export function trashQrCode(id: string): Promise<void> {
  return setDeleted([id], new Date().toISOString());
}

export function restoreQrCode(id: string): Promise<void> {
  return setDeleted([id], null);
}

export function restoreAllQrCodes(): Promise<void> {
  return setDeleted(
    listTrashedQrCodes().map((r) => r.id),
    null,
  );
}

/** Gone for good; a dynamic code's short link is retired, never reused. */
export async function deleteQrCodesForever(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  if (isNeonConfigured()) {
    const client = await neon();
    const { error } = await client.from('qr_codes').delete().in('id', ids);
    if (error) throw error;
  }
  const gone = new Set(ids);
  records = records.filter((r) => !gone.has(r.id));
  for (const id of ids) scans.delete(id);
  if (quota) quota = { ...quota, used: Math.max(0, quota.used - ids.length) };
  if (!isNeonConfigured()) writeOffline();
  emit();
  void refreshQuota();
}
