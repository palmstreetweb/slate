'use client';

import { useEffect, useMemo, useState } from 'react';
import { Form } from '@/index.js';
import { fetchPublishedFormBySlug, metaToPayload, submitPublicResponse } from '../neon/publicApi.js';
import { isNeonConfigured } from '../neon/env.js';
import { navigate } from '../_router.js';
import { hostFileUpload } from '../hostFileUpload.js';
import { resolveUploadMeta } from '../resolveUploadMeta.js';
import { setUploadContext, clearUploadContext } from '../uploadContext.js';
import { readSlateMode } from '../slateMode.js';
import { LoadingScreen } from '../shell/LoadingScreen.js';

type Props = { slug: string };

export function PublicFill({ slug }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<Awaited<ReturnType<typeof fetchPublishedFormBySlug>>>(null);
  const mode = readSlateMode();

  useEffect(() => {
    if (!isNeonConfigured()) {
      setError('Public fill requires Neon configuration.');
      setLoading(false);
      return;
    }
    let cancelled = false;
    void fetchPublishedFormBySlug(slug)
      .then((payload) => {
        if (cancelled) return;
        if (!payload) {
          setError('This form is not published or does not exist.');
        } else {
          setForm(payload);
          setUploadContext(payload.id);
        }
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Could not load this form.');
        setLoading(false);
      });
    return () => {
      cancelled = true;
      clearUploadContext();
    };
  }, [slug]);

  const schema = useMemo(() => form?.schema ?? null, [form]);

  if (loading) {
    return <LoadingScreen label="Loading form" />;
  }

  if (error || !schema || !form) {
    return (
      <div data-slate-forms="" data-theme-name="slate" data-theme={mode} className="slate-app">
        <div className="slate-empty" style={{ minHeight: '100vh', display: 'grid', placeContent: 'center' }}>
          <p style={{ margin: '0 0 12px' }}>{error ?? 'Form unavailable.'}</p>
          <button type="button" className="slate-btn slate-btn--primary" onClick={() => navigate('/')}>
            Back to dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="slate-public-respond" style={{ minHeight: '100vh' }}>
      <Form
        schema={schema}
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
