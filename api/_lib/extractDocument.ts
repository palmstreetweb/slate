/**
 * Pull plain text from a dropped PDF for Build with AI (ADR-039).
 * API-only. First version is PDF only. Word and Pages stay out until asked.
 */

import { extractText, getDocumentProxy } from 'unpdf';

const MAX_BYTES = 3_000_000;
const MAX_TEXT = 24_000;
/** A paper form is a few pages. Anything longer is a book, and slow to parse (audit M-AI-2). */
const MAX_PAGES = 30;
/**
 * pdf.js runs on the function's main thread and the route's 165 s deadline only wraps the model
 * call, so a PDF built to inflate or loop could hold the function until Vercel's kill, after the
 * quota unit was spent (audit 2026-10 M-2). A paper form opens in well under this.
 */
export const EXTRACT_TIMEOUT_MS = 25_000;
const UNREADABLE =
  'We couldn’t open that PDF. Try saving it again, or paste the questions instead.';
export const EXTRACT_TIMEOUT_MESSAGE =
  'That PDF took too long to read. Try a smaller or simpler PDF, or paste the questions instead.';

export class DocumentExtractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DocumentExtractError';
  }
}

export type DocumentPayload = {
  filename: string;
  mime?: string;
  /** Base64 PDF bytes. */
  base64?: string;
};

export function documentToPrompt(filename: string, text: string, note?: string): string {
  const body = text.replace(/\s+\n/g, '\n').trim().slice(0, MAX_TEXT);
  const extra = note?.trim() ? `\n\nAlso follow this note:\n${note.trim()}` : '';
  return [
    'Turn this existing document into a conversational Slate form.',
    'Keep every blank, choice list, and numbered question/answer pair. One field each. Do not merge them.',
    'Section notes that explain a conflict or what is already true become statement screens.',
    'Keep the wording. Do not invent a different form.',
    'Skip only lines that are about handing the paper back.',
    '',
    `Document (${filename}):`,
    body,
    extra,
  ]
    .join('\n')
    .trim();
}

/** Resolves with `work`, or rejects with the timeout error once `ms` have passed. */
function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new DocumentExtractError(EXTRACT_TIMEOUT_MESSAGE)), ms);
  });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

export async function extractDocumentText(
  doc: DocumentPayload,
  timeoutMs = EXTRACT_TIMEOUT_MS,
): Promise<string> {
  const filename = doc.filename.trim() || 'document.pdf';
  const base64 = doc.base64?.trim();
  if (!base64) throw new DocumentExtractError('That PDF is empty. Pick another file.');

  let bytes: Buffer;
  try {
    bytes = Buffer.from(base64, 'base64');
  } catch {
    throw new DocumentExtractError(UNREADABLE);
  }
  if (bytes.length === 0) throw new DocumentExtractError('That PDF is empty. Pick another file.');
  if (bytes.length > MAX_BYTES) {
    throw new DocumentExtractError('That PDF is too big. Pick one under 3 MB.');
  }

  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const mime = (doc.mime ?? '').toLowerCase();
  const isPdf =
    ext === 'pdf' || mime === 'application/pdf' || bytes.subarray(0, 5).toString() === '%PDF-';
  if (!isPdf) {
    throw new DocumentExtractError('Only PDFs work here for now. Save it as a PDF and try again.');
  }

  // Open and read under one deadline. The document is destroyed either way, so a warm instance
  // doesn't keep parsed PDFs around. isEvalSupported off: pdf.js otherwise compiles PDF functions
  // with `new Function`.
  // unpdf's bundled typings omit both `isEvalSupported` and `destroy()`; pdf.js has them.
  type Proxy = Awaited<ReturnType<typeof getDocumentProxy>> & { destroy?: () => Promise<void> };
  const openOptions = { isEvalSupported: false } as Parameters<typeof getDocumentProxy>[1];
  let pdf: Proxy | undefined;
  const read = async (): Promise<string> => {
    try {
      pdf = (await getDocumentProxy(new Uint8Array(bytes), openOptions)) as Proxy;
    } catch {
      throw new DocumentExtractError(UNREADABLE);
    }
    if (pdf.numPages > MAX_PAGES) {
      throw new DocumentExtractError(`That PDF is too long. Pick one under ${MAX_PAGES} pages.`);
    }
    const { text } = await extractText(pdf, { mergePages: true });
    return (Array.isArray(text) ? text.join('\n') : text).replaceAll('\u0000', '').trim();
  };
  let joined: string;
  try {
    joined = await withTimeout(read(), timeoutMs);
  } finally {
    await pdf?.destroy?.().catch(() => undefined);
  }
  if (joined.length < 20) {
    throw new DocumentExtractError(
      'We couldn’t find any text in that PDF (it may be a scan). Paste the questions instead.',
    );
  }
  return joined.slice(0, MAX_TEXT);
}
