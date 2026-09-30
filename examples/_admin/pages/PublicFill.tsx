'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Form } from '@/index.js';
import {
  FormClosedError,
  fetchPublishedFormBySlug,
  metaToPayload,
  submitPublicResponse,
  unlockPublicForm,
} from '../neon/publicApi.js';
import type { FormClosedInfo, PublishedFormPayload } from '../neon/database.types.js';
import { isNeonConfigured } from '../neon/config.js';
import { hostFileUpload } from '../hostFileUpload.js';
import { resolveUploadMeta } from '../resolveUploadMeta.js';
import { setUploadContext, clearUploadContext } from '../uploadContext.js';
import { readSlateMode } from '../slateMode.js';
import { detectAdminUiTheme } from '../adminUiTheme.js';
import { LoadingScreen } from '../shell/LoadingScreen.js';
import { FillGate } from '../components/FillGate.js';
import { FormClosedScreen } from '../components/FormClosedScreen.js';
import { prefillFromSearch, trackingFromSearch } from '../trackedLinks.js';
import { clearFillUnlockToken, readFillUnlockToken, writeFillUnlockToken } from '../fillUnlock.js';
import { routeSearchParams } from '../_router.js';

type Props = { slug: string };

type OpenForm = Extract<PublishedFormPayload, { locked: false }>;
type LockedForm = Extract<PublishedFormPayload, { locked: true }>;

/** `?embed=1` — we're inside a host site's iframe (ADR-054). */
function readEmbedMode(): boolean {
  return routeSearchParams().get('embed') === '1';
}

/**
 * The link's extras (ADR-063), read once: `src` / `utm_*` ride along as hidden
 * fields on the response; other parameters may prefill questions whose owner
 * allowed it. The base link `/forms/{slug}` works exactly as before.
 */
function readLinkExtras(): { tracking: Record<string, string>; prefill: Record<string, string> } {
  const params = routeSearchParams();
  return { tracking: trackingFromSearch(params), prefill: prefillFromSearch(params) };
}

/**
 * Embed mode: post our height to the host page so its script can size the
 * iframe. One-way — we never read from, or listen to, the parent. The page
 * fills the frame, so the height tracks the tallest step seen rather than
 * shrinking between steps (the host page doesn't jump under a thumb).
 */
function useEmbedHeight(enabled: boolean) {
  return useCallback(
    (el: HTMLElement | null) => {
      if (!enabled || !el || window.parent === window) return;
      if (typeof ResizeObserver === 'undefined') return;
      let last = 0;
      const observer = new ResizeObserver(() => {
        const height = el.offsetHeight;
        if (height <= 0 || height === last) return;
        last = height;
        window.parent.postMessage({ type: 'slate:height', height }, '*');
      });
      observer.observe(el);
      return () => observer.disconnect();
    },
    [enabled],
  );
}

export function PublicFill({ slug }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<OpenForm | null>(null);
  /** Locked and not yet unlocked in this tab (ADR-043). */
  const [gate, setGate] = useState<LockedForm | null>(null);
  /** Closed (ADR-063): past its closing time or at its cap. */
  const [closed, setClosed] = useState<{
    name: string;
    info: FormClosedInfo;
    duringFill: boolean;
  } | null>(null);
  const [extras] = useState(readLinkExtras);
  /** Honeypot input (ADR-052). Read at submit, never rendered from state. */
  const trapRef = useRef<HTMLInputElement>(null);
  const [embed] = useState(readEmbedMode);
  const embedRef = useEmbedHeight(embed);
  const mode = readSlateMode();
  const uiTheme = detectAdminUiTheme();
  const embedClass = embed ? ' slate-embed' : '';

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
      setUploadContext(payload.id, { scope: 'public' });
    };
    void (async () => {
      try {
        const payload = await fetchPublishedFormBySlug(slug);
        if (cancelled) return;
        if (!payload) {
          setError('This form is not available. It may have been closed.');
        } else if (payload.closed) {
          setClosed({ name: payload.name, info: payload.closed, duringFill: false });
        } else if (!payload.locked) {
          open(payload);
        } else {
          // Reload in the same tab: re-prove with the saved token, no retyping.
          const token = readFillUnlockToken(payload.id);
          const resumed = token ? await unlockPublicForm(slug, { token }) : null;
          if (cancelled) return;
          if (resumed?.ok) {
            open(resumed.form);
          } else if (resumed?.reason === 'closed') {
            setClosed({ name: payload.name, info: resumed.closed, duringFill: false });
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
      if (!result.ok && result.reason === 'closed') {
        setClosed({ name: gate?.name ?? '', info: result.closed, duringFill: false });
        setGate(null);
        return null;
      }
      if (!result.ok) return result.message;
      if (result.unlockToken) writeFillUnlockToken(result.form.id, result.unlockToken);
      setForm(result.form);
      setGate(null);
      setUploadContext(result.form.id, { scope: 'public' });
      return null;
    },
    [slug, gate],
  );

  if (loading) {
    return <LoadingScreen label="Loading form" />;
  }

  if (closed) {
    return (
      <div
        ref={embedRef}
        data-slate-forms=""
        data-theme-name="slate"
        data-admin-ui={uiTheme}
        data-theme={mode}
        className={`slate-app${embedClass}`}
      >
        <FormClosedScreen
          formName={closed.name}
          closed={closed.info}
          duringFill={closed.duringFill}
        />
      </div>
    );
  }

  if (gate && !form) {
    return (
      <div
        ref={embedRef}
        data-slate-forms=""
        data-theme-name="slate"
        data-admin-ui={uiTheme}
        data-theme={mode}
        className={`slate-app${embedClass}`}
      >
        <FillGate formName={gate.name} onUnlock={onUnlock} />
      </div>
    );
  }

  if (error || !form) {
    // Anonymous scanners land here — no studio links.
    return (
      <div
        ref={embedRef}
        data-slate-forms=""
        data-theme-name="slate"
        data-admin-ui={uiTheme}
        data-theme={mode}
        className={`slate-app${embedClass}`}
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
    <div
      ref={embedRef}
      className={`slate-public-respond${embedClass}`}
      style={{ minHeight: '100vh' }}
    >
      <Form
        schema={form.schema}
        hiddenFields={extras.tracking}
        prefill={extras.prefill}
        onFileUpload={hostFileUpload}
        resolveFileUploadMeta={resolveUploadMeta}
        onSubmit={async (answers, meta) => {
          const payloadMeta = metaToPayload(meta);
          // Filled trap = bot. Flag it and let the Function drop it before any
          // DB work (ADR-058); the respondent sees the same thanks screen either way.
          const trapped = Boolean(trapRef.current?.value.trim());
          try {
            await submitPublicResponse({
              formId: form.id,
              answers,
              meta: trapped
                ? { ...payloadMeta, hiddenFields: { ...payloadMeta.hiddenFields, _hp: '1' } }
                : payloadMeta,
            });
          } catch (err) {
            // Closed while they were filling it in (ADR-063): say so plainly
            // instead of offering a Retry that can't work.
            if (err instanceof FormClosedError) {
              setClosed({ name: form.name, info: err.closed, duringFill: true });
            }
            throw err;
          }
        }}
      />
      {/* Off-screen, outside the engine: people and screen readers never reach
          it, naive fill-every-input bots do. Neutral name so autofill skips it. */}
      <div className="slate-fill-trap" aria-hidden="true">
        <label>
          Leave this field empty
          <input
            ref={trapRef}
            type="text"
            name="fill_note"
            tabIndex={-1}
            autoComplete="off"
            data-1p-ignore=""
            data-lpignore="true"
            data-bwignore=""
            data-form-type="other"
          />
        </label>
      </div>
      {/* Embedded, the host page names the form; a line under 100vh would only add a scrollbar. */}
      {embed ? null : (
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
      )}
    </div>
  );
}
