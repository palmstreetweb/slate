'use client';

import { useState } from 'react';
import { listAllForms, replaceAllForms } from '../_formsStore.js';
import { listAllSubmissions, replaceAllSubmissions } from '../_submissionStore.js';
import { useConfirm } from '../_confirm.js';
import {
  buildBackup,
  downloadBackupJson,
  parseBackup,
  pickBackupFile,
} from '../dataBackup.js';
import { safeThemeName } from '../sanitizeUntrustedSchema.js';

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function BackupPanel() {
  const confirm = useConfirm();
  const [formCount, setFormCount] = useState(() => listAllForms().length);
  const [submissionCount, setSubmissionCount] = useState(() => listAllSubmissions().length);

  const refreshCounts = () => {
    setFormCount(listAllForms().length);
    setSubmissionCount(listAllSubmissions().length);
  };

  const onExportBackup = () => {
    const backup = buildBackup(listAllForms(), listAllSubmissions());
    const stamp = new Date().toISOString().slice(0, 10);
    downloadBackupJson(backup, `slate-backup-${stamp}.json`);
  };

  const onImportBackup = async () => {
    const raw = await pickBackupFile();
    if (!raw) return;
    const backup = parseBackup(raw);
    if (!backup) {
      await confirm({
        title: 'That isn’t a Slate backup',
        message: 'Choose a file you saved with Export backup.',
        confirmLabel: 'OK',
        danger: false,
      });
      return;
    }
    const saved = new Date(backup.exportedAt);
    const when = Number.isNaN(saved.getTime()) ? '' : ` from ${saved.toLocaleString()}`;
    const ok = await confirm({
      title: 'Import backup?',
      message: `This replaces every form and response in this browser with the ${count(backup.forms.length, 'form', 'forms')} and ${count(backup.submissions.length, 'response', 'responses')} in the backup${when}.`,
      confirmLabel: 'Import',
      danger: true,
    });
    if (!ok) return;
    replaceAllSubmissions(backup.submissions);
    // A form theme is a real one; the studio's own ('slate') never dresses a form (F31).
    const persisted = replaceAllForms(
      backup.forms.map((f) =>
        f.schema ? { ...f, schema: { ...f.schema, theme: safeThemeName(f.schema.theme) } } : f,
      ),
    );
    refreshCounts();
    if (!persisted) {
      await confirm({
        title: 'Forms weren’t imported',
        message:
          'The responses were imported, but the forms couldn’t be saved. This browser may be out of space: delete forms or responses you don’t need, then import again.',
        confirmLabel: 'OK',
        danger: false,
      });
    }
  };

  return (
    <section className="slate-settings-section">
      <h2 className="slate-settings-heading">Backup</h2>
      <p className="slate-settings-copy">
        Forms and responses are saved in this browser only. Export a backup now and then, and import
        it if you switch browsers or clear this site’s data.
      </p>
      <dl className="slate-settings-stats">
        <div>
          <dt>Forms</dt>
          <dd>{formCount}</dd>
        </div>
        <div>
          <dt>Responses</dt>
          <dd>{submissionCount}</dd>
        </div>
      </dl>
      <div className="slate-settings-actions">
        <button type="button" className="slate-btn" onClick={onExportBackup}>
          Export backup
        </button>
        <button type="button" className="slate-btn" onClick={() => void onImportBackup()}>
          Import backup
        </button>
      </div>
    </section>
  );
}
