/**
 * Audit fixes (2026-10-09), studio, files on the Responses page:
 *  - F1: a bare URL in a file answer is never fetched or shown — only a stored
 *    file's own ref is.
 *  - B6: a dropped connection while loading a thumb or a voice note says so
 *    instead of loading forever.
 *  - B13: the lightbox traps focus and gives it back to the button that opened it.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type * as Storage from '../examples/_admin/storageUpload.js';

const state = vi.hoisted(() => ({
  content: null as null | (() => Promise<unknown>),
}));

vi.mock('../examples/_admin/neon/env.js', () => ({ isNeonConfigured: () => false }));
vi.mock('../examples/_admin/storageUpload.js', async (importOriginal) => ({
  ...(await importOriginal<typeof Storage>()),
  isStorageUploadRef: (ref: string) => ref.startsWith('slate-file://storage:'),
  getStorageContentBlob: () => (state.content ? state.content() : Promise.resolve(null)),
  getStorageDownloadUrl: () => Promise.resolve(null),
}));
vi.mock('../examples/_admin/resolveUploadMeta.js', () => ({
  resolveUploadMeta: () => Promise.resolve(null),
}));
vi.mock('../examples/_admin/localFileStore.js', () => ({
  getLocalUploadBlob: () => Promise.resolve(null),
  getLocalUploadMeta: () => Promise.resolve(null),
}));

import { ResponseFileAnswer } from '../examples/_admin/components/ResponseFileAnswer.js';
import { VoiceNoteAnswer } from '../examples/_admin/responses/WaveCAnswers.js';

let fetchSpy: ReturnType<typeof vi.fn>;

beforeAll(() => {
  URL.createObjectURL ??= () => 'blob:test';
  URL.revokeObjectURL ??= () => undefined;
});

beforeEach(() => {
  state.content = null;
  fetchSpy = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));
  vi.stubGlobal('fetch', fetchSpy);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('a bare URL in a file answer (audit F1)', () => {
  it('is never fetched, shown, or opened', async () => {
    const user = userEvent.setup();
    render(<ResponseFileAnswer value="https://attacker.invalid/track.png" />);
    await waitFor(() =>
      expect(document.querySelector('.slate-response-file-badge--loading')).toBeNull(),
    );
    expect(document.querySelector('img')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Download' }));
    expect(await screen.findByText('Could not download file.')).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(document.querySelectorAll('a[href^="https://attacker"]')).toHaveLength(0);
  });

  it('a list of URLs is treated the same', async () => {
    render(
      <ResponseFileAnswer value={['https://attacker.invalid/a.png', 'http://attacker.invalid/b']} />,
    );
    await waitFor(() =>
      expect(document.querySelector('.slate-response-file-badge--loading')).toBeNull(),
    );
    expect(document.querySelector('img')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('a connection that drops while a file loads (audit B6)', () => {
  it('leaves the plain file badge, not a loading one', async () => {
    state.content = () => Promise.reject(new TypeError('Failed to fetch'));
    render(<ResponseFileAnswer value="slate-file://storage:draft/f1/u1/photo.jpg" />);
    expect(document.querySelector('.slate-response-file-badge--loading')).not.toBeNull();
    await waitFor(() =>
      expect(document.querySelector('.slate-response-file-badge--loading')).toBeNull(),
    );
    expect(screen.getByText('photo.jpg')).toBeInTheDocument();
  });

  it('the voice note says it did not load', async () => {
    state.content = () => Promise.reject(new TypeError('Failed to fetch'));
    render(
      <VoiceNoteAnswer value={{ audio: 'slate-file://storage:draft/f1/u1/note.webm', seconds: 4 }} />,
    );
    expect(
      await screen.findByText('The recording didn’t load. Use Download below.'),
    ).toBeInTheDocument();
  });
});

describe('the lightbox (audit B13)', () => {
  it('takes focus on open, closes on Escape, and gives focus back', async () => {
    const user = userEvent.setup();
    const photo = new File(['x'], 'photo.png', { type: 'image/png' });
    render(<ResponseFileAnswer value={photo} />);
    const preview = await screen.findByRole('button', { name: 'Preview' });
    await user.click(preview);
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(preview).toHaveFocus();
  });
});
