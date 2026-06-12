# Architecture Decision Log

ADR-style log. Every non-trivial architectural choice gets an entry. Format:

```
## ADR-NNN — Title
Date: YYYY-MM-DD
Status: accepted | superseded | deferred
Context: why we needed to choose
Decision: what we chose
Alternatives: what else we considered
Consequences: trade-offs we're accepting
Revisit when: a concrete trigger
```

---

## ADR-001 — Package name and scope
Date: 2026-05-10
Status: accepted
Context: This library is internal Palm Street Web tooling, used across multiple client projects (805 Sealcoating, Wallace Plumbing, Wild Wash, PSW v2). It is not open-source. It needs to live in the private `@palmstreetweb` npm scope.
Decision: Publish as `@palmstreetweb/forms` with `publishConfig.access = "restricted"`. License: `UNLICENSED` (proprietary).
Alternatives:
- Open-source as `psw-forms` on the public registry. Rejected — clients pay for bespoke work; the library encodes agency IP (theme system, UX patterns).
- Multi-package monorepo with `@palmstreetweb/forms-core`, `@palmstreetweb/forms-themes`, etc. Rejected for v1 — premature optimization for a one-package library.
Consequences:
- Consumers need npm auth to the `@palmstreetweb` org.
- We can't expect community contributions; the agency owns all work.
Revisit when: we ship a second package under the scope, or considering open-sourcing.

## ADR-002 — Bundler: tsup
Date: 2026-05-10
Status: accepted
Context: We need ESM + CJS + `.d.ts` emit with React JSX support. Tree-shaking matters because the engine targets <50kb gzipped (brief §2.9).
Decision: Use `tsup` for the library build. Use `vite` separately as the dev server for `examples/` and as the test runner via Vitest.
Alternatives:
- Vite library mode. Functional but heavier config for a pure library output; tsup is purpose-built for this and zero-config.
- Rollup directly. Too much boilerplate for our needs.
- esbuild only. Doesn't emit `.d.ts` cleanly without a wrapper.
Consequences:
- Two configs (tsup for build, vite for dev/test). Slightly more files but each is small and serves a clear purpose.
- tsup's CSS handling is basic — we use `loader: { '.css': 'copy' }` and expect consumers to import `@palmstreetweb/forms/styles.css` explicitly.
Revisit when: tsup falls behind on JSX/RSC support, or we need fine-grained Rollup plugin control.

## ADR-003 — localStorage key
Date: 2026-05-10
Status: accepted
Context: The PSW site itself uses `psw-theme` for its theme persistence (palmstreetweb.com). If our forms package writes to the same key while embedded on PSW's site, we collide.
Decision: Use `psw-forms-theme` as the localStorage key.
Alternatives:
- Share `psw-theme` with the host. Rejected — embedded forms shouldn't mutate the host's theme state.
- Scope per-form (`psw-forms-theme:<schema-id>`). Rejected — over-engineered; a user toggling once should persist across all forms they encounter on a site.
Consequences:
- On first mount we read `document.documentElement.dataset.theme` (the host's current theme) as a fallback if our own key is unset — this gives the right initial state without us writing to the host's key.
Revisit when: a consumer reports cross-form theme desync.

## ADR-004 — `data-theme` lives on the wrapper, not `<html>`
Date: 2026-05-10
Status: accepted
Context: The package is embedded in someone else's page. We can't assume we own `<html>`. The host page may already have its own theme system reading `<html data-theme>`.
Decision: Apply `data-theme="light|dark"` to the `[data-psw-forms]` wrapper element rendered by `<Form>`. Token CSS is scoped via `[data-psw-forms][data-theme="light"] { ... }`. We **read** `<html>.dataset.theme` on first mount for inheritance; we **never write** to it.
Alternatives:
- Write to `<html>` (PSW's own pattern). Rejected — host page collision.
- Shadow DOM. Rejected for v1 — complicates font loading and breaks tab order with the rest of the page.
Consequences:
- Slightly heavier selectors (extra `[data-psw-forms]` prefix on every token override).
- Host pages can still influence us on first mount via their own `<html data-theme>`.
Revisit when: a consumer needs to embed multiple `<Form>` instances on a single page with different themes (currently supported, but verify when it happens).

## ADR-005 — Conditional logic retention semantics
Date: 2026-05-10
Status: accepted
Context: A question with `visibleIf` may become hidden mid-flow after a prior answer changes. What should happen to its already-collected answer?
Decision: **Retain answers in internal state, exclude from `onSubmit` payload.** If the user toggles the prior answer back and the question becomes visible again, their previously-typed answer is still there. But the `onSubmit` `answers` object only contains values for questions whose `visibleIf` evaluates true at submit time.
Alternatives:
- Delete on hide. Rejected — frustrating UX if the user toggles back and forth.
- Always include in `onSubmit` regardless of visibility. Rejected — pollutes the payload with stale data from abandoned branches.
Consequences:
- The engine maintains a distinction between "all answers" (internal) and "visible answers" (the `Answers` object passed to `onSubmit`).
- `SubmitMeta.questionsVisited` is the ordered list of question IDs actually shown — this is the consumer's audit trail for which branch was traversed.
Revisit when: a consumer needs the full unfiltered state (e.g., for resume-from-URL — currently V2).

## ADR-006 — Phone validation via `libphonenumber-js`, lazy-imported
Date: 2026-05-10
Status: accepted
Context: Brief §2.9 mandates "zero runtime dependencies beyond React" but §5 requires E.164 normalization via `libphonenumber-js` for `phone` questions. Direct conflict.
Decision: Add `libphonenumber-js` as a runtime dependency, **lazy-imported only inside `src/components/questions/PhoneField.tsx`** via dynamic `import()`. Consumers who never use `phone` questions don't pay for it — tree-shaking + code-splitting keep the engine bundle clean.
Alternatives:
- Ship a homegrown regex validator. Rejected — phone-number normalization is an underestimated swamp; getting it wrong leaks bad data into CRMs.
- Make it a peer dependency. Rejected — consumers shouldn't have to know about our internals to install a quote form.
- Defer `phone` type to V2. Rejected — quote forms need phone numbers; that's table stakes.
Consequences:
- Total dep count: 1 runtime dep.
- `PhoneField.tsx` does `const { parsePhoneNumber } = await import('libphonenumber-js')` inside its handler, so the ~16kb is only paid when a phone question renders.
- Bundle budget audit: engine still <50kb gzipped without `libphonenumber-js` because it's tree-shaken out of `import { Form } from '@palmstreetweb/forms'` when no schema contains a phone question.
Revisit when: bundle audits show `libphonenumber-js` is being eagerly bundled, or a viable lightweight alternative emerges.

## ADR-007 — Version: `1.0.0-beta.1`
Date: 2026-05-10
Status: accepted
Context: Golden-prompt instructions said `1.0.0-beta.0`, but brief §13 and §16 say `1.0.0-beta.1`. Picking one.
Decision: Ship as `1.0.0-beta.1`. The brief is canonical.
Alternatives: `1.0.0-beta.0` (golden prompt). Rejected — the brief was written first and reviewed twice; the golden prompt typo lost.
Consequences: First publish is `1.0.0-beta.1`. Subsequent betas increment from there. Promote to `1.0.0` after dogfooding on Wild Wash per brief §16.
Revisit when: betas wrap and we promote to `1.0.0`.

## ADR-008 — Single vite config drives both dev server and tests
Date: 2026-05-10
Status: accepted
Context: We need a dev server for `examples/` (`npm run dev`) and a Vitest config with React + jsdom. Vite is the common base for both.
Decision: Keep them separate (`vite.config.ts` for the dev server with `root: 'examples'`; `vitest.config.ts` for tests). Both share the `@/*` alias for parity.
Alternatives:
- Single config with `test:` block. Rejected — `root: 'examples'` confuses Vitest's path resolution.
Consequences: Two small configs. Each is ~15 lines.
Revisit when: dual-maintenance burden becomes annoying (unlikely at this size).

## ADR-009 — Swiss display font: Inter (Akzidenz-Grotesk substitute)
Date: 2026-05-10
Status: accepted
Context: The Swiss theme aspires to swissted.com fidelity. Mike Joyce's actual Swissted typeface is **Berthold Akzidenz-Grotesk** (1898), a paid Berthold license (~$400+ for a couple of weights, no Google Fonts mirror, no SIL/OFL alternative with matching metrics). The brief originally specified `Archivo Black` for display + `Archivo` for body — both free Google Fonts, but with tighter tracking and more compressed letterforms than authentic Akzidenz, particularly noticeable in lowercase `a` / `g` / `e`.
Decision: Swap to **Inter** (variable font, `opsz` axis 14–32) for both display and body in the Swiss theme. Use weight `900` for titles, `500` for body. Keep `--psw-title-tracking` at `-0.035em` (loosened slightly from `-0.04em` because Inter has more open counters than Archivo Black and the tighter setting starts to crowd at large sizes). Editorial theme is unchanged (Fraunces stays).
Alternatives:
- Keep `Archivo Black`. Rejected — closer to a heavy display sans than to Akzidenz; Caleb flagged the gap.
- **Söhne** by Klim Type Foundry. Rejected for v1 — the de-facto paid Akzidenz substitute, but it's a paid license and we don't want a license-management problem inside an internal package.
- **Inter Tight**. Considered — slightly tighter spacing, closer to Akzidenz Bold Condensed. Rejected because the standard Inter `opsz` axis already gives us display-grade letterforms at large sizes without needing a second family.
- **Public Sans** (US Web Design System). Decent grotesque, but less actively maintained and a step further from Akzidenz than Inter.
- License real **Berthold Akzidenz-Grotesk Pro**. Deferred — when we have a budget line for type licensing, swap inline. Self-host as a woff2 inside the package's `dist/` and gate on `defaultCountry` of the consumer's Berthold license.
Consequences:
- Swiss theme is now noticeably closer to swissted.com aesthetic, particularly the lowercase letterforms.
- One fewer Google Font family loaded (Inter replaces both Archivo + Archivo Black).
- The `--psw-font-display` and `--psw-font-body` tokens become identical (both `'Inter', system-ui, sans-serif`). That's intentional — Inter handles both roles via the variable axis.
- Ships with `system-ui` as fallback so the form renders sanely before the webfont loads.
Revisit when: budget allows the Berthold license; or when a closer free alternative emerges (the Klim folks have hinted at OSS work).

## ADR-010 — Date question via segmented native inputs, no picker dependency
Date: 2026-06-12
Status: accepted
Context: The Typeform-parity roadmap (Phase 2) adds a `date` question type, which the brief's §14 had deferred. Date pickers are the classic bundle-budget trap — popular React date libraries are 30–100kb+ and bring their own styling systems, which fights the wrapper-scoped token CSS.
Decision: Implement `date` as three segmented native text inputs (month / day / year, order controlled by a `format: 'MM/DD/YYYY' | 'DD/MM/YYYY'` schema field, US-first default). Auto-advance focus between segments as each fills. Store the answer as an ISO `YYYY-MM-DD` string. Calendar validity (leap years, days-per-month) is checked by a small pure helper (`isValidIsoDate` in `src/logic/validation.ts`); optional `min`/`max` bounds compare ISO strings lexicographically.
Alternatives:
- `<input type="date">`. Rejected — native picker UI is unstylable and visually clashes with both themes; placeholder behavior differs wildly across browsers.
- react-day-picker / similar. Rejected — bundle budget (brief §2.9) and theming friction. Typing a date is also faster than a calendar for known dates (birthdays, etc.), which is the dominant intake-form case.
Consequences:
- No month-grid calendar UI. If a consumer ever needs visual date *browsing* (e.g. appointment booking), that's a separate question type with its own ADR.
- ISO string storage keeps `Answers` within the existing `string | string[] | number` value union — no type-system ripple.
Revisit when: a consumer needs date ranges, times, or calendar-style availability picking.

## ADR-011 — Phase 2 question types extend the brief's §5 catalog
Date: 2026-06-12
Status: accepted
Context: Typeform-parity roadmap Phase 2 adds `url`, `date`, `dropdown`, `yes_no`, `legal`, and `nps` to the question-type union — beyond the brief's frozen 11-type catalog. The brief stays unmodified; this ADR records the API extension.
Decision: Add the six types following the AGENTS.md "How to add a question type" recipe. Stored values stay within the existing answers value union: `url`/`date`/`dropdown` → `string`, `yes_no` → `'yes' | 'no'`, `legal` → `'accept' | 'decline'`, `nps` → `number`. `dropdown`, `yes_no`, and `legal` default to `required: true` (same rationale as `single_choice` — clicking is cheap and a skippable consent question is meaningless). `nps` is a fixed 0–10 with standard anchor labels rather than a `scale` preset, so analytics consumers can discriminate on the type.
Alternatives:
- Model `yes_no`/`legal` as `single_choice` presets. Rejected — distinct types let the renderer give them dedicated keyboard shortcuts (Y/N) and let scoring/branching treat consent specially later.
- Store `yes_no` as boolean. Rejected — would widen the answers value union and ripple through `AnswersOf` inference and consumers' switch statements.
Consequences: The public `Question` union, validators, renderer switch, keyboard map, README, and studio all grew together; tests cover each new type.
Revisit when: V1.1 theme-registry work lands (custom themes may want type-specific decoration hooks).

## ADR-012 — file_upload: host-controlled storage via `onFileUpload`
Date: 2026-06-12
Status: accepted
Context: Phase 3 of the Typeform-parity roadmap adds `file_upload`. The library is a renderer with no backend, so it cannot own storage. The brief's §14 deferred this pending a storage-strategy decision.
Decision: Two-mode answer shape. `<Form>` gains an optional `onFileUpload?: (file: File, questionId: string) => Promise<string>` prop. When provided, the field hands the file off at selection time and stores the resolved string (URL, S3 key, whatever the host returns) as the answer. When omitted, the raw `File` object is stored and delivered in the `onSubmit` payload, and the host deals with it there. `LooseAnswers` widens to include `File` in its value union. Client-side guards: native `accept` attribute + `maxSizeMb` size check at selection.
Alternatives:
- Always require `onFileUpload`. Rejected — simple hosts (e.g. posting FormData to their own endpoint) shouldn't need to implement an upload round-trip before submit.
- Store data-URLs. Rejected — multi-MB base64 strings in state, in autosave payloads, and in `onSubmit` JSON is a footgun.
- Presigned-URL protocol baked into the library. Rejected — couples the renderer to a backend contract; `onFileUpload` lets hosts implement exactly that in ~5 lines if they want it.
Consequences:
- The answers value union is no longer JSON-safe when a raw `File` is present; hosts that serialize answers must either provide `onFileUpload` or handle `File` themselves. Documented in the README.
- Phase 5 autosave must skip `File` values (can't be persisted to localStorage).
Revisit when: a consumer needs multi-file answers or upload progress UI.

## ADR-013 — Phase 3 answer shapes: picture_choice, ranking, matrix
Date: 2026-06-12
Status: accepted
Context: The remaining "hard" Typeform/Google-Forms types need answer-shape decisions beyond the original `string | string[] | number` union.
Decision:
- `picture_choice` — single mode stores the option `value` string (required-by-default + auto-advance like `single_choice`); `multiple: true` stores `string[]` with `min`/`max` bounds like `multi_choice`. Options are `PictureOption = Option & { src, alt? }`.
- `ranking` — stores the **full ordered array** of option values on OK. No partial ranks; the validator rejects non-permutations. Reordering is via keyboard-accessible up/down buttons plus HTML5 drag for mouse users (no drag-drop dependency, per the bundle budget).
- `matrix` — stores `Record<rowValue, columnValue | columnValue[]>` (`MatrixAnswer`), the `| columnValue[]` arm for `multiple: true` checkbox grids. The answers value union widens accordingly. Desktop renders a CSS-grid table; ≤560px stacks each row with the column label inside the cell.
Alternatives:
- Matrix as flattened `"row:col"` string arrays. Rejected — pushes parsing onto every consumer.
- Matrix as auto-generated child questions (one per row). Rejected — pollutes `questionsVisited`, progress counts, and the studio outline.
- Ranking via a dnd library (dnd-kit ~12kb). Rejected for now — buttons + native DnD cover it dep-free.
Consequences: `LooseAnswers` values are now `string | string[] | number | File | MatrixAnswer | undefined`. `evaluate()` already treats unknown shapes safely (objects are only matched by `is_empty`/`is_not_empty`).
Revisit when: conditional logic needs to address individual matrix rows (would need `field: 'id.row'` path syntax — new ADR).

## ADR-014 — Answer piping via `{{field:id}}` template syntax
Date: 2026-06-12
Status: accepted
Context: The brief's `DynamicTitle` (function-style personalization) requires writing schemas in code. Typeform-style "recall" needs a serializable syntax the studio can edit and store as JSON.
Decision: A pure resolver in `src/logic/piping.ts` replaces `{{field:questionId}}` with the formatted answer and `{{score}}` with the running score total. Resolution happens once, in `QuestionRenderer`, over a question's `title`, `subtitle`, and `body` — function-style `DynamicTitle` keeps working (functions run first, their output is then piped). Unknown or unanswered fields resolve to `''`. Formatting: arrays join with ", ", `File` → its name, matrix → "row: col" pairs.
Alternatives:
- Resolving in each field component. Rejected — 18 call sites, and double-resolution risks injecting templates from user-typed answers.
- `{{id}}` without the `field:` prefix. Rejected — leaves no namespace for future tokens (`{{score}}` already collides; `{{var:x}}` may come later).
Consequences: Strings flow through one resolver; the studio can offer piping pickers later without engine changes.
Revisit when: variables (`{{var:x}}`) or per-token formatting (`{{field:date|long}}`) are needed.

## ADR-015 — Logic jumps: `logic: [{ if, goTo }]` evaluated on advance
Date: 2026-06-12
Status: accepted
Context: `visibleIf` covers show/hide but cannot express "skip ahead to Q7 if they answered No" without inverting conditions on every in-between question.
Decision: Answer-bearing questions (and statements) accept `logic?: LogicRule[]`. Rules are evaluated in `useFormState`'s `go_next` against the answer state at the moment the user advances *from* the carrying question. First match wins; navigation goes to the target's index in the visible list. No match, hidden target, or dangling id → normal step+1 (forgiving, not erroring). The jump origin is pushed onto history, so Back returns to it. Backward jumps are allowed (direction animates backward).
Retention semantics vs. ADR-005: jumps change *navigation only* — they do not hide the skipped-over questions. Answers to skipped questions are retained in state and still included in the submit payload if their `visibleIf` passes. Hosts that need skipped-question exclusion should pair jumps with `visibleIf` (the studio logic editor makes both visible side by side).
Alternatives:
- Auto-excluding skipped-over answers from submit. Rejected — "skipped" becomes path-dependent (what if the user goes Back and takes the other branch?), while ADR-005's visibility rule is a pure function of answers.
- A schema-level edges graph (Typeform's internal model). Rejected — per-question rules keep the flat-array schema and are exactly what the Inspector can edit.
Consequences: `questionsVisited` reflects the actual path. Progress can jump non-linearly (accepted; it tracks position, not path length).
Revisit when: loops become a real authoring hazard — a studio-side cycle detector would land in schema validation (Phase 6).

## ADR-016 — Scoring via option-level `score` + multiple endings
Date: 2026-06-12
Status: accepted
Context: Quiz/qualification forms need a score accumulated from answers, endings that differ by outcome, and a redirect for qualified leads.
Decision:
- `Option.score?: number` on choice options (single_choice, multi_choice, dropdown, picture_choice). `computeScore()` in `src/logic/scoring.ts` sums the scores of selected options; unscored options count 0.
- The total is exposed in `SubmitMeta.score` and in piping as `{{score}}`.
- Multiple endings: `thanks` screens gain `visibleIf`; several may coexist and the first visible one is shown when the user reaches the end (or is jumped there). `thanks` also gains `redirectUrl?: string`, navigated to only after `onSubmit` resolves successfully.
Alternatives:
- A `variables` map with per-question add/subtract operations (full Typeform model). Rejected for now — one accumulator covers scoring quizzes; a variables engine is a much bigger surface.
- Redirect immediately on reaching thanks. Rejected — a failed submit would strand the response while the user is already gone.
Consequences: `window.location.assign` is the one place the library touches navigation — it's host-sanctioned via the schema, not ambient behavior. SubmitMeta grows a required `score` field (0 when nothing is scored).
Revisit when: per-question variables or score *ranges* selecting endings (sugar over `visibleIf` gt/lte) are requested.

## ADR-017 — Save-and-resume under `psw-forms-resume:<formId>`
Date: 2026-06-12
Status: accepted
Context: Long conversational forms lose respondents to accidental tab closes. Typeform persists partial progress; we need the same without a backend.
Decision: Opt-in via the `<Form resume>` prop, which requires a new optional `schema.id` (the namespace). Snapshots (`answers` + `step` + `visitedIds` + `savedAt`) are written to `localStorage` on every change under the key `psw-forms-resume:<schema.id>` — a new user-visible storage name, prefix-consistent with `psw-forms-theme`. On remount with a saved session, a banner offers Resume (hydrates the state machine) or Start over (deletes the save). The save is cleared on successful submit. `File` answers are stripped before serialization (un-serializable); the question is simply unanswered after resume.
Alternatives:
- Always-on autosave. Rejected — writing respondent PII to localStorage without the host opting in is a privacy decision the host must make.
- Silent auto-restore without a prompt. Rejected — shared devices; an explicit prompt is the Typeform behavior too.
- `sessionStorage`. Rejected — doesn't survive the accidental-close case, which is the whole point.
Consequences: Hosts embedding multiple forms must give each a distinct `schema.id`. The resume prompt is wrapper-scoped UI (no document-level dialogs). Phase 5 also adds the `review` chrome screen (no answer stored, listed in no payload) and `onPartialChange(answers, meta)` for abandonment capture — both pure additions to the public API.
Revisit when: resume-from-URL-token (cross-device) gets scheduled; that needs signing and stays deferred.

---

## Deferred to V2

Per brief §14, V1 explicitly does **not** include the items below. Each gets a stub ADR when the work is actually scheduled.

- ~~**File upload question type**~~ — shipped in Phase 3 with host-controlled storage (ADR-012).
- ~~**Date picker question type**~~ — shipped as segmented `date` inputs in Phase 2 (ADR-010).
- ~~**Calculator / scoring logic**~~ — shipped as option-level `score` + `{{score}}` piping in Phase 4 (ADR-016). A full expression language remains out of scope.
- **Save-and-resume from URL token** — needs a signing strategy. (Same-device resume via `localStorage` shipped in Phase 5, ADR-017.)
- **iframe / HTML script-tag embed** — different consumer model; current package is React-only.
- **Built-in analytics event bus** — `onQuestionChange` callback is enough for V1.
- **Translation / i18n** — current pattern: callers pass already-localized strings.
- **Visual form builder UI** — agency writes schemas in code; clients never edit forms directly.
- **Multi-tenant form storage backend** — out of package scope.
- **Client-facing admin dashboard** — out of package scope.

---

## Breaking-change protocol

See [`MIGRATION_NOTES.md`](./MIGRATION_NOTES.md).
