// @vitest-environment node
/**
 * PDF extraction for Build with AI runs under its own deadline, destroys the
 * document either way, and never lets pdf.js compile PDF functions with
 * `new Function` (audit 2026-10 M-2).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const pdfjs = vi.hoisted(() => ({
  destroy: vi.fn(async () => undefined),
  getDocumentProxy: vi.fn(),
  extractText: vi.fn(),
}));
vi.mock('unpdf', () => ({
  getDocumentProxy: pdfjs.getDocumentProxy,
  extractText: pdfjs.extractText,
}));

import {
  DocumentExtractError,
  EXTRACT_TIMEOUT_MESSAGE,
  EXTRACT_TIMEOUT_MS,
  extractDocumentText,
} from '../api/_lib/extractDocument.js';

const PDF = { filename: 'form.pdf', base64: Buffer.from('%PDF-1.4 fake').toString('base64') };
const doc = (numPages = 2) => ({ numPages, destroy: pdfjs.destroy });

beforeEach(() => {
  vi.useFakeTimers();
  pdfjs.destroy.mockClear();
  pdfjs.getDocumentProxy.mockReset().mockImplementation(async () => doc());
  pdfjs.extractText
    .mockReset()
    .mockResolvedValue({ text: 'Name: ____  Email: ____  Coming? yes/no' });
});
afterEach(() => vi.useRealTimers());

describe('extractDocumentText', () => {
  it('opens with isEvalSupported off and destroys the document after reading', async () => {
    const text = await extractDocumentText(PDF);
    expect(text).toContain('Name:');
    expect(pdfjs.getDocumentProxy).toHaveBeenCalledWith(expect.any(Uint8Array), {
      isEvalSupported: false,
    });
    expect(pdfjs.destroy).toHaveBeenCalledTimes(1);
  });

  it('gives up after the deadline with plain copy, and still destroys the document', async () => {
    pdfjs.extractText.mockImplementation(() => new Promise(() => {}));
    const pending = extractDocumentText(PDF);
    const outcome = pending.then(
      () => 'resolved',
      (e: unknown) => e,
    );
    await vi.advanceTimersByTimeAsync(EXTRACT_TIMEOUT_MS + 1);
    const err = await outcome;
    expect(err).toBeInstanceOf(DocumentExtractError);
    expect((err as Error).message).toBe(EXTRACT_TIMEOUT_MESSAGE);
    expect((err as Error).message).not.toMatch(/timeout|pdf\.js|unpdf|exceeded/i);
    expect(pdfjs.destroy).toHaveBeenCalledTimes(1);
  });

  it('a document that never finishes opening also hits the deadline', async () => {
    pdfjs.getDocumentProxy.mockImplementation(() => new Promise(() => {}));
    const outcome = extractDocumentText(PDF, 1000).then(
      () => 'resolved',
      (e: unknown) => (e as Error).message,
    );
    await vi.advanceTimersByTimeAsync(1001);
    expect(await outcome).toBe(EXTRACT_TIMEOUT_MESSAGE);
    expect(pdfjs.destroy).not.toHaveBeenCalled();
  });

  it('too many pages is refused after opening, and the document is destroyed', async () => {
    pdfjs.getDocumentProxy.mockImplementation(async () => doc(31));
    await expect(extractDocumentText(PDF)).rejects.toThrow(/too long/);
    expect(pdfjs.extractText).not.toHaveBeenCalled();
    expect(pdfjs.destroy).toHaveBeenCalledTimes(1);
  });

  it('a PDF pdf.js cannot open is the unreadable sentence, with no pdf.js text', async () => {
    pdfjs.getDocumentProxy.mockRejectedValue(new Error('Invalid PDF structure'));
    await expect(extractDocumentText(PDF)).rejects.toThrow(/^We couldn’t open that PDF\./);
  });

  it('the deadline is 25 s', () => {
    expect(EXTRACT_TIMEOUT_MS).toBe(25_000);
  });
});
