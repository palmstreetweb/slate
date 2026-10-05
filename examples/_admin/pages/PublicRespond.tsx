import { useMemo } from 'react';
import { Form } from '@/index.js';
import { decodePortableSchema } from '../portableShare.js';
import { sanitizeUntrustedSchema } from '../sanitizeUntrustedSchema.js';
import { addSubmission, PREVIEW_LINK_MESSAGE } from '../_submissionStore.js';
import { isNeonConfigured } from '../neon/config.js';
import { asStoredAnswers } from '../storedAnswers.js';
import { navigate } from '../_router.js';
import { resolveUploadMeta } from '../resolveUploadMeta.js';
import { localHostFileUpload } from '../hostFileUpload.js';
import { readSlateMode } from '../slateMode.js';

type Props = { token: string };

export function PublicRespond({ token }: Props) {
  const payload = useMemo(() => {
    const decoded = decodePortableSchema(token);
    // Anyone can mint this link — treat the schema as hostile (ADR-046).
    return decoded ? { ...decoded, schema: sanitizeUntrustedSchema(decoded.schema) } : null;
  }, [token]);
  const mode = readSlateMode();

  if (!payload) {
    return (
      <div data-slate-forms="" data-theme-name="slate" data-theme={mode} className="slate-app">
        <div
          className="slate-empty"
          style={{ minHeight: '100vh', display: 'grid', placeContent: 'center' }}
        >
          <p style={{ margin: '0 0 12px' }}>This share link is invalid or expired.</p>
          <button
            type="button"
            className="slate-btn slate-btn--primary"
            onClick={() => navigate('/')}
          >
            Back to dashboard
          </button>
        </div>
      </div>
    );
  }

  const { schema, formId, name } = payload;
  const submissionFormId = formId ?? `portable_${token.slice(0, 12)}`;

  // A cloud form's portable link can never send answers (QA COPY-05): say so
  // before anyone fills it in, instead of failing at the end.
  if (isNeonConfigured() && !/^(portable|local)_/.test(submissionFormId)) {
    return (
      <div data-slate-forms="" data-theme-name="slate" data-theme={mode} className="slate-app">
        <div
          className="slate-empty"
          role="status"
          style={{ minHeight: '100vh', display: 'grid', placeContent: 'center', padding: 24 }}
        >
          <p style={{ margin: 0, maxWidth: 420 }}>{PREVIEW_LINK_MESSAGE}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="slate-public-respond" style={{ minHeight: '100vh' }}>
      <Form
        schema={schema}
        onFileUpload={localHostFileUpload}
        resolveFileUploadMeta={resolveUploadMeta}
        onSubmit={async (answers, meta) => {
          // No server here: store what the submit Function would (ADR-068).
          addSubmission(submissionFormId, asStoredAnswers(schema.questions, answers), meta);
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
