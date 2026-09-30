/**
 * Portable share links — embed a form schema in the URL so anyone can open
 * and fill it without sharing the author's localStorage. Static-host friendly.
 */

import type { Schema } from '@/index.js';

const MAX_ENCODED_LEN = 120_000;

type PortablePayload = {
  v: 1;
  schema: Schema;
  /** Original form id — submissions land here when the author uses the same browser. */
  formId?: string;
  name?: string;
};

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  const b64 = btoa(binary);
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(token: string): Uint8Array {
  const b64 = token.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
  const binary = atob(b64 + pad);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function encodeUtf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

/**
 * A pin-the-spot photo uploaded in the studio rides in the schema as a
 * `data:` image (ADR-065). The portable reader drops those anyway (only https
 * images survive `sanitizeUntrustedSchema`), so leave them out of the link.
 */
function withoutUploadedImages(schema: Schema): Schema {
  if (!schema.questions.some((q) => q.type === 'image_pin' && q.image?.startsWith('data:'))) {
    return schema;
  }
  return {
    ...schema,
    questions: schema.questions.map((q) => {
      if (q.type !== 'image_pin' || !q.image?.startsWith('data:')) return q;
      const { image: _dropped, ...rest } = q;
      return rest;
    }),
  };
}

/** Serialize schema (+ optional metadata) to a URL-safe token. */
export function encodePortableSchema(
  schema: Schema,
  meta?: { formId?: string; name?: string },
): string {
  const payload: PortablePayload = { v: 1, schema: withoutUploadedImages(schema), ...meta };
  const json = JSON.stringify(payload);
  return toBase64Url(encodeUtf8(json));
}

/** Decode a portable token back to schema + metadata. Returns null when invalid. */
export function decodePortableSchema(token: string): PortablePayload | null {
  if (!token || token.length > MAX_ENCODED_LEN) return null;
  try {
    const json = decodeUtf8(fromBase64Url(token));
    const parsed = JSON.parse(json) as PortablePayload;
    if (parsed?.v !== 1 || !parsed.schema || typeof parsed.schema !== 'object') return null;
    if (!Array.isArray(parsed.schema.questions)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Full share URL with schema embedded — works on any device/browser. */
export function buildPortableShareUrl(
  schema: Schema,
  meta?: { formId?: string; name?: string },
): string {
  const token = encodePortableSchema(schema, meta);
  const path = `/r?d=${encodeURIComponent(token)}`;
  if (typeof window === 'undefined') return path;
  return `${window.location.origin}${path}`;
}

/** Whether a schema is small enough for a portable link (rough guard). */
export function canEncodePortableSchema(schema: Schema): boolean {
  try {
    return encodePortableSchema(schema).length <= MAX_ENCODED_LEN;
  } catch {
    return false;
  }
}
