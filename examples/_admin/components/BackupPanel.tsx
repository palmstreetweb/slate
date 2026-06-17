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
        title: 'Import failed',
        message: 'That file is not a valid Slate backup.',
        confirmLabel: 'OK',
        danger: false,
      });
      return;
    }
    const ok = await confirm({
      title: 'Import backup?',
      message: `Replace all forms and responses in this browser with ${backup.forms.length} form(s) and ${backup.submissions.length} response(s) from ${new Date(backup.exportedAt).toLocaleString()}?`,
      confirmLabel: 'Import',
      danger: true,
    });
    if (!ok) return;
    replaceAllSubmissions(backup.submissions);
    const persisted = replaceAllForms(backup.forms);
    refreshCounts();
    if (!persisted) {
      await confirm({
        title: 'Import incomplete',
        message: 'Responses imported, but forms could not be saved — localStorage may be full.',
        confirmLabel: 'OK',
        danger: false,
      });
    }
  };

  return (
    <section className="slate-settings-section">
      <h2 className="slate-settings-heading">Backup</h2>
      <p className="slate-settings-copy">
        Forms and responses save in this browser only. Export a JSON backup occasionally, or
        restore from a file if you switch browsers or clear site data.
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
