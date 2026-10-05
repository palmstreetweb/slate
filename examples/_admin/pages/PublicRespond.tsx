import { useMemo, useRef, useState } from 'react';
import { Form } from '@/index.js';
import { decodePortableSchema } from '../portableShare.js';
import { sanitizeUntrustedSchema } from '../sanitizeUntrustedSchema.js';
import { addSubmission } from '../_submissionStore.js';
import { asStoredAnswers } from '../storedAnswers.js';
import { routeSearchParams } from '../_router.js';
import { resolveUploadMeta } from '../resolveUploadMeta.js';
import { localHostFileUpload } from '../hostFileUpload.js';
import { deleteLocalUploads, localRefsIn } from '../localFileStore.js';
import { isNeonConfigured } from '../neon/config.js';
import { readSlateMode } from '../slateMode.js';
import { prefillFromSearch } from '../trackedLinks.js';
import { LINK_BROKEN, LINK_PREVIEW_ONLY } from '../fillCopy.js';

type Props = { token: string };

/**
 * Prefill on a portable link (GAP-23): the same `?key=value` parameters as the
 * public link, minus `d` — the link's own schema.
 */
function readPrefill(): Record<string, string> {
  const params = routeSearchParams();
  params.delete('d');
  return prefillFromSearch(params);
}

/**
 * An id for a link minted without one: a hash of the whole token. (Its first
 * characters are the same for every link — the encoded `{"v":1,"schema"` —
 * so they can't tell two links apart, and the tab's saved answers would mix.)
 */
export function tokenId(token: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < token.length; i++) h = Math.imul(h ^ token.charCodeAt(i), 0x01000193);
  return `portable_${(h >>> 0).toString(36)}`;
}

/** A respondent screen with one line and no studio chrome (COPY-13, F27). */
function Notice({ text }: { text: string }) {
  return (
    <div
      data-slate-forms=""
      data-theme-name="slate"
      data-theme={readSlateMode()}
      className="slate-app"
    >
      <main className="slate-fill-gate">
        <p className="slate-fill-gate-notice" role="status">
          {text}
        </p>
      </main>
    </div>
  );
}

export function PublicRespond({ token }: Props) {
  const payload = useMemo(() => {
    const decoded = decodePortableSchema(token);
    if (!decoded) return null;
    // On the live site a portable link can never reach the owner (it is the
    // unpublished preview's link): say so before anyone types (GAPV-X2,
    // COPY-05), without reading anything else in it (SEC-3). That holds for
    // a device-only link too: its answers would stay on the respondent's own
    // device, where the owner never sees them.
    if (isNeonConfigured()) return 'preview' as const;
    try {
      // Anyone can mint this link — treat the schema as hostile (ADR-046).
      const schema = sanitizeUntrustedSchema(decoded.schema);
      // Nothing in it is a question: the link is broken.
      if (!schema.questions.length) return null;
      const formId = decoded.formId ?? tokenId(token);
      // With an id, answers survive a reload or back / forward in this tab only (GAP-05).
      return { ...decoded, formId, schema: { ...schema, id: formId } };
    } catch (err) {
      // A crafted link the sanitizer still can't read is a broken link, never a blank page.
      console.error('[slate] portable link', err);
      return null;
    }
  }, [token]);
  const [prefill] = useState(readPrefill);
  /**
   * Files this page saved on the device. On a successful submit, the ones the
   * response doesn't keep (removed, retaken, re-recorded) are deleted (MEDIA-19).
   */
  const saved = useRef(new Set<string>());

  // Portable links never expire: one that can't be read was cut short or mistyped.
  if (!payload) return <Notice text={LINK_BROKEN} />;
  if (payload === 'preview') return <Notice text={LINK_PREVIEW_ONLY} />;

  const { schema, formId, name } = payload;

  return (
    <div className="slate-public-respond" style={{ minHeight: '100vh' }}>
      <Form
        schema={schema}
        resume="tab"
        prefill={prefill}
        onFileUpload={async (file, questionId, ctx) => {
          const ref = await localHostFileUpload(file, questionId, ctx);
          saved.current.add(ref);
          return ref;
        }}
        resolveFileUploadMeta={resolveUploadMeta}
        onSubmit={async (answers, meta) => {
          // No server here: store what the submit Function would (ADR-068).
          addSubmission(formId, asStoredAnswers(schema.questions, answers), meta);
          const kept = localRefsIn(answers);
          const unused = [...saved.current].filter((ref) => !kept.has(ref));
          saved.current = new Set();
          void deleteLocalUploads(unused);
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
