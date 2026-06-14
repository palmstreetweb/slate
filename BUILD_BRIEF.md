# `@palmstreetweb/slate` — Build Brief v1.0

> The complete spec for building Palm Street Web's internal forms package. Read this end-to-end before writing a single line of code. Every decision is intentional — when in doubt, return here.

---

## 1. Mission

A small, opinionated form-rendering library. Schema in → Typeform-quality conversational form out. Theme registry. Pluggable submit handler. Used across all Palm Street Web client projects (805 Sealcoating, Wallace Plumbing, Wild Wash, PSW v2, future clients).

**This is internal tooling owned by the agency.** Clients never write schemas — Caleb writes them in code per client project. No form-builder UI. No multi-tenant storage. No admin dashboard. Just a beautiful, fast, accessible form engine that drops into any Next.js project.

---

## 2. Non-Negotiable Principles

1. **TypeScript-first.** Full inference on schemas. If a consumer types `answers.` in their `onSubmit`, autocomplete reveals every question ID typed correctly.
2. **Schema-driven.** A `Schema` object is the source of truth. No imperative API.
3. **Theme registry.** Themes are config objects. Adding a third theme = adding an object, not touching the engine.
4. **Light + dark per theme.** Every theme defines both modes. The user can toggle between them, or the developer can force one.
5. **PSW theme toggle 1:1.** The dark/light toggle UI matches palmstreetweb.com pixel-for-pixel — same 68×36 pill, same morph, same easing. See §8.
6. **Pluggable submit.** The package never knows about Resend, Supabase, or any backend. The consumer wires `onSubmit`.
7. **Top-5% repo hygiene.** `AGENTS.md`, `CLAUDE.md`, `DECISIONS.md`, `MIGRATION_NOTES.md`, `README.md` ship day one.
8. **Accessibility is not optional.** ARIA, focus management, `prefers-reduced-motion`, mobile-first.
9. **No bloat.** Tree-shakeable. Zero runtime dependencies beyond React. Bundle size budget: <50kb gzipped for the engine, themes lazy.

---

## 3. Public API (Surface)

```ts
import { Form, defineSchema, themes } from '@palmstreetweb/slate';
import type { Schema, Answers, Theme } from '@palmstreetweb/slate';

const schema = defineSchema({
  brand: {
    name: '805 Sealcoating',
    logo: '/logo.svg', // optional
  },
  theme: 'swiss',          // 'editorial' | 'swiss'
  themeMode: 'toggle',     // 'auto' | 'light' | 'dark' | 'toggle'
  questions: [
    { id: 'welcome', type: 'welcome', title: 'Hey there.', cta: 'Start' },
    { id: 'name', type: 'short_text', title: "What's your first name?", required: true },
    {
      id: 'service',
      type: 'single_choice',
      title: 'Which service?',
      options: [
        { label: 'Sealcoating', value: 'sealcoat' },
        { label: 'Striping', value: 'striping' },
      ],
    },
    {
      id: 'lot_size',
      type: 'single_choice',
      title: 'How big is the lot?',
      visibleIf: { field: 'service', op: 'equals', value: 'sealcoat' },
      options: [/* ... */],
    },
    { id: 'done', type: 'thanks', title: "You're all set." },
  ],
});

export default function QuotePage() {
  return (
    <Form
      schema={schema}
      onSubmit={async (answers, meta) => {
        await fetch('/api/quote', { method: 'POST', body: JSON.stringify({ answers, meta }) });
      }}
      onQuestionChange={(qid, answers) => { /* analytics hook */ }}
      hiddenFields={{ utm_source: 'google', source: 'quote_form' }}
    />
  );
}
```

**Exports:**
- `Form` — main component
- `defineSchema(schema)` — identity helper for TypeScript inference (returns `schema` typed)
- `themes` — registry object (`{ editorial, swiss }`)
- Types: `Schema`, `Question`, `Answers`, `Theme`, `Option`, `Condition`, `FormProps`, `SubmitMeta`

**`onSubmit` signature:**
```ts
onSubmit: (answers: Answers, meta: SubmitMeta) => Promise<void> | void;

type SubmitMeta = {
  startedAt: Date;
  completedAt: Date;
  durationMs: number;
  questionsVisited: string[];      // ordered IDs of questions actually shown
  hiddenFields: Record<string, unknown>;
};
```

---

## 4. Target File Structure

```
palmstreetweb-forms/
├── .changeset/                       # changeset versioning (or manual semver — agent decides, document in DECISIONS.md)
├── .github/
│   └── workflows/ci.yml
├── examples/
│   ├── basic-quote-form.tsx          # minimal sealcoating quote
│   ├── conditional-logic.tsx         # demonstrates visibleIf
│   └── with-host-theme.tsx           # demonstrates host-theme inheritance
├── src/
│   ├── components/
│   │   ├── Form.tsx                  # main entry component
│   │   ├── questions/
│   │   │   ├── WelcomeScreen.tsx
│   │   │   ├── StatementScreen.tsx
│   │   │   ├── ShortTextField.tsx
│   │   │   ├── LongTextField.tsx
│   │   │   ├── EmailField.tsx
│   │   │   ├── PhoneField.tsx
│   │   │   ├── NumberField.tsx
│   │   │   ├── SingleChoiceField.tsx
│   │   │   ├── MultiChoiceField.tsx
│   │   │   ├── ScaleField.tsx
│   │   │   └── ThanksScreen.tsx
│   │   ├── chrome/
│   │   │   ├── TopBar.tsx            # brand + back button
│   │   │   ├── ProgressBar.tsx
│   │   │   ├── FooterCounter.tsx
│   │   │   └── ThemeToggle.tsx       # PSW 1:1 match (see §8)
│   │   └── decorations/
│   │       └── SwissDecoration.tsx   # geometric SVG compositions
│   ├── themes/
│   │   ├── types.ts
│   │   ├── editorial.ts              # exports { light, dark } token sets
│   │   ├── swiss.ts                  # exports { light, dark } token sets
│   │   └── index.ts                  # themes registry barrel
│   ├── hooks/
│   │   ├── useFormState.ts           # step machine, answers, history
│   │   ├── useKeyboardNav.ts         # Enter, A-F, Tab, Escape
│   │   ├── useTheme.ts               # toggle + host-theme inheritance
│   │   └── useReducedMotion.ts
│   ├── logic/
│   │   ├── conditional.ts            # evaluates visibleIf conditions
│   │   ├── validation.ts             # per-question-type validators
│   │   └── progress.ts               # calculates progress % and visited list
│   ├── styles/
│   │   ├── tokens.css                # CSS custom properties (light + dark)
│   │   ├── toggle.css                # PSW theme toggle styles (see §8)
│   │   ├── animations.css            # qIn, qOut, morph keyframes
│   │   └── base.css                  # resets + global form styles
│   ├── utils/
│   │   ├── focus.ts
│   │   ├── letters.ts                # A-F badge helpers
│   │   └── tokens.ts                 # apply theme tokens to wrapper
│   ├── types/
│   │   ├── Question.ts
│   │   ├── Schema.ts
│   │   ├── Answers.ts
│   │   ├── Theme.ts
│   │   └── index.ts
│   └── index.ts                      # public exports barrel
├── tests/
│   ├── form.test.tsx
│   ├── conditional.test.ts
│   ├── validation.test.ts
│   └── keyboard.test.tsx
├── AGENTS.md                         # agent ops doc
├── CLAUDE.md                         # Claude-specific guidance
├── DECISIONS.md                      # ADR-style log of architecture choices
├── MIGRATION_NOTES.md                # versioning + breaking change protocol
├── README.md                         # quickstart, API reference, theme docs
├── LICENSE                           # MIT (or proprietary — agent asks)
├── package.json
├── tsconfig.json
├── tsup.config.ts                    # build config (or vite — agent decides, documents)
├── eslint.config.mjs
├── prettier.config.mjs
└── .gitignore
```

**Rule of thumb:** if a file's purpose is unclear from its path, it doesn't belong. Top-level should be readable in `ls` alone — that's the Palm Street Web OCD standard.

---

## 5. Question Type Catalog (V1)

Every question has these base fields (except where noted):

```ts
type BaseQuestion = {
  id: string;                          // unique within schema; used as Answers key
  type: QuestionType;
  visibleIf?: Condition;               // see §7 — not allowed on welcome/thanks
};
```

| Type | Schema additions | Validation | Notes |
|---|---|---|---|
| `welcome` | `title`, `subtitle?`, `cta?` (default 'Start') | — | First screen; no `visibleIf` |
| `statement` | `title`, `body?`, `cta?` (default 'Continue') | — | Info-only screen, advances on Enter/click |
| `short_text` | `title`, `placeholder?`, `required?`, `maxLength?`, `pattern?: RegExp`, `patternError?: string` | Required check, pattern check | |
| `long_text` | `title`, `placeholder?`, `required?`, `maxLength?` | Required check | Textarea, Enter submits, Shift+Enter newline |
| `email` | `title`, `placeholder?`, `required?` | RFC-lite regex | |
| `phone` | `title`, `placeholder?`, `required?`, `defaultCountry?: string` (default 'US') | E.164 normalization via `libphonenumber-js` | Storage is E.164; display pretty |
| `number` | `title`, `min?`, `max?`, `step?`, `required?` | Range check | Inputmode `decimal` |
| `single_choice` | `title`, `options: Option[]`, `required?` (default true) | Required check | Letter keys A–F, auto-advance |
| `multi_choice` | `title`, `options: Option[]`, `min?`, `max?` | Min/max selections | Letter keys toggle; OK button advances |
| `scale` | `title`, `min: number`, `max: number`, `minLabel?: string`, `maxLabel?: string`, `step?` (default 1) | Range check | 0–10 NPS-style; number keys select; auto-advance |
| `thanks` | `title`, `subtitle?`, `cta?` (e.g. "Submit another") | — | Final screen; fires `onSubmit` on entry |

`Option`:
```ts
type Option = {
  label: string;
  value: string;
  description?: string;                // small text under option
};
```

`Title-as-function` for personalization on text/email/choice types only:
```ts
title: string | ((answers: Answers) => string);
// example: title: (a) => `Nice to meet you, ${a.name}. What's your email?`
```

`titleText` is computed inside the engine — never call the function in user code.

---

## 6. Answers + Hidden Fields

```ts
type Answers = Record<string, string | string[] | number | undefined>;
// short_text, long_text, email, phone → string
// number, scale → number
// single_choice → string (the `value`)
// multi_choice → string[] (array of `value`s)
// welcome, statement, thanks → never stored

type HiddenFields = Record<string, unknown>;
// passed via <Form hiddenFields={{ utm_source: '...', user_id: '...' }} />
// flows into SubmitMeta.hiddenFields; NEVER renders to the user
```

---

## 7. Conditional Logic Spec

```ts
type Condition =
  | { field: string; op: 'equals' | 'not_equals'; value: string | number }
  | { field: string; op: 'in' | 'not_in'; value: (string | number)[] }
  | { field: string; op: 'gt' | 'lt' | 'gte' | 'lte'; value: number }
  | { field: string; op: 'is_empty' | 'is_not_empty' }
  | { all: Condition[] }   // logical AND
  | { any: Condition[] };  // logical OR
```

**Evaluator** (`src/logic/conditional.ts`):
- Pure function `evaluate(condition: Condition, answers: Answers): boolean`
- Unknown fields → treated as empty
- `multi_choice` answers (arrays): `equals` checks if value is in array; `in` checks if any selected matches; etc.
- Composable infinitely: `{ all: [{ any: [...] }, { field: ..., op: 'equals', ... }] }`

**Engine integration:**
- After every answer change, recompute the visible question list
- If currently-shown question becomes hidden mid-flow → skip forward to next visible
- If a previously-answered question's `visibleIf` is no longer true, its answer is **retained but excluded from `onSubmit`** (clean slate semantics; document this in DECISIONS.md)

---

## 8. PSW Theme Toggle — 1:1 Match Spec

> **Source of truth:** Caleb's `palm-street-web` repo. This section captures the verbatim CSS, JS, and HTML. **DO NOT redesign — match exactly.**

### 8.1 HTML Markup

The toggle is a `<button>` with two SVGs inside (both always in DOM; CSS controls visibility).

```html
<button class="theme-toggle" type="button" aria-label="Switch to light mode">
  <svg class="theme-ico theme-ico--moon" width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"
          stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
  </svg>
  <svg class="theme-ico theme-ico--sun" width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="12" cy="12" r="4.5" stroke="currentColor" stroke-width="2.5" />
    <path d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"
          stroke="currentColor" stroke-width="2.5" stroke-linecap="round" />
  </svg>
</button>
```

`aria-label` flips to "Switch to dark mode" when current theme is light. SVG `width`/`height` is 15 even though viewBox is 24 — yes that's intentional, matches PSW.

### 8.2 CSS (verbatim, do not redesign)

```css
.theme-toggle {
  position: relative;
  width: 68px;
  height: 36px;
  padding: 0;
  border: 1px solid var(--border-md);
  border-radius: 999px;
  background: var(--bg-3);
  cursor: pointer;
  flex-shrink: 0;
  overflow: visible;
  transition:
    background 0.24s ease-out,
    border-color 0.24s ease-out,
    transform 0.18s ease-out,
    box-shadow 0.24s ease-out;
}

.theme-toggle:hover {
  border-color: rgb(var(--accent-rgb) / 0.2);
  box-shadow: 0 0 0 1px rgb(var(--accent-rgb) / 0.06);
}

.theme-toggle:active { transform: scale(0.97); }

[data-theme="light"] .theme-toggle {
  background: var(--accent);
  border-color: transparent;
}
[data-theme="light"] .theme-toggle:hover {
  border-color: rgba(255, 255, 255, 0.22);
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.08);
}

[data-theme="dark"] .theme-toggle {
  background: #101812;
  border: 1px solid rgba(255, 255, 255, 0.14);
  box-shadow:
    0 0 0 1px rgba(0, 0, 0, 0.35),
    inset 0 1px 0 rgba(255, 255, 255, 0.05);
}
[data-theme="dark"] .theme-toggle:hover {
  border-color: rgba(255, 255, 255, 0.2);
  box-shadow:
    0 0 0 1px rgb(var(--accent-rgb) / 0.2),
    inset 0 1px 0 rgba(255, 255, 255, 0.05);
}

/* Sliding thumb */
.theme-toggle::before {
  content: '';
  position: absolute;
  top: calc(50% - 13px);
  left: 4px;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: var(--text);
  box-shadow: 0 1px 5px rgba(0, 0, 0, 0.4);
  z-index: 1;
  transition: transform 0.34s cubic-bezier(0.37, 0, 0.63, 1),
              background 0.26s ease-out,
              box-shadow 0.24s ease-out;
}
[data-theme="dark"] .theme-toggle::before {
  background: var(--accent);
  box-shadow: 0 1px 6px rgba(0, 0, 0, 0.38), 0 1px 4px rgb(var(--accent-rgb) / 0.22);
}
[data-theme="light"] .theme-toggle:not(.is-morphing-to-light):not(.is-morphing-to-dark)::before {
  transform: translateX(32px);
  background: #fff;
  box-shadow:
    0 1px 5px rgba(0, 0, 0, 0.2),
    0 0 0 1px rgba(0, 0, 0, 0.32);
}

@keyframes slate-morph-thumb-right {
  from { transform: translateX(0); }
  to { transform: translateX(32px); }
}
@keyframes slate-morph-thumb-left {
  from { transform: translateX(32px); }
  to { transform: translateX(0); }
}

.theme-toggle.is-morphing-to-light::before {
  transition: background 0.28s ease-out, box-shadow 0.24s ease-out;
  animation: slate-morph-thumb-right 0.62s cubic-bezier(0.37, 0, 0.63, 1) forwards;
}
.theme-toggle.is-morphing-to-dark::before {
  transition: background 0.28s ease-out, box-shadow 0.24s ease-out;
  animation: slate-morph-thumb-left 0.62s cubic-bezier(0.37, 0, 0.63, 1) forwards;
}

@media (prefers-reduced-motion: reduce) {
  .theme-toggle, .theme-toggle::before { transition: none; }
  .theme-toggle:active { transform: none; }
  .theme-toggle:hover { box-shadow: none; }
  .theme-toggle.is-morphing-to-light::before,
  .theme-toggle.is-morphing-to-dark::before { animation: none; }
}

.theme-ico {
  display: block !important;
  position: absolute;
  top: 50%;
  width: 17px;
  height: 17px;
  z-index: 2;
  pointer-events: none;
  filter: none;
  shape-rendering: geometricPrecision;
  transition:
    opacity 0.32s ease-out,
    transform 0.32s cubic-bezier(0.33, 1, 0.68, 1),
    color 0.24s ease-out;
}
.theme-toggle:hover .theme-ico--moon,
.theme-toggle:hover .theme-ico--sun {
  transform: translate(-50%, -50%) scale(1.06);
}
.theme-ico--moon {
  left: calc(4px + 13px);
  transform: translate(-50%, -50%);
  color: var(--text);
  opacity: 1;
}
.theme-ico--sun {
  left: calc(4px + 32px + 13px);
  transform: translate(-50%, -50%);
  color: var(--muted);
  opacity: 0.45;
}
[data-theme="dark"] .theme-toggle .theme-ico--moon { color: #0a0a0e; opacity: 1; }
[data-theme="dark"] .theme-toggle .theme-ico--sun  { color: rgba(255, 255, 255, 0.5); opacity: 1; }
[data-theme="light"] .theme-ico--moon { color: #0a0a0e; opacity: 0.98; }
[data-theme="light"] .theme-ico--sun  { color: #0a0a0e; opacity: 1; }
```

### 8.3 Toggle Logic (port to React)

PSW's vanilla JS pattern, adapted to React in `src/hooks/useTheme.ts`:

```ts
// Pseudocode
function useTheme(initialMode: ThemeMode, themeName: string) {
  // 1. On first mount, determine initial theme:
  //    a. If `themeMode` is 'light' or 'dark' (forced) → use that, no toggle
  //    b. If 'toggle': read localStorage('slate-forms-theme'); fallback to host's <html data-theme>; fallback to prefers-color-scheme; fallback to 'dark'
  //    c. If 'auto': respect prefers-color-scheme always, no toggle
  
  // 2. Set `data-theme` on the form's WRAPPER element (NOT <html> — we don't own the host page)
  
  // 3. Toggle function:
  //    a. Determine `next` theme (opposite of current)
  //    b. If reduced motion: commit immediately, return
  //    c. Add `is-morphing-to-{next}` class to .theme-toggle
  //    d. If document.startViewTransition exists, wrap commit in it
  //    e. Otherwise: set `data-theme-switching` on wrapper for 550ms (suppress transitions)
  //    f. Commit: setState, localStorage.setItem('slate-forms-theme', next), remove morph class on animationend
  //    g. Update aria-label on the toggle button
}
```

Critical implementation notes:
- **Wrapper-scoped, not `<html>`-scoped** — the form may be embedded; don't touch the host page's `<html>` attributes.
- **localStorage key:** `slate-forms-theme` (not `psw-theme` — that's PSW's site key).
- **Host inheritance:** on first mount only, if `slate-forms-theme` is unset, peek at `document.documentElement.dataset.theme`. If host is in light mode, start light too.
- **No FOUC for SSR:** the form is a client component (`'use client'`). Use `useLayoutEffect` for the initial theme application to avoid a flash.

### 8.4 Tokens (the swap mechanism)

Each theme defines color tokens for both modes. Light/dark is just a different token set under `[data-theme="light"]`.

**Base tokens** (every theme defines both light + dark for these):
```
--bg          /* primary surface */
--bg-2        /* slightly raised */
--bg-3        /* most raised */
--text        /* primary text */
--muted       /* secondary text */
--dim         /* tertiary text / borders */
--accent      /* primary brand color */
--accent-rgb  /* same accent as space-separated RGB (for rgb()/alpha) */
--accent-on-light  /* deeper accent variant for light mode */
--accent-lo  /* accent at low alpha for backgrounds */
--border     /* hairline borders */
--border-md  /* medium borders */
color-scheme /* 'light' | 'dark' for native form controls */
```

**Theme-specific tokens** (each theme can add more):
- `--font-display`, `--font-body`, `--font-mono`
- `--radius`, `--border-width`
- `--title-weight`, `--title-tracking`, `--title-line-height`, `--title-size`
- `--transform` (`'none' | 'lowercase'`)

---

## 9. Theme Definitions

### 9.1 Editorial

**Tagline:** Refined serif · warm cream
**Aesthetic:** Newspaper editorial energy — Fraunces serif headlines, JetBrains Mono labels, generous whitespace, subtle grain.

**Tokens — Light:**
```css
--bg: #FAF6EE; --bg-2: #F4F0E5; --bg-3: #EDE8DD;
--text: #1A1A1A; --muted: #5B5851; --dim: #8E8B83;
--accent: #2D5BFF; --accent-rgb: 45 91 255;
--accent-on-light: #2D5BFF; --accent-lo: rgb(45 91 255 / 0.06);
--border: rgba(26,26,26,0.10); --border-md: rgba(26,26,26,0.18);
--font-display: 'Fraunces', Georgia, serif;
--font-body: 'Fraunces', Georgia, serif;
--font-mono: 'JetBrains Mono', monospace;
--radius: 3px; --border-width: 1.5px;
--title-weight: 500; --title-tracking: -0.025em; --title-line-height: 1.08;
--title-size: clamp(2rem, 5.2vw, 3.4rem);
--transform: none;
color-scheme: light;
```

**Tokens — Dark:**
```css
--bg: #14110D; --bg-2: #1C1815; --bg-3: #25201B;
--text: #FAF6EE; --muted: #B8B2A4; --dim: #7A7468;
--accent: #6E8FFF; --accent-rgb: 110 143 255;
--accent-on-light: #2D5BFF; --accent-lo: rgb(110 143 255 / 0.10);
--border: rgba(250,246,238,0.08); --border-md: rgba(250,246,238,0.14);
color-scheme: dark;
/* font/layout tokens identical to light */
```

**Decoration:** subtle SVG grain overlay (06% opacity), no shapes.

### 9.2 Swiss

**Tagline:** Bold geometric · poster energy
**Aesthetic:** Swissted.com poster series. Archivo Black display, lowercase, sharp corners, big geometric SVG compositions in saturated primary palette behind each question.

**Tokens — Light:**
```css
--bg: #F2EFE3; --bg-2: #E8E4D5; --bg-3: #DDD8C6;
--text: #000000; --muted: #2A2A2A; --dim: #6B6B6B;
--accent: #DC2626; --accent-rgb: 220 38 38;
--accent-on-light: #DC2626; --accent-lo: rgb(220 38 38 / 0.08);
--border: rgba(0,0,0,0.18); --border-md: rgba(0,0,0,0.28);
--font-display: 'Archivo Black', sans-serif;
--font-body: 'Archivo', sans-serif;
--font-mono: 'Archivo', sans-serif;
--radius: 0px; --border-width: 2.5px;
--title-weight: 900; --title-tracking: -0.04em; --title-line-height: 0.95;
--title-size: clamp(2.5rem, 6.2vw, 4.2rem);
--transform: lowercase;
color-scheme: light;
```

**Tokens — Dark:**
```css
--bg: #0A0A0A; --bg-2: #131313; --bg-3: #1A1A1A;
--text: #F2EFE3; --muted: #C8C8C8; --dim: #888888;
--accent: #F87171; --accent-rgb: 248 113 113;
--accent-on-light: #DC2626; --accent-lo: rgb(248 113 113 / 0.10);
--border: rgba(242,239,227,0.14); --border-md: rgba(242,239,227,0.22);
color-scheme: dark;
```

**Decoration:** `SwissDecoration` SVG component, 9 geometric compositions cycling per question step. Reference: keep the compositions from the `intake-form.jsx` artifact verbatim. In dark mode, swap palette to muted versions of the same colors.

---

## 10. Engine Behavior

### 10.1 State Machine (`useFormState`)

```ts
type FormState = {
  step: number;                      // index into visible questions
  visibleQuestions: Question[];      // recomputed when answers change
  answers: Answers;
  history: number[];                 // step indices visited (for back nav)
  isAnimating: boolean;
  direction: 'forward' | 'backward';
  startedAt: Date;
};
```

Actions: `next(answer)`, `back()`, `selectChoice(qid, value)`, `setMultiChoice(qid, values)`, `submit()`.

### 10.2 Transitions

- **Forward:** new question slides up + fades in (translateY 24→0, opacity 0→1), 480ms `cubic-bezier(0.16, 1, 0.3, 1)`
- **Backward:** new question slides down + fades in (translateY -16→0), same duration
- **Outgoing question:** opacity 1→0, 220ms `cubic-bezier(0.4, 0, 1, 1)`
- Swiss theme: snappier (380ms in / 180ms out)
- Honor `prefers-reduced-motion` — instant swap, no animation

### 10.3 Keyboard

| Key | Action |
|---|---|
| `Enter` | Advance (or submit text/long_text/email/phone/number) |
| `Shift + Enter` | New line in `long_text` |
| `A`–`F` | Select choice option (auto-advance for `single_choice`) |
| `1`–`0` | Select scale value |
| `Esc` | Go back (configurable; default off to prevent accidental loss) |
| `Tab` / `Shift+Tab` | Standard browser focus order |

### 10.4 Validation

Inline, on submit-attempt only (no live "as you type" red borders). Show error message below input, in `--accent` adjacent error color (per theme).

### 10.5 Auto-Focus

After each question transition, focus the primary input. Use `useLayoutEffect` + a short timeout (~380ms after transition starts) so focus arrives smoothly, not pre-animation.

### 10.6 Submission

Fires `onSubmit` exactly when the engine enters the `thanks` step. Show a loading state on the thanks screen until the promise resolves. On error: display a fallback message (configurable via `errorMessage` prop) and a retry button.

---

## 11. Accessibility Checklist

- [ ] Every input has a programmatic label (visible title acts as the label via `aria-labelledby`)
- [ ] `single_choice`/`multi_choice` use `role="radiogroup"` / `role="group"` correctly
- [ ] Error messages are `aria-live="polite"`
- [ ] Focus is managed across transitions (no focus loss)
- [ ] Touch targets minimum 44×44
- [ ] Input `font-size: 16px` minimum on mobile (prevents iOS zoom)
- [ ] Theme toggle has correct `aria-label` (flips between "Switch to light/dark mode")
- [ ] Honor `prefers-reduced-motion`
- [ ] Color contrast: every text/bg pair passes WCAG AA in both light and dark of both themes
- [ ] Works without JavaScript? No — but at minimum, render meaningful HTML before hydration so screen readers don't see empty content

---

## 12. Repo Hygiene Standards

Top-level files day one:

- **`README.md`** — Quickstart (install + basic example), API reference (props, schema types), theme guide, examples links
- **`AGENTS.md`** — How AI agents should work in this repo (file map, conventions, what to never touch)
- **`CLAUDE.md`** — Claude-specific guidance (any nuance about how Claude should approach this codebase)
- **`DECISIONS.md`** — ADR log. Every architectural choice gets an entry: what, why, alternatives considered, when revisitable
- **`MIGRATION_NOTES.md`** — Semver protocol, breaking change template, upgrade guides per major version
- **`LICENSE`** — MIT or proprietary (ask Caleb in Phase 0)

Code conventions:
- No `any` except documented escape hatches
- No default exports except for component files (per common React convention)
- Path alias `@/` → `src/`
- Co-locate component-specific styles when possible
- Comments explain *why*, not *what*

---

## 13. Build + Publish

- **Bundler:** `tsup` (recommended — zero-config, ESM + CJS, .d.ts emit). Alternative: Vite library mode if more flexibility needed.
- **Output:** ESM + CJS + .d.ts, with proper `exports` map in `package.json`
- **React peer dep:** `>=18`
- **Test runner:** Vitest
- **CI:** Lint + typecheck + test on PR (GitHub Actions, basic)
- **Versioning:** semver, initial `1.0.0-beta.1`. Promote to `1.0.0` after dogfooding on Wild Wash.
- **Publishing:** `npm publish --access=restricted` to private registry under `@palmstreetweb` scope. (Agent must confirm the org exists or prompt Caleb to create it.)

---

## 14. Out of Scope for V1 (explicit)

Do not build:
- Visual form builder UI (drag-drop questions)
- Multi-tenant form storage / backend
- Client-facing admin dashboard or login
- File upload question type
- Date picker question type
- Calculator / scoring logic
- Save-and-resume from URL token
- Embed via iframe / HTML script tag
- Built-in analytics events (only an `onQuestionChange` hook for the consumer to wire)
- Translation / i18n system (use plain string substitution)

Each of these gets an entry in `DECISIONS.md` marked "deferred to V2."

---

## 15. Reference Materials

- **`intake-form.jsx`** (in repo root or wherever you put it) — the prototype artifact. Architecture reference for theme system, question flow, Swiss decoration compositions, keyboard handling. **Visual fidelity target.** Read first.
- **PSW v2 codebase** (`~/AI/palm-street-web/`) — source of truth for theme toggle (see §8). Specifically:
  - `components/nav.tsx` — toggle button markup
  - `public/assets/css/style.css` — toggle CSS (lines 317–493)
  - `public/assets/js/animate.js` — toggle logic (lines 60–100, 370–420)
  - `lib/sacred/rootHeadBootstrap.ts` — pre-hydration boot pattern
  - `app/globals.css` + `public/assets/css/style.css` lines 55–90 — token system

---

## 16. Success Criteria

V1 ships when:

1. `@palmstreetweb/slate@1.0.0-beta.1` is published to private npm
2. The `examples/basic-quote-form.tsx` runs as a real Next.js page locally with all 10 question types working
3. Both themes (Editorial + Swiss), both modes (light + dark), the PSW toggle morphs identically to PSW.com
4. Conditional logic works: `examples/conditional-logic.tsx` demonstrates branching
5. Keyboard nav: Enter advances text, A–F selects choice, Tab order makes sense
6. Mobile: tested on iOS Safari + Chrome Android, no zoom-on-focus, 44×44 touch targets
7. A11y: passes axe-core on the example pages
8. README has install + quickstart + full API reference
9. All five top-level docs are filled in (README, AGENTS, CLAUDE, DECISIONS, MIGRATION_NOTES)
10. CI green on main

Then the package gets installed into the Wild Wash project and replaces whatever quote form pattern was planned there. That's the dogfood test before `1.0.0`.

---

End of brief. When in doubt: re-read § 2 (Non-Negotiable Principles).
