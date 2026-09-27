/**
 * Studio moments for the /motion gallery (ADR-060): delight passes 4 and 5.
 * Each demo uses the real studio components and CSS with demo data — no
 * stores, no sign-in, nothing saved or sent. Replay buttons remount or
 * re-run each moment.
 */

'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Question } from '@palmstreetweb/slate';
import type { StoredSubmission } from '../_admin/_submissionStore.js';
import { useToast } from '../_admin/toast.js';
import { playUiSound } from '../_admin/uiSounds.js';
import { FlipPill, PublishButton, usePublishIgnition } from '../_admin/delight/ignition.js';
import { IconBell } from '../_admin/delight/BellIcon.js';
import { Odometer } from '../_admin/delight/Odometer.js';
import { StudioConfetti } from '../_admin/delight/StudioConfetti.js';
import { RadarPing } from '../_admin/delight/RadarPing.js';
import { isArrival, noteArrivals, useArrivalsVersion } from '../_admin/delight/arrivals.js';
import { ResponsesSummary } from '../_admin/responses/ResponsesSummary.js';
import { usePhone } from '../_admin/responses/hooks.js';

type Mode = 'light' | 'dark';
type Common = { mode: Mode; reduce: boolean; sound: boolean };

const noop = () => {};

/** The studio's chrome wrapper (warm palette), scoped to one card. */
function StudioSurface({
  mode,
  reduce,
  className,
  children,
}: {
  mode: Mode;
  reduce: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      data-slate-forms=""
      data-theme-name="slate"
      data-admin-ui="warm"
      data-theme={mode}
      {...(reduce ? { 'data-reduced-motion': '' } : {})}
      className={`mg-studio${className ? ` ${className}` : ''}`}
    >
      {children}
    </div>
  );
}

function CardFoot({ title, note, children }: { title: string; note: string; children: ReactNode }) {
  return (
    <footer className="mg-card-foot mg-card-foot--stack">
      <div>
        <strong>{title}</strong>
        <span>{note}</span>
      </div>
      <div className="mg-actions">{children}</div>
    </footer>
  );
}

/* ---------- pass 4a: publish ignition ---------- */

function PublishDemo({ mode, reduce, sound }: Common) {
  const toast = useToast();
  const ignite = usePublishIgnition();
  const scopeRef = useRef<HTMLDivElement>(null);
  const [published, setPublished] = useState(false);
  const [ignited, setIgnited] = useState(false);
  const [auto, setAuto] = useState(1);

  const publish = () => {
    if (sound) playUiSound('confirm');
    ignite.start(
      () => {
        setPublished(true);
        return true;
      },
      {
        scope: scopeRef.current,
        onLive: () => {
          setIgnited(true);
          if (sound) playUiSound('success');
          // The first run plays when the page opens; only replays toast.
          if (autoRef.current < 2) return;
          toast.push({
            title: 'You’re live',
            detail: 'Demo only — nothing was published.',
            tone: 'success',
            sound: 'none',
          });
        },
      },
    );
  };
  const publishRef = useRef(publish);
  publishRef.current = publish;
  const autoRef = useRef(auto);
  autoRef.current = auto;

  // Replay: back to Draft, then press Publish.
  useEffect(() => {
    setPublished(false);
    setIgnited(false);
    const t = window.setTimeout(() => publishRef.current(), 900);
    return () => window.clearTimeout(t);
  }, [auto]);

  const label = published && ignite.phase !== 'working' ? 'Live' : 'Draft';

  return (
    <article className="mg-card">
      <StudioSurface mode={mode} reduce={reduce} className="mg-studio--publish">
        <div ref={scopeRef} className="mg-studio-bar">
          <span className="slate-crumb mg-studio-crumb">Forms / Spring intake</span>
          <span className="mg-studio-bar-right">
            <FlipPill
              label={label}
              className={`slate-pub-pill${label === 'Live' ? ' slate-pub-pill--live' : ''}`}
            />
            {!published || ignite.phase !== 'idle' ? (
              <PublishButton phase={ignite.phase} onClick={publish}>
                Publish
              </PublishButton>
            ) : (
              <button type="button" className="slate-btn" onClick={() => setAuto((n) => n + 1)}>
                Share
              </button>
            )}
          </span>
        </div>
        <div className="mg-studio-share">
          <span className="mg-studio-share-label">Share panel</span>
          <div className="slate-share-foot">
            {published && ignite.phase !== 'working' ? (
              <p className={`slate-share-live${ignited ? ' slate-share-live--ignite' : ''}`}>
                <span className="slate-share-live-dot" aria-hidden />
                Live
              </p>
            ) : (
              <p className="mg-studio-muted">Not published</p>
            )}
          </div>
        </div>
      </StudioSurface>
      <CardFoot
        title="Publish ignition"
        note="Spinner → self-drawing check → the button bows out. The pill flips Draft → Live; the Live dot fires one sonar ring, pulses three times, then rests."
      >
        <button
          type="button"
          className="mg-btn mg-btn--primary"
          disabled={ignite.phase !== 'idle'}
          onClick={() => setAuto((n) => n + 1)}
        >
          Replay
        </button>
      </CardFoot>
    </article>
  );
}

/* ---------- pass 4b: a response arrives ---------- */

const ARRIVING = [
  { who: 'Nora Fischer', what: 'Heater won’t ignite' },
  { who: 'Kai Nakamura', what: 'Quote for a new cover' },
  { who: 'Ava Park', what: 'Leak near the skimmer' },
  { who: 'Sam Ortiz', what: 'Weekly service' },
  { who: 'Lena Brandt', what: 'Green water after rain' },
];

type Row = { id: string; who: string; what: string };

let rowSeq = 0;

function ArrivalDemo({ mode, reduce, sound }: Common) {
  useArrivalsVersion();
  const [count, setCount] = useState(8);
  const [ring, setRing] = useState(0);
  const [unread, setUnread] = useState(0);
  const [rows, setRows] = useState<Row[]>([
    { id: 'seed-1', who: 'Mia Chen', what: 'Opening in May' },
    { id: 'seed-2', who: 'Owen Hart', what: 'Pump is loud' },
  ]);
  const [auto, setAuto] = useState(1);

  const arrive = (n: number) => {
    const fresh = Array.from({ length: n }, () => {
      rowSeq += 1;
      const pick = ARRIVING[rowSeq % ARRIVING.length]!;
      return { id: `demo-${rowSeq}`, ...pick };
    });
    noteArrivals(fresh.map((r) => r.id));
    setRows((prev) => [...fresh, ...prev].slice(0, 5));
    setCount((c) => c + n);
    setUnread((u) => u + n);
    setRing((r) => r + 1);
    if (sound) playUiSound('arrival');
  };
  const arriveRef = useRef(arrive);
  arriveRef.current = arrive;

  useEffect(() => {
    setCount(8);
    setUnread(0);
    const timers = [
      window.setTimeout(() => arriveRef.current(1), 700),
      window.setTimeout(() => arriveRef.current(3), 2600),
    ];
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [auto]);

  return (
    <article className="mg-card">
      <StudioSurface mode={mode} reduce={reduce} className="mg-studio--arrive">
        <div className="mg-studio-bar">
          <span className="mg-studio-brand">Slate</span>
          <button
            type="button"
            className={`slate-btn slate-btn--icon slate-inbox-btn${ring > 0 ? ' slate-inbox-btn--ring' : ''}`}
            aria-label={unread > 0 ? `Notifications, ${unread} new` : 'Notifications'}
            onClick={() => setUnread(0)}
          >
            <IconBell key={`bell-${ring}`} swing={ring > 0} />
            {unread > 0 ? (
              <span key={`badge-${ring}`} className="slate-inbox-badge">
                {unread > 9 ? '9+' : unread}
              </span>
            ) : null}
          </button>
        </div>
        <div className="mg-studio-pad">
          <div className="slate-card mg-studio-formcard">
            <div className="slate-card-pad">
              <span className="slate-card-title">Spring intake</span>
              <div className="mg-studio-badges">
                <span className="slate-badge slate-badge--live">Live</span>
                <span className="slate-badge slate-badge--accent">
                  <Odometer value={count} /> {count === 1 ? 'response' : 'responses'}
                </span>
              </div>
            </div>
          </div>
          <div className="slate-inbox mg-studio-inbox">
            <ul className="slate-inbox-list">
              {rows.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    className={`slate-inbox-item slate-inbox-item--unread${
                      isArrival(row.id) ? ' is-arrived' : ''
                    }`}
                  >
                    <span className="slate-inbox-dot" aria-hidden />
                    <span className="slate-inbox-text">
                      {row.who}
                      <span className="slate-inbox-form"> · {row.what}</span>
                    </span>
                    <span className="slate-inbox-when">now</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </StudioSurface>
      <CardFoot
        title="New response arrives"
        note="The bell swings, the card count rolls like an odometer (9 → 12 rolls the tens), and new rows slide in with an accent wash that fades over 2 s. With Sound on: the arrival ding-dong."
      >
        <button type="button" className="mg-btn" onClick={() => arrive(1)}>
          +1
        </button>
        <button
          type="button"
          className="mg-btn mg-btn--primary"
          onClick={() => setAuto((n) => n + 1)}
        >
          Replay
        </button>
      </CardFoot>
    </article>
  );
}

/* ---------- pass 4c: a form's first response ---------- */

function FirstResponseDemo({ mode, reduce, sound }: Common) {
  const toast = useToast();
  const [run, setRun] = useState(0);

  useEffect(() => {
    if (run > 0 && sound) playUiSound('arrival');
  }, [run, sound]);

  return (
    <article className="mg-card">
      <StudioSurface mode={mode} reduce={reduce} className="mg-studio--first">
        <div
          key={run}
          className="slate-toast slate-toast--success slate-toast--celebrate mg-studio-toast"
        >
          <span className="slate-toast-medal" aria-hidden="true">
            1<sup>st</sup>
            <StudioConfetti />
          </span>
          <div className="slate-toast-body">
            <strong className="slate-toast-title">First response!</strong>
            <p className="slate-toast-detail">Spring intake just heard back.</p>
          </div>
        </div>
      </StudioSurface>
      <CardFoot
        title="First response!"
        note="Once per form, remembered in this browser. Pass 1’s confetti, in studio colours, bursts from the 1st medal."
      >
        <button
          type="button"
          className="mg-btn"
          onClick={() => {
            if (sound) playUiSound('arrival');
            toast.push({
              title: 'First response!',
              detail: 'Spring intake just heard back.',
              tone: 'success',
              sound: 'none',
              celebrate: true,
              durationMs: 5600,
            });
          }}
        >
          As a toast
        </button>
        <button
          type="button"
          className="mg-btn mg-btn--primary"
          onClick={() => setRun((n) => n + 1)}
        >
          Replay
        </button>
      </CardFoot>
    </article>
  );
}

/* ---------- pass 5a: the Summary comes alive ---------- */

const SUMMARY_QUESTIONS = [
  { id: 'name', type: 'short_text', title: 'Your name' },
  { id: 'email', type: 'email', title: 'Best email' },
  {
    id: 'need',
    type: 'single_choice',
    title: 'What do you need?',
    options: [
      { label: 'Repair', value: 'repair' },
      { label: 'Quote', value: 'quote' },
      { label: 'Weekly service', value: 'service' },
      { label: 'New install', value: 'install' },
    ],
  },
  {
    id: 'source',
    type: 'single_choice',
    title: 'How did you hear about us?',
    options: [
      { label: 'Flyer', value: 'flyer' },
      { label: 'A friend', value: 'friend' },
      { label: 'Google', value: 'google' },
      { label: 'Instagram', value: 'instagram' },
    ],
  },
  { id: 'rating', type: 'scale', title: 'How urgent is it?', min: 1, max: 5 },
] as unknown as Question[];

const PEOPLE = [
  'Nora Fischer',
  'Kai Nakamura',
  'Ava Park',
  'Sam Ortiz',
  'Lena Brandt',
  'Mia Chen',
  'Owen Hart',
  'Ivy Moreau',
  'Leo Rossi',
  'Zoe Adams',
  'Eli Brooks',
  'Ruby Diaz',
  'Theo Grant',
  'June Wells',
  'Max Silva',
  'Ada Novak',
  'Finn Kerr',
  'Iris Vale',
];
const NEEDS = [
  'repair',
  'quote',
  'repair',
  'service',
  'repair',
  'install',
  'quote',
  'repair',
  'service',
];
const SOURCES = ['flyer', 'friend', 'flyer', 'google', 'flyer', 'instagram', 'friend', 'flyer'];
/** Days ago for each response — a busy week after a quiet one. */
const DAYS_AGO = [0, 0, 0, 1, 1, 2, 2, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13];

function demoSubs(): StoredSubmission[] {
  const now = Date.now();
  return PEOPLE.map((name, i) => {
    const receivedAt = new Date(
      now - DAYS_AGO[i]! * 86_400_000 - (i % 5) * 3_600_000 - 60_000,
    ).toISOString();
    return {
      id: `sum-${i}`,
      formId: 'demo-form',
      receivedAt,
      answers: {
        name,
        email: `${name.split(' ')[0]!.toLowerCase()}@example.com`,
        need: NEEDS[i % NEEDS.length],
        source: SOURCES[i % SOURCES.length],
        rating: ((i * 7) % 5) + 1,
      },
      meta: {
        startedAt: receivedAt,
        completedAt: receivedAt,
        durationMs: 48_000 + ((i * 13_000) % 60_000),
        questionsVisited: [],
        hiddenFields: {},
        score: 0,
      },
    } as unknown as StoredSubmission;
  });
}

function SummaryDemo({ mode, reduce }: Common) {
  const [run, setRun] = useState(0);
  const subs = useMemo(() => demoSubs(), []);
  const unread = useMemo(() => new Set(['sum-0', 'sum-1', 'sum-2']), []);
  const phone = usePhone();

  return (
    <div className="mg-panel">
      <div className="mg-toolbar">
        <p className="mg-note mg-note--flush">
          KPIs count up over 600 ms, the 14-day sparkline draws on left to right, and each chart’s
          bars grow from zero (transform, not width) the first time it scrolls into view.
        </p>
        <button
          type="button"
          className="mg-btn mg-btn--primary"
          onClick={() => setRun((n) => n + 1)}
        >
          Replay
        </button>
      </div>
      <StudioSurface mode={mode} reduce={reduce} className="mg-studio--summary">
        <div className={`slate-rsp${phone ? ' slate-rsp--phone' : ''}`}>
          <div className="rsp-view">
            <ResponsesSummary
              key={run}
              formId="demo-form"
              formName="Spring intake"
              questions={SUMMARY_QUESTIONS}
              subs={subs}
              unread={unread}
              onMarkRead={noop}
              onMarkUnread={noop}
              onTrash={noop}
            />
          </div>
        </div>
      </StudioSurface>
    </div>
  );
}

/* ---------- pass 5b: empty states ---------- */

function EmptyDemo({ mode, reduce }: Common) {
  const [run, setRun] = useState(0);
  return (
    <div className="mg-grid mg-grid--empty">
      <article className="mg-card">
        <StudioSurface mode={mode} reduce={reduce} className="mg-studio--empty">
          <div key={run} className="slate-empty slate-empty--start">
            <div className="slate-empty-mark" aria-hidden>
              <span />
              <span />
              <span />
            </div>
            <p className="slate-empty-title">Your library is empty</p>
            <p className="slate-empty-copy">
              Build with AI or New form live in the top right — pick whichever fits.
            </p>
          </div>
        </StudioSurface>
        <CardFoot
          title="Dashboard, no forms"
          note="The three-bar mark assembles like the boot splash’s loading stack, then holds."
        >
          <button
            type="button"
            className="mg-btn mg-btn--primary"
            onClick={() => setRun((n) => n + 1)}
          >
            Replay
          </button>
        </CardFoot>
      </article>
      <article className="mg-card">
        <StudioSurface mode={mode} reduce={reduce} className="mg-studio--empty">
          <div key={run} className="slate-empty slate-empty--start">
            <RadarPing />
            <p className="slate-empty-title">No responses yet</p>
            <p className="slate-empty-copy">
              Share your public link. New answers appear here as soon as someone submits.
            </p>
            <div className="slate-empty-actions">
              <button type="button" className="slate-btn slate-btn--primary slate-nudge">
                Share link
              </button>
              <button type="button" className="slate-btn">
                Preview
              </button>
            </div>
          </div>
        </StudioSurface>
        <CardFoot
          title="Responses, none yet"
          note="A slow radar ping and a nudge on Share as each ping lands — three cycles (about 5 s), then still. Every studio loop now stops after three."
        >
          <button
            type="button"
            className="mg-btn mg-btn--primary"
            onClick={() => setRun((n) => n + 1)}
          >
            Replay
          </button>
        </CardFoot>
      </article>
    </div>
  );
}

/* ---------- sections ---------- */

export function StudioPass4(props: Common) {
  return (
    <div className="mg-grid mg-grid--studio">
      <PublishDemo {...props} />
      <ArrivalDemo {...props} />
      <FirstResponseDemo {...props} />
    </div>
  );
}

export function StudioSummary(props: Common) {
  return <SummaryDemo {...props} />;
}

export function StudioEmpty(props: Common) {
  return <EmptyDemo {...props} />;
}
