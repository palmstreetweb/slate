'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Form } from '@/index.js';
import type { Answers } from '@/index.js';
import {
  FilesRejectedError,
  FormClosedError,
  PasswordChangedError,
  SlotFullError,
  TooLongError,
  fetchPublishedFormBySlug,
  fetchSlotsLeft,
  metaToPayload,
  newSubmitId,
  submitPublicResponse,
  unlockPublicForm,
} from '../neon/publicApi.js';
import type {
  FormClosedInfo,
  PublishedFormPayload,
  SlotsLeftPayload,
} from '../neon/database.types.js';
import { mergeSlotsLeft, slotFullMessage } from '../slotFull.js';
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
import { FORM_UNAVAILABLE, LOAD_LATER, LOAD_OFFLINE, SEND_TOO_LONG_HERE } from '../fillCopy.js';
import { withoutRepeatedOptionsIn } from '../uniqueOptions.js';
import { withWebRedirects } from '../redirectUrl.js';

type Props = { slug: string };

type OpenForm = Extract<PublishedFormPayload, { locked: false }>;
type LockedForm = Extract<PublishedFormPayload, { locked: true }>;

/** Spots-left counts older than this are refreshed when someone reaches a sign-up question. */
const SLOTS_STALE_MS = 30_000;

/**
 * The question holding the biggest answer, for a submit that was too long
 * (413, GAP-07): the respondent goes back there to shorten it. Text answers
 * get "this answer is too long"; anything else keeps the general sentence.
 */
export function longestAnswer(answers: Answers): { id: string; text: boolean } | null {
  let best: { id: string; text: boolean } | null = null;
  let size = 0;
  for (const [id, value] of Object.entries(answers)) {
    const n = JSON.stringify(value ?? '').length;
    if (n > size) {
      size = n;
      best = { id, text: typeof value === 'string' };
    }
  }
  return best;
}

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
  /** Why the form isn't showing, and whether loading again can help (COPY-X3). */
  const [error, setError] = useState<{ text: string; retry: boolean } | null>(null);
  /** Bumped by "Try again" on the load error: runs the load once more. */
  const [attempt, setAttempt] = useState(0);
  const [form, setForm] = useState<OpenForm | null>(null);
  /** Locked and not yet unlocked in this tab (ADR-043). */
  const [gate, setGate] = useState<LockedForm | null>(null);
  /** Why the gate is back mid-fill (the password changed; audit 2026-10). */
  const [gateNotice, setGateNotice] = useState<string | null>(null);
  /** Closed (ADR-063): past its closing time or at its cap. */
  const [closed, setClosed] = useState<{
    name: string;
    info: FormClosedInfo;
    duringFill: boolean;
  } | null>(null);
  const [extras] = useState(readLinkExtras);
  /** Spots left on sign-up slots (ADR-066), from the lookup, a refresh or a 409. */
  const [slotsLeft, setSlotsLeft] = useState<SlotsLeftPayload | undefined>(undefined);
  const slotsAt = useRef(0);
  /** Honeypot input (ADR-052). Read at submit, never rendered from state. */
  const trapRef = useRef<HTMLInputElement>(null);
  /**
   * This fill's retry key (ADR-067) where the engine has no `meta.fillId` (a page
   * not served over https): kept until a submit goes through, so pressing Retry
   * after a lost reply returns the stored response instead of a duplicate.
   */
  const submitIdRef = useRef<string | undefined>(undefined);
  const [embed] = useState(readEmbedMode);
  const embedRef = useEmbedHeight(embed);
  const mode = readSlateMode();
  const uiTheme = detectAdminUiTheme();
  const embedClass = embed ? ' slate-embed' : '';

  useEffect(() => {
    if (!isNeonConfigured()) {
      setError({ text: FORM_UNAVAILABLE, retry: false });
      setLoading(false);
      return;
    }
    let cancelled = false;
    const open = (payload: OpenForm) => {
      setForm(payload);
      setSlotsLeft(payload.slotsLeft);
      slotsAt.current = Date.now();
      setGate(null);
      setUploadContext(payload.id, { scope: 'public' });
    };
    void (async () => {
      try {
        const payload = await fetchPublishedFormBySlug(slug);
        if (cancelled) return;
        if (!payload) {
          setError({ text: FORM_UNAVAILABLE, retry: false });
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
        // publicForm.ts throws plain sentences (or the Function's "Too many…" copy);
        // anything else is a bug, shown as "try again" and logged, never as its text.
        const raw = err instanceof Error ? err.message : '';
        const known = [FORM_UNAVAILABLE, LOAD_OFFLINE, LOAD_LATER].includes(raw);
        if (!known && !raw.startsWith('Too many')) console.error('[slate] form load failed', err);
        const text = known || raw.startsWith('Too many') ? raw : LOAD_LATER;
        // "Not available" can't be helped by trying again.
        setError({ text, retry: text !== FORM_UNAVAILABLE });
      }
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
      clearUploadContext();
    };
  }, [slug, attempt]);

  /**
   * The schema as `<Form>` gets it: with the form's id, so the answers are
   * kept in this tab across a reload, back / forward, or the phone discarding
   * the tab (GAP-05, ADR-017 addendum) — and the "Try again" on a part that
   * didn't load (a page reload) keeps them too.
   */
  const fillSchema = useMemo(
    // Each option value once (CH-05): a form published before options got
    // their own values never ticks two rows at once or asks for picks nobody has.
    // A redirect typed without https:// opens that site, as the editor said (CON-06).
    () =>
      form ? { ...withWebRedirects(withoutRepeatedOptionsIn(form.schema)), id: form.id } : null,
    [form],
  );

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
      setGateNotice(null);
      setForm(result.form);
      setSlotsLeft(result.form.slotsLeft);
      slotsAt.current = Date.now();
      setGate(null);
      setUploadContext(result.form.id, { scope: 'public' });
      return null;
    },
    [slug, gate],
  );

  // Someone reaching a sign-up question sees fresh counts (at most every 30 s),
  // from the same throttled lookup — a locked form re-proves with this tab's token.
  /** The question on screen, so `slate:top` goes out once per new question, never on load. */
  const shownQuestion = useRef<string | null>(null);
  const onQuestionChange = useCallback(
    (questionId: string) => {
      if (!form) return;
      // Embedded (GAP-25): a new question asks the host page to bring the
      // frame's top back into view; the snippet's script does it if needed.
      if (embed && shownQuestion.current !== questionId) {
        if (shownQuestion.current !== null && window.parent !== window) {
          window.parent.postMessage({ type: 'slate:top' }, '*');
        }
        shownQuestion.current = questionId;
      }
      const q = form.schema.questions.find((x) => x.id === questionId);
      if (q?.type !== 'signup_slots' || Date.now() - slotsAt.current < SLOTS_STALE_MS) return;
      slotsAt.current = Date.now();
      const token = readFillUnlockToken(form.id);
      void (async () => {
        const next = token
          ? await unlockPublicForm(slug, { token }).then((r) => (r.ok ? r.form.slotsLeft : null))
          : await fetchSlotsLeft(slug);
        if (next) setSlotsLeft((cur) => mergeSlotsLeft(cur, next));
      })();
    },
    [form, slug, embed],
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
        <FillGate formName={gate.name} onUnlock={onUnlock} notice={gateNotice} />
      </div>
    );
  }

  if (error || !form || !fillSchema) {
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
          <div className="slate-fill-gate-card">
            <p className="slate-fill-gate-notice" role="status" style={{ justifySelf: 'center' }}>
              {error?.text ?? FORM_UNAVAILABLE}
            </p>
            {/* In-app browsers (a QR scan, a social app) hide reload: give them a way back. */}
            {error?.retry ? (
              <button
                type="button"
                className="slate-btn slate-btn--primary slate-fill-gate-submit"
                onClick={() => {
                  setError(null);
                  setLoading(true);
                  setAttempt((n) => n + 1);
                }}
              >
                Try again
              </button>
            ) : null}
          </div>
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
        schema={fillSchema}
        resume="tab"
        hiddenFields={extras.tracking}
        prefill={extras.prefill}
        onFileUpload={hostFileUpload}
        resolveFileUploadMeta={resolveUploadMeta}
        slotsLeft={slotsLeft}
        onQuestionChange={onQuestionChange}
        onSubmit={async (answers, meta) => {
          const payloadMeta = metaToPayload(meta);
          // Filled trap = bot. Flag it and let the Function drop it before any
          // DB work (ADR-058); the respondent sees the same thanks screen either way.
          const trapped = Boolean(trapRef.current?.value.trim());
          // The engine's id for this fill, kept with the tab's answers: a reload and
          // Resume send it again, so a reply lost on the way is never stored twice
          // (ENG-03, SEC-1). This page's own key where the browser can't make one.
          const submitId = meta.fillId ?? (submitIdRef.current ??= newSubmitId());
          try {
            await submitPublicResponse({
              formId: form.id,
              submitId,
              answers,
              meta: trapped
                ? { ...payloadMeta, hiddenFields: { ...payloadMeta.hiddenFields, _hp: '1' } }
                : payloadMeta,
            });
            // Stored: "Submit another" is a new fill with its own key.
            submitIdRef.current = undefined;
          } catch (err) {
            // A file expired or never finished uploading (ADR-067): nothing was stored;
            // back to that question to add it again, every other answer kept.
            if (err instanceof FilesRejectedError) {
              throw Object.assign(new Error(err.message), { goTo: err.questions[0] });
            }
            // Too long to send (413, GAP-07): Retry would send the same thing again,
            // so back to the biggest answer to shorten it, every other answer kept.
            if (err instanceof TooLongError) {
              const longest = longestAnswer(answers as Answers);
              if (longest) {
                throw Object.assign(new Error(longest.text ? SEND_TOO_LONG_HERE : err.message), {
                  goTo: longest.id,
                });
              }
            }
            // Closed while they were filling it in (ADR-063): say so plainly
            // instead of offering a Retry that can't work.
            if (err instanceof FormClosedError) {
              setClosed({ name: form.name, info: err.closed, duringFill: true });
            }
            // The password changed meanwhile (401): back to the password screen,
            // the answers kept in this tab for Resume; Retry could only fail again.
            if (err instanceof PasswordChangedError) {
              setGateNotice(err.message);
              setGate({
                id: form.id,
                name: form.name,
                slug: form.slug,
                locked: true,
                schema: null,
              });
              setForm(null);
            }
            // A slot filled while they were answering (ADR-066): fresh counts, and back to
            // the question to pick again — every other answer stays.
            if (err instanceof SlotFullError) {
              setSlotsLeft((cur) => mergeSlotsLeft(cur, err.slotsLeft));
              slotsAt.current = Date.now();
              const first = err.full[0]?.question;
              throw Object.assign(new Error(slotFullMessage(form.schema.questions, err.full)), {
                goTo: first,
              });
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
