'use client';

import { useCallback, useEffect, useState } from 'react';
import { Form } from '@/index.js';
import {
  fetchPublishedFormBySlug,
  metaToPayload,
  submitPublicResponse,
  unlockPublicForm,
} from '../neon/publicApi.js';
import type { PublishedFormPayload } from '../neon/database.types.js';
import { isNeonConfigured } from '../neon/env.js';
import { hostFileUpload } from '../hostFileUpload.js';
import { resolveUploadMeta } from '../resolveUploadMeta.js';
import { setUploadContext, clearUploadContext } from '../uploadContext.js';
import { readSlateMode } from '../slateMode.js';
import { detectAdminUiTheme } from '../adminUiTheme.js';
import { LoadingScreen } from '../shell/LoadingScreen.js';
import { FillGate } from '../components/FillGate.js';
import { clearFillUnlockToken, readFillUnlockToken, writeFillUnlockToken } from '../fillUnlock.js';

type Props = { slug: string };

type OpenForm = Extract<PublishedFormPayload, { locked: false }>;
type LockedForm = Extract<PublishedFormPayload, { locked: true }>;

export function PublicFill({ slug }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<OpenForm | null>(null);
  /** Locked and not yet unlocked in this tab (ADR-043). */
  const [gate, setGate] = useState<LockedForm | null>(null);
  const mode = readSlateMode();
  const uiTheme = detectAdminUiTheme();

  useEffect(() => {
    if (!isNeonConfigured()) {
      setError('This form is not available right now.');
      setLoading(false);
      return;
    }
    let cancelled = false;
    const open = (payload: OpenForm) => {
      setForm(payload);
      setGate(null);
      setUploadContext(payload.id);
    };
    void (async () => {
      try {
        const payload = await fetchPublishedFormBySlug(slug);
        if (cancelled) return;
        if (!payload) {
          setError('This form is not available. It may have been closed.');
        } else if (!payload.locked) {
          open(payload);
        } else {
          // Reload in the same tab: re-prove with the saved token, no retyping.
          const token = readFillUnlockToken(payload.id);
          const resumed = token ? await unlockPublicForm(slug, { token }) : null;
          if (cancelled) return;
          if (resumed?.ok) {
            open(resumed.form);
          } else {
            if (resumed?.reason === 'wrong_password') clearFillUnlockToken(payload.id);
            setGate(payload);
          }
        }
      } catch (err: unknown) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Could not load this form.');
      }
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
      clearUploadContext();
    };
  }, [slug]);

  const onUnlock = useCallback(
    async (password: string): Promise<string | null> => {
      const result = await unlockPublicForm(slug, { password });
      if (!result.ok) return result.message;
      if (result.unlockToken) writeFillUnlockToken(result.form.id, result.unlockToken);
      setForm(result.form);
      setGate(null);
      setUploadContext(result.form.id);
      return null;
    },
    [slug],
  );

  if (loading) {
    return <LoadingScreen label="Loading form" />;
  }

  if (gate && !form) {
    return (
      <div
        data-slate-forms=""
        data-theme-name="slate"
        data-admin-ui={uiTheme}
        data-theme={mode}
        className="slate-app"
      >
        <FillGate formName={gate.name} onUnlock={onUnlock} />
      </div>
    );
  }

  if (error || !form) {
    // Anonymous scanners land here — no studio links.
    return (
      <div
        data-slate-forms=""
        data-theme-name="slate"
        data-admin-ui={uiTheme}
        data-theme={mode}
        className="slate-app"
      >
        <main className="slate-fill-gate">
          <p className="slate-fill-gate-notice" role="status">
            {error ?? 'This form is not available.'}
          </p>
        </main>
      </div>
    );
  }

  return (
    <div className="slate-public-respond" style={{ minHeight: '100vh' }}>
      <Form
        schema={form.schema}
        onFileUpload={hostFileUpload}
        resolveFileUploadMeta={resolveUploadMeta}
        onSubmit={async (answers, meta) => {
          await submitPublicResponse({
            formId: form.id,
            answers,
            meta: metaToPayload(meta),
          });
        }}
      />
      <p
        style={{
          margin: 0,
          padding: '8px 16px',
          fontSize: 12,
          color: 'var(--slate-muted)',
          textAlign: 'center',
        }}
      >
        {form.name}
      </p>
    </div>
  );
}
