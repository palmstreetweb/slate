/**
 * Audit fixes (2026-10-09), studio, backups:
 *  - B12: a backup's shape is checked, and its responses read the way the
 *    server's rows are, so a response without meta can't break the page.
 *  - F1: a bare URL in a file answer doesn't survive an import.
 *  - B11: the panel says files aren't in the backup.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../examples/_admin/_formsStore.js', () => ({
  listAllForms: () => [],
  replaceAllForms: () => true,
}));
vi.mock('../examples/_admin/_submissionStore.js', () => ({
  listAllSubmissions: () => [],
  replaceAllSubmissions: () => {},
}));

import { parseBackup } from '../examples/_admin/dataBackup.js';
import { buildResponsesCsv } from '../examples/_admin/csvExport.js';
import { BackupPanel } from '../examples/_admin/components/BackupPanel.js';
import { ConfirmProvider } from '../examples/_admin/_confirm.js';
import type { Question } from '@/index.js';

const questions = [
  { id: 'name', type: 'short_text', title: 'Name?' },
  { id: 'site', type: 'website', title: 'Site?' },
  { id: 'files', type: 'file_upload', title: 'Photos?' },
  { id: 'voice', type: 'voice_note', title: 'Say it' },
  { id: 'shots', type: 'photo_checklist', title: 'Shots', items: [{ value: 'front', label: 'Front' }] },
] as unknown as Question[];

const form = {
  id: 'f_1',
  name: 'Quote',
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  schema: { brand: { name: 'Q' }, theme: 'swiss', themeMode: 'toggle', questions },
};

const backup = (submissions: unknown[], forms: unknown[] = [form]) =>
  JSON.stringify({ v: 1, exportedAt: '2026-10-01T00:00:00.000Z', forms, submissions });

describe('reading a backup (audit B12)', () => {
  it('a response without meta gets a usable one, and the CSV can be built', () => {
    const parsed = parseBackup(
      backup([
        { id: 's1', formId: 'f_1', receivedAt: '2026-10-01T01:00:00.000Z', answers: { name: 'Ana' } },
      ]),
    )!;
    expect(parsed.submissions).toHaveLength(1);
    expect(parsed.submissions[0]!.meta).toMatchObject({ durationMs: 0, questionsVisited: [] });
    expect(() => buildResponsesCsv(questions, parsed.submissions)).not.toThrow();
  });

  it('drops what isn’t a form or a response, and non-object answers', () => {
    const parsed = parseBackup(
      backup(
        [null, 'text', { id: 's1' }, { id: 's2', formId: 'f_1', receivedAt: 'x', answers: 'nope' }],
        [form, { id: 'bad' }, 7, { id: 'f_2', name: 'No schema' }],
      ),
    )!;
    expect(parsed.forms.map((f) => f.id)).toEqual(['f_1']);
    expect(parsed.submissions.map((s) => s.id)).toEqual(['s2']);
    expect(parsed.submissions[0]!.answers).toEqual({});
  });

  it('keeps trash, retry keys and the export time', () => {
    const parsed = parseBackup(
      backup([
        {
          id: 's1',
          formId: 'f_1',
          receivedAt: '2026-10-01T01:00:00.000Z',
          deletedAt: '2026-10-02T01:00:00.000Z',
          submitKey: 'fill-1',
          answers: {},
          meta: { startedAt: '', completedAt: '', durationMs: 5, questionsVisited: [], hiddenFields: {} },
        },
      ]),
    )!;
    expect(parsed.exportedAt).toBe('2026-10-01T00:00:00.000Z');
    expect(parsed.submissions[0]).toMatchObject({ deletedAt: '2026-10-02T01:00:00.000Z', submitKey: 'fill-1' });
    expect(parsed.submissions[0]!.meta.durationMs).toBe(5);
  });

  it('still refuses what isn’t a backup at all', () => {
    expect(parseBackup('{}')).toBeNull();
    expect(parseBackup('not json')).toBeNull();
    expect(parseBackup(JSON.stringify({ v: 1, forms: {}, submissions: [] }))).toBeNull();
  });
});

describe('file answers in a backup (audit F1)', () => {
  it('keeps stored refs and drops bare URLs, leaving other answers alone', () => {
    const parsed = parseBackup(
      backup([
        {
          id: 's1',
          formId: 'f_1',
          receivedAt: '2026-10-01T01:00:00.000Z',
          answers: {
            name: 'https://example.com is my site',
            site: 'https://example.com',
            files: ['https://attacker.invalid/track.png', 'slate-file://local:abc'],
            voice: { audio: 'https://attacker.invalid/voice.webm', seconds: 3 },
            shots: { front: 'https://attacker.invalid/shot.png' },
          },
        },
        {
          id: 's2',
          formId: 'f_1',
          receivedAt: '2026-10-01T01:00:00.000Z',
          answers: { files: ['https://attacker.invalid/only.png'], voice: { typed: 'Hi there' } },
        },
      ]),
    )!;
    const [s1, s2] = parsed.submissions;
    expect(s1!.answers).toEqual({
      name: 'https://example.com is my site',
      site: 'https://example.com',
      files: ['slate-file://local:abc'],
      // Read like a server row: a number inside a record becomes its text.
      voice: { seconds: '3' },
      shots: {},
    });
    expect(s2!.answers).toEqual({ voice: { typed: 'Hi there' } });
  });

  it('a response for a form not in the backup keeps its answers as read', () => {
    const parsed = parseBackup(
      backup([
        {
          id: 's1',
          formId: 'elsewhere',
          receivedAt: '2026-10-01T01:00:00.000Z',
          answers: { files: ['slate-file://local:abc'] },
        },
      ]),
    )!;
    expect(parsed.submissions[0]!.answers).toEqual({ files: ['slate-file://local:abc'] });
  });
});

describe('the Backup panel (audit B11)', () => {
  it('says uploaded files are not in the backup', () => {
    render(
      <ConfirmProvider>
        <BackupPanel />
      </ConfirmProvider>,
    );
    expect(
      screen.getByText(/Files people uploaded aren’t in the backup — they stay in the browser/),
    ).toBeInTheDocument();
  });
});
