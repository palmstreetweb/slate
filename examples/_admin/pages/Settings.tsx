'use client';

import { useEffect, useState } from 'react';
import {
  listForms,
  probeFormsStorage,
  replaceAllForms,
  resetFormsStorage,
  subscribe,
} from '../_formsStore.js';
import {
  listSubmissions,
  probeSubmissionsStorage,
  replaceAllSubmissions,
  resetSubmissionsStorage,
  subscribe as subscribeSubmissions,
} from '../_submissionStore.js';
import { navigate } from '../_router.js';
import { useConfirm } from '../_confirm.js';
import { AdminShell } from '../shell/AdminShell.js';
import { useAdminTheme } from '../adminThemeContext.js';
import {
  buildBackup,
  downloadBackupJson,
  parseBackup,
  pickBackupFile,
} from '../dataBackup.js';
import {
  estimateSiteStorageBytes,
  formatByteSize,
  resetWorkflowTip,
} from '../_siteSettings.js';

export function Settings() {
  const { mode, setMode } = useAdminTheme();
  const confirm = useConfirm();
  const [formCount, setFormCount] = useState(() => listForms().length);
  const [submissionCount, setSubmissionCount] = useState(() => listSubmissions().length);
  const [storageBytes, setStorageBytes] = useState(() => estimateSiteStorageBytes());
  const [storageIssue, setStorageIssue] = useState<'forms' | 'submissions' | 'both' | null>(() => {
    const formsBad = probeFormsStorage() === 'corrupt';
    const subsBad = probeSubmissionsStorage() === 'corrupt';
    if (formsBad && subsBad) return 'both';
    if (formsBad) return 'forms';
    if (subsBad) return 'submissions';
    return null;
  });

  useEffect(() => {
    return subscribe((forms) => {
      setFormCount(forms.length);
      setStorageBytes(estimateSiteStorageBytes());
    });
  }, []);

  useEffect(() => {
    return subscribeSubmissions((subs) => {
      setSubmissionCount(subs.length);
      setStorageBytes(estimateSiteStorageBytes());
    });
  }, []);

  const onExportBackup = () => {
    const backup = buildBackup(listForms(), listSubmissions());
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
    setFormCount(listForms().length);
    setSubmissionCount(listSubmissions().length);
    setStorageBytes(estimateSiteStorageBytes());
    if (!persisted) {
      await confirm({
        title: 'Import incomplete',
        message: 'Responses imported, but forms could not be saved — localStorage may be full.',
        confirmLabel: 'OK',
        danger: false,
      });
    }
  };

  const onResetAll = async () => {
    const ok = await confirm({
      title: 'Reset all site data?',
      message: 'Deletes every form and response saved in this browser. There is no undo.',
      confirmLabel: 'Reset everything',
      danger: true,
    });
    if (!ok) return;
    resetSubmissionsStorage();
    resetFormsStorage();
    setFormCount(0);
    setSubmissionCount(0);
    setStorageBytes(estimateSiteStorageBytes());
    setStorageIssue(null);
  };

  const onResetCorrupt = async () => {
    const ok = await confirm({
      title: 'Reset local storage?',
      message: 'Deletes corrupted forms and/or responses in this browser. There is no undo.',
      confirmLabel: 'Reset storage',
      danger: true,
    });
    if (!ok) return;
    if (storageIssue === 'forms' || storageIssue === 'both') resetFormsStorage();
    if (storageIssue === 'submissions' || storageIssue === 'both') resetSubmissionsStorage();
    setFormCount(listForms().length);
    setSubmissionCount(listSubmissions().length);
    setStorageBytes(estimateSiteStorageBytes());
    setStorageIssue(null);
  };

  return (
    <AdminShell crumbs={<span className="slate-crumb">Settings</span>}>
      <div className="slate-settings">
        <header className="slate-settings-header">
          <h1 className="slate-page-title">Settings</h1>
          <p className="slate-page-sub">
            Appearance, data, and how Slate works in this browser.
          </p>
        </header>

        {storageIssue && (
          <section className="slate-settings-section slate-settings-section--alert" role="alert">
            <h2 className="slate-settings-heading">Storage issue</h2>
            <p className="slate-settings-copy">
              {storageIssue === 'both'
                ? 'Saved forms and responses could not be read. Reset storage to start fresh.'
                : storageIssue === 'forms'
                  ? 'Saved forms appear corrupted. Responses may still be intact.'
                  : 'Saved responses appear corrupted. Your forms may still be intact.'}
            </p>
            <div className="slate-settings-actions">
              <button type="button" className="slate-btn slate-btn--danger" onClick={() => void onResetCorrupt()}>
                Reset storage
              </button>
            </div>
          </section>
        )}

        <section className="slate-settings-section">
          <h2 className="slate-settings-heading">Appearance</h2>
          <p className="slate-settings-copy">
            Studio chrome theme. Form previews keep each form&apos;s own theme.
          </p>
          <div className="slate-tabs" role="tablist" aria-label="Studio theme">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'light'}
              className={`slate-tab${mode === 'light' ? ' slate-tab--active' : ''}`}
              onClick={() => setMode('light')}
            >
              Light
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'dark'}
              className={`slate-tab${mode === 'dark' ? ' slate-tab--active' : ''}`}
              onClick={() => setMode('dark')}
            >
              Dark
            </button>
          </div>
        </section>

        <section className="slate-settings-section">
          <h2 className="slate-settings-heading">Data</h2>
          <p className="slate-settings-copy">
            Everything lives in this browser&apos;s localStorage — not on a server. Use the same
            browser and URL (e.g. slateforms.vercel.app) to keep your work.
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
            <div>
              <dt>Storage used</dt>
              <dd>{formatByteSize(storageBytes)}</dd>
            </div>
          </dl>
          <div className="slate-settings-actions">
            <button type="button" className="slate-btn" onClick={onExportBackup}>
              Export backup
            </button>
            <button type="button" className="slate-btn" onClick={() => void onImportBackup()}>
              Import backup
            </button>
            <button type="button" className="slate-btn slate-btn--danger" onClick={() => void onResetAll()}>
              Reset all data
            </button>
          </div>
        </section>

        <section className="slate-settings-section">
          <h2 className="slate-settings-heading">Help</h2>
          <p className="slate-settings-copy">
            To share a form, open it and use Share → Shareable Link. Export a backup occasionally
            so nothing is lost if you clear browser data.
          </p>
          <div className="slate-settings-actions">
            <button
              type="button"
              className="slate-btn"
              onClick={() => {
                resetWorkflowTip();
                navigate('/');
              }}
            >
              Show welcome tip on dashboard
            </button>
            <a href="/brand" className="slate-btn" style={{ textDecoration: 'none' }}>
              Brand &amp; docs
            </a>
          </div>
        </section>

        <section className="slate-settings-section slate-settings-section--muted">
          <h2 className="slate-settings-heading">About</h2>
          <p className="slate-settings-copy" style={{ margin: 0 }}>
            Slate — conversational forms by Palm Street Web. Schema in, form out.
          </p>
        </section>
      </div>
    </AdminShell>
  );
}
