import { useMemo } from 'react';
import { Form } from '@/index.js';
import { decodePortableSchema } from '../portableShare.js';
import { addSubmission } from '../_submissionStore.js';
import { navigate } from '../_router.js';
import { readSlateMode } from '../slateMode.js';

type Props = { token: string };

export function PublicRespond({ token }: Props) {
  const payload = useMemo(() => decodePortableSchema(token), [token]);
  const mode = readSlateMode();

  if (!payload) {
    return (
      <div data-slate-forms="" data-theme-name="slate" data-theme={mode} className="slate-app">
        <div className="slate-empty" style={{ minHeight: '100vh', display: 'grid', placeContent: 'center' }}>
          <p style={{ margin: '0 0 12px' }}>This share link is invalid or expired.</p>
          <button type="button" className="slate-btn slate-btn--primary" onClick={() => navigate('/')}>
            Back to dashboard
          </button>
        </div>
      </div>
    );
  }

  const { schema, formId, name } = payload;
  const submissionFormId = formId ?? `portable_${token.slice(0, 12)}`;

  return (
    <div className="slate-public-respond" style={{ minHeight: '100vh' }}>
      <Form
        schema={schema}
        onSubmit={async (answers, meta) => {
          await new Promise((r) => setTimeout(r, 250));
          addSubmission(submissionFormId, answers, meta);
        }}
      />
      {name ? (
        <p
          style={{
            margin: 0,
            padding: '8px 16px',
            fontSize: 12,
            color: 'var(--slate-muted)',
            textAlign: 'center',
          }}
        >
          {name}
        </p>
      ) : null}
    </div>
  );
}
