import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * QA pass (w4a) on portable links (`/r?d=…`): a broken link is a respondent
 * screen with no studio button (COPY-13, F27), the live site says a preview
 * link can't take answers before anyone types (GAPV-X2), prefill works like
 * the public link (GAP-23), answers survive a reload in the tab (GAP-05), and
 * files the response doesn't keep are deleted after it is sent (MEDIA-19).
 */

const cfg = vi.hoisted(() => ({ cloud: false }));
const files = vi.hoisted(() => ({
  upload: vi.fn(),
  deleted: [] as string[][],
}));

vi.mock('../examples/_admin/neon/config.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  isNeonConfigured: () => cfg.cloud,
}));
vi.mock('../examples/_admin/hostFileUpload.js', () => ({
  localHostFileUpload: files.upload,
}));
vi.mock('../examples/_admin/localFileStore.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  deleteLocalUploads: async (refs: string[]) => {
    files.deleted.push([...refs]);
  },
}));

import type { Schema } from '@/index.js';
import { PublicRespond, tokenId } from '../examples/_admin/pages/PublicRespond.js';
import { encodePortableSchema } from '../examples/_admin/portableShare.js';
import { matchRoute } from '../examples/_admin/_router.js';
import { listSubmissions } from '../examples/_admin/_submissionStore.js';
import { LINK_BROKEN, LINK_PREVIEW_ONLY } from '../examples/_admin/fillCopy.js';

const schema: Schema = {
  brand: { name: 'Crew' },
  theme: 'classic',
  themeMode: 'light',
  questions: [
    { id: 'name', type: 'short_text', title: 'Your name?', required: true, prefillKey: 'name' },
    { id: 'done', type: 'thanks', title: 'Thanks' },
  ],
};

beforeEach(() => {
  cfg.cloud = false;
  files.upload.mockReset();
  files.deleted = [];
  window.sessionStorage.clear();
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  window.history.replaceState({}, '', '/');
});

describe('a link that can’t be used', () => {
  it('a broken token: plain words and no studio button (COPY-13, F27)', () => {
    render(<PublicRespond token="not-a-real-token" />);
    expect(screen.getByText(LINK_BROKEN)).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByText(/dashboard|expired/i)).toBeNull();
  });

  it('/r with no d is still the respondent page, not the studio (F27)', () => {
    window.history.replaceState({}, '', '/r');
    expect(matchRoute('/r')).toEqual({ name: 'respond', token: '' });
    render(<PublicRespond token="" />);
    expect(screen.getByText(LINK_BROKEN)).toBeInTheDocument();
  });

  it('on the live site a portable link says it can’t take answers, before anyone types (GAPV-X2)', () => {
    cfg.cloud = true;
    render(<PublicRespond token={encodePortableSchema(schema, { formId: 'f_cloudform1' })} />);
    expect(screen.getByText(LINK_PREVIEW_ONLY)).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});

describe('filling a portable link', () => {
  it('a link without a form id gets one from the whole token, so two links never share a save', () => {
    const a = encodePortableSchema(schema);
    const b = encodePortableSchema({ ...schema, brand: { name: 'Other' } });
    expect(a.slice(0, 12)).toBe(b.slice(0, 12));
    expect(tokenId(a)).not.toBe(tokenId(b));
    expect(tokenId(a)).toMatch(/^portable_[0-9a-z]+$/);
    expect(tokenId(a)).toBe(tokenId(a));
  });

  it('prefill from the link works like the public link (GAP-23), and d isn’t a prefill', async () => {
    const token = encodePortableSchema(schema, { formId: 'portable_pre001' });
    window.history.replaceState({}, '', `/r?d=${encodeURIComponent(token)}&name=Ada`);
    render(<PublicRespond token={token} />);
    expect(await screen.findByRole('textbox')).toHaveValue('Ada');
  });

  it('answers survive a reload in this tab only (GAP-05)', async () => {
    const twoSteps: Schema = {
      ...schema,
      questions: [
        schema.questions[0]!,
        { id: 'city', type: 'short_text', title: 'Your city?' },
        { id: 'done', type: 'thanks', title: 'Thanks' },
      ],
    };
    const token = encodePortableSchema(twoSteps, { formId: 'portable_tab001' });
    const user = userEvent.setup();
    const first = render(<PublicRespond token={token} />);
    await user.type(await screen.findByRole('textbox'), 'Ada');
    await user.keyboard('{Enter}');
    await screen.findByRole('heading', { name: 'Your city?' });
    await waitFor(() =>
      expect(window.sessionStorage.getItem('slate-forms-resume:portable_tab001')).toContain('Ada'),
    );
    expect(window.localStorage.getItem('slate-forms-resume:portable_tab001')).toBeNull();
    first.unmount();
    render(<PublicRespond token={token} />);
    expect(await screen.findByText('Pick up where you left off?')).toBeInTheDocument();
  });

  it('files the response doesn’t keep are deleted once it is sent (MEDIA-19)', async () => {
    const withFiles: Schema = {
      ...schema,
      questions: [
        { id: 'docs', type: 'file_upload', title: 'Your files', maxFiles: 5 },
        { id: 'done', type: 'thanks', title: 'Thanks' },
      ],
    };
    let n = 0;
    files.upload.mockImplementation(async () => `slate-file://local-${++n}`);
    render(
      <PublicRespond token={encodePortableSchema(withFiles, { formId: 'portable_files1' })} />,
    );
    await screen.findByText(/choose files/i, {}, { timeout: 8000 });
    const input = document.querySelector('input[type="file"]')!;
    await act(async () => {
      fireEvent.change(input, {
        target: {
          files: [
            new File(['a'], 'a.txt', { type: 'text/plain' }),
            new File(['b'], 'b.txt', { type: 'text/plain' }),
          ],
        },
      });
    });
    await waitFor(() => expect(files.upload).toHaveBeenCalledTimes(2));
    // Remove the first file before sending.
    fireEvent.click((await screen.findAllByRole('button', { name: /^Remove / }))[0]!);
    fireEvent.click(screen.getByRole('button', { name: /^ok/i }));
    await screen.findByRole('heading', { name: 'Thanks' });
    await waitFor(() => expect(files.deleted).toEqual([['slate-file://local-1']]));
    expect(listSubmissions('portable_files1')[0]!.answers).toEqual({
      docs: ['slate-file://local-2'],
    });
  });
});
