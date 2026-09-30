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
Addendum (ADR-058): superseded numbers and order. Submits now charge IP + form owner (2,000 × 4 KiB units / h) and IP (10,000 / h) in one all-or-nothing statement, after the form lookup.

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
Addendum (ADR-058): (5) is replaced. Public signs are charged by declared size (256 KiB units) to IP + form owner (8,192 / h) and IP (40,960 / h), after the form lookup; draft uploads to the account and the IP.

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
Consequences: `ANTHROPIC_API_KEY` is server-only (Vercel + `.env.local`). `npm run dev` proxies `/api/generate` through a Vite middleware so localhost works without `vercel dev`; production/preview still use the Vercel function. Engine `npm run build` size is unchanged. Closing the review modal discards the draft (nothing saved). A dropped PDF is read on the server (`unpdf`, API-only) and turned into the generate prompt. Word and Pages are later. The review step is unchanged. AI drafts are capped at 24 questions (short prompts still aim for 3–8). The engine itself has no question limit.
Revisit when: streaming schemas, per-user auth on the generate endpoint, or Word/image uploads.

## ADR-040 — Admin chrome UI sounds
Date: 2026-09-20
Status: accepted
Context: Respondent forms already have opt-in step sounds (ADR-023). Studio chrome felt quiet — important actions (new form, AI, publish, confirm/delete, copy, sign-out) needed short feedback without shipping audio assets.
Decision: (1) `examples/_admin/uiSounds.ts` with synthesized Web Audio cues (`tap`, `create`, `ai`, `confirm`, `danger`, `success`, `open`, `copy`, `refresh`, `drop`). Document-level `pointerdown` (capture) maps important buttons by class / label / `data-slate-sound`, including portaled dialogs. Restore / refresh labels map to `refresh`. Soft Neon pulls on tab-return also play `refresh`. (2) Sign-out plays letter-fall from `useSignOutFlow` (timed with dissolve); sign-in plays letter-rise when session goes null→signed-in after hydrate. (3) Boot splash plays **Open resolve** (Legend-adjacent whoosh + sub + fifth) once per page load; retries on first gesture if AudioContext was locked. (4) Settings → Studio sounds On/Off persists `slate-admin-ui-sounds` (`0` = muted) and gates all of the above. Not part of the published engine package.
Alternatives:
- Per-button `onClick` calls only. Rejected — easy to miss portals and new CTAs.
- Reuse `schema.sound` presets. Rejected — those are respondent-facing and opt-in per form.
Consequences: Studio feels more tactile. First click still unlocks AudioContext. Compact primary tabs stay silent. Mute is studio-only (form step sounds unchanged). Build with AI’s full-page PDF drop wash plays `drop` (glass taps timed to the assemble bars) once when the file is dropped, not while it is still hovering.
Revisit when: distinct per-route themes, or a volume slider.
Addendum (2026-09-27, ADR-060): a new `arrival` cue (two-note bell) plays when new responses are announced and for the first-response toast, in place of `refresh`. Mute gates it like every other cue.

## ADR-041 — Studio toast host + publish confidence
Date: 2026-09-20
Status: accepted
Context: Publish / save / CSV feedback was easy to miss (header mono text or silent). Authors editing a live form had no clear “public snapshot is behind” signal.
Decision: (1) Portaled `ToastProvider` in examples admin for success/error/info toasts (Web Audio cues via ADR-040). (2) `hasUnpublishedChanges()` compares `schema` vs `publishedSchema`. (3) Editor header shows Live / Draft / Unpublished changes + one-click Publish/Republish; Share panel primary action becomes Republish when stale. (4) Dashboard cards and Responses empty state surface the same status. (5) Editor shortcuts dialog via ⌘/ (⌘⇧S share, ⌘⇧P preview).
Alternatives:
- Only toast on publish. Rejected — status pills still needed at a glance.
- Auto-republish on every save. Rejected — authors often want to stage draft edits.
Consequences: Clearer live-vs-draft mental model. Toast stack is examples-only.
Revisit when: real-time collaborator presence or scheduled publish.
Addendum (2026-09-27, ADR-060): Publish/Republish now plays spinner → self-drawing check → bow-out, and the header pill flips Draft → Live on the check. The publish itself still runs on click. The "New response" toast now actually fires on cloud polls (it was swallowed by the subscription's silent ingest). Toasts gained `celebrate` (the one-time "First response!"), and `sound: 'none'` is silent.

## ADR-042 — Choice letter keys run A–Z
Date: 2026-09-21
Status: accepted
Context: Brief §10.3 stops choice shortcuts at F. A town checklist with 16 options showed letters on the first six and blank badges after that, so the rest looked like the list had ended.
Decision: `CHOICE_LETTERS` is A–Z. Single choice, multi choice, and picture choice show a badge and accept that key for every option through Z. Yes/no and legal still only honor their own keys. Options past 26 stay click-only.
Alternatives:
- Keep A–F and rely on clicks. Rejected — the blank badges read as a cutoff.
- Double letters (AA, AB) past Z. Rejected — one keypress is the whole shortcut.
Consequences: A long checklist can be answered from the keyboard. G–Z no longer pass through on those screens.
Revisit when: a question type needs more than 26 keyed options.

## ADR-043 — Public-fill password lock + fixed numeric slugs
Date: 2026-09-21
Status: accepted
Context: Some forms go on a flyer but are meant for one crew or one event. Authors want "only people I gave the word to," without a second link, a new question type, or reprinting the QR. Separately, slugs were the slugified form name and followed renames, so renaming a published form silently broke its printed QR.
Decision:
(1) **Lock is a Share setting on the same URL.** `forms.fill_password_hash` (bcrypt via pgcrypto `crypt` / `gen_salt('bf', 8)`) plus generated `forms.fill_locked`. Off by default, 4–72 characters. Migration `012_fill_password.sql`.
(2) **Only one door writes the hash.** `set_form_fill_password(p_form_id, p_password)` is SECURITY DEFINER, checks `auth_uid() = owner_id`, and clears on empty string. A BEFORE INSERT/UPDATE trigger pins the column for the Data API roles (`authenticated`, `anonymous`), so an upsert can never set, change, or clear it. Editor saves, publish, unpublish, trash, and restore don't touch it.
(3) **The hash never reaches a browser.** Owner hydrate selects `FORM_OWNER_COLUMNS` (no `*`); `FormRecord` has `fillLocked?: boolean` only. `get_form_by_slug` now returns `{ id, name, slug, locked, schema }` with `schema = null` when locked.
(4) **Unlock rides the existing submit Function.** `VITE_SUBMIT_URL` is one endpoint, so the body is discriminated: `{ op: 'unlock', slug, password | token }` vs. the existing `{ formId, answers, meta }`. Success returns the schema plus `unlockToken = hex(hmac_sha256(data = form_id, key = fill_password_hash))`. The page keeps the token in `sessionStorage` under `slate-fill-unlock:{formId}` — per tab, never the password — and re-proves with it on reload. Changing or removing the password changes the hash, which voids every old token.
(5) **Everything behind the gate checks the token.** Submit and `storage-sign` `public/` uploads require a timing-safe-valid `unlockToken` when a hash is set (401 otherwise). A Bearer does not substitute on `public/` uploads.
(6) **Rate limits, fail closed.** Every unlock attempt (right, wrong, or token) consumes `consume_submit_rate`: 40 / 10 min per IP+slug and 80 / hour per IP (env-tunable `UNLOCK_RATE_*`). A conference NAT fits; a 4-digit PIN spray does not. Rate-table errors return 503.
(7) **Respondent gate, not an admin error.** `FillGate` shows the form name, one password field, Continue. The public error state no longer offers "Back to dashboard."
(8) **Share panel:** one fixed-height row between the link card and the QR — switch when off, field + Set while editing, `Locked · Change / Remove` when on. Cloud only; hidden in `VITE_ADMIN_OFFLINE` mode because nothing could enforce it.
(9) **Slugs are fixed at create.** New forms get a random 8-digit numeric slug (`allocateNumericSlug`), redrawn until unique among the owner's active forms, and redrawn again if the global unique index rejects the insert. Rename no longer touches the slug; a patch can't replace an existing slug. Existing word slugs are untouched, so links already in the wild keep working. Duplicate creates a fresh row: new slug, no password.
Alternatives:
- Password as a first question. Rejected — schema would already be on the device; submit and uploads stay open.
- Separate locked slug or password in the QR URL. Rejected — reprints flyers, or prints the secret on them.
- `/unlock` subpath on the Function. Rejected — not guaranteed to route on a single-URL Neon Function.
- Column-level `REVOKE SELECT` on the hash. Deferred — it breaks any cached SPA bundle still doing `select('*')`. Today an owner could read their *own* bcrypt hash through the Data API with a hand-written query; RLS keeps everyone else out.
- Random signed/expiring token. Deferred — the HMAC needs no new table or secret and already dies with the password.
Consequences: Turning the lock on, off, or changing the word never changes the URL or QR. Respondents type it once per tab. A respondent mid-fill when the password changes gets a clear "password changed, reload" on submit. Backup restore re-creates rows, so restored forms come back unlocked. The SPA tolerates a database without 012 (falls back to the column list without `fill_locked`; unlocked rows still open), so deploy order is forgiving — but the lock row will error until 012 is applied and the Data API schema cache is refreshed.
Revisit when: per-respondent codes, expiring access, or the custom-slug / custom-domain feature lands.
Addendum (ADR-058): (1) new or changed passwords need 6–72 characters, NFC-normalized. (6) is replaced: only misses are counted, through `try_fill_password`; token reloads and unknown slugs are free, and errors read as a wrong password.
Addendum (ADR-061): (3) the public lookup is now `GET ?op=form` on `submitresponse` and returns the published title (`forms.published_name`), not the live name, for every form. Unlock's slug lookup charges unknown slugs to the same per-IP miss budget; an IP over budget gets a 429.

## ADR-044 — Clean pathname routes; public link is `/forms/{slug}`
Date: 2026-09-22
Status: accepted
Context: The studio used a hash router (`#/…`) from its static-file days. Public links read `https://…/#/f/95389890`, which looks broken on a flyer and wastes QR density. Vercel already rewrites every path to `index.html`, and Vite does the same in dev, so the hash no longer buys anything. Solo-dev stage, no external users — no compatibility constraints.
Decision: (1) `_router.ts` reads `location.pathname`, navigates with `history.pushState`, and listens to `popstate`. (2) Public fill is the bare `/forms/{slug}`; admin verbs hang off the same prefix — `/forms/:id/edit`, `/forms/:id/preview` (was `/forms/:id`), `/forms/:id/submissions`. Later features get their own verb without touching the public shape. (3) Portable respond is `/r?d=…`; sign-in code links are `/?otp=…`. (4) Old `#/path?query` URLs are upgraded in place on load and on hash-only changes (four lines — not a commitment). (5) Share shows the link without `https://`; Copy, Open, and the QR still carry the full URL. (6) The editor header no longer relabels Publish to "Share link" once live and current — it hides, leaving one Share button.
Alternatives:
- Keep `/f/{slug}`. Rejected — `/forms/12345678` reads better and 8 digits is already short enough for a chunky QR.
- Separate `/studio/…` prefix for admin. Rejected for now — more churn than it earns while there is one app.
Consequences: Anchors are full-page loads (there are two). `vercel.json` rewrites are now load-bearing for every route, not only the root. Playwright smoke and `authEmailHtml` tests updated. Word slugs on older forms keep working at `/forms/{word}`.
Revisit when: custom domains per customer, or a second app shares the origin.

## ADR-045 — Studio chrome: notifications, size, refresh splash, seed
Date: 2026-09-22
Status: accepted
Context: Notifications were three-line cards with invisible read state; the studio had no text-size control; refresh gave no feedback; there was no way to fill a dev database with realistic data.
Decision: Flat single-line notification rows with a red unread dot, relative ages, thin scrollbar. Settings → Studio size: three steps (1× / 1.1× / 1.2×) applied with `zoom` on studio roots via `body[data-slate-scale]`; public fill never scales. Refresh shows the boot splash (min 1.4 s). `npm run seed` / `--clean` fills forms + responses under one owner, tagged by id prefix.
Consequences: Studio-only. Respondents see nothing different.

## ADR-046 — Hardening for real users (audit 2026-09-22)
Date: 2026-09-22
Status: accepted
Context: Four-way audit (DB/RLS, Functions + API, client, performance) against the 1000-users-tomorrow bar. Findings were verified against the live project, not just read from code.
Decision, in blast-radius order:
1. **storage-sign verifies JWT signatures.** It had decoded `sub` without checking the signature — a three-part string with any `sub` was an owner. Now EdDSA-verified against the Neon Auth JWKS (`authJwt.ts`), `exp` required, `iss` checked, anonymous tokens rejected, unknown `kid` refetches once. "Not yours" and "does not exist" both return 404. Read ops are rate-limited before the owner check.
2. **Uploads can't smuggle HTML.** Stored `Content-Type` is allow-listed (images, pdf, text, office, audio, video) or becomes `application/octet-stream`; the type is part of the presigned PUT signature; `content` and `download` serve as `attachment` with `nosniff`. The studio only frames blobs whose *served* type is `application/pdf` — never by filename. (A "pdf" that was HTML executed on the studio origin as the owner.)
3. **Rate limits key on the rightmost `X-Forwarded-For`.** The leftmost entry is client-typed; a probe with a spoofed first entry passed 45/45 before, 40 then 429 after. Neon's edge appends the real peer last.
4. **submit-response validates.** 256 KB body cap (413), answers filtered to the published schema's question ids, strings clamped to 10 KB, meta bounded, generic error text, Resend call bounded to 2.5 s. Unlock returns the same 401 for wrong password and unknown slug.
5. **`/api/generate` requires a signed-in user** (same JWKS check, copy in `api/authJwt.ts`), rate-limited per user then per IP. The Vite dev middleware marks its own requests (`x-slate-dev`) so local dev without Neon still works; Vercel never sets it.
6. **Migration 013:** RLS on + forced for `submit_rate_buckets` (any signed-in user could read respondent IPs per form and reset every limit); default privileges that auto-granted `authenticated` on every future table/function removed; team-allowlist RPCs revoked; RLS forced everywhere with explicit owner-role policies; rate buckets pruned opportunistically; `(form_id, received_at desc)` index; stale OTP rows swept hourly by the auth-email Function.
7. **Client:** engine redirect only to http(s) (`javascript:` in a portable link ran on our origin); portable schemas sanitized (https-only images, no logo, text caps); CSV cells starting with `= + - @` defused; field `::selection` restored.
8. **Headers (`vercel.json`):** CSP with `script-src 'self'` and no inline scripts, `frame-ancestors 'none'`, `nosniff`, HSTS, immutable `/assets`, `no-cache` index. Tested by serving the production build with the exact headers.
9. **Perf quick wins:** preconnect to the Neon auth + Data API hosts; `vite:preloadError` reloads once after a redeploy; inbox polls at 60 s ± 20 % and stops refetching the quota on every tick.
Not done (needs a product answer or more time): per-owner notification email (every response still mails `PSW_NOTIFY_EMAIL`); studio bundle served to respondents (1.02 MB raw) — needs route-level `lazy()`; submissions fetched unbounded on boot — needs projection + limit; autosave debounce; dashboard memoization; Functions run as the table owner — needs a least-privilege role; 4-character PIN minimum; per-owner slugs are globally unique (a squatting/enumeration oracle); portable links have no "not verified by Slate" interstitial; session refresh appears to lapse after ~1 h.
Consequences: Owners must be signed in for Build with AI. `storagesign` needs `NEON_AUTH_URL` (it can derive it from `DATABASE_URL` but the env is pinned on deploy). Uploads of unusual types are stored as octet-stream and downloaded rather than previewed.
Revisit when: custom domains (CSP `frame-ancestors`, cookies), per-respondent access codes, or a second app on the origin.
Addendum (ADR-058): item 1, read ops are now charged after a valid Bearer, to the account plus an IP backstop, never before. Item 4, the body cap is 64 KiB counted in bytes.
Addendum (ADR-061): the enumeration half of "per-owner slugs are globally unique (a squatting/enumeration oracle)" is closed by the throttled lookup; squatting was closed by ADR-057.

## ADR-047 — v1 responses live in the app only
Date: 2026-09-22
Status: accepted
Context: `submitresponse` emailed every response — respondent names, emails, free text — to one address (`PSW_NOTIFY_EMAIL`, default hello@palmstreetweb.com) regardless of who owned the form. With more than one owner that is an undisclosed disclosure of other people's respondents, an inbox flood, and a third-party call on the hot path of every submit.
Decision: No email on submit. Responses are visible only in the studio: the bell badge, the notifications inbox (60 s poll, toast on arrival), the Responses page, and CSV export. `RESEND_API_KEY` is used by `authemail` only. The notify HTML builder is deleted rather than kept behind a flag.
Alternatives:
- Per-owner notification email with an opt-in setting. Deferred — it needs a verified address per owner, unsubscribe handling, and a sending reputation to protect. Worth doing when owners ask for it, not before.
- Keep the single-address email for PSW's own forms only. Rejected — one code path that leaks under the wrong env value is not worth the convenience.
Consequences: An owner learns about a response when they open Slate. Submit no longer waits on Resend. The thanks-screen chip now reads “response received” instead of the prototype's “confirmation sent” — nothing is sent, and the engine shouldn't promise it on a host's behalf. `PSW_NOTIFY_EMAIL` and `PUBLIC_FORM_BASE` are no longer read by any Function; remove them from the deployed env.
Revisit when: owners ask for email or push, or a daily digest.

## ADR-048 — Respondent bundle split + SDK-free form fetch
Date: 2026-09-23
Status: accepted
Context: A QR scan on `/forms/{slug}` downloaded the entire studio (1.02 MB raw / 267 KB gzip JS, 25 KB gzip CSS) and made three serial cross-origin calls before the welcome screen: Neon Auth `get-session` (measured 0.6–2 s), an anonymous token, then `get_form_by_slug`.
Decision: (1) `examples/main.tsx` is a tiny entry that reads the route and dynamically imports `publicApp.tsx` (fill + portable respond) or `studioApp.tsx` (everything else, incl. dev `dropLab`). (2) For `/forms/{slug}` the entry starts the form fetch immediately, before either bundle downloads; PublicFill awaits the same memoized promise (`neon/publicForm.ts`). (3) That fetch is two plain requests — anonymous token, then the RPC — with no Neon SDK and no session call; the token is cached per tab until 60 s before expiry and refetched once on a 401. (4) SDK-free config moved to `neon/config.ts`; `env.ts` re-exports it and keeps `getNeon()`. Upload helpers load the SDK lazily. (5) The ~11 KB of CSS the respondent page needs moved from `_adminTheme.css` to `publicChrome.css`; the studio imports it right before `_adminTheme.css`, so cascade order is unchanged. Portable `/r` loads its page on demand.
Alternatives:
- Fetch the form through the submit Function in one hop. Rejected — it would put a per-network rate limit in front of merely viewing a form (100 people on one event Wi-Fi scanning the same QR), and measured no faster than two preconnected requests.
- Route-level `lazy()` inside one app. Rejected — `AuthProvider` and the SDK sit at the root, so respondents would still pay for them.
Consequences: Respondent JS 267 → 98 KB gzip; CSS 25 → 13 KB gzip; the token request starts ~17 ms after the HTML (tested on the production build with production headers). In-app navigation from a public route to a studio route does a full reload so the entry can pick the studio bundle. Two copies of nothing — rules were moved, not duplicated.
Revisit when: a second public surface (embeds, custom domains) needs its own entry.
Addendum (ADR-061): the rejected alternative is now the decision. The fetch is one `GET ?op=form&slug=` to `submitresponse` with no custom headers (no preflight, no token), and only distinct unknown slugs are charged, so viewing a form costs nothing while a network is under budget. index.html preconnects the Function host in place of the Data API host.

## ADR-049 — Responses load in slices, not all at once
Date: 2026-09-23
Status: accepted
Context: The studio fetched every submission the owner ever received — all answers and meta — on boot and again on every inbox poll. Fine at dozens of rows; at 50 forms × 500 responses it is ~25 MB per fetch per tab. Trash, restore, and empty-trash rewrote whole rows one request each.
Decision: `submissionsRemote.ts` keeps two layers. (1) A slim index of every response (`id, form_id, received_at, deleted_at`), fetched once per session in 1000-row pages; it drives counts, "last response", trash counts, and new-response detection, and is O(1) per dashboard card. (2) Full rows with answers: the 50 most recent on boot, anything new since, and all of one form's rows when its Responses page opens (`ensureFormSubmissions`). Polls ask only for rows at or after the newest seen (`gte`, dedup by id); a burst of 200+ reloads the index instead. Manual Refresh reloads the index so another device's trash/deletes appear. Trash, restore, and empty trash are single `update`/`delete` requests filtered by id or form, so answers are never rewritten. The Responses page shows "Loading…" until its form is complete, and Export CSV / Move all to trash wait for it. No migration.
Alternatives:
- A `submission_stats()` RPC for counts. Deferred — needs another SQL paste; the slim index is small enough (~100 bytes/row) and also gives the inbox its ids. Revisit past ~20k responses per owner.
- Paginate the Responses page. Deferred to the Responses redesign.
Consequences: Boot is two requests; polls are usually empty. Verified live against the production database: counts match, a form opens with one request, trash/restore round-trip with answers intact. Older responses appear in the notifications list as "New response" until their form is opened.
Revisit when: owners have tens of thousands of responses, or the Responses redesign lands.

## ADR-050 — Public uploads only for forms that ask for a file
Date: 2026-09-23
Status: accepted
Context: ADR-031 limited anonymous `public/` uploads to published, non-deleted forms, and ADR-043 added the unlock-token check. `storagesign` never looked at the form's questions. So any published form, including a plain contact form with no file field, lent out bucket space: 20 files per 10 minutes per IP and form, 60 per hour per IP, up to 32 MB each. Anyone who knew a form id could use it as free storage.
Decision: (1) A `public/` upload is signed only when the form's `published_schema.questions` holds at least one question with `type === 'file_upload'`. A missing or null schema, or `questions` that is not an array, counts as no file question. (2) `contentLength` must be at most the largest limit among the form's file questions. A question's limit is `maxSizeMb × 1 MiB` (the same bytes-per-MB as the client), raised to at least 1 MiB. It is `STORAGE_SIGN_MAX_BYTES` when `maxSizeMb` is unset or is not a positive finite number. The result is never above `STORAGE_SIGN_MAX_BYTES`. The sign request doesn't say which question it is for, so the largest limit applies. (3) The decision is a pure module, `storage-sign/uploadPolicy.ts`, and a NaN on either side of the size comparison refuses. (4) `published_schema` is added to the form query the public path already runs, so there is no extra round trip. Owner read requests don't fetch it. (5) The check runs after the unlock-token check, so a locked form's questions and limits stay behind the password. (6) No file question returns the same `404 Form not available` as a missing or unpublished form, which the client shows as "This form is not accepting uploads." Over the limit returns 413, shown as "That file is too large." (7) Rate limits, the signed Content-Type and Content-Length, the fail-closed 503s, and owner `draft/` uploads are unchanged. The sign response's `maxBytes` now reports the per-form limit.
Alternatives:
- Send `questionId` in the sign request and apply that question's own limit. Deferred: it changes the client and the request body, and gives little extra protection because the biggest limit on the form already bounds any one object.
- Do the check in SQL (`jsonb_path_exists` on `published_schema`). Rejected: it can't be unit-tested locally, and a malformed schema turns into a SQL error instead of a clean refusal.
- Enforce sub-megabyte `maxSizeMb` exactly. Rejected: the client re-encodes photos to JPEG after its size check, and the output can exceed a very small limit. The server would then refuse a file the page had accepted. The client still enforces the owner's exact limit.
- Also check `accept` (file types) on the server. Rejected for now: ADR-031 keeps `accept` as a hint in the file picker only.
Consequences: Forms without a file question can no longer be used for anonymous storage. A respondent whose page still has an older published version (a file question later removed, or its limit lowered) gets "This form is not accepting uploads." or "That file is too large." Their answer for that question would have been dropped on submit anyway. Needs a `storagesign` redeploy; no migration. A typo in `STORAGE_SIGN_MAX_BYTES` (NaN) now blocks every public upload with 413 instead of silently removing the size cap.
Revisit when: file questions get per-question server rules (types, counts), or the sign request carries a question id.
Addendum (integration): the public fill page now pins its upload scope to public/ (`setUploadContext(id, { scope: 'public' })`). Before, any browser signed into a Slate studio uploaded as draft/ and was refused on someone else's form; that bug predates this ADR but broke the same path.
Addendum (ADR-058): (7) rate limits changed. The gate no longer reads `published_schema`; the rate statement returns it after the charge. Refusals for no file question or over the limit are charged.

## ADR-051 — Build with AI daily spend cap lives in Postgres
Date: 2026-09-23
Status: accepted
Context: `/api/generate` checked the Neon Auth JWT and then called `takeRateLimit()`, an in-memory Map per Vercel instance (ADR-039, ADR-046). Cold starts and parallel instances reset it, so nothing durable limited how much one user, or everyone together, could spend on the Anthropic key. Sign-up is open (ADR-036).
Decision: (1) Migration 014 adds `ai_generation_usage` (owner_id, UTC day, count). RLS is enabled and forced, there are no Data API policies, all grants are revoked, and the owner-role policy matches 013. `ai_quota_limits()` returns 25 per user and 500 overall per day; change them there. (2) `consume_ai_generation()` is SECURITY DEFINER and keyed on `auth_uid()`. It serializes with one `pg_advisory_xact_lock`, adds 1 to the caller's row and the `'__global__'` row together only when both are under cap, and returns (allowed, used, per_user_daily, global_used). The first allowed call of each UTC day deletes rows older than 14 days. Execute is granted to `authenticated` only. (3) `/api/generate` calls it through the Neon Data API as the user, forwarding the caller's own bearer, with the URL derived from `VITE_NEON_URL` (`api/neonDataApi.ts`). It runs after the JWT check, the burst limiter and all input validation, and immediately before the model call, so a request that would 400 costs nothing. (4) Refused → 429: "You’ve used today’s Build with AI limit. It resets at midnight UTC." If the caller is under their own cap, the shared ceiling is what's full, and the message becomes "Build with AI has reached today’s limit. It resets at midnight UTC." Both carry `Retry-After` to UTC midnight. (5) Any RPC failure (no URL, network, 8 s timeout, 404 before 014 is applied, 403, 5xx, unexpected body) → 503 "Build with AI is temporarily unavailable." Fail closed. The token is never logged. (6) The Vite dev bypass (`x-slate-dev`, no `VERCEL`) skips the quota just as it skips the JWT. The in-memory per-user and per-IP limiter stays as a per-minute burst guard. (7) The client shows the server's `error` exactly as sent.
Alternatives:
- A direct Postgres connection from Vercel with an owner or service credential. Rejected: it puts a database secret in Vercel and a pool on a serverless path. Running as the user keeps `auth_uid()` authoritative and needs no new secret.
- Fail open when the quota check errors. Rejected: a missing migration or a Neon outage would quietly mean unlimited spend.
- Upstash/KV counters. Rejected: a new vendor and runtime dependency when Postgres is already on the path.
- Charge after a successful generation. Rejected: two round trips, and a crash between the model call and the charge would leave a free generation.
- One global lock vs. per-user locks plus a row lock on the global row. One lock is simpler, and at ≤500 calls a day it never queues.
Consequences: Every production generate now makes one extra Data API round trip (usually tens of ms; longer when the compute is waking up). 014 must be applied, and the schema cache refreshed, before the handler ships, or Build with AI returns 503. A generation that fails at Anthropic still uses up its unit. Signed-in users can call `consume_ai_generation` directly, but that only uses up their own allowance and never reaches Anthropic. With open sign-up, about 20 accounts can use up the 500 global allowance for a day: the global cap limits spend but does not guarantee fair access. The advisory lock key 87123002 is reserved next to 87123001 (form quota).
Revisit when: owners need visible "N left today" (the RPC already returns the counts), paid tiers need per-plan limits, or abuse from mass sign-ups shows up.
Addendum (review): only the server may spend. `consume_ai_generation(p_server_key)` requires a 64-hex key generated by migration 014 into an owner-only table (`ai_quota_key`) and held by Vercel as `AI_QUOTA_KEY`. Without it any signed-in user could call the RPC directly and ~20 throwaway accounts could exhaust the global ceiling for everyone. A missing/wrong key or a null `auth_uid()` now raises 42501, which /api/generate treats as a fail-closed 503 rather than 'limit reached'. Verified on a Neon branch: applies idempotently, rejects missing/wrong keys, `authenticated` cannot read the key or usage table, `anonymous` cannot execute.

## ADR-052 — Public fill honeypot is live
Date: 2026-09-23
Status: accepted
Context: `submitresponse` has dropped any submission whose `meta.hiddenFields._hp` is truthy since the Neon cutover. The check runs after the IP+form and IP rate limits and before any DB access. Nothing ever set `_hp`, so the check never fired. Rate limits (ADR-030) cap volume per network but don't stop a slow bot that fills every input on a published form, and those junk rows land in owners' Responses and quota.
Decision: PublicFill (`/forms/{slug}`) renders a trap input as a sibling of the engine, never inside it, with no engine changes. People never reach it: the container is `aria-hidden="true"`, the input is `tabindex=-1`, and a `.slate-fill-trap` class in publicChrome.css puts it at `top:-10000px`, 1x1 with overflow hidden. It is laid out rather than `display:none`, because bots skip non-rendered inputs. It sits off the top rather than the side, so it adds no scroll in LTR or RTL. Autofill and password managers stay out through `autocomplete=off`, `data-1p-ignore`, `data-lpignore`, `data-bwignore`, `data-form-type="other"` and a neutral name (`fill_note`). A "Leave this field empty" label covers the case where the CSS doesn't load. At submit the value is read from the DOM ref, which also catches `.value` assignment without events. If the trimmed value isn't empty, `_hp: '1'` goes into a copy of `hiddenFields`. The server answers `{id:'ignored'}` with a 200, so the respondent gets the same thanks screen and redirect and a bot learns nothing. PublicRespond (portable links, answers saved on the device only) gets no trap.
Alternatives:
- Put the trap inside the engine (a Form prop or a hidden question type). Rejected: it changes the public API and engine markup for something only one host needs.
- `display:none`, `visibility:hidden` or the `hidden` attribute. Rejected: headless bots commonly skip inputs that aren't rendered.
- `inert` on the container. Rejected: it blocks the programmatic focus that Puppeteer-style `type()` needs, which lets exactly those bots through.
- Reject on the client (skip the fetch). Rejected: it takes the bot out of server rate limiting and makes the behaviour differ in a way someone could detect.
- A time-to-complete check (submit under N seconds) or a CAPTCHA. Deferred: a timing check risks false positives on one-question forms, and a CAPTCHA adds friction that fails the 1000-user bar.
Consequences: Browser bots that fill every input are dropped silently after using up their rate-limit quota. Bots that POST straight to the Function skip the trap entirely; rate limits remain the defence there. A false positive would silently lose a real response. The layered defences above make that unlikely, but no metric tracks dropped submissions today.
Revisit when: owners report junk responses that get past both the rate limits and the trap, or we want a count of dropped submissions (for example a log line or a counter keyed by form).
Addendum (review): honeypot drops are logged by submitresponse (form id, answer-key count, duration — no answers, no IP) so an autofill false positive, the worst failure mode here, is visible in Function logs.
Addendum (ADR-058): the honeypot now runs before every rate limit and any DB access, costs nothing, and is logged at most once per 10 s per isolate with per-form counts.

## ADR-053 — Brand logo in the form chrome
Date: 2026-09-23
Status: accepted
Context: `BrandConfig.logo` has been in the Schema type since v1, and the brief's example uses `logo: '/logo.svg'`. `TopBar` only rendered `brand.name`, so logos never showed. Schemas reach the engine from hosts, from studio owners (open signup, ADR-036, so any account can write any string), and from portable links (already sanitized, ADR-046). So the engine itself has to decide what it will load.
Decision: (1) `safeLogoSrc()` (`src/utils/brandLogo.ts`) runs at render time. It allows absolute `https:` URLs without credentials; same-origin `/paths`, with the origin checked by the WHATWG parser so `//host`, `/\host` and tab/newline tricks are refused; and base64 `data:image/(png|jpeg|webp|gif)` up to 100k characters. Everything else is refused: `javascript:`, `data:image/svg+xml`, `http:`, `blob:`, bare relative paths. (2) `TopBar` renders `<img alt={brand name} loading="eager" decoding="async" referrerPolicy="no-referrer">` left of the name. The name stays visible but is `aria-hidden` while the logo shows, so it is announced once. On a load error the chrome falls back to the plain text brand. The failed src is remembered, so a new URL (a live studio edit) gets a fresh attempt. (3) The logo is a fixed `height: 24px` with width from its aspect ratio, `max-width: min(160px, 40vw)` and `object-fit: contain`. With `max-height` alone, a viewBox-only SVG counted as 0px wide when the brand was sized, and the name wrapped under it. (4) Studio Settings gets a "Logo URL" field. Blank removes the key. The hint uses the same check and warns when the engine would refuse the URL. (5) Portable links keep stripping `brand.logo` (ADR-046).
Alternatives:
- An opt-in flag to hide the text name when a logo is set. Deferred; logo + name covers the common case and adds no public API.
- Upload-to-storage for logos. Deferred; it needs the signed-upload path and a size policy. A URL field is enough for v1.
- `alt=""` (decorative) because the name is adjacent. Rejected; with an empty or failed name the logo would have no accessible name. Alt + aria-hidden text gives one announcement either way.
- Allowing `http:`. Rejected; mixed content is blocked or upgraded on the https respondent page anyway.
Consequences: Respondents' browsers request the logo from the owner's chosen host. This is the same exposure as picture-choice images; `no-referrer` keeps the form URL out of it. vercel.json `img-src 'self' data: blob: https:` already allows it. Oversized data URLs are refused rather than rendered, but they still ride along in the stored schema. Studio edits request each intermediate URL while typing.
Revisit when: owners want logo uploads, a logo-only chrome, or per-theme logo variants (light/dark).
Addendum (review): with a logo, the brand name truncates with an ellipsis instead of overflowing into the back button at phone widths; the editor's blank-clears-logo rule lives in `withBrandLogo()` with tests.

## ADR-054 — Public forms can be embedded (iframe)
Date: 2026-09-23
Status: proposed — awaiting owner confirmation (BUILD_BRIEF §14 lists iframe embed as deferred)
Context: Owners want the public form on their own sites. vercel.json sent `frame-ancestors 'none'` and `X-Frame-Options: DENY` on every path, so the form could not be framed. Vercel applies every header rule whose source matches, so relying on rule order to override a header is not possible. BUILD_BRIEF §14 and the "Deferred to V2" list mark "Embed via iframe / HTML script tag" as out of scope for v1. That item is about the npm package (React-only). This ADR covers only the hosted public page and leaves the package React-only.
Decision: (1) Framing comes from two header rules that never both match the same path. `/((?!forms/(?!new$)[^/]+$).*)` keeps the CSP with `frame-ancestors 'none'` plus `X-Frame-Options: DENY`. `/forms/((?!new$)[^/]+)` is the public fill link: exactly one segment after /forms/, and not /forms/new. It sends the same CSP with `frame-ancestors *` and no X-Frame-Options. nosniff, Referrer-Policy, Permissions-Policy and HSTS stay on `/(.*)`. Both sources use unnamed groups, so Vercel never substitutes path params into the CSP value. A trailing slash or odd casing still opens the form in the router but is refused a frame (fails closed). `tests/vercelHeaders.test.ts` compiles every source the way Vercel does (a port of path-to-regexp 6.x with strict, sensitive and delimiter '/') and checks the effective headers per path, including that any framable path is one the router opens as the public form. (2) `?embed=1` on the public page hides the form-name footer and adds `.slate-embed`, which makes the frame's own html/body background transparent. When the page is framed it posts `{ type: 'slate:height', height }` to `window.parent` with target '*' from a ResizeObserver, only when the height changes. It never reads from or listens to the parent. The page fills the frame (min-height 100vh), so the reported height grows to the tallest step seen and does not shrink between steps. The host page doesn't jump under the respondent's finger, and there is no resize feedback loop. (3) The Share panel gets an "Embed" text button in the existing actions row. It copies `<iframe src="{publicUrl}?embed=1" title="{escaped name}" style="width:100%;min-height:560px;border:0" loading="lazy"></iframe>`, and only for published cloud forms.
Alternatives: A script-tag loader that injects and auto-sizes the iframe. Deferred: it is a second public surface with its own caching and versioning, and the plain iframe works without any script. Allow-listing host origins per form in frame-ancestors. Deferred: it needs a per-form setting and a dynamic header, and Vercel static headers can't do that; the public form is already open to anyone with the link. Shrinking the frame to the natural content height. Rejected: the form fills its viewport by design, and a frame that shrinks and grows on every step moves the host page.
Consequences: Any site can frame /forms/{slug}. Clickjacking risk is limited to anonymous form fill and the per-form password screen; owner and studio routes stay DENY. Printed QR and flyer URLs are unchanged, and `?embed=1` is only added on. The anonymous token fetch already uses `credentials: 'omit'`, so blocked third-party cookies don't matter, and all storage access is already in try/catch. An ending redirect set on a form navigates the iframe, not the host page. Hosts that auto-size should keep a min-height (the snippet sets 560px).
Revisit when: owners need per-domain allow-lists, a script-tag loader, custom domains, or redirects that must leave the frame.
Addendum (review): the snippet does not request camera access — nothing in the public bundle uses it, and plain file pickers don't need it.

## ADR-055 — Responses: Inbox + Summary views
Date: 2026-09-23
Status: accepted
Context: The Responses page was a flat list of expandable cards plus a separate Summary tab. Owners who check in often want to work through new responses one at a time; owners who check in rarely want the pattern first (how many, what people asked for, where they found you) and then the people behind a number. The owner picked two of ten gallery prototypes — "01 Inbox split view" and "09 Summary first" — and asked for both behind a toggle. Read state already existed, but only inside the notifications bell (`shell/StudioInbox.tsx`), so a response opened on the page stayed "new" in the bell.
Decision: (1) One page shell (`pages/FormSubmissions.tsx`) keeps loading (ADR-049), refresh, Share, CSV export and every write, and hosts two views under `examples/_admin/responses/` against shared prop contracts (`types.ts`): `ResponsesInbox` (list + reader, keyboard j/k/u//, grouped by day) and `ResponsesSummary` (KPI tiles, one bar chart per choice/scale question, filterable table). Pure helpers (names, strict email check, day groups, distributions, KPIs, search) live in `responses/model.ts` with tests. (2) A segmented Inbox / Summary toggle in the page toolbar, persisted per browser in `slate-responses-view` (default Inbox; storage wrapped in try/catch). (3) Trash is a mode of the Inbox view (Restore / Delete forever / Restore all / Empty trash), not a third view, and is not persisted. Moving one response to trash happens at once with an Undo toast (toasts gained an optional action); deleting forever, emptying trash, restoring all and moving all to trash keep their confirm dialogs. (4) `responses/unreadStore.ts` is the one per-browser read store for the bell and the page, on the existing keys `slate-admin-known-subs` / `slate-admin-unread-subs` (caps 2000 / 200); same-tab listeners plus the `storage` event keep every tab live. Opening a response marks it read; trashing one clears its unread flag and Undo restores it. Both views treat read state the same way: Mark unread / Mark read flips the open response and leaves it open, and Mark all read is one write with an Undo toast. (5) Reply is a `mailto:` built only from an address that passes a strict allow-list, with an encoded "Re: {form name}" subject; respondent text is rendered as React text only. (6) No new dependencies — bars and sparklines are plain CSS; colors come only from the studio chrome tokens, so all six palette/mode combinations work. (7) The phone layout switches below 720 CSS px of page width, scaled by the studio size setting (ADR-045), and the page's header actions move into the toolbar's ⋯ menu there so the header fits at 320px; the fill-height Inbox divides `100dvh` by the studio zoom. Above phone width the header trail is fitted to the room the studio header leaves (it is measured, since cloud mode adds Sign out): "Forms / {form} / Responses", then the form name alone, then no trail with the form name under the page title.
Alternatives:
- Ship only one of the two views. Rejected: the owner explicitly wants both, and they serve different visit patterns.
- Store read state in Neon per owner. Deferred: it needs a table, an endpoint and a write per open, which is more than v1 needs for one owner per account.
- Trash as a third toggle option. Rejected: it is somewhere you go occasionally, not a way of looking at responses; as a mode it can reuse the Inbox layout.
- A chart library. Rejected: two bar shapes don't justify the bundle weight or a new dependency.
Consequences: Read / unread is per browser. Opening a response on a laptop does not clear it on a phone, and clearing site data makes everything "not new" again (the bell re-seeds silently on first run). The unread list is capped at 200 ids across all forms, so very old unread items drop off. The Responses page styles the studio header through `:has(.slate-rsp)` so crumbs truncate and phone gutters tighten on this page only; the rest of the studio header is unchanged. On a 320–360px phone at the larger studio sizes the header drops Refresh on this page (it already pulls new responses on open and on tab focus), so the brand, bell, Sign out and theme toggle still fit.
Revisit when: read state should sync across devices or team members (move it to Neon), owners need saved filters or views beyond these two, or the studio gets a shared phone header (then drop the page-scoped header rules).
Addendum (2026-09-27, ADR-060): Summary KPIs count up, the sparkline draws on and bars grow from zero by `scaleX` when their card first scrolls into view; rows that arrive while the page is open wash in with the accent. Point 6's "no new dependencies" still holds.

## ADR-056 — Security audit fixes, first pass
Date: 2026-09-23
Status: accepted
Context: The 2026-09-23 audit found no cross-tenant breach or secret leak, but two highs (H1: one anonymous submission white-screens an owner's studio; H2: no durable Build with AI spend cap in production) and a set of mediums. Fixing them also surfaced that the ADR-046 issuer pin rejected every signed-in user, because Neon Auth stamps user JWTs with the bare auth origin and anonymous JWTs with `…/neondb/auth`.

Decision:
- **JWT issuer:** accept both forms, still pinned to this project's auth host (`api/authJwt.ts`, storage-sign copy).
- **Untrusted answers (H1):** the submit Function clamps every answer to `string | number | boolean | string[] | Record<string, string | string[]>` and drops prototype-shadowing keys; the studio normalizes every row again in `rowToSubmission` (`examples/_admin/answerShape.ts`); `formatAnswerForQuestion` is total; `ErrorBoundary` wraps the bell, the page body and the studio root.
- **AI cost (H2, M-AI-1, M-AI-2):** migration 014 applied; the typed prompt is capped at 2,000 chars even with a PDF; a PDF sent with a revision is ignored; the daily unit is charged before PDF parsing; PDFs over 30 pages are refused; `maxOutputTokens` 16,000 and one SDK retry; `/api/generate` gets `maxDuration: 180` and its own 165 s deadline so a slow draft is a clear message, not a Vercel 504.
- **Embed clickjacking (M-FRAME-1):** `/#/…` links upgrade to paths only at `/`, and the studio never mounts when `window.self !== window.top` (it shows an open-in-new-tab link instead).
- **Neon Auth config:** email + password off (closes the password-reset OTP path, M-AUTH-1), organization plugin off, wildcard localhost off (exact `localhost:5173` / `127.0.0.1:5173` stay trusted).

Alternatives:
- Validate answers per question type server-side. Deferred: a shape check closes the crash with no risk of dropping real answers when a question type changes; per-type checks can come with file-ref validation (M-DB-3).
- Raise the Anthropic output cap instead of adding a deadline. Rejected: without a deadline a long PDF still ends in a raw 504.

Consequences: Answers with nested objects are dropped at submit and hidden on load. Build with AI can run up to ~3 minutes per call (Vercel function time). Local studio sign-in only works on port 5173. The remaining audit items are tracked in the fix plan (steps 6–14).

Revisit when: a question type needs a nested answer shape, or Neon Auth changes its issuer format.

## ADR-057 — Form links are fixed for life (slug lock)
Date: 2026-09-24
Status: accepted
Context: Audit M-SLUG-1, reproduced on a throwaway branch. Slugs were unique only among live forms (`forms_slug_active_uidx … where deleted_at is null`), and `authenticated` could update the column. Once an owner trashed a form, any signed-in account could PATCH its own form's slug to the freed value: every scan of the printed QR then opened the attacker's form, and the owner's Restore failed on the clash. The column also had no contract (audit lows slug-no-contract, slug-new-collision): 5,000-character slugs, markup, look-alike Unicode, and `new`, which the router sends to the studio editor. ADR-043 fixed slugs at create, but only the studio honored it.

Decision (migration `015_slug_lock.sql`, database only):
- **Fixed on update:** `forms_slug_lock` keeps `old.slug` on every UPDATE, silently, like `owner_id`. A stale studio upsert that re-sends an older draw still saves.
- **Unique across trash:** `forms_slug_uidx` covers every row, so a trashed form keeps its link and Restore always works.
- **Retired on permanent delete:** a BEFORE DELETE trigger records the slug and its owner in `retired_slugs` (RLS forced, no Data API grants). A new row with a retired slug is refused with `23505 slug is retired` unless it belongs to the same account (restoring its own backup). Insert and delete take the same per-slug advisory lock, so an insert racing a delete either meets the live row or waits and meets the retired one.
- **Shape:** every row must match `^[a-z0-9]+(-[a-z0-9]+)*$`, 64 characters at most, never `new` (`forms_slug_format`). New rows must use the 8-digit slug the studio draws. An upsert that re-sends a row's own stored slug is not new, so older word slugs keep working.
- **Existing data:** three slugs were shared by one owner's "Untitled form" drafts (a live copy plus trashed ones). The live row (else the newest) kept each slug; the four other trashed copies got fresh 8-digit slugs, with `updated_at` untouched. No served link changed.
- **Studio:** `insertForm` treats a slug-related `23505` or `23514` as "draw again".

Alternatives:
- Raise on a slug change instead of keeping the old value. Rejected: an upsert queued before a redraw re-sends the first draw and would fail the save.
- Revoke UPDATE on `forms.slug` from `authenticated`. Rejected: PostgREST upserts set every payload column, so every studio save would fail.
- Retire only the slugs of forms that were ever published. Rejected: unpublish keeps no history, so a printed link could slip through.
- Free retired slugs after a grace period. Rejected: printed flyers stay up for years.

Consequences: Another account can never reuse a slug. Each permanent delete adds one small `retired_slugs` row (the 8-digit space holds 90M). An operator who must move a slug does it in one transaction with `forms_slug_lock` disabled. Any new `/forms/<word>` route must first check that no existing word slug uses that word. Verified by 49 SQL checks on a throwaway branch (the attack before and after, stale upsert, restore, retire and reclaim, 12 malformed slugs, grants, the delete/insert race) and by `tests/slugLock.test.ts`.

Revisit when: owners can pick custom links (needs a reserved-word and ownership policy), or permanent delete gets an undo.

## ADR-058 — Crowd-scale rate limits
Date: 2026-09-26
Status: accepted (2026-09-26)
Context: Audit M-RL-1 and M-RL-2, plus pin-bruteforce, file-fanout-dos, jwks-refetch and body-unbounded. The IP was the only identity, and the order was wrong for a crowd. `submitresponse` charged IP+form (10 / 10 min) and then IP (30 / h) before it looked the form up, so 30 junk ids from anyone inside a venue's NAT closed every form for about an hour, and 300 people on one Wi-Fi needed about 10 hours to get their responses in. Unlock charged every attempt (right, wrong or a tab reload) at 40 per IP+slug per 10 min. `storagesign` gave a crowd 20 files per 10 min per form, and every owner read shared the venue's 120 reads per 10 min with every respondent's meta call. `consume_submit_rate` wrote a row on every call, denials included, one round trip per bucket, and a later bucket's denial left earlier ones charged. Keys were built from unchecked input, and the prune was random and unbounded.
Decision:
(a) **Order.** Shape checks first (0 statements), then the honeypot (0 statements), then the form lookup and lock (1 small read that never selects `published_schema`), then ONE rate statement. The schema is read in that same statement, and only when the charge went through. This deliberately reverses the audit's "per-IP first": a per-IP charge before the lookup is the lever that let junk ids lock a network out. A missing, unpublished, schema-less or locked-without-token form costs one read and writes nothing.
(b) **All or nothing.** Migration `016_crowd_rate_limits.sql` adds `consume_submit_rates(keys[], windows[], maxes[], costs[])`. It checks every bucket read-only and reports the one that blocks longest; a denial writes nothing (the 014 rule). Otherwise it charges every bucket in one global key order, and an exception block undoes the whole call if a concurrent caller filled a bucket in between. Then it prunes at most 20 rows older than 25 h with SKIP LOCKED. Keys over 256 bytes, max < 1 and cost outside 1..max are denied without a write; bad array shapes and windows outside 1..86,400 s raise 22023 (the Functions answer 503). `consume_submit_rate` stays as a one-line wrapper with the same signature and one-row result, for `authemail` and for rollback.
(c) **IP + form owner keys, with a 5x whole-IP backstop.** A signed-up abuser flooding their own form at a venue closes only their own forms to that network.
(d) **Size charging.** Submits: 1 unit per 4 KiB of body (min 1), body cap 64 KiB counted in bytes, chunked bodies included (`hono/body-limit`, already in hono 4.13.7). Uploads: 1 unit per 256 KiB of declared `contentLength` (a safe integer; 1e20 is a 400).
(e) **Honeypot ahead of every limit, free.** Logged at most once per 10 s per isolate with per-form counts.
(f) **Unlock counts misses, not attempts.** One SECURITY DEFINER call, `try_fill_password`, reads the miss ceilings, charges a CPU guard on every attempt, runs bcrypt on the NFC-normalized password and counts the result, all in one transaction. A network with fewer than 3 misses on the form ("fresh"), or with a success there this hour ("proven"), skips the per-IP and per-form miss ceilings; a proven network's own misses are capped at the per-IP budget. Keys carry the password version (the bcrypt salt), so a new password starts fresh buckets. Any error from that call answers exactly like a wrong password. Unknown slugs, unlocked forms, token reloads and an empty password are free.
(g) **Fill passwords need 6–72 characters** for new or changed passwords, NFC-normalized in SQL; the studio trims, and unlock trims and normalizes before the check.
(h) **Owner reads** (`meta`, `download`, `content`) and draft uploads need a Bearer first (no DB without one), then a verified JWT, then one charge to the account plus an IP backstop, then the owner check. `content` refuses objects over 10 MiB (413 `too_large_for_preview`; the studio falls back to the signed download link). `meta` and `content` answer 404 only when the object is missing, 503 otherwise. File answers keep only this form's own storage refs, deduplicated and capped at `maxFiles` (the server half of M-DB-3 for new rows).
(i) **Client IP** is the rightmost `X-Forwarded-For` only, port stripped, IPv6 grouped by /64 (a placeholder: the Function hosts are IPv4-only, DNS 2026-09-26), `::ffff:` mapped to IPv4, anything else `raw:` plus ≤ 64 safe characters. `X-Real-IP`, `CF-Connecting-IP` and `True-Client-IP` are no longer trusted. No XFF means the shared `noip` key at a tenth of every limit, with a loud log line at most once a minute.
(j) **slug-oracle is deferred to step 8b.** `get_form_by_slug` is untouched; a real throttle needs a new hop that sees the client IP.
(k) **JWKS:** a forced refresh at most once per 60 s per instance, recorded only after it succeeds; each kind of fetch is single-flight; a failed fetch backs off 60 s and serves stale keys; with nothing cached the verifier throws (storagesign 503). Both copies (`api/authJwt.ts`, storage-sign).
(l) **Crowd UX:** both Functions send CORS `maxAge: 7200` and expose `Retry-After`. Every 429 names the wait and suggests another network. Unlock shows the server's text. Network failures on submit and upload-sign get plain copy. Public uploads never load the Neon SDK, fill the meta cache on success, and the fill page never reads stored files.

Numbers (Function env overrides must be integers in range, else the default; each Function logs its effective limits once per isolate):

| Bucket | Default | Window | Env |
|---|---|---|---|
| `sub:ipowner:{ip}:{owner}` | 2,000 units (4 KiB) | 1 h | `SUBMIT_RATE_IP_OWNER_MAX` |
| `sub:ip:{ip}` | 10,000 units | 1 h | `SUBMIT_RATE_IP_MAX` |
| `unlock:pw:{ip}:{owner}` | 2,000 attempts | 10 min | `UNLOCK_RATE_PW_MAX` |
| `unlock:pw:{ip}` | 10,000 attempts | 10 min | `UNLOCK_RATE_PW_IP_MAX` |
| `unlock:failip:{ip}` | 500 misses | 1 h | `UNLOCK_RATE_FAIL_IP_MAX` |
| `unlock:failform:{form}:{pv}` | 300 misses | 1 h | `UNLOCK_RATE_FAIL_FORM_MAX` |
| `up:ipowner:{ip}:{owner}` | 8,192 units (256 KiB), 2 GiB | 1 h | `STORAGE_SIGN_IP_OWNER_MAX` |
| `up:draft:{sub}` | 8,192 units | 1 h | `STORAGE_SIGN_DRAFT_USER_MAX` |
| `up:ip:{ip}` (public + draft) | 40,960 units, 10 GiB | 1 h | `STORAGE_SIGN_IP_MAX` |
| `read:u:{sub}` | 3,000 reads | 10 min | `STORAGE_SIGN_READ_USER_MAX` |
| `read:ip:{ip}` | 15,000 reads | 10 min | `STORAGE_SIGN_READ_IP_MAX` |

Also: submit body ≤ 65,536 B; sign body ≤ 8,192 B; content previews ≤ 10,485,760 B (`STORAGE_SIGN_CONTENT_MAX_BYTES`, at most 32 MiB); `noip` = every IP-keyed max ÷ 10 (min 1); keys ≤ ~170 B. The new prefixes never collide with the old keys, so a rollback starts clean. Retired env names (none set in prod): `SUBMIT_RATE_IP_FORM_MAX`, `SUBMIT_RATE_IP_FORM_WINDOW_SEC`, `SUBMIT_RATE_IP_WINDOW_SEC`, `UNLOCK_RATE_IP_SLUG_*`, `UNLOCK_RATE_IP_MAX`, `UNLOCK_RATE_IP_WINDOW_SEC`, `STORAGE_SIGN_IP_FORM_*`, `STORAGE_SIGN_IP_WINDOW_SEC`, `STORAGE_SIGN_READ_IP_WINDOW_SEC`. `SUBMIT_RATE_IP_MAX`, `STORAGE_SIGN_IP_MAX` and `STORAGE_SIGN_READ_IP_MAX` keep their names but now count units (or reads) under the new keys.

Crowd math: 300 people on one venue IP, one form, ~10 min: 300 submit units (15 % of IP+owner); ~360 unlock attempts with typos, and after the first success the venue is proven; 900 photos = 1,800 upload units (22 %); the organizer reviewing on the same Wi-Fi is charged to their account, not the venue. A 1,000-person session still fits (50 % submits, 73 % uploads at 3 photos each).
Alternatives:
- Per-IP first, as the audit suggested. Rejected: that charge is the lever that let junk ids close a network.
- A per-form submit ceiling across all IPs. Rejected: a distributed flood would close the form to everyone.
- An expiring or random unlock token. Deferred (ADR-043): guessing targets the password, not the 256-bit token.
- Counting uploads per submission with a client-chosen fill id. Rejected: the client picks it. Step 11 brings server-minted keys and per-owner quotas.
- GCRA or sliding windows. Deferred: the fixed-window all-or-nothing core is one small SQL function.
- A CAPTCHA or per-device signal. Rejected for now: fails the no-friction bar.
Consequences / risks:
- The IP is still the only identity. Someone inside a crowd's NAT can close one owner's forms for up to 1 h with 2,000 submit units (≥ 125 junk rows that owner sees), every form with 10,000 units across ≥ 5 owners, and password entry for up to 10 min with 10,000 attempts across ≥ 5 owners' locked forms. Today 30 junk submits close every form.
- Uploads are charged when signed, by declared size, and nothing ties an object to a response. The cheapest lever left: 64 signs declaring 32 MiB close one owner's file forms to the venue for up to 1 h (320 across ≥ 5 owners), with no bytes moved. Orphan objects are invisible to owners. Step 11 is the real fix.
- Free hosting stays about today's figure per IP + owner (2 GiB/h), 10 GiB/h per IP across ≥ 5 owners; submissions storage up to ~7.8 MiB/h per IP + owner. A 100-IP botnet scales every per-IP limit by 100.
- The submit body cap drops from 256 KiB to 64 KiB (about 21,000 CJK or 65,000 ASCII characters); such a respondent sees "Your answers are too long to send…". The largest real response is ~1.5 KB.
- Unlock errors read as a wrong password, by design, so no guess gets a distinct answer. A DB outage, or deploying the new `submitresponse` before 016, looks like wrong passwords. Apply 016 first.
- The unlock exemptions trade some brute-force resistance for crowd safety (~600 misses/h per form from a 100-IP botnet; a 6-digit PIN still takes ~35 days). One corner case can lock a network out of one form for up to 1 h: a distributed flood has filled that form's ceiling, nobody on the network has unlocked it this hour, and its first 3 tries all miss. Changing the password resets it.
- Fixed windows allow up to 2x a limit across a window edge; a denied caller may wait up to 1 h.
- No studio read queue until step 14: an owner past 3,000 reads per 10 min sees blank thumbnails for up to 10 min. Previews over 10 MiB open through the signed download link (big PDFs download, some large videos don't play inline in Safari).
- If Neon ever stops sending `X-Forwarded-For`, public traffic hits the `noip` limits quickly (fail closed) with a loud log line.
- Neon's default 100 concurrent invocations per account is shared by all three Functions; no Postgres bucket protects that.
- slug-oracle stays open until 8b.
- A denied submit is now 2 statements (the lookup, then the rate check) where it was 1, because the lookup runs first on purpose. On the branch it measured p50 ~190 ms vs ~100 ms from a laptop; accepted submits, wrong unlocks and public signs all got faster (one round trip fewer).

Verified on a throwaway branch (2026-09-26): 016 applied twice, 28 SQL checks (all-or-nothing under 50 parallel calls, 0 deadlocks in 60 s × 32 clients, bounded prune on the index, fresh/proven unlock rules, NFC, grants) and 15 scenarios running the real Functions against it (`scripts/check-rate-limits.ts`).
Revisit when: an edge limiter or per-device signal is available, the Function hosts get AAAA records (IPv6 grouping), step 11 (per-owner byte quotas, server-minted keys), or typo lockouts are reported.
Addendum (ADR-061): (j) is done. `FORM_LOOKUP_MISS_MAX` (300 distinct unknown slugs per 10 min, IP) joins the table; the Neon 100-invocation risk now covers form loading too.

## ADR-059 — Delight pass 1: completion celebration, question hand-off, progress spark
Date: 2026-09-26
Status: accepted
Context: The engine felt correct but flat. A design audit ranked motion ideas; the owner approved the first three passes plus a gallery page. The brief covers question transitions (§10.2) and focus (§10.5) but is silent on celebration, choice feedback, progress styling and decoration motion, and the §10.2 220ms outgoing exit was never implemented (`slate-q-leave` existed in animations.css, but Form.tsx key-swapped instantly). Constraints: no runtime dependencies, wrapper-scoped DOM, CSS-variable colours only in components, GPU-friendly motion, `prefers-reduced-motion` everywhere, and the <50 kB gz engine budget.
Decision:
1. **Celebration fires on submit success, not on reaching thanks.** `<Form>` passes `submitConfirmed` (thanks step and `submitStatus === 'success'`) to ProgressBar, ThemeDecoration and, via status, ThanksScreen. The bar holds at the last answered question's value while submitting or after an error, and reaches 100% only on success. The chip's check draws itself, the chip pops, and 14 CSS confetti pieces burst from it (fixed layout, no randomness). Variants are pure CSS keyed on `data-theme-name`: swiss/mono drop poster shapes, constellation sparkles in place and its decoration lights the whole map, bloom drifts petals and its vine flowers, midnight/sunset raise orbs, terminal redraws pixels in `steps()`, riso overprints dots through `--slate-deco-blend`, memphis throws triangles and bars, and the rest use accent-family confetti. Colours come from `--slate-cf-1..4`, derived from existing deco/accent tokens in motion.css (no new hex). ThanksScreen's inline styles became classes, and its status sits in one persistent `aria-live="polite"` region (a region created together with its text often isn't announced). Confetti is `aria-hidden`.
2. **Finale chord.** `playFormFinale()` in `utils/formSounds.ts` is a synthesized C-major arpeggio over a root (~1.4 s, same Web Audio engine, no assets). It plays once per confirmed submit and only when `schema.sound` resolves to a preset (extends ADR-023; sound stays off by default).
3. **Question hand-off (§10.2 outgoing 220ms).** A ref callback on the stage content runs just before React removes the old question, clones its DOM, copies live input values, strips `id`/`name`/`for`, and marks it `aria-hidden` + `inert`. A layout effect places the copy in a React-free `.slate-q-leave-host` inside `.slate-stage`, where the existing `slate-q-leave` keyframes (classic 260 / swiss 180 / default 220ms, plus a new downward variant for Back) fade it. It is removed on `animationend` or after 420ms at most. Focus rules (§10.5) are unchanged: the copy can never hold focus, and the new field still focuses ~380ms in. Rejected: **View Transitions**, which snapshot the whole document and so the host page when embedded. Also rejected: keeping the old React tree mounted, since its effects (confirm handler, focus timer, autosave) would stay live for the exit.
4. **Choice commit.** `useChoiceCommit` marks a value as committed when it arrives after mount (click or letter key), not when it was already selected on Back or resume. Single choice, yes/no, legal and single picture choice render `ChoiceBadge`, whose letter flips edge-on and hands over to a self-drawing check, while the other options fade to 0.4 and scale to 0.97. Everything finishes inside the existing 220ms auto-advance delay, and the leaving copy freezes on that end state.
5. **Invalid input.** `shakeInvalid()` (WAAPI, 3px, 320ms) runs from each field's failed-validation branch, so it replays even when the message is unchanged. `.slate-err` slides in with CSS.
6. **Progress spark.** The fill uses `transform: scaleX()` instead of `width`. A tip rides a `translateX` track and flares through WAAPI on advance, with a bigger finale flare on a confirmed 100%. The footer number is keyed so it rolls up, or down when going back. base.css now turns the bar/tip transitions off for reduced motion (they were missed before).
7. **Decorations draw on**, using stroke-dash and transform only. Constellation connectors draw with a stroke-dash and a stagger for newly lit lines only (old ones keep delay 0, so a finished draw is never pulled back into its active interval), then the star pops and a halo pulses once. Bloom's stem animates only its new length (measured with `getTotalLength`), leaves unfurl from their node and flowers open on completion. Aurora cross-fades whole-scene `<svg>` layers, so the 80px blur rasterises once and only layer opacity animates. Swiss keys each composition so its shapes slide in through the individual `translate` property, which composes with the shapes' own `transform` attributes.
8. **Reduced motion.** Motion keyframes apply only inside `@media (prefers-reduced-motion: no-preference)` on a wrapper without `data-reduced-motion`. Every rule outside that block is the static end state. `<Form>` sets `data-reduced-motion` from `useReducedMotion()`, which now also reads an internal `ReducedMotionOverrideContext` (not exported from `src/index.ts`) so the gallery can preview the calm versions. motion.css mirrors animations.css's reduced block for that attribute. JS motion (hand-off copy, shake, flares, stem draw, aurora layering) checks the same flag.
9. **Styles.** All of the above lives in a new `src/styles/motion.css`, appended last in `scripts/bundle-css.mjs`, so `dist/styles.css` stays one file.
10. **No new public API.** No schema flag, no new `<Form>` prop, and `src/index.ts` is unchanged. ThemeDecoration gains an optional `complete` prop (internal component).
11. **Gallery.** `/motion` in the examples app (never published) is its own lazily loaded entry chunk, like the public bundle (ADR-048). It needs no studio, auth or Neon, and uses demo schemas with a local fake submit. Every animation has a Replay button, plus Dark, Reduce motion and Sound switches, and the layout works at phone width. `/motion` is not under `/forms/`, so it can't collide with a slug (ADR-057). It gets the default non-framable headers.
Alternatives:
- A `schema.celebrate` flag. Deferred. The celebration is short, on-brand and respects reduced motion, so no host has needed an opt-out yet. Adding it later is purely additive.
- A confetti or animation library (canvas-confetti, Motion). Rejected: runtime dependency and budget. CSS + WAAPI cover it.
- Canvas or randomized confetti. Rejected: canvas costs main-thread work and randomness makes snapshots and design review nondeterministic.
- `width` transitions with a pseudo-element tip. Rejected: `width` triggers layout on every frame.
Consequences: Measured with `npm run build`: `dist/index.js` goes from 37.3 to 41.0 kB gz (unminified, as published), or 27.4 to 30.1 kB gz minified. `dist/styles.css` goes from 14.1 to 17.9 kB gz, most of it the per-theme confetti and decoration rules. The engine stays under the brief's 50 kB budget. The thanks-step progress bar reads below 100% until the submit resolves. `aria-valuenow` is honest about that, and the hold is intentional. A leaving copy briefly duplicates visible text in the DOM (aria-hidden, inert, no ids), so text queries in host tests can see it for ≤420ms. The single-choice snapshot markup is unchanged. Only the thanks snapshot changed (classes instead of inline styles).
Revisit when: a host asks to turn the celebration off (add `schema.celebrate?: boolean`), scale/NPS want a commit beat, or riso/memphis/grid get their own draw-on.

## ADR-060 — Delight passes 4 + 5: publish ignition, arrivals, a living Summary, calmer empty states
Date: 2026-09-27
Status: accepted
Context: Pass 1 (ADR-059) made the respondent side feel alive; the studio still met its two biggest moments (going live, hearing back) with a toast and a number change. The owner approved passes 4 and 5 for the studio. The same limits apply: no runtime dependencies, CSS + the Web Animations API only, transform/opacity (and stroke-dash for self-drawing checks), `prefers-reduced-motion` everywhere, colours from tokens. An audit also found two loops that never stopped (the empty-state border breathe and button float in `slateMotion.css`, and the Share panel's Live dot pulse) — WCAG 2.2.2 — and that the Live dot animated `box-shadow`. The brief is silent on studio motion (the studio is an examples-only surface, ADR-018).
Decision:
1. **One home.** Everything lives in `examples/_admin/delight/` (helpers, small components, `delight.css`), imported by the studio and the `/motion` gallery. Nothing touches `src/` or the published package; `src/index.ts` is unchanged. `delight.css` follows ADR-059's pattern: rules outside the motion block are the static end state, keyframes run only inside `@media (prefers-reduced-motion: no-preference)` on a wrapper without `data-reduced-motion` (the gallery's Reduce switch), and JS motion checks `motionReduced()` from `src/utils/motion.ts`.
2. **Publish ignition** (`usePublishIgnition`, `PublishButton`). The publish runs on click, synchronously, as before; only what the author sees is staged: a 420 ms spinner, then the ring closes and a check draws itself with "Live", held 1.1 s, then the button bows out (220 ms). The toast and success cue fire on the check beat and still fire if the button unmounts mid-spin, so a publish is never silent and never delayed. Calm motion goes straight to the check. The editor pill keeps its old label during the spinner, then flips (`FlipPill`, a rotateX split-flap, never on first render). The Share panel uses the same button; its Live footer appears on the check beat.
3. **Live dot** (standing decision: a small dot, never a pill or badge). It stays a 7 px dot coloured by the new `--chrome-live` token. Its pulse is now an opacity/scale pseudo-element that runs three 1.6 s cycles, then rests. Right after a publish from the panel it pops in and fires one sonar ring first.
4. **Arrivals.** `delight/arrivals.ts` is a per-tab, in-memory record of responses that landed while the studio was open. The bell's ingest (`StudioInbox`) is the only writer, and only once stores are hydrated, so the batch that loads with the page never animates. On an arrival the bell swings (rotate with a lagging clapper), its badge pops, the bell panel and the Responses inbox rows slide in with an accent wash that fades over 2 s, and the dashboard card count rolls like an odometer (`Odometer`: per-digit reels translated by transform, the true number in screen-reader text). A new `arrival` Web Audio cue (a two-note bell) replaces `refresh` where the studio already announced new responses, and plays for the first-response toast; mute still gates it (ADR-040).
5. **Poll announce fix.** A poll's store update reached `ingest` through the subscription before the poll's own ingest ran, so in cloud mode the rows were marked known silently and the "New response" toast (ADR-041) never showed. The subscription now inherits the poll's `announce` flag through a ref.
6. **First response.** When every active response of a form is new in one ingest and the form hasn't been celebrated, a one-time "First response!" toast shows a "1st" medal that bursts pass 1's confetti (same `.slate-confetti` classes and keyframes, studio colours via `--slate-cf-*` overrides). Celebrated form ids are kept per browser under the new key `slate-admin-first-response` (JSON array, capped at 500); every access is in try/catch, so blocked storage can at worst repeat it. Toasts gained `celebrate?: boolean`, and `sound: 'none'` now really is silent (it used to fall through to the tone's cue).
7. **Summary comes alive.** KPI numbers count up over 600 ms (`CountUp`, easeOutCubic; the true value is screen-reader text, only the aria-hidden copy animates). The 14-day sparkline columns draw on left to right (scaleY). Each chart's bars grow from zero by `transform: scaleX` (their width stays the layout truth) the first time the card scrolls into view: `useReveal` sets `data-reveal` on the DOM from a shared IntersectionObserver, in a layout effect so nothing flashes, and marks the card revealed at once with calm motion or without IntersectionObserver. Filtering keeps its existing width transition.
8. **Empty states.** The dashboard's three-bar mark assembles with the boot splash's loading-stack motion (same start scale and ease, held instead of fading). "No responses yet" (never had any) gets a radar: a dot with two rings pinging outward, and the Share button glints as each ping lands. The old infinite border breathe (a `border-color` animation) became an opacity-only glow. Every one of these loops runs three 1.6 s cycles, so each is done within about 6 s, then still. Loading spinners and skeleton shimmers keep looping while something is loading (they stop when it stops).
9. **Gallery.** `/motion` gains three studio sections (publish + first responses, the Summary, empty states) with Replay buttons, demo data, the real studio components and CSS, and the real toast host. No stores, no sign-in; nothing is published or saved.
Alternatives:
- A number-animation or chart library. Rejected: runtime dependency for a few hundred lines of CSS.
- Delaying the real publish until the spinner finishes. Rejected: navigating away mid-spin would drop the publish.
- Animating bar `width` from 0. Rejected: layout on every frame; scaleX gives the same look on the compositor.
- Replaying arrivals for everything new since the last visit. Rejected: fifty rows flashing at once is noise; the unread dots already say "new since you were here".
- Storing first-response state in Neon. Deferred: per-browser is enough for a one-time moment, same as read state (ADR-055).
Consequences: Studio-only; respondents and the engine bundle are unchanged (the respondent route loads the same code, the examples build only regrouped shared chunks). The Publish button now lingers ~1.7 s after a publish instead of vanishing. The first-response toast can repeat on another browser or after clearing site data. The bell panel and inbox wash use the accent colour, so they follow the studio palette.
Revisit when: read state moves to Neon (move first-response with it), the Share panel gets a new layout, or a user asks to turn studio motion down separately from the OS setting.


## ADR-061 — Slug lookups go through the Function, charged by distinct misses (slug-oracle)
Date: 2026-09-28
Status: proposed — built and branch-tested; awaiting Caleb's "ship it" (he approved the design direction and the shared-network trade-off on 2026-09-28)
Context: Public fill loaded the form through the anonymous Data API RPC `get_form_by_slug` (012). Nothing throttled it, so a script could walk the 8-digit slug space (90,000,000 values) and list every published form, including locked ones by name. It also returned the live `forms.name`, so a rename after publishing reached every scanner, even for password-locked forms. ADR-058(j) deferred this: the Data API has no rate limit and SQL can't see a trustworthy client IP, because Neon's proxy forwards the client's own headers. ADR-048 had rejected loading through the Function because it would put a per-network limit in front of merely viewing a form.
Decision:
(a) **Where: `submitresponse`, `GET ?op=form&slug=`.** The Function already sees the client IP (ADR-058(i)) and has the pool and the rate core, so this adds no new public host, secret or DB path. A GET with no custom headers is a CORS simple request, so there is no preflight: a first-time QR scan is one round trip where it was three (anonymous token, preflight, RPC). The entry prefetch (ADR-048) is unchanged in shape: `main.tsx` starts `loadPublishedForm` before the public chunk downloads, still with no SDK. It has no token now either. index.html preconnects the Function host instead of the Data API host.
(b) **Charge distinct misses only.** Migration `017_slug_oracle.sql` adds `lookup_public_form(slug, ip, miss_max, window)`, one statement for `op=form` and `op=unlock` alike:
   - It reads the IP's miss row. If the IP already has `miss_max` distinct misses in the window, the answer is `denied` and nothing is read or written.
   - A published, live form is a hit and writes nothing.
   - Anything else (unknown, draft, trashed, schema-less) is a miss. It adds the slug's hash to that IP's set in `slug_miss_buckets`: one row per IP, capped at `miss_max` entries. A repeat of the same slug is free, so 300 people scanning one dead QR, or one person reloading, count once.
   - Misses prune at most 20 rows older than 25 h, with SKIP LOCKED.
(c) **Over budget, hits are refused too**, or the oracle would survive. 429 with `Retry-After`, `retryAfterSeconds` and `reason: 'lookup'`: "Too many links to forms that don’t exist were opened from this network, so forms are paused here for about N minutes. Please try again then, or switch to mobile data." The fill page shows it as sent. It starts with "Too many", so pre-8b bundles also show it verbatim on the unlock path.
(d) **Unlock shares the budget.** Unlock with an unlocked form's slug returned its schema, so it was a second oracle. Its lookup is now the same statement: an unknown slug charges one miss and still answers 401 `wrong_password`, and an IP over budget gets the lookup 429 before any token check or bcrypt. Wrong passwords on a real form stay on ADR-058(f)'s own budgets. They are not slug misses, so a venue full of password typos can't pause form loading.
(e) **Unknown and locked reveal nothing new.** Malformed slugs (015's format) are a free 404 with no DB. Unknown, draft and trashed slugs all get the same 404 `{"error":"not_found"}`. A locked form gets `{ id, name, slug, locked: true, schema: null }`, the same fields as before.
(f) **Published title.** `published_schema` carries only `brand.name`, which the studio lets diverge from the form name (the brand shown in the top bar). So 017 adds `forms.published_name`. A trigger snapshots `name` when `published_schema` changes or `status` becomes `published`. That is exactly Publish or Republish, since every other studio save re-sends the same `published_schema`. A client-sent value is honoured only when it equals the row's current `name` on a live published row (a rename-only Republish, see (h)). Otherwise the trigger pins the old value: a forged title, or the old title that ordinary saves re-send, is ignored for every role. The backfill copies today's name into every published row, which is what those rows already serve. The lookup, unlock and `get_form_by_slug` all return `coalesce(published_name, published brand name, 'Form')`, never the live name.
(g) **Old bundles.** `get_form_by_slug` keeps its signature and grants through an overlap window. 017 switches it to the published title, so the name leak closes for old bundles at once. `018_revoke_get_form_by_slug.sql` revokes EXECUTE from `anonymous` and `authenticated`, applied 24 h after the new SPA with no rollback. Evidence: production keeps no per-function call stats (`track_functions = none`, no `pg_stat_statements`), so it can't be measured. In code, the RPC's only caller is `publicForm.ts`, which runs at page load; `index.html` is `no-cache` and assets are hashed, so old bundles stop calling it within minutes of the deploy. The real constraint is rollback: once 018 is applied, a Vercel instant rollback to a pre-8b build breaks every public form until 018's one-line GRANT is run. So 018 waits until a rollback is unlikely.
(h) **A rename is an unpublished change.** With a customized brand name, a rename leaves the schema unchanged, so the studio used to show the form as current with no Republish, and the public title stayed old. The owner hydrate now reads `published_name` (`FORM_OWNER_COLUMNS`; RLS limits it to the owner's rows) into `FormRecord.publishedName`, and `hasUnpublishedChanges` is also true when `name ≠ publishedName`. Publish/Republish sets `publishedName = name` and writes `published_name = name`, which the trigger accepts. Ordinary saves re-send the cached old title, which it ignores. Writes carry `published_name` only after a hydrate has read the column, so a database without 017 (or a stale Data API cache) keeps loading and saving, with renames not compared. A backup restore mirrors the insert trigger (published rows go live under their own name). Local mode records `publishedName` on publish. Old records without it compare schemas only.
Numbers: `FORM_LOOKUP_MISS_MAX` = 300 distinct unknown slugs per IP per 10 min (fixed window, integer env override like ADR-058). `noip` = 30. A scanner gets 300 probes per 10 min per IP, which is 43,200 per day. With N live 8-digit forms, one find takes about 90,000,000 / N probes: about 350 days per IP at today's 6 live forms, about 2 days per IP at 1,000 forms, and about 30 minutes for a 100-IP botnet at 1,000 forms. Before, the only limit was Data API throughput. A venue with 300 opens and 30 typos uses 30 of its 300.
Verified:
- Unit: `tests/submitResponse.test.ts`, `tests/publicForm.test.ts`, `tests/slugOracle.test.ts` and `tests/publishedName.test.tsx`.
- On a throwaway branch, `scripts/check-slug-oracle.ts` ran the real Function against 017. 17/17 scenarios passed (re-run with (h)'s trigger rule), among them:
   - 1,000 random slugs from one IP: 301 × 404, then 699 × 429, and a real slug is 429 too.
   - Denials and 200 hits write nothing.
   - 300 opens, 30 typos and 300 scans of one dead slug: no 429.
   - 400 misses on 32 connections store exactly 300.
   - Unlock scanning is throttled the same way.
   - A locked form returns the published title after a live rename, and a forged `published_name` is ignored.
   - A rename-only save keeps the old title; `published_name = name` on a live row moves it; on a draft it is pinned.
   - Old-bundle RPC calls work through the overlap with the published title.
   - 018 gives both Data API roles 42501, and its rollback GRANT restores access.
Latency: DB cost per call (1,000 calls in a DO block): `get_form_by_slug` hit 0.059 ms, lookup hit 0.029 ms, miss 0.164 ms, denied 0.018 ms. Warm network legs from a laptop to us-east-2 (p50 of 30): auth host 84 ms, Data API preflight 102 ms, Function GET 97 ms. A first scan was ~3 legs (≈290 ms here, ≈750 ms at a 250 ms cafe RTT) and is now 1 (≈100 / ≈250 ms). A reload in the same tab was already 1 leg (cached token and preflight), so it doesn't change. The in-process app adds ~4 ms over the raw statement.
Alternatives:
- A same-origin Vercel `api/` route. Rejected. It needs its own path to Postgres: a Data API call with a new server key held by Vercel (the ADR-051 pattern), or a DB credential in Vercel, which ADR-051 rejected. It also puts a Vercel cold start and a cross-region hop (iad1 → us-east-2) on the fill path. Its one real win, reusing the page's connection, is matched by a preconnect.
- Charging every lookup, or hits too. Rejected. That is the lever ADR-048 refused: one crowd scanning one QR would pay for viewing.
- Counting misses without de-duplication, or with one marker row per (IP, slug). Rejected. The first trips on one dead QR. The second writes a row per distinct miss (a 100-IP botnet ≈ 4 M rows a day); one bounded array per IP holds the same information.
- Revoking the RPC in 017. Rejected: it breaks a SPA rollback and races the promote.
- Using `brand.name` as the published title. Rejected: it is the brand, not the form's name, and changing the gate's heading would be a product change.
Consequences / risks:
- A prankster behind a shared IP can pause form loading there for up to 10 min with 300 unknown slugs (Caleb accepted this, 2026-09-28). Every other network is unaffected.
- If Neon stops sending `X-Forwarded-For`, 30 distinct misses anywhere pause form loading for everyone who shares `noip`. This fails closed, as ADR-058 does for submits, and logs loudly.
- Every form view is now a `submitresponse` invocation. Neon allows 100 concurrent invocations per account, shared by all three Functions. A lookup is ~20–50 ms of wall time, so that is roughly 2,000 lookups/s. A 300-person venue scanning over 2 min is ~2.5/s (≈0.1 concurrent). But a flood against any Function (already possible via submits) now also stalls form loading, which used to run on the Data API. The first view after the isolate idles pays the pg pool's TLS connect.
- Over budget, a page load can make two requests: the prefetch fails, the memo clears and PublicFill retries (ADR-048's retry rule). Both are denied without writes.
- The 4 legacy word slugs can be guessed from a dictionary, under the same budget.
- ~~A rename while the brand name is customized leaves the schema unchanged, so the studio offers no Republish.~~ Fixed by (h) before shipping.
- The studio now reads a column 017 adds, so apply 017 and then refresh the Data API schema cache (`neonctl data-api refresh-schema`) before the SPA ships. Without the refresh the SPA still works; it just doesn't compare names.
- 017 must be applied before the new `submitresponse`, or op=form answers 503 and unlock answers 503. The new SPA needs the new Function, or the fill page says "not available". Deploy: 017 → submitresponse → SPA → (24 h) 018. Rollback reverses it, and 017 carries its own rollback SQL.
Revisit when: Neon or Vercel offer an edge limiter keyed on the client IP, invocation limits bite, owners get custom slugs (a dictionary oracle), or a typo lockout is reported.

## ADR-062 — Studio mobile layout: compact bar, bottom sheets, one-pane editor
Date: 2026-09-29
Status: accepted (2026-09-29) — Caleb reviewed the preview and approved the merge
Context: On an iPhone the studio rendered wider than the phone. At 375 px the dashboard reported `innerWidth` 444 offline and 506 in production (`visualViewport.width` 375); the editor reported 823 and the preview page 557. Cause: the studio header is a single flex row. Its lead (brand + crumbs) and trail (refresh, bell, the page's `rightSlot` buttons, Sign out, theme toggle) had no `min-width: 0` or wrap, so on a phone the trail ran past the right edge. The studio wrapper sets `overflow: visible` on purpose (publicChrome.css, so the sticky header works), so nothing clipped it, and mobile browsers widen the layout viewport to fit overflowing content. Every `position: fixed` element (FABs, toasts) and every percentage width then laid out against the wider viewport; the editor's fixed rail columns (300 + 360 px) would have overflowed on their own too. Beyond the overflow, the studio had no phone design: 36 px targets, hover-only outline actions, 13–15 px fields (iOS zooms the page on focus), `100vh` heights, side-panel and centered-modal patterns, and a three-pane editor squashed to 375 px. The Responses page (ADR-055) was the one exception: `usePhone()`, a ⋯ menu and 44 px targets. The brief is silent on studio layout (ADR-018).
Decision:
1. **Fix the header at the source, at every width.** Header.tsx's groups became `.slate-header-lead` (`flex: 1 1 0; min-width: 0`, crumbs truncate with an ellipsis) and `.slate-header-trail` (`flex: none`). From 1180 px down the editor header drops its autosave label and ⌘ button, and from 1023 px down the content gutter is 24 px, so 720–1023 px fits without a phone layout. There is no `overflow-x: hidden` on `body` or the wrapper: it would hide the next regression instead of preventing it, and hidden overflow on the wrapper breaks the sticky header.
2. **One breakpoint.** Phone = `usePhone()` from `responses/hooks.ts` (≤ 719 CSS px, scaled by the studio size zoom, ADR-045), the same one Responses already used. JS decides structure: AdminShell renders the phone chrome and marks `.slate-app--phone`. Portaled overlays live outside the shell, so their CSS uses `@media (max-width: 719px)`. At the 1.1×/1.2× studio sizes that media query can disagree with `usePhone()` between 720 and ~863 px; the overlays then keep their desktop form, which still fits.
3. **Phone chrome (`examples/_admin/mobile/`).** `AdminShell` takes an optional `phone` prop (`PhoneChrome`: `back`, `title`, `subtitle`, `menu`, `actions`). On a phone it renders `PhoneHeader` instead of the desktop header: back chevron or Slate mark, a one-line title with an optional second line, then refresh, the bell and a ⋯ button. The ⋯ opens a bottom sheet (focus-trapped, scroll-locked, Esc and backdrop close) with the page's items, then Settings, Light/Dark mode, Send feedback and Sign out (cloud only), and the signed-in email. The Settings and Feedback FABs are not rendered on phones. `FeedbackButton` gained `trigger={false}` and `openFeedback()` (a window event), so the dialog still works from the sheet. `actions` render in a fixed bottom action bar (48 px buttons, safe-area padding); the page content pads for it.
4. **Per screen.** Dashboard: lockup bar; Build with AI + New form in the action bar; empty-state copy says "below" instead of "top right" on phones. Editor: back to Forms, form name, and a second line with publish state (a 6 px dot, never a pill, standing decision) and save state; ⋯ holds Test the form, Responses, Undo, Redo (phones have no ⌘Z); the action bar holds Share, plus Publish/Republish (the ADR-060 ignition button) when there is something to push. Preview: "Test run" bar, the note hidden, the frame fills the screen. Settings: back closes Settings. Responses: back to Forms with the form name in the bar (its toolbar's duplicate name line is hidden); its own ⋯ is unchanged.
5. **Editor: one pane at a time.** `EditorLayoutShell` takes `phoneTab`; on phones it renders a sticky segmented control (Outline · Question · Preview, where "Question" reads "Welcome"/"Ending" for those screens, roving arrow keys) and only the active pane. Only the active pane is mounted, so a hidden preview can never take focus and raise the iOS keyboard. Tapping a question, adding one or tapping a schema issue opens the Question tab. Outline and Question flow with the page (so the URL bar can collapse); the preview gets a fixed dvh-sized frame. In the Outline, a finger on a row scrolls: only the grip starts a drag (rows used to be `touch-action: none`), and the current question's move/duplicate actions stay visible, because hover never happens on a phone. The add-question palette is a bottom sheet.
6. **Sheets and dialogs.** Under 720 px, `.slate-dialog`, the Share panel and the shortcuts dialog are bottom sheets (full width, 20 px top radius, `max-height: 100%` of the backdrop with inner scroll, safe-area padding), with actions stacked full width, primary on top. Build with AI is full screen. The bell panel spans the width under the bar. Toasts span the width above the action bar and the home indicator.
7. **Platform rules.** Tap targets ≥ 44 px (buttons, icon buttons, tabs, outline actions, sheet rows 52 px). Studio fields are ≥ 16 px under 720 px and on coarse pointers (iPads), so iOS never zooms on focus. The rule excludes a previewed form's own inner wrapper, and it is `!important` because publicChrome.css's field selectors carry long `:not()` chains. `100dvh` everywhere the studio sized to the viewport (with a `100vh` line first as a fallback). The studio bundle adds `viewport-fit=cover` to the viewport meta at mount (`mobile/viewport.ts`) and pads bars, sheets, gutters and FABs with `env(safe-area-inset-*)`. The respondent bundle never loads it, so public forms keep the browser's own safe-area handling.
8. **Tokens and motion.** New tokens: `--m-*` layout tokens in mobile.css and `--chrome-scrim` in slateChromeTokens.css; mobile.css has no colour literals (a test enforces it). Sheets rise 24 px and the action bar slides up only inside `prefers-reduced-motion: no-preference`; everything else is the static end state (ADR-059/060 pattern). Delight motion is untouched.
9. **/motion** (dev gallery): its selects, buttons and tabs are 16 px / 44 px on phones and touch.
Alternatives:
- `overflow-x: hidden` (or `clip`) on `body` or `.slate-app`. Rejected as the fix: it hides the overflow instead of removing it, cuts off whatever overflowed, and `hidden` breaks the sticky header.
- A pure-CSS phone layout that restyles the desktop header's `rightSlot` into a menu. Rejected: each page's `rightSlot` mixes status text, pills and buttons, and CSS can't move them into a sheet with focus management. Each page names its phone actions instead.
- A separate mobile route or app. Rejected: two UIs to keep in sync.
- Keep all three editor panes mounted and hide two. Rejected: the hidden preview's focus timers could grab focus and open the keyboard, and it costs a Form render per keystroke.
- `viewport-fit=cover` in index.html. Rejected: it would change the public fill page, which is already fine.
Consequences: Phone users get Settings, Feedback, theme and Sign out one tap deeper (in ⋯). The editor on a phone shows one pane at a time. The 720–1180 px editor header no longer shows "Saved 3:56 PM" or the ⌘ button. Keyboard shortcuts still work. Prettier reformatted a few touched files (whitespace only). Verified: `tests/mobileShell.test.tsx` (10 tests: phone bar, ⋯ sheet, feedback from the sheet, desktop unchanged, editor tabs, viewport meta, CSS guards) and `tests/e2e/mobileLayout.spec.ts` (Playwright with touch emulation at 360/375/390/430 px: dashboard, editor tabs, Responses, Settings and Preview all have `scrollWidth === innerWidth === width`; it fails on main with 444). A scripted sweep of 24 studio screens in light and dark at 375 and 390 px, plus 720/768/1024/1280 px, found no overflow.
Revisit when: the studio gets a real tablet layout (two panes at 720–1023 px), the Share panel gets a new layout (ADR-060), or the studio becomes installable (standalone mode makes the top safe area non-zero, and the bar already pads for it).

## ADR-063 — Question catalog expansion: options first, on-demand field UIs, Wave A
Date: 2026-09-29
Status: proposed — built on `feat/questions-wave-a`, branch-tested; awaiting Caleb's review of the preview and "ship it"
Context: Owners are local service businesses. Their respondents are mostly on phones, on cafe Wi-Fi, arriving from a flyer QR. The ideas list (2026-09-24) has four waves of new form options. Wave A: "Other: ___" on choices, flyer source tracking and prefill from the link, closing a form on a date or after N responses, scale styles (stars, faces, a slider), a number stepper, time of day and date ranges, and a cleaner Add-to-form palette. Later waves add real new types (address, signature, pin-the-spot, voice note, availability grid, sign-up slots, …). Brief §5 (question types) is frozen and the engine budget is < 50 kB gzip (brief §2.9). Every new type or option has to reach about fifteen surfaces: the type union, validation, `useFormState`, the renderer, keyboard nav, the studio palette and inspector, outline icons, schemaCheck and the portable-schema sanitizer, the server's answer clamp, Responses (Inbox, Summary, table, CSV), backup, Build with AI, piping/logic/scoring, 12 themes, the phone layout (ADR-062) and delight motion (ADR-059/060). Wave A has to set the pattern so the later waves drop in without growing the core bundle or skipping a surface.
Decision — the architecture:
1. **Options before types.** A new variant of an existing answer (stars vs numbers, stepper vs box, date + time, "Other") is an option on the existing type, with the same stored answer shape. Only a new answer shape is a new type. The type union is unchanged (22 types; brief §5 untouched), and every Wave A answer fits the server's shapes (`string`, `number`, `string[]`, `Record<string, string | string[]>`) and the client's `answerShape` normalizer as they were.
2. **On-demand field UIs (`src/components/questions/lazyFields.tsx`).** Heavier field UIs live in `src/components/questions/ext/*` and load with `React.lazy`. `extFieldKey(question)` says which UI a question needs (or null for its core field); `QuestionRenderer` asks it first. Every ext field takes one prop contract, `ExtFieldProps` (question, answers, value, onAnswer, onCommit, onAdvance, onType, ping, file-upload hooks). `<Form>` preloads the chunks the schema needs on mount, so they land while the welcome screen is up. Until one lands, the question shows its title and a quiet placeholder of the same height; if it fails (offline), a Retry button, never a blank form. Adding a UI is a key, a loader and a line in `extFieldKey`. Wave A's: `scale-styled`, `number-stepper`, `date-extended`, and `file-upload` (the existing FileUploadField moved behind the registry unchanged, which alone saves 4.7 kB gzip from every form without a file question).
3. **Code splitting in the package.** tsup builds with `splitting: true` (ESM and CJS), so the ext fields ship as separate chunks. `npm run size` (`scripts/engine-size.mjs`) measures the engine as the consumer's initial load: `index.js` plus its statically imported chunks, gzip -9, unminified as published, with each on-demand chunk listed. The budget applies to that figure.
4. **A coverage guard.** `tests/catalogCoverage.test.tsx` keeps one sample question and answer per type (a `Record<QuestionType, …>`, so a new type is a compile error there) and checks each type has a studio label, a palette entry and an icon, validates, formats (engine piping and Responses), passes the server clamp, is offered to Build with AI (welcome/thanks excepted), and survives the portable-schema sanitizer with its options. `TypeIcon`'s map is keyed by the type union too. AGENTS.md's "How to add a question type" now lists every surface.
5. **Per-type server clamp.** `sanitizeAnswers` calls `clampForQuestion(question, value)` (`answerShape.ts`) after the generic clamp: numbers, scales and NPS must be finite numbers (numeric text becomes a number); date strings ≤ 40 characters; typed Other text ≤ 500 characters, one typed entry per list. New types add a branch here.
Decision — Wave A:
6. **"Other: ___"** (`allowOther`, `otherLabel` on single/multi choice, dropdown and picture choice). Storage follows Google Forms: the typed text is stored in place of an option value, so answers keep their shape. Text that names an option (its value, or its label ignoring case) is stored as that option. `OTHER_VALUE` (`'__other__'`, exported) means "picked Other" in a condition and is never stored. Once Other is picked, its text is required. Other takes the next letter shortcut after the options. Picture choice gets a pencil tile; the dropdown gets an `Other: “…”` row that fills from what was typed in the search box. Summary groups every typed answer into one Other bar and lists the typed values under the owner's own Other label; Inbox, table and CSV show `Other: text`. Scoring gives typed text no points. schemaCheck warns when a condition tests Other on a question that no longer offers it (`other_off`).
7. **Source tracking and prefill from the link.** The flyer link never changes (`/forms/{slug}`); everything is an extra query parameter. `src` and `utm_source|medium|campaign|term|content` go to `meta.hiddenFields` (already capped by the Function's `sanitizeMeta`). Any other parameter can prefill a question only when the owner turned on "Fill from link" and named it (`prefillKey`, `^[A-Za-z0-9_-]{1,40}$`, not a reserved name). The value is coerced to the question's shape and must pass that question's validator, or it is ignored; consent, files, rankings and grids are never prefillable; the respondent still sees and can change every prefilled answer. Share → Tracked links names a source ("Mailbox flyer" → `?src=mailbox-flyer`) and switches the link and QR (in the saved QR style) to it; the main link is one tap away. Generated links carry `src` only, never an answer. The names live in `forms.tracked_sources` (below), studio-only. Responses gets a Source column, fact and filter; Summary a By-source chart (Direct = no source); CSV a Source column after Score.
8. **Closing a form** (`closes_at`, `max_responses` 1–10,000, `closed_message` ≤ 500, migration 019). Enforced by the server, live the moment it's saved, with no Republish. The public lookup (op=form and unlock) returns `closed: { reason: 'date' | 'full', message }` with no schema, in the same statement it already ran. The fill page shows "This form is closed" (plus the owner's message) before anyone starts. Closed wins over the password gate, so no one types a password to learn it's closed. The Function's gate refuses a past `closes_at` before any rate charge (410). The insert goes through `insert_public_submission`, which re-checks the date, and when a cap is set takes a per-form transaction advisory lock (87123003), counts live responses and refuses at the cap (409). So the cap is exact under concurrent submits, and forms without a cap never lock. Someone mid-fill when it closes sees the closed screen with "It closed before your answers were sent." Trashed responses don't count, so trashing junk frees a spot. The count uses the partial index `submissions_form_live_idx (form_id) where deleted_at is null`. Studio: a one-line Closing row in Share (Open · Close now · Schedule, or Closed · Reopen), a Closed badge on the dashboard and editor, and the Live dot hidden while closed. A closed form's lookup never carries its schema.
9. **Scale styles** (`display: 'numbers' | 'stars' | 'emoji' | 'slider'`, `sliderIcon`). The answer is the same number. Stars and faces are a radiogroup with roving focus, arrow keys, digits and a hover preview; faces are drawn SVG whose mouth and brows follow the value (no emoji font, so every phone draws the same faces). The slider is a native range input for screen readers and keyboards, starts untouched (no answer until moved, so "required" still means something), and its face or stars react as it moves; Enter confirms. The inspector suggests 5 points when stars or faces go past 7. All motion sits behind ADR-059's reduced-motion gate.
10. **Number stepper** (`display: 'stepper'`, `step`, `prefix`/`unit` for both styles). A spinbutton with 56 px −/+ buttons, hold-to-repeat (accelerating), stopping at min/max (aria-disabled, so a held button stops cleanly). Prefix/unit (e.g. `$`, `people`) are shown beside the field and in Responses; CSV keeps the raw number.
11. **Date and time** (`includeTime`, `range`). Answers are strings: `YYYY-MM-DD`, `YYYY-MM-DDTHH:MM` (local wall time, no zone), and `start/end` (ISO 8601 interval) for a range. Validation checks each part against min/max and that the end isn't before the start. Time entry is hour/minute segments, with AM/PM on month-first (US) forms; typing `9` guesses 9 AM and `4` guesses 4 PM (business hours). Plain dates stay ISO in exports as before; times and ranges read naturally in Responses.
12. **Add-to-form palette.** All labels left-aligned, wrapping under themselves; the Unicode glyphs (☏ ⇪ ◈, some rendered as emoji or tiny) replaced by `TypeIcon`, one 16 px line icon per type in the Responses icon style (1.6 stroke, `currentColor`). No icon library.
13. **Build with AI** can set the new options (`allowOther`, number `display`/`unit`/`prefix`, scale `display`, date `includeTime`/`range`); the generator's schema and prompt name them and the mapper validates them. Prefill keys and close settings are never generated.
Numbers:
- Engine initial load, unminified gzip -9 (as published): **41.0 → 43.4 kB** of the 50 kB budget; minified + gzip 31.9 → 35.1 kB. Without the registry it would be 54.9 kB (over budget). On-demand: DateExtField 3.1, FileUploadExt 4.7, NumberStepperField 2.5, ScaleStyledField 3.3 kB gzip. `styles.css` 17.9 → 20.4 kB gzip.
- Public fill page (respondent critical path, JS static closure of the page, publicApp and PublicRespond): 221.5 → 227.7 kB gzip JS (+2.8 %), CSS 15.6 → 16.1 kB. It is 19 files instead of 12 (Vite split shared chunks out of the old ones); they are preloaded together.
- 019 on a branch copy of production: live count of 20,000 responses is an Index Only Scan, 2.37 ms, 0 heap fetches.
Verified:
- Unit: 1,143 tests (984 before), among them `otherChoice`, `prefill`, `dateValue`, `extFields`, `formClose`, `waveAStudio`, `publicFillWaveA`, `sharePanelWaveA`, `inspectorWaveA`, `catalogCoverage`, plus snapshot, schemaCheck, piping, CSV, AI and sanitizer updates. Existing snapshots are unchanged.
- `scripts/check-form-close.ts` on a throwaway branch drove the real Function: 26/26. Columns and constraints; RLS (the owner can set them, another account can't, anonymous reads nothing); `anonymous` and `authenticated` get 42501 on `insert_public_submission`; open/closed-by-date/full lookups; 410 with nothing stored or charged; reopening by moving the date; **30 concurrent submits at a cap of 10 stored exactly 10** (20 × 409); trash frees a spot; locked + closed; the per-type clamps; the index plan; submit latency p50 408 ms without a cap vs 385 ms with one (laptop → us-east-2, so the lock adds nothing measurable); the rollback block and re-apply.
- A second throwaway branch served the real Function locally to the real fill page: prefill from the link, an Other answer, a stepper answer stored with `meta.hiddenFields = { src: 'mailbox-flyer' }` and nothing else, the closed-by-date screen with the owner's message, the full screen, and a cap reached mid-fill (409 → closed screen). Both branches were deleted.
- Visual pass: every new option in the editor and on the fill page in classic, swiss and constellation, at desktop and 375 px, light and dark, with and without reduced motion, plus spot checks in terminal, memphis, bloom, midnight, editorial and riso. A scripted sweep rendered all 13 Wave A variants in all 12 themes, light and dark (312 renders) at 375 px: no horizontal overflow, every on-demand field ready within 1.2 s on the dev server, console clean. `tests/e2e/mobileLayout.spec.ts` passes (4/4).
Alternatives:
- New types for each variant (`star_rating`, `slider`, `stepper`, `datetime`, `date_range`). Rejected: each would need its own shape handling on every surface and in stored data, for answers that are already a number or a date string; switching style would lose answers.
- Storing Other as `{ other: text }` or a sentinel plus a sidecar field. Rejected: it breaks the answer shape the server and every export accept, and old bundles would drop it. The cost is the ambiguity rule in (6).
- Allowing a small overshoot on the cap (count without a lock, or an approximate counter). Rejected: "20 spots" has to mean 20 for sign-ups. The lock is per form and only on capped forms; the concurrency test shows no measurable latency.
- Closing through the published schema (Republish to close). Rejected: owners close forms in a hurry, and a Republish would also push unrelated draft edits.
- Keeping tracked sources in the schema or localStorage. Rejected: they'd go public with the schema, or stay on one device.
- An icon library for the palette. Rejected: new runtime dependency for 22 small icons.
Consequences / risks:
- `pipe()` now renders choice labels, yes/no, dates, number prefix/unit and typed Other text when `<Form>` passes the questions (it always does). A form that piped a choice's raw value into a title now shows the label. It's a beta and the label is what the respondent picked; noted here instead of in MIGRATION_NOTES.
- `file_upload` renders a one-frame placeholder before its chunk arrives (preloaded on mount, so usually never seen). Two tests were updated to await it.
- A typed Other answer that matches an option label is stored as that option; one that matches no option but looks like an old option value (after an owner renamed or removed it) shows as Other in Summary.
- A capped form serializes its submits (one insert at a time per form). At a few milliseconds per insert that is still hundreds of submits a second per form, far above a flyer crowd.
- A submit refused as full still counts against the rate limit (the charge comes before the insert); a date close is refused before charging. The fill page shows a full form as closed up front, so only people mid-fill (or scripts) get there.
- The studio reads and writes four new columns: apply 019 and refresh the Data API schema cache before the SPA ships. Without the refresh the SPA still loads and saves, just without close settings or tracked links (the optional-column pattern from ADR-061(h)). Saved values are clamped to 019's constraints, so a hand-edited backup can't fail a save.
- New public API (additive, minor): `OTHER_VALUE`, `ScaleDisplay`, `NumberDisplay`, `<Form prefill>`, and the new question options.
Deploy: 019 (then `neonctl data-api refresh-schema`) → `submitresponse` → SPA. The new Function needs 019 (its lookup reads the columns and it inserts through the function); without it, form loads and submits fail. The SPA should follow the Function so an owner can't set a close the server doesn't enforce yet. Rollback reverses the order: an SPA rollback is safe at any time (old SPAs ignore the columns); the old Function works with 019 applied (it ignores the columns, so closes stop being enforced); 019's own rollback block runs only after the Function is back on its old build, and loses close settings and tracked-link names (responses and their `src` are untouched).
Revisit when: Wave B–D types land (each adds a registry key, a clamp branch and a coverage sample), owners ask for per-source Summary tabs or UTM builders, a capped form sees real contention, or owners want a waitlist instead of "full".

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
