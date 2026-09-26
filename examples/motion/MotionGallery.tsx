/**
 * Motion gallery (ADR-059) — every delight-pass animation on one page, each
 * with a Replay button. Dev demo only: it ships in the examples app, never in
 * the published package. Schemas are built in; onSubmit resolves locally
 * after a short fake delay, so nothing leaves the browser.
 *
 * The "Reduce motion" switch previews the calm versions through the engine's
 * internal ReducedMotionOverrideContext, the same path the OS setting takes.
 */

'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { Form, themes } from '@palmstreetweb/slate';
import type { Schema } from '@palmstreetweb/slate';
import { ReducedMotionOverrideContext } from '@/hooks/useReducedMotion.js';
import { ProgressBar } from '@/components/chrome/ProgressBar.js';
import { FooterCounter } from '@/components/chrome/FooterCounter.js';
import { ThemeDecoration, hasStepDecorationBackdrop, resolveThemeDecoration } from '@/components/ThemeDecoration.js';

type Mode = 'light' | 'dark';

const THEME_NAMES = Object.keys(themes);

function label(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** What each theme's finale does, in a few words. */
const FINALE_NOTE: Record<string, string> = {
  classic: 'confetti in the accent family',
  editorial: 'ribbons in ink + accent',
  swiss: 'poster shapes drop in',
  midnight: 'aurora orbs rise',
  sunset: 'warm orbs rise',
  terminal: 'pixels redraw in steps',
  forest: 'confetti in the accent family',
  mono: 'grayscale shapes drop in',
  constellation: 'the whole star map lights',
  bloom: 'the vine flowers, petals drift',
  riso: 'overprinting ink dots',
  memphis: 'triangles and bars',
};

const fakeSubmit = () => new Promise<void>((resolve) => window.setTimeout(resolve, 650));

/* ---------- tiny DOM script helpers (the gallery's own DOM only) ---------- */

type ScriptStep = { at: number; run: (root: HTMLElement) => void };

function clickIn(root: HTMLElement, selector: string, index = 0): void {
  const el = root.querySelectorAll<HTMLElement>(`.slate-stage-content ${selector}`)[index];
  el?.click();
}

/** Set a controlled input's value the way a keystroke would, so React sees it. */
function fillIn(root: HTMLElement, value: string): void {
  const input = root.querySelector<HTMLInputElement>('.slate-stage-content input');
  if (!input) return;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

/** Runs `steps` against `rootRef` every time `runKey` changes; cancels on replay/unmount. */
function useScript(rootRef: RefObject<HTMLElement | null>, runKey: string, steps: ScriptStep[]) {
  const stepsRef = useRef(steps);
  stepsRef.current = steps;
  useEffect(() => {
    const timers = stepsRef.current.map((s) =>
      window.setTimeout(() => {
        if (rootRef.current) s.run(rootRef.current);
      }, s.at),
    );
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [rootRef, runKey]);
}

/* ---------- chrome ---------- */

function Switch({
  label: text,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className="mg-switch"
      onClick={() => onChange(!checked)}
    >
      <span className="mg-switch-track" aria-hidden="true">
        <span className="mg-switch-thumb" />
      </span>
      {text}
    </button>
  );
}

function ThemeSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="mg-select">
      <span>Theme</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {THEME_NAMES.map((n) => (
          <option key={n} value={n}>
            {label(n)}
          </option>
        ))}
      </select>
    </label>
  );
}

function SectionHead({
  id,
  title,
  children,
  actions,
}: {
  id: string;
  title: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mg-section-head">
      <div>
        <h2 id={id}>{title}</h2>
        <p>{children}</p>
      </div>
      {actions && <div className="mg-actions">{actions}</div>}
    </div>
  );
}

/** A bare engine wrapper, for showing chrome and decorations outside a <Form>. */
function Surface({
  theme,
  mode,
  reduce,
  className,
  children,
}: {
  theme: string;
  mode: Mode;
  reduce: boolean;
  className?: string;
  children: ReactNode;
}) {
  const deco = resolveThemeDecoration(theme);
  return (
    <div
      data-slate-forms=""
      data-theme-name={theme}
      data-theme={mode}
      {...(hasStepDecorationBackdrop(deco) ? { 'data-has-decoration': '' } : {})}
      {...(reduce ? { 'data-reduced-motion': '' } : {})}
      className={`mg-surface ${className ?? ''}`}
    >
      {children}
    </div>
  );
}

/* ---------- 1. completion celebration ---------- */

function CelebrationCard({
  theme,
  mode,
  sound,
  allRun,
  index,
}: {
  theme: string;
  mode: Mode;
  sound: boolean;
  allRun: number;
  index: number;
}) {
  const [runs, setRuns] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const runKey = `${allRun}-${runs}`;
  // A solo replay may play the finale chord; "Replay all" stays quiet.
  const solo = runs > 0;

  const schema = useMemo<Schema>(
    () => ({
      brand: { name: label(theme) },
      theme,
      themeMode: mode,
      sound: sound && solo ? 'pixie-mallet' : 'off',
      questions: [
        { id: 'ready', type: 'yes_no', title: 'Ready to send it?' },
        { id: 'done', type: 'thanks', title: "You're all set.", subtitle: 'Talk soon.' },
      ],
    }),
    [theme, mode, sound, solo],
  );

  useScript(rootRef, runKey, [
    { at: (solo ? 0 : index * 140) + 650, run: (root) => clickIn(root, '.slate-choice') },
  ]);

  return (
    <article className="mg-card">
      <div className="mg-frame" ref={rootRef}>
        <Form key={runKey} schema={schema} onSubmit={fakeSubmit} />
      </div>
      <footer className="mg-card-foot">
        <div>
          <strong>{label(theme)}</strong>
          <span>{FINALE_NOTE[theme] ?? 'confetti'}</span>
        </div>
        <button type="button" className="mg-btn" onClick={() => setRuns((n) => n + 1)}>
          Replay
        </button>
      </footer>
    </article>
  );
}

/* ---------- 2. question flow (one live form at a time: keys are global) ---------- */

type FlowDemo = 'commit' | 'handoff' | 'invalid';

const FLOW_TABS: ReadonlyArray<{ id: FlowDemo; name: string; note: string }> = [
  {
    id: 'commit',
    name: 'Choice commit',
    note: 'The badge flips to a self-drawing check while the other options step back, inside the 220ms before auto-advance.',
  },
  {
    id: 'handoff',
    name: 'Question hand-off',
    note: 'The outgoing question leaves over 220ms as an inert copy while the next rises in. Back leaves downward.',
  },
  {
    id: 'invalid',
    name: 'Invalid input',
    note: 'A 3px shake on every failed attempt — even when the message is the same — and the error slides in.',
  },
];

function flowSchema(demo: FlowDemo, theme: string, mode: Mode, sound: boolean): Schema {
  const base = {
    brand: { name: 'Motion demo' },
    theme,
    themeMode: mode,
    sound: sound ? ('pixie-mallet' as const) : ('off' as const),
  };
  if (demo === 'commit') {
    return {
      ...base,
      questions: [
        {
          id: 'build',
          type: 'single_choice',
          title: 'What are we building?',
          options: [
            { label: 'A quote form', value: 'quote' },
            { label: 'An event sign-up', value: 'event', description: 'with a guest count' },
            { label: 'A feedback survey', value: 'survey' },
            { label: 'Something else', value: 'other' },
          ],
        },
        { id: 'name', type: 'short_text', title: 'Lovely. And your name?' },
        { id: 'done', type: 'thanks', title: 'Thanks!' },
      ],
    };
  }
  if (demo === 'handoff') {
    return {
      ...base,
      questions: [
        {
          id: 'intro',
          type: 'statement',
          title: 'One question at a time.',
          body: 'Each one hands off to the next.',
          cta: 'Next',
        },
        { id: 'city', type: 'short_text', title: 'Which city are you in?' },
        { id: 'done', type: 'thanks', title: 'Thanks!' },
      ],
    };
  }
  return {
    ...base,
    questions: [
      {
        id: 'email',
        type: 'email',
        title: 'Where should we send the quote?',
        required: true,
      },
      { id: 'done', type: 'thanks', title: 'Thanks!' },
    ],
  };
}

const FLOW_SCRIPTS: Record<FlowDemo, ScriptStep[]> = {
  commit: [{ at: 800, run: (r) => clickIn(r, '.slate-choice', 1) }],
  handoff: [
    { at: 700, run: (r) => clickIn(r, '.slate-cta') },
    { at: 2100, run: (r) => r.querySelector<HTMLElement>('.slate-back')?.click() },
    { at: 3400, run: (r) => clickIn(r, '.slate-cta') },
  ],
  invalid: [
    { at: 800, run: (r) => clickIn(r, '.slate-ok-btn') },
    { at: 1700, run: (r) => fillIn(r, 'not-an-email') },
    { at: 2100, run: (r) => clickIn(r, '.slate-ok-btn') },
    { at: 2900, run: (r) => clickIn(r, '.slate-ok-btn') },
  ],
};

function FlowStage({ mode, sound }: { mode: Mode; sound: boolean }) {
  const [demo, setDemo] = useState<FlowDemo>('commit');
  const [theme, setTheme] = useState('classic');
  const [runs, setRuns] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const runKey = `${demo}-${theme}-${mode}-${runs}`;
  const schema = useMemo(() => flowSchema(demo, theme, mode, sound), [demo, theme, mode, sound]);
  const tab = FLOW_TABS.find((t) => t.id === demo)!;

  useScript(rootRef, runKey, FLOW_SCRIPTS[demo]);

  return (
    <div className="mg-flow">
      <div className="mg-toolbar">
        <div className="mg-tabs" role="tablist" aria-label="Question flow demos">
          {FLOW_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={t.id === demo}
              className="mg-tab"
              onClick={() => setDemo(t.id)}
            >
              {t.name}
            </button>
          ))}
        </div>
        <div className="mg-actions">
          <ThemeSelect value={theme} onChange={setTheme} />
          <button type="button" className="mg-btn mg-btn--primary" onClick={() => setRuns((n) => n + 1)}>
            Replay
          </button>
        </div>
      </div>
      <p className="mg-note">{tab.note} You can also click and type in it yourself.</p>
      <div className="mg-frame mg-frame--tall" ref={rootRef}>
        <Form key={runKey} schema={schema} onSubmit={fakeSubmit} />
      </div>
    </div>
  );
}

/* ---------- 3. progress spark + counter roll ---------- */

const PROGRESS_STEPS = 6;

function useAutoRun(onTick: (i: number) => boolean, intervalMs: number) {
  const tickRef = useRef(onTick);
  tickRef.current = onTick;
  const [running, setRunning] = useState(0);
  useEffect(() => {
    if (running === 0) return undefined;
    let i = 0;
    const t = window.setInterval(() => {
      i += 1;
      if (!tickRef.current(i)) window.clearInterval(t);
    }, intervalMs);
    return () => window.clearInterval(t);
  }, [running, intervalMs]);
  return useCallback(() => setRunning((n) => n + 1), []);
}

function ProgressDemo({ mode, reduce }: { mode: Mode; reduce: boolean }) {
  const [theme, setTheme] = useState('classic');
  const [step, setStep] = useState(1);
  const [complete, setComplete] = useState(false);
  const value = complete ? 100 : ((step - 1) / PROGRESS_STEPS) * 100;

  const replay = useAutoRun((i) => {
    if (i < PROGRESS_STEPS) {
      setStep(i + 1);
      return true;
    }
    setComplete(true);
    return false;
  }, 750);

  const restart = () => {
    setComplete(false);
    setStep(1);
    replay();
  };

  return (
    <div className="mg-panel">
      <div className="mg-toolbar">
        <ThemeSelect value={theme} onChange={setTheme} />
        <div className="mg-actions">
          <button
            type="button"
            className="mg-btn"
            onClick={() => {
              setComplete(false);
              setStep((s) => Math.max(1, s - 1));
            }}
          >
            Back
          </button>
          <button
            type="button"
            className="mg-btn"
            onClick={() => setStep((s) => Math.min(PROGRESS_STEPS, s + 1))}
          >
            Next
          </button>
          <button type="button" className="mg-btn" onClick={() => setComplete(true)}>
            Submit ✓
          </button>
          <button type="button" className="mg-btn mg-btn--primary" onClick={restart}>
            Replay
          </button>
        </div>
      </div>
      <Surface theme={theme} mode={mode} reduce={reduce} className="mg-surface--progress">
        <ProgressBar value={value} complete={complete} />
        <div className="mg-surface-copy">
          <span className="slate-step-badge">
            <span>{String(step).padStart(2, '0')}</span>
            <span className="slate-step-sep">→</span>
          </span>
          <p>{complete ? 'Submitted — the tip gives one last flare.' : 'The tip flares on every step forward.'}</p>
        </div>
        <FooterCounter current={step} total={PROGRESS_STEPS} />
      </Surface>
    </div>
  );
}

/* ---------- 4. decorations ---------- */

const DECO_DEMOS: ReadonlyArray<{ theme: string; title: string; note: string; narrative: boolean }> = [
  {
    theme: 'constellation',
    title: 'Constellation',
    note: 'The newest line draws itself, then its star pops. Submit lights the whole map.',
    narrative: true,
  },
  {
    theme: 'bloom',
    title: 'Bloom',
    note: 'The vine grows its new length and a leaf unfurls. Submit brings the flowers.',
    narrative: true,
  },
  {
    theme: 'midnight',
    title: 'Aurora',
    note: 'The new glow cross-fades over the old one (opacity only).',
    narrative: false,
  },
  {
    theme: 'swiss',
    title: 'Swiss',
    note: 'Each composition slides its shapes in from the edges, staggered.',
    narrative: false,
  },
];

const DECO_LAST_STEP = 8;

function DecorationCard({
  demo,
  mode,
  reduce,
}: {
  demo: (typeof DECO_DEMOS)[number];
  mode: Mode;
  reduce: boolean;
}) {
  const [step, setStep] = useState(0);
  const [complete, setComplete] = useState(false);

  const replay = useAutoRun((i) => {
    if (i <= DECO_LAST_STEP) {
      setStep(i);
      return true;
    }
    if (demo.narrative) setComplete(true);
    return false;
  }, 850);

  return (
    <article className="mg-card">
      <Surface theme={demo.theme} mode={mode} reduce={reduce} className="mg-surface--deco">
        <ThemeDecoration themeName={demo.theme} step={step} complete={complete} />
        <span className="mg-step-pill">{complete ? 'submitted' : `step ${step}`}</span>
      </Surface>
      <footer className="mg-card-foot mg-card-foot--stack">
        <div>
          <strong>{demo.title}</strong>
          <span>{demo.note}</span>
        </div>
        <div className="mg-actions">
          <button
            type="button"
            className="mg-btn"
            onClick={() => {
              setComplete(false);
              setStep((s) => Math.max(0, s - 1));
            }}
          >
            Back
          </button>
          <button type="button" className="mg-btn" onClick={() => setStep((s) => s + 1)}>
            Next
          </button>
          {demo.narrative && (
            <button type="button" className="mg-btn" onClick={() => setComplete(true)}>
              Submit ✓
            </button>
          )}
          <button
            type="button"
            className="mg-btn mg-btn--primary"
            onClick={() => {
              setComplete(false);
              setStep(0);
              replay();
            }}
          >
            Replay
          </button>
        </div>
      </footer>
    </article>
  );
}

/* ---------- page ---------- */

function osPrefers(query: string): boolean {
  return typeof window !== 'undefined' && Boolean(window.matchMedia?.(query).matches);
}

export function MotionGallery() {
  const [mode, setMode] = useState<Mode>(() =>
    osPrefers('(prefers-color-scheme: dark)') ? 'dark' : 'light',
  );
  const osReduce = osPrefers('(prefers-reduced-motion: reduce)');
  const [reduce, setReduce] = useState(osReduce);
  const [sound, setSound] = useState(false);
  const [allRun, setAllRun] = useState(0);

  return (
    <div className="mg" data-mode={mode}>
      <header className="mg-head">
        <div className="mg-title">
          <span className="mg-eyebrow">Slate · delight pass 1</span>
          <h1>Motion gallery</h1>
          <p>
            Every new animation, replayable. Demo schemas live in the page — nothing is signed in
            to or sent anywhere.
          </p>
        </div>
        <div className="mg-controls" aria-label="Preview settings">
          <Switch label="Dark" checked={mode === 'dark'} onChange={(d) => setMode(d ? 'dark' : 'light')} />
          <Switch label="Reduce motion" checked={reduce} onChange={setReduce} />
          <Switch label="Sound" checked={sound} onChange={setSound} />
        </div>
        {osReduce && !reduce && (
          <p className="mg-warn">
            Your system asks for reduced motion, so CSS animations stay calm even with this switch
            off.
          </p>
        )}
      </header>

      <ReducedMotionOverrideContext.Provider value={reduce ? true : null}>
        <nav className="mg-jump" aria-label="Sections">
          <a href="#celebration">Celebration</a>
          <a href="#flow">Question flow</a>
          <a href="#progress">Progress</a>
          <a href="#decorations">Decorations</a>
        </nav>

        <section aria-labelledby="celebration">
          <SectionHead
            id="celebration"
            title="Completion celebration"
            actions={
              <button type="button" className="mg-btn mg-btn--primary" onClick={() => setAllRun((n) => n + 1)}>
                Replay all
              </button>
            }
          >
            Fires on a confirmed submit only — never just for reaching the end. The bar fills, the
            check draws, the chip pops and each theme bursts its own way. With Sound on, a solo
            Replay plays the finale chord.
          </SectionHead>
          <div className="mg-grid">
            {THEME_NAMES.map((name, i) => (
              <CelebrationCard
                key={`${name}-${allRun}`}
                theme={name}
                mode={mode}
                sound={sound}
                allRun={allRun}
                index={i}
              />
            ))}
          </div>
        </section>

        <section aria-labelledby="flow">
          <SectionHead id="flow" title="Question flow">
            The commit beat, the 220ms hand-off and the invalid-input nudge.
          </SectionHead>
          <FlowStage mode={mode} sound={sound} />
        </section>

        <section aria-labelledby="progress">
          <SectionHead id="progress" title="Progress spark + counter roll">
            The bar moves by scaleX with a glowing tip; the footer number rolls to the next.
          </SectionHead>
          <ProgressDemo mode={mode} reduce={reduce} />
        </section>

        <section aria-labelledby="decorations">
          <SectionHead id="decorations" title="Self-drawing decorations">
            Stroke-dash and transform only. Narrative themes finish their picture on submit.
          </SectionHead>
          <div className="mg-grid mg-grid--deco">
            {DECO_DEMOS.map((d) => (
              <DecorationCard key={d.theme} demo={d} mode={mode} reduce={reduce} />
            ))}
          </div>
        </section>
      </ReducedMotionOverrideContext.Provider>

      <footer className="mg-foot">ADR-059 · examples only — not part of @palmstreetweb/slate.</footer>
    </div>
  );
}
