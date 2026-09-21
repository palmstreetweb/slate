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
Decision: Publish as `@palmstreetweb/forms` with `publishConfig.access = "restricted"`. License: `UNLICENSED` (proprietary). *(Superseded by ADR-025 — package renamed to `@palmstreetweb/slate`.)*
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
- tsup's CSS handling is basic — we use `loader: { '.css': 'copy' }` and expect consumers to import `@palmstreetweb/slate/styles.css` explicitly.
Revisit when: tsup falls behind on JSX/RSC support, or we need fine-grained Rollup plugin control.

## ADR-003 — localStorage key
Date: 2026-05-10
Status: accepted
Context: The PSW site itself uses `psw-theme` for its theme persistence (palmstreetweb.com). If our forms package writes to the same key while embedded on PSW's site, we collide.
Decision: Use `slate-forms-theme` as the localStorage key.
Alternatives:
- Share `psw-theme` with the host. Rejected — embedded forms shouldn't mutate the host's theme state.
- Scope per-form (`slate-forms-theme:<schema-id>`). Rejected — over-engineered; a user toggling once should persist across all forms they encounter on a site.
Consequences:
- On first mount we read `document.documentElement.dataset.theme` (the host's current theme) as a fallback if our own key is unset — this gives the right initial state without us writing to the host's key.
Revisit when: a consumer reports cross-form theme desync.

## ADR-004 — `data-theme` lives on the wrapper, not `<html>`
Date: 2026-05-10
Status: accepted
Context: The package is embedded in someone else's page. We can't assume we own `<html>`. The host page may already have its own theme system reading `<html data-theme>`.
Decision: Apply `data-theme="light|dark"` to the `[data-slate-forms]` wrapper element rendered by `<Form>`. Token CSS is scoped via `[data-slate-forms][data-theme="light"] { ... }`. We **read** `<html>.dataset.theme` on first mount for inheritance; we **never write** to it.
Alternatives:
- Write to `<html>` (PSW's own pattern). Rejected — host page collision.
- Shadow DOM. Rejected for v1 — complicates font loading and breaks tab order with the rest of the page.
Consequences:
- Slightly heavier selectors (extra `[data-slate-forms]` prefix on every token override).
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
- Bundle budget audit: engine still <50kb gzipped without `libphonenumber-js` because it's tree-shaken out of `import { Form } from '@palmstreetweb/slate'` when no schema contains a phone question.
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
Decision: Swap to **Inter** (variable font, `opsz` axis 14–32) for both display and body in the Swiss theme. Use weight `900` for titles, `500` for body. Keep `--slate-title-tracking` at `-0.035em` (loosened slightly from `-0.04em` because Inter has more open counters than Archivo Black and the tighter setting starts to crowd at large sizes). Editorial theme is unchanged (Fraunces stays).
Alternatives:
- Keep `Archivo Black`. Rejected — closer to a heavy display sans than to Akzidenz; Caleb flagged the gap.
- **Söhne** by Klim Type Foundry. Rejected for v1 — the de-facto paid Akzidenz substitute, but it's a paid license and we don't want a license-management problem inside an internal package.
- **Inter Tight**. Considered — slightly tighter spacing, closer to Akzidenz Bold Condensed. Rejected because the standard Inter `opsz` axis already gives us display-grade letterforms at large sizes without needing a second family.
- **Public Sans** (US Web Design System). Decent grotesque, but less actively maintained and a step further from Akzidenz than Inter.
- License real **Berthold Akzidenz-Grotesk Pro**. Deferred — when we have a budget line for type licensing, swap inline. Self-host as a woff2 inside the package's `dist/` and gate on `defaultCountry` of the consumer's Berthold license.
Consequences:
- Swiss theme is now noticeably closer to swissted.com aesthetic, particularly the lowercase letterforms.
- One fewer Google Font family loaded (Inter replaces both Archivo + Archivo Black).
- The `--slate-font-display` and `--slate-font-body` tokens become identical (both `'Inter', system-ui, sans-serif`). That's intentional — Inter handles both roles via the variable axis.
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
- Matrix as auto-generated child questions (one per row). Rejected — pollutes `questionsVisited`, progress counts, and Slate outline.
- Ranking via a dnd library (dnd-kit ~12kb). Rejected for now — buttons + native DnD cover it dep-free.
Consequences: `LooseAnswers` values are now `string | string[] | number | File | MatrixAnswer | undefined`. `evaluate()` already treats unknown shapes safely (objects are only matched by `is_empty`/`is_not_empty`).
Revisit when: conditional logic needs to address individual matrix rows (would need `field: 'id.row'` path syntax — new ADR).

## ADR-014 — Answer piping via `{{field:id}}` template syntax
Date: 2026-06-12
Status: accepted
Context: The brief's `DynamicTitle` (function-style personalization) requires writing schemas in code. Typeform-style "recall" needs a serializable syntax Slate can edit and store as JSON.
Decision: A pure resolver in `src/logic/piping.ts` replaces `{{field:questionId}}` with the formatted answer and `{{score}}` with the running score total. Resolution happens once, in `QuestionRenderer`, over a question's `title`, `subtitle`, and `body` — function-style `DynamicTitle` keeps working (functions run first, their output is then piped). Unknown or unanswered fields resolve to `''`. Formatting: arrays join with ", ", `File` → its name, matrix → "row: col" pairs.
Alternatives:
- Resolving in each field component. Rejected — 18 call sites, and double-resolution risks injecting templates from user-typed answers.
- `{{id}}` without the `field:` prefix. Rejected — leaves no namespace for future tokens (`{{score}}` already collides; `{{var:x}}` may come later).
Consequences: Strings flow through one resolver; Slate can offer piping pickers later without engine changes.
Revisit when: variables (`{{var:x}}`) or per-token formatting (`{{field:date|long}}`) are needed.

## ADR-015 — Logic jumps: `logic: [{ if, goTo }]` evaluated on advance
Date: 2026-06-12
Status: accepted
Context: `visibleIf` covers show/hide but cannot express "skip ahead to Q7 if they answered No" without inverting conditions on every in-between question.
Decision: Answer-bearing questions (and statements) accept `logic?: LogicRule[]`. Rules are evaluated in `useFormState`'s `go_next` against the answer state at the moment the user advances *from* the carrying question. First match wins; navigation goes to the target's index in the visible list. No match, hidden target, or dangling id → normal step+1 (forgiving, not erroring). The jump origin is pushed onto history, so Back returns to it. Backward jumps are allowed (direction animates backward).
Retention semantics vs. ADR-005: jumps change *navigation only* — they do not hide the skipped-over questions. Answers to skipped questions are retained in state and still included in the submit payload if their `visibleIf` passes. Hosts that need skipped-question exclusion should pair jumps with `visibleIf` (Slate logic editor makes both visible side by side).
Alternatives:
- Auto-excluding skipped-over answers from submit. Rejected — "skipped" becomes path-dependent (what if the user goes Back and takes the other branch?), while ADR-005's visibility rule is a pure function of answers.
- A schema-level edges graph (Typeform's internal model). Rejected — per-question rules keep the flat-array schema and are exactly what the Inspector can edit.
Consequences: `questionsVisited` reflects the actual path. Progress can jump non-linearly (accepted; it tracks position, not path length).
Revisit when: loops become a real authoring hazard — a slate-side cycle detector would land in schema validation (Phase 6).

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

## ADR-017 — Save-and-resume under `slate-forms-resume:<formId>`
Date: 2026-06-12
Status: accepted
Context: Long conversational forms lose respondents to accidental tab closes. Typeform persists partial progress; we need the same without a backend.
Decision: Opt-in via the `<Form resume>` prop, which requires a new optional `schema.id` (the namespace). Snapshots (`answers` + `step` + `visitedIds` + `savedAt`) are written to `localStorage` on every change under the key `slate-forms-resume:<schema.id>` — a new user-visible storage name, prefix-consistent with `slate-forms-theme`. On remount with a saved session, a banner offers Resume (hydrates the state machine) or Start over (deletes the save). The save is cleared on successful submit. `File` answers are stripped before serialization (un-serializable); the question is simply unanswered after resume.
Alternatives:
- Always-on autosave. Rejected — writing respondent PII to localStorage without the host opting in is a privacy decision the host must make.
- Silent auto-restore without a prompt. Rejected — shared devices; an explicit prompt is the Typeform behavior too.
- `sessionStorage`. Rejected — doesn't survive the accidental-close case, which is the whole point.
Consequences: Hosts embedding multiple forms must give each a distinct `schema.id`. The resume prompt is wrapper-scoped UI (no document-level dialogs). Phase 5 also adds the `review` chrome screen (no answer stored, listed in no payload) and `onPartialChange(answers, meta)` for abandonment capture — both pure additions to the public API.
Revisit when: resume-from-URL-token (cross-device) gets scheduled; that needs signing and stays deferred.

## ADR-018 — The studio is a supported dev-tool surface
Date: 2026-06-12
Status: accepted
Context: Brief §14 declared "Visual form builder UI" out of V1 scope ("agency writes schemas in code; clients never edit forms directly"). The `examples/_admin` studio has nevertheless grown into a real builder — outline with drag-and-drop reordering, duplication and bulk delete, a three-pane editor with logic/jump/score editing, live preview with save-and-resume, submissions with CSV export and per-question summaries. Pretending it's "just an example" no longer matches reality.
Decision: The studio is formally a **supported internal dev tool**: agency-facing, dev-server-only (`npm run dev`), localStorage-backed. It is *not* part of the published package (nothing under `examples/` ships in `dist/`), not client-facing, and carries no multi-tenant/auth/backend ambitions — those remain deferred per §14. Engine rule going forward (already roadmap policy): every schema feature must be editable in Slate Inspector, or it isn't done.
Decision (supporting): schema sanity checking lives in the *engine* as a pure, exported `checkSchema(questions): SchemaIssue[]` (`src/logic/schemaCheck.ts`) — duplicate ids, dangling `visibleIf`/jump-condition references, dangling/self jump targets. The studio surfaces issues in an editor banner; hosts and CI can call it directly. The runtime engine stays forgiving (dangling refs fall through) per ADR-015.
Alternatives:
- Keep the builder unofficial. Rejected — it already contradicts the brief in practice; an ADR is the honest paper trail.
- Promote it into the published package. Rejected — bundle budget and scope; the engine is the product, Slate is tooling.
Consequences: Slate code is held to repo conventions (TS, tokens, tests where practical) but not to the engine's bundle budget. Brief §14 stays frozen; this ADR is the documented exception.
Revisit when: someone wants to deploy Slate for non-developers — that's the "client-facing admin dashboard" line item, still deferred.

---

## ADR-019 — `classic` theme (old-Typeform feel) is the new default
Date: 2026-06-13
Status: accepted
Context: The shipped themes (`editorial` serif/cream, `swiss` 900-weight lowercase poster) are both heavily branded. The product direction is the calm, full-screen, conversational feel of early Typeform: one question mid-viewport, neutral medium-weight sans, soft rounded controls, a friendly blue accent, generous whitespace, no decoration. Neither existing theme expresses that.
Decision: Add a third built-in theme, `classic` (`src/themes/classic.ts` + mirrored in `tokens.css`), and make it the **default** for new forms created in the studio. It uses Inter at weight 500, normal case, a comfortable reading title size (`clamp(1.6rem, 3.6vw, 2.4rem)`), 8px radius, a `#2C6EF2`→`#5B9BFF` blue accent, and `decoration: 'none'`. Inter is already loaded (used by Swiss), so no new font dependency. `editorial` and `swiss` are unchanged and remain selectable. `ThemeName` becomes `'classic' | 'editorial' | 'swiss'`.
Alternatives:
- Restyle `editorial`/`swiss` toward the classic look. Rejected — destroys two distinct, working aesthetics and isn't reversible; the theme registry exists precisely so new looks are additive.
- Add a new bespoke font (Apercu/Söhne-like). Rejected — adds a font dependency and load cost for marginal gain over Inter; "clean" argues for the system-adjacent stack already in the bundle.
Consequences: Existing forms keep whatever theme they saved. The studio theme dropdown lists Classic first. Future chrome/motion refinements (Enter affordance, choice pills, slide transitions) that lean further into the classic feel are theme-agnostic and tracked separately.
Revisit when: we want classic-only chrome that would conflict with editorial/swiss — that would argue for per-theme component variants rather than shared CSS.

---

## ADR-020 — Theme toggle scaled ~15% via a wrapper, port left verbatim
Date: 2026-06-14
Status: accepted
Context: The theme toggle felt slightly too large in the form chrome. `src/styles/toggle.css` is a verbatim 1:1 port of palmstreetweb.com (brief §8.2) and is a protected file — per AGENTS.md/CLAUDE.md, any tweak requires an ADR. The toggle is built from interlocking pixel values (track 68×36, thumb 26, translateX(32px), icon offsets) and uses `transform` itself for the `:active` press and the morph animation, so editing those px values — or putting a `transform: scale()` directly on `.theme-toggle` — is error-prone and collides with its existing transforms.
Decision: Wrap the toggle button in a `.slate-toggle-scale` span and apply `transform: scale(0.85)` (≈15% smaller, `transform-origin: right center`) in `base.css`. `toggle.css` is unchanged — it remains a faithful port; the size adjustment is a composable, fully reversible outer transform. The design, proportions, colors, and morph animation are identical, just rendered smaller.
Alternatives:
- Edit the px values in `toggle.css`. Rejected — mutates the protected verbatim port and risks desyncing the interlocking dimensions/animation.
- `transform: scale()` directly on `.theme-toggle`. Rejected — conflicts with the toggle's own `:active` `scale(0.97)` and morph transforms (specificity/override fights).
Consequences: The toggle no longer matches palmstreetweb.com at exactly 1:1 size (it's intentionally ~15% smaller in this product). The hit target shrinks proportionally (~58×31), still acceptable for a secondary control. If we later want pixel parity again, delete the wrapper rule.
Revisit when: PSW ships a new canonical toggle, or we want a configurable toggle size.

---

## ADR-021 — Five more themes + a generalized per-step decoration system
Date: 2026-06-14
Status: accepted
Context: The Swiss theme's per-step geometric backdrops (a different composition each question) were well-liked, but that behavior was hard-wired to one theme. We wanted more built-in aesthetic range and to make the "backdrop changes per page" idea reusable by any theme.
Decision: (1) Generalize decoration. `Theme.decoration` becomes `'none' | 'grain' | 'shapes' | 'aurora' | 'grid'`. All except `grain` are per-step — `Form.tsx` passes `state.step` to the decoration component, which indexes into a scene array (same model as `SwissDecoration`). Two new components: `AuroraDecoration` (soft blurred gradient blobs, reads `--slate-deco-1/2/3`) and `GridDecoration` (technical line grid with a per-step accent cell, reads `--slate-deco-line` + `--slate-accent`). Decoration tokens stay CSS-only in `tokens.css` (not on the `Theme` TS shape), matching how Swiss already declared `--slate-deco-*`. (2) Add five themes: `midnight` (indigo/aurora), `sunset` (warm/aurora), `terminal` (monospace phosphor/grid), `forest` (sage/grain), `mono` (brutalist B&W, reuses `shapes` with a grayscale deco palette). `ThemeName` is now the 8-key union; `classic` remains the default.
Alternatives:
- A fully generative scene engine (procedural per-step art). Rejected for now — curated scene arrays are more predictable and on-brand; can revisit.
- Bespoke per-step SVG sets for every new theme. Rejected — expensive; reusing `aurora`/`grid`/`shapes`/`grain` across themes (parametrized by tokens) gives variety cheaply.
- New runtime font dependencies for distinct themes. Rejected — all themes reuse already-loaded Inter / Fraunces / JetBrains Mono to stay within the loading/bundle budget.
Consequences: `tokens.css` grew (mirrors for 5 themes + their deco tokens). The studio theme dropdown lists all eight. No engine logic changed beyond the decoration switch. Adding future themes still follows the documented 4-step recipe in AGENTS.md.
Revisit when: we want user-defined/custom themes at runtime (tokens already support inline-property injection via utils/tokens.ts) or a procedural decoration generator.

---

## ADR-022 — Narrative decorations + four creative themes
Date: 2026-06-14
Status: accepted
Context: ADR-021's per-step decorations reshuffle a curated scene each step, but the step index was only ever used to pick a *different* scene — never to build one *up*. The more compelling use of progress is narrative: a backdrop that accumulates as the respondent advances, so completing the form completes a picture. We also wanted bolder aesthetics than the (intentionally safe) ADR-021 set.
Decision: Extend `Theme.decoration` with four values — `'riso' | 'memphis' | 'constellation' | 'growth'` — and add four themes. Two are **narrative/cumulative** (they read `step` to render the artwork *so far*, not a scene chosen by `step`): `constellation` (theme key `constellation`, `ConstellationDecoration` — lights one star + its connector per step over a fixed wandering path, completing a star map) and `bloom` (`growth` decoration, `GrowthDecoration` — a vine climbs one node per step, leafing as it goes and flowering on the final steps). Two are **recomposing/aesthetic** like ADR-021: `riso` (`RisoDecoration` — two halftone-dot ink blobs, offset for print mis-registration, overprinting via `mix-blend-mode` driven by a new `--slate-deco-blend` token that is `multiply` in light / `screen` in dark) and `memphis` (`MemphisDecoration` — scattered 80s squiggles, zigzags, arcs, triangles, dot grids). `ThemeName` is now a 12-key union; `classic` is still default. Per-theme `.slate-decoration` opacity caps live in `base.css` so the busier backdrops (riso/memphis especially) stay behind content.
Alternatives:
- Make every decoration narrative. Rejected — recomposing scenes still suit calm/ambient themes; narrative is a deliberate, occasional flourish.
- Real halftone via an SVG filter (feImage/feTile gradients). Rejected — a `<pattern>` of dots clipped to blobs is far cheaper and reads the same at backdrop opacity.
- New fonts for riso/memphis (a chunky display face). Rejected — heavy `Inter` (700–800) carries the print/playful weight without a new font dependency, per the AGENTS.md bundle budget.
Consequences: `tokens.css` and Slate dropdown grew to 12 themes. `riso` introduces the first blend-mode-driven decoration (new `--slate-deco-blend` token). Narrative decorations assume `step` increases monotonically toward completion (it does — welcome=0 … thanks=last); a future non-linear/branch-heavy flow would still render correctly but the "story" reads best linearly.
Revisit when: we add a procedural/generative decoration engine, or want narrative decorations whose length auto-fits the question count (today the constellation/vine paths are fixed-length and simply cap out on long forms).

---

## ADR-023 — Opt-in sound effects on forward navigation
Date: 2026-06-14
Status: accepted
Context: We wanted an optional audio confirmation as respondents move page-to-page (and a small flourish on completion), in the spirit of conversational forms. The brief is silent on audio, so per CLAUDE.md this needs an ADR. Two costs to avoid: a runtime dependency / bundled audio assets (engine budget is <50kb gz, AGENTS.md §2.9), and any host-page side effects (wrapper-scoped rule).
Decision: Add `schema.sound?: FormSound | boolean` (default off → silent) to the public `Schema` type. `FormSound` is `'off'` or one of **ten built-in preset ids** (`pixie-mallet`, `soft-chime`, `glass-tap`, `wood-block`, `bubble-pop`, `coin-pickup`, `page-flip`, `type-ding`, `marimba`, `laser-blip`). Legacy `sound: true` normalizes to `'pixie-mallet'`. When set to a preset, `<Form>` plays that cue on **discrete respondent interactions** — choice toggles (matrix, multi-select, picture multi), auto-advance selects (single choice, yes/no, scale, NPS), OK/Enter advances (text fields, welcome CTA, etc.) — not on passive step changes or back navigation. All presets are **synthesized with the Web Audio API** — the generic engine lives in `src/utils/pixieMallet.ts` (Pixie Mallet's tuned recipe stays there, untouched); the registry + nine additional recipes live in `src/utils/formSounds.ts`. No asset files, no deps. Volume (0–1) is the only runtime knob (`playFormSound(id, 0.6)`). The studio exposes a **Step sound** dropdown in Settings (`FORM_SOUND_OPTIONS`).
Alternatives:
- Bundle/CDN-fetch mp3/wav cues. Rejected — assets + fetch for tiny effects; synthesis is free and self-contained.
- A richer object (`{ id, volume }`). Rejected for v1 — the dropdown + fixed volume covers the ask; the field can widen later without breaking callers.
- Gate on `prefers-reduced-motion`. Rejected — motion ≠ sound; feature is opt-in and off by default.
Consequences: Additive public API (`FormSound`, `FormSoundId` exported from the type barrel). `sound: true` still works (maps to Pixie Mallet). Tests cover registry length, normalization, and off/no-op behavior.
Revisit when: we want distinct per-question-type cues, a respondent-facing mute control, custom user-uploaded sounds, or volume in the schema.

---

## ADR-024 — Accent-fill foreground token (`--slate-on-accent`)
Date: 2026-06-14
Status: accepted
Context: Mono dark sets `--slate-accent` to white (same as `--slate-text`). OK buttons used hardcoded `color: #fff` on `background: var(--slate-accent)`, producing invisible labels. The bug can recur on any future theme where accent is light or equals text unless the rule is structural.
Decision: (1) Add `--slate-on-accent: var(--slate-bg)` on every `[data-slate-forms]` wrapper (built-in tokens.css + runtime custom themes inherit it automatically when `--slate-bg` is set). (2) **Fill rule:** any control surface filled with `--slate-accent` uses `color: var(--slate-on-accent)`; any surface filled with `--slate-text` uses `color: var(--slate-bg)`. Never `#fff`, never `--slate-text` on accent fills. (3) CI test `tests/themeContrast.test.ts` asserts every built-in theme/mode pair meets ≥3:1 contrast between `bg` and `accent` (WCAG large UI text). (4) CSS discipline test bans `color: #fff` in `questions.css`.
Alternatives:
- Per-theme `onAccent` color in the Theme TS shape. Rejected — duplicates `bg`; the page background is always the opposite pole from the accent fill in our palette design.
- Keep `#fff` and special-case mono. Rejected — whack-a-mole; the next light-accent theme would break the same way.
Consequences: All accent-filled controls (OK, scale, dropdown selection, matrix dot, badges, resume primary) migrated to `--slate-on-accent`. New themes must keep `accent`/`bg` contrast ≥3:1 in both modes; the test catches regressions at `npm run test`.
Revisit when: we need non-inverted accent buttons (e.g. outlined/ghost variants) — those should omit the accent fill entirely rather than picking a third foreground token.

---

## ADR-025 — Product rename: Forms/Studio/psw → Slate
Date: 2026-06-14
Status: accepted
Context: The internal form engine and its dev-tool shell were named piecemeal (`@palmstreetweb/forms`, Studio, `psw-*` tokens). The product direction is a single brand — **Slate** — while keeping the `@palmstreetweb` npm org and GitHub org unchanged.
Decision: (1) Rename the npm package to `@palmstreetweb/slate`. (2) Rebrand the dev-tool display name Studio → Slate. (3) Rename all product tokens: `data-psw-forms` → `data-slate-forms`, `.psw-*` → `.slate-*`, `--psw-*` → `--slate-*`, admin `studio-*` → `slate-*`, `data-theme-name='studio'` → `'slate'`. (4) localStorage: `psw-forms-theme` → `slate-forms-theme`, `psw-forms-resume:*` → `slate-forms-resume:*`, `psw-studio-theme` → `slate-theme`, `psw-studio-forms` → `slate-forms`, `psw-studio-submissions` → `slate-submissions`. (5) One-time migration shim in `src/utils/migrateLocalStorage.ts` (copy legacy → new on load; leave legacy keys until ~2026-07-15). (6) **Do not rename** the PSW site key `psw-theme`, generic `/forms/` route paths, or the noun "forms" in UI copy.
Alternatives:
- Rename org scope to `@slate/*`. Rejected — org stays `@palmstreetweb`.
- Drop the `slate-` prefix entirely. Rejected — embed collision armor on client sites.
- Breaking migration without shim. Rejected — in-progress respondent sessions would lose resume data.
Consequences: Major breaking change for any consumer importing `@palmstreetweb/forms` or targeting `[data-psw-forms]` / `.psw-*` in host CSS. External projects must update independently (builder app, client embeds). Repo folder + GitHub remote rename are human-driven (Phase 3).
Revisit when: remove the localStorage migration shim after ~2026-07-15.

---

## ADR-026 — GitHub repository rename: `palm-street-web-forms` → `slate`
Date: 2026-06-14
Status: accepted
Context: ADR-025 renamed the npm package and product tokens to Slate but left the GitHub repo at the legacy name `palmstreetweb/palm-street-web-forms`. The repo name, local clone folder, and package name should align so contributors, CI, and `gh` workflows resolve to one canonical slug.
Decision: Rename the GitHub repository to `palmstreetweb/slate`. GitHub's rename flow preserves history and redirects the old URL. Update the local `origin` remote to `https://github.com/palmstreetweb/slate.git` (fetch + push). Add a `repository` field to `package.json` pointing at the new URL. No other code or publish changes — this is repo metadata only.
Alternatives:
- Keep `palm-street-web-forms` on GitHub. Rejected — perpetual mismatch with `@palmstreetweb/slate` and the Slate brand.
- Create a new repo and migrate issues/PRs manually. Rejected — GitHub rename is zero-downtime and keeps stars, issues, and branch protection.
Consequences:
- Clones with a stale remote URL still work via GitHub redirects, but contributors should run `git remote set-url origin https://github.com/palmstreetweb/slate.git` (or re-clone) so push/fetch targets the canonical URL.
- Any hard-coded links to `github.com/palmstreetweb/palm-street-web-forms` in external docs or bookmarks should be updated; GitHub redirects are not guaranteed forever.
- `package.json` `repository` metadata now points at `palmstreetweb/slate` for npm and tooling.
Revisit when: we publish to npm and confirm the registry links resolve correctly.

---

## ADR-027 — Standalone brand page (`brand/`)
Date: 2026-06-14
Status: accepted
Context: Slate has a visual identity (Field mark, wordmark, palette, usage rules) that internal teams and partners need outside the form engine and dev examples app. That content should be easy to share as a single URL without coupling it to the npm library build or the Vite examples shell.
Decision: (1) Add a top-level `brand/` directory containing a self-contained static site (`index.html`, `favicon.svg`, no build step, no `package.json`). (2) Do not wire `brand/` into `tsup`, Vite, Vitest, or the pnpm workspace — the library and examples builds remain unchanged. (3) Deploy `brand/` as a **separate Vercel project** with Root Directory = `brand`, framework = Other (static). Production URL: [slateforms.vercel.app](https://slateforms.vercel.app). (4) Document deploy settings in `brand/README.md` and link from the root README.
Alternatives:
- Serve the brand page from the examples Vite app. Rejected — couples brand collateral to the dev server and library-adjacent routing.
- Publish as a path on palmstreetweb.com. Rejected for now — dedicated Vercel static deploy is faster to ship and keeps PSW site deploys independent.
- Add a build step (Tailwind, bundler) inside `brand/`. Rejected — the page is already self-contained HTML/CSS/inline SVG; zero build keeps Vercel config trivial.
Consequences: `brand/` is source-only in this repo; Vercel project setup is manual (Root Directory + static framework). Favicon and page assets live beside `index.html`. Prettier may touch HTML on `npm run format`; that does not affect `npm run build`.
Revisit when: we want downloadable SVG exports, versioned brand PDFs, or auth-gated partner access.

## ADR-026 — Client-side image optimize pipeline + `heic2any` for uploads
Date: 2026-06-15
Status: accepted (HEIC decoder path updated by ADR-033)
Context: 805 Sealcoating already ships a browser-side upload prep stack (MIME inference, HEIC→JPEG, canvas downscale/recompress) before Supabase Storage. Slate's `file_upload` type (ADR-012) left optimization to hosts; slateforms admin had no `onFileUpload`, so files never persisted.
Decision: Port the 805 prep pipeline into `src/utils/` (`imageFileTypes`, `heicToJpeg`, `prepareImageForStorage`, `prepareFileForUpload`) and expose `createFileUploadHandler({ upload })` so hosts run optimize-then-upload in one callback. Images use the same profile as 805 (1920px edge, ~450KB JPEG cap, 32MB input cap); non-images pass through with size limits only. Add runtime dep `heic2any`, lazy-imported only when a HEIC/HEIF file is picked. Slate admin (`examples/_admin`) stores prepared blobs in IndexedDB and answers as `slate-file://{uuid}` refs until `VITE_UPLOAD_URL` is configured for remote POST.
Alternatives:
- Bake Supabase upload into the library. Rejected — same as ADR-012; storage stays host-specific.
- Skip optimization in the library. Rejected — duplicates 805 logic in every consumer and slateforms would keep losing files on submit.
Consequences: `heic2any` counts toward bundle budget but loads on demand. `<Form>` gains optional `resolveFileUploadMeta` for display of opaque refs. Backup/export of submissions includes refs only — blob sidecar in IndexedDB is not in JSON backups yet.
Revisit when: backup format should embed files, or upload progress UI is needed beyond the field's uploading state.

Revisit when: backup format should embed files, or upload progress UI is needed beyond the field's uploading state.

## ADR-028 — Production Slate admin: Supabase persistence + PSW auth
Date: 2026-06-15
Status: superseded by ADR-029
Context: ADR-018 scoped Slate as a localStorage-backed internal dev tool with no backend. The studio is now deployed at slateforms.vercel.app and needs real persistence: PSW team auth, centralized submissions from public fill links, file storage, and email alerts. The form engine package (`src/`) stays host-agnostic per the brief.
Decision: (1) Add Supabase (Postgres + Auth + Storage + Edge Functions) as the production backend for `examples/_admin` only — not a runtime dep of `@palmstreetweb/slate`. (2) Auth-gate the admin SPA: only `@palmstreetweb.com` (or allowlisted) emails via Supabase Auth magic link / OAuth. (3) `forms` and `submissions` tables with soft-delete (`deleted_at`), draft vs `published_schema` + `status`. (4) Public fill at `#/f/{slug}` via `get_form_by_slug` RPC; anonymous submit via `submit-response` Edge Function (rate-limited, no open RLS insert). (5) File uploads to private `form-uploads` bucket; refs in answers. (6) `submit-response` triggers Resend notification when configured. (7) When `VITE_SUPABASE_URL` is unset, admin falls back to localStorage (tests + offline dev).
Alternatives:
- Multi-tenant SaaS with client logins. Rejected for v1 — PSW ops only.
- Bake Supabase into the npm engine. Rejected — ADR-012; hosts own storage.
- Vercel Postgres + custom API routes. Rejected — Supabase matches 805 patterns and ships Auth + Storage.
Consequences: `@supabase/supabase-js` is a devDependency (examples build only). New `supabase/migrations/` and Edge Functions in repo. ADR-018's "no backend ambitions" is superseded for the **deployed admin app** only; the published package is unchanged. RLS must be audited before production credentials ship.
Revisit when: multi-tenant client workspaces, real-time collaborative editing, or embedding admin in the npm package.

## ADR-029 — Production Slate admin: Neon backend (Data API + Auth + Storage + Functions)
Date: 2026-09-13
Status: accepted
Context: ADR-028 put the deployed studio on Supabase. Paying for additional Supabase Pro projects to isolate apps became undesirable; Neon’s free tier allows many projects, and Neon now ships Managed Better Auth, Data API, Object Storage, and Functions (beta) sufficient for Slate’s admin needs. Fresh cutover — no migration of historical Supabase rows/files.
Decision: (1) Replace Supabase with **Neon** for `examples/_admin` only — still not a runtime dep of `@palmstreetweb/slate`. (2) Use `@neondatabase/neon-js` with `SupabaseAuthAdapter` so existing `from()` / `rpc()` / `auth.signInWithOAuth` call shapes stay close. (3) Env: `VITE_NEON_URL` (HTTPS database URL; SDK derives Auth + Data API). Offline: `VITE_ADMIN_OFFLINE=1` ignores Neon (localStorage). (4) Schema in `neon/migrations/`; RLS via `is_psw_team()` using JWT email / `neon_auth.user` + `team_allowlist`. (5) Public submit via Neon Function `submit-response` (`VITE_SUBMIT_URL`). (6) File uploads via Neon Object Storage bucket `form-uploads` with Neon Function `storage-sign` for presigned URLs (`VITE_STORAGE_SIGN_URL`). (7) Package remains host-agnostic.
Alternatives:
- Keep Supabase and share one Pro project with schemas. Rejected — prior cross-app Auth/redirect conflicts; cost of extra Pros.
- Neon Postgres only + keep Supabase Auth/Storage. Rejected — still requires a Supabase project.
- Full rewrite onto Better Auth native API without SupabaseAuthAdapter. Deferred — adapter minimizes churn for this cutover.
Consequences: `@supabase/supabase-js` removed; Neon Auth/Storage/Functions are beta. Operators enable Data API + Auth + Google OAuth in Neon Console per `neon/SETUP.md`. OAuth users re-authenticate; password hashes do not migrate.
Revisit when: Neon Auth/Storage leave beta, or multi-app schemas share one Neon project.

## ADR-030 — Public submit rate limits (Neon Function)
Date: 2026-09-13
Status: accepted
Context: Share links are public (`#/f/{slug}`). Without limits, anonymous `submitresponse` can be flooded. Honeypot alone is insufficient.
Decision: (1) Postgres table `submit_rate_buckets` + `consume_submit_rate()` RPC (security definer, owner-only). (2) Neon Function checks **IP+form** (default 10 / 10 min) then **IP** (default 30 / hour) before insert; returns **429** + `Retry-After`. (3) Limits tunable via Function env `SUBMIT_RATE_*`. (4) Fail closed (503) if the rate check errors.
Alternatives:
- In-memory Map on the Function isolate. Rejected — resets on cold start / multi-isolate.
- External Redis. Rejected — extra paid service for v1 scale.
Consequences: Legitimate rapid re-tests from one network may hit 429; raise env limits if needed. IP spoofing is mitigated by trusting platform `x-forwarded-for` from Neon/edge.
Revisit when: per-form admin-configurable quotas or CAPTCHA are required.

## ADR-031 — Public upload signing guards (Neon Function)
Date: 2026-09-13
Status: accepted
Context: `storagesign` issued presigned PUTs for any `public/{formId}/…` path with no form check, size cap, or rate limit — bucket fill risk on share links.
Decision: (1) Path must match `public|draft/{formId}/{uuid}/{filename}`. (2) `public/` uploads only when the form exists, is **published**, and not soft-deleted. (3) Require `contentLength`; max **32 MB** (env `STORAGE_SIGN_MAX_BYTES`). Accept **any** `contentType` (default `application/octet-stream`) — no MIME allowlist; respondents must not fail on file type. (4) Bind `ContentLength` on the signed PUT. (5) Rate-limit anonymous signing via existing `consume_submit_rate` (defaults: 20 / 10 min per IP+form, 60 / hour per IP). (6) `draft/` uploads and all `download` / `meta` / `content` ops require a Bearer JWT whose `sub` (or `id`) matches `forms.owner_id` (exp checked; signature verify deferred until JWKS is wired).
Alternatives:
- MIME allowlist. Rejected — customer forms need arbitrary attachments; type errors are worse than hosting risk mitigated by size + rate + path guards.
- Virus scanning / ClamAV. Deferred — ops cost.
- CAPTCHA on upload. Deferred until abuse persists after these guards.
- Full JWKS signature verify on every request. Deferred — owner_id match + exp blocks casual Bearer forgery; add JWKS when Neon Auth exposes a stable URL in Function env.
Consequences: Malware can still be uploaded within size/rate limits; downloads should treat blobs as untrusted. Optional per-question `accept` remains a client picker hint only, not a server gate. Admin Responses previews require a signed-in owner session.
Revisit when: JWKS verification on draft/download, or admin opts into a server-side MIME denylist.

## ADR-032 — Multi-file `file_upload` answers
Date: 2026-09-13
Status: accepted
Context: ADR-012 deferred multi-file. Studio users need respondents to attach more than one file and keep drag-and-drop after the first pick (empty-state zone alone is insufficient).
Decision: (1) `FileUploadQuestion` gains `multiple?: boolean` (default **ON** when unset; set `false` for single-file) and `maxFiles?: number` (default **10** when multiple). (2) Single mode (`multiple: false`) keeps answer `File | string`. Multiple mode stores `(File | string)[]` (legacy single values still accepted when reading). (3) UI: file chip list + persistent drop zone; `<input multiple>` and drop accept all files up to `maxFiles`. (4) Studio: new `file_upload` questions set `multiple: true`; unset schemas behave as multi. (5) `onFileUpload` still called once per file (sequential).
Alternatives:
- Always store an array. Rejected — breaks existing single-string answers and `AnswersOf` consumers.
- Parallel uploads with progress UI. Deferred — sequential + “Uploading…” is enough for v1.
Consequences: Autosave strips raw `File` items from arrays (string refs remain). Piping / response formatting join multi labels with ", ".
Revisit when: per-file progress bars or a host batch-upload API is needed.

## ADR-033 — HEIC decode: `heic-to` (+ native) for iOS 18+
Date: 2026-09-13
Status: accepted
Context: ADR-026 used `heic2any` alone. iPhone HEIC from iOS 18+ fails with libheif “format not supported,” so uploads silently passed through raw `.HEIC` and Responses Preview showed a dead-end error. `heic2any` is unmaintained relative to libheif.
Decision: (1) Convert HEIC via native decode → `heic-to` (libheif 1.22+) → `heic2any` fallback. (2) Keep both deps lazy-loaded. (3) On upload, if HEIC still cannot be decoded, **fail the upload** with a clear message instead of storing unreadable HEIC.
Alternatives:
- Server-side conversion in `storagesign`. Deferred — adds Function CPU/deps; client path is enough for PSW admin volume.
- Drop HEIC support. Rejected — iPhone is the default camera for PSW fieldwork.
Consequences: slightly larger on-demand chunk when HEIC is opened; existing stored `.HEIC` answers become previewable after refresh.
Revisit when: Neon Functions should normalize all uploads server-side.

## ADR-034 — Typewriter key ticks while typing (companion to step sound)
Date: 2026-09-13
Status: accepted
Context: ADR-023 covers discrete step/choice confirmation cues. Respondents (and studio preview) also want a soft typewriter feel on free-text entry when sound is enabled. Brief is silent; revisit clause on ADR-023 named per-interaction cues.
Decision: When `schema.sound` resolves to a preset (not `off`), text-entry fields play a **separate synthesized typewriter tick** on printable keys, Backspace, and Delete — not on Enter (Enter still uses the step sound via OK/advance). Implemented as `playTypewriterTick()` in `formSounds.ts` (Web Audio, no assets), rate-limited (~26ms) with slight pitch variation. Wired through `<Form>` → `QuestionRenderer` → short/long text, email, phone, url, and number fields. No new schema field — typing sound is on whenever step sound is on.
Alternatives:
- Separate `schema.typingSound` toggle. Rejected for v1 — one Settings control is enough; can split later without breaking callers.
- Reuse the selected step preset per key. Rejected — step presets are too long/loud for keystroke rate.
- Sampled typewriter WAV. Rejected — same ADR-023 asset budget rule.
Consequences: Forms with sound on feel more conversational while typing; silent forms stay silent. IME composition keys are ignored.
Revisit when: respondent mute control, or typing sound independent of step sound.

## ADR-035 — Team allowlist UI via SECURITY DEFINER RPCs
Date: 2026-09-14
Status: superseded by ADR-036
Context: Extra studio emails live in `team_allowlist` (002). Migration 005 revoked direct client table access because RLS policies that call `is_psw_team()` recurse (that helper reads the same table). Operators still needed SQL to invite contractors. Sharing model for v1 remains a **single shared PSW workspace** (`@palmstreetweb.com` + allowlist), not multi-tenant personal accounts.
Decision: (1) Add `list_team_allowlist` / `add_team_allowlist` / `remove_team_allowlist` as `SECURITY DEFINER` RPCs gated by `is_psw_team()` first — table stays revoked from `authenticated`. (2) Settings → Team access panel for add/remove. (3) Skip inserting `@palmstreetweb.com` (already covered by domain). (4) Block allowlisted-only users from removing their own email. (5) `can_sign_in` continues to honor the allowlist for magic-link / OAuth gate.
Alternatives:
- Restore table RLS with `(select is_psw_team())`. Rejected — same recursion footgun that 005 fixed.
- Multi-tenant per-user forms. Deferred — product decision; current ops model is shared studio.
Consequences: Any team member can invite/remove others from Settings. Schema cache refresh required after migration 007.
Revisit when: multi-tenant or role-scoped admin (owner-only invites).
Superseded by: ADR-036 (open signup; Team Access UI removed).

## ADR-036 — Open signup + per-user form ownership
Date: 2026-09-14
Status: accepted (supersedes ADR-035 sharing model; ADR-029 team gate)
Context: Slate was gated to `@palmstreetweb.com` + `team_allowlist` with a single shared form library. Product intent is now **anyone can sign up and use the app** with isolated libraries. Team Access in Settings is unnecessary under that model.
Decision: (1) Open `can_sign_in` to any plausible email. (2) Add `forms.owner_id` stamped from `auth.user_id()` on insert (frozen on update). (3) Replace team RLS with owner-scoped policies on `forms` / `submissions` / `form_files`. (4) Remove Team Access UI; keep allowlist table/RPCs inert for now. (5) Backfill existing rows to a known PSW auth user so current forms are not orphaned. (6) Public fill by slug + Function submit remain global (slug still unique).
Alternatives:
- Keep shared team library + invites. Rejected — conflicts with “anyone can use.”
- Multi-user orgs / form sharing. Deferred — personal accounts first.
Consequences: New accounts start empty. Two users cannot share a form library without a future share model. Global slug uniqueness can collide across users (unique index still enforces).
Revisit when: form sharing, teams, or per-owner slug namespaces.

## ADR-037 — One branded sign-in email (magic link + code + Slate lockup)
Date: 2026-09-18
Status: accepted
Context: Email sign-in calls both the Email OTP plugin and the Magic Link plugin so the login screen can accept either a click or a 6-digit code. Neon’s shared mailer then sends **two** default-branded messages. Dashboard email templates are not available; custom SMTP still uses Neon’s copy. Users asked for a single email that includes the actual Slate lockup.
Decision: Subscribe Managed Better Auth webhooks to `send.otp` and `send.magic_link` (which disables Neon’s default templates). A Neon Function (`authemail`) verifies the Ed25519 signature, coalesces both payloads for the same address (~1.8s + advisory lock), and sends one Resend email from `Slate <notifications@palmstreetweb.com>` with the lockup PNG (CID), a Sign-in button, and the code. Staging rows live in `auth_email_pending` (RLS on, no Data API grants). Neon Auth will not call its own Function hosts, so production webhook URL is `https://slateforms.vercel.app/api/auth-email`, which forwards to `authemail`.
Alternatives:
- Custom SMTP only. Rejected — still two Neon-branded templates.
- Send only magic link *or* only OTP. Rejected — login UI offers both.
- Client-side merge. Impossible — tokens are minted server-side.
Consequences: `RESEND_API_KEY` and `NEON_AUTH_URL` must be set on `authemail`. The Auth webhook URL must be a non-Neon HTTPS host (`slateforms.vercel.app/api/auth-email`). If one plugin fails, the email still sends with whichever payload arrived.
Revisit when: Neon ships dashboard email templates that can include both a link and a code.

## ADR-038 — Hard per-user form quota
Date: 2026-09-18
Status: accepted
Context: ADR-036 opened signup. Authenticated users insert forms through the Data API with no ceiling, so one bot account could create unbounded rows, keep compute awake, and burn Launch credits. Public submit/upload already have IP rate limits (ADR-030/031); form *creation* did not.
Decision: (1) Postgres `BEFORE INSERT` on `forms` (inside `forms_enforce_owner`) counts **all** rows for `owner_id`, including trash, and raises `FORM_QUOTA_EXCEEDED` at **50**. (2) Count includes soft-deleted rows so trash-and-recreate cannot churn; a slot frees only on permanent delete. (3) Skip the quota when the `id` already exists so PostgREST upserts of existing forms still save at the cap. (4) Serialize with `pg_advisory_xact_lock` per owner. (5) Limit lives in `form_quota_limit()`; SPA reads `form_quota_status()` for copy. (6) UI blocks New form / Duplicate with an explanation — not a hidden button. LocalStorage offline mode stays uncapped.
Alternatives:
- Client-only disable of New form. Rejected — bots call the Data API directly.
- Count active forms only. Rejected — infinite create/trash loop.
- Invite-only signup. Complementary, not a substitute; product still wants open signup.
- Per-hour insert rate in addition to the cap. Deferred until we see abuse at 50.
Consequences: A user with 50 forms (active + trash) cannot create or duplicate until they delete forever. Bumping the number is one SQL change to `form_quota_limit()` plus Data API schema refresh. Existing libraries over 50 remain editable.
Revisit when: paid plans, per-email allowlist exceptions, or signup captcha.

## ADR-039 — Build with AI (admin draft generator)
Date: 2026-09-19
Status: accepted
Context: Authors want a first draft from a short prompt. The engine bundle budget is <50kb gzipped (brief §2.9); Anthropic must stay server-side. No existing Zod model of the form schema.
Decision: (1) Add runtime deps `ai`, `@ai-sdk/anthropic`, and `zod` for the **admin API only** — never imported from `src/`. (2) `POST /api/generate` (Vercel serverless, Node) calls structured generation with `claude-haiku-4-5` and a Zod schema of **every type the editor can add** (`ADDABLE_TYPES` + welcome/thanks as separate chrome). Questions are a **flat object** (type enum + unused fields as `""` / `0` / `[]`) because Anthropic structured output cannot compile a 20-way discriminated union. `picture_choice` options need a real `https` `src`. (3) Map `title` → form name + `brand.name`, `description` → welcome subtitle, `theme` → `editorial` | `swiss`, `themeMode` always `toggle`. (4) In-memory 10 req/min per IP. (5) The modal **reviews the draft first**. `createFormAsync` runs only when the author clicks Open in editor; Undo still permanently deletes that unused draft. (6) Revise in place: `{ prompt, previous, instruction }` returns a new object (keep ids stable when the question is the same). (7) Optional branch: `showIfField` + `showIfEquals` map to engine `visibleIf` `{ op: 'equals' }`. (8) Default types are short text, choice, email, date, yes/no, long text; ranking / matrix / NPS / picture only when asked.
Alternatives:
- Import AI SDK into the published engine. Rejected — blows the bundle budget and exposes the key path.
- Limit to BUILD_BRIEF §5 (11 types). Superseded — the editor already ships url, date, file_upload, dropdown, yes_no, nps, etc.
- Stream tokens. Deferred — stagger-reveal the landed object in the modal.
- Create the form as soon as generate returns. Rejected — Undo existed only to undo that auto-create.
Consequences: `ANTHROPIC_API_KEY` is server-only (Vercel + `.env.local`). `npm run dev` proxies `/api/generate` through a Vite middleware so localhost works without `vercel dev`; production/preview still use the Vercel function. Engine `npm run build` size is unchanged. Closing the review modal discards the draft (nothing saved).
Revisit when: streaming schemas or per-user auth on the generate endpoint.

## ADR-040 — Admin chrome UI sounds
Date: 2026-09-20
Status: accepted
Context: Respondent forms already have opt-in step sounds (ADR-023). Studio chrome felt quiet — important actions (new form, AI, publish, confirm/delete, copy, sign-out) needed short feedback without shipping audio assets.
Decision: (1) `examples/_admin/uiSounds.ts` with synthesized Web Audio cues (`tap`, `create`, `ai`, `confirm`, `danger`, `success`, `open`, `copy`). Document-level `pointerdown` (capture) maps important buttons by class / label / `data-slate-sound`, including portaled dialogs. (2) Sign-out plays letter-fall from `useSignOutFlow` (timed with dissolve); sign-in plays letter-rise when session goes null→signed-in after hydrate. (3) Boot splash plays **Open resolve** (Legend-adjacent whoosh + sub + fifth) once per page load; retries on first gesture if AudioContext was locked. (4) Settings → Studio sounds On/Off persists `slate-admin-ui-sounds` (`0` = muted) and gates all of the above. Not part of the published engine package.
Alternatives:
- Per-button `onClick` calls only. Rejected — easy to miss portals and new CTAs.
- Reuse `schema.sound` presets. Rejected — those are respondent-facing and opt-in per form.
Consequences: Studio feels more tactile. First click still unlocks AudioContext. Compact primary tabs stay silent. Mute is studio-only (form step sounds unchanged).
Revisit when: distinct per-route themes, or a volume slider.

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
- ~~**Visual form builder UI**~~ — Slate is now a supported internal dev tool (ADR-018). A *client-facing* builder remains deferred.
- **Multi-tenant form storage backend** — out of package scope.
- **Client-facing admin dashboard** — out of package scope.

---

## Breaking-change protocol

See [`MIGRATION_NOTES.md`](./MIGRATION_NOTES.md).
