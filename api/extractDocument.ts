/**
 * Pull plain text from a dropped PDF for Build with AI (ADR-039).
 * API-only. First version is PDF only. Word and Pages stay out until asked.
 */

import { extractText, getDocumentProxy } from 'unpdf';

const MAX_BYTES = 3_000_000;
const MAX_TEXT = 24_000;

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

export async function extractDocumentText(doc: DocumentPayload): Promise<string> {
  const filename = doc.filename.trim() || 'document.pdf';
  const base64 = doc.base64?.trim();
  if (!base64) throw new DocumentExtractError('That PDF was empty.');

  let bytes: Buffer;
  try {
    bytes = Buffer.from(base64, 'base64');
  } catch {
    throw new DocumentExtractError('Could not read that PDF.');
  }
  if (bytes.length === 0) throw new DocumentExtractError('That PDF was empty.');
  if (bytes.length > MAX_BYTES) {
    throw new DocumentExtractError('Keep the PDF under 3 MB.');
  }

  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const mime = (doc.mime ?? '').toLowerCase();
  const isPdf = ext === 'pdf' || mime === 'application/pdf' || bytes.subarray(0, 5).toString() === '%PDF-';
  if (!isPdf) {
    throw new DocumentExtractError('Start with a PDF. Word and Pages can come later.');
  }

  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text } = await extractText(pdf, { mergePages: true });
  const joined = (Array.isArray(text) ? text.join('\n') : text).replace(/\u0000/g, '').trim();
  if (joined.length < 20) {
    throw new DocumentExtractError(
      'No readable text in that PDF. Paste the questions, or export a text PDF.',
    );
  }
  return joined.slice(0, MAX_TEXT);
}
