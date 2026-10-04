# AGENTS.md

Operating manual for any AI agent working in this repo. Read this before touching code.

## What this repo is

`@palmstreetweb/slate` (Slate) — internal conversational form engine for Palm Street Web. Schema-in / form-out. The complete spec lives in [`BUILD_BRIEF.md`](./BUILD_BRIEF.md). When in doubt, **return to the brief.**

## Source-of-truth files (do not modify without explicit ask)

- `BUILD_BRIEF.md` — the spec. Frozen during the v1 build. Architectural changes go into `DECISIONS.md` as ADRs, not into the brief.
- `intake-form.jsx` — the visual prototype. Reference only. Never imported. Never modified.

## File map

```
src/
├── components/    Form.tsx + question types + chrome + decorations
├── themes/        editorial.ts, swiss.ts, registry
├── hooks/         useFormState, useKeyboardNav, useTheme, useReducedMotion
├── logic/         conditional, validation, progress (pure, no React)
├── styles/        tokens.css, toggle.css, animations.css, base.css, motion.css
├── utils/         focus, letters, tokens (small helpers)
├── types/         Question.ts, Schema.ts, Answers.ts, Theme.ts (+ barrel)
└── index.ts       public exports barrel
examples/          dev-only demos served by `npm run dev` (admin → Neon, ADR-029)
api/               Vercel serverless (auth-email proxy, Build with AI — ADR-039)
neon/              migrations + Functions + SETUP.md (admin backend)
tests/             Vitest specs
```

Every layer has one job. If a new file doesn't fit cleanly into one of the above, stop and ask whether the layer is right.

## Conventions

- **TypeScript-first.** No `any` without a `// eslint-disable` + a comment explaining why.
- **No default exports** except for component files (React convention).
- **Path alias** `@/*` → `src/*`. Use it for cross-layer imports.
- **`'use client'`** at the top of every component file (the lib is client-only).
- **CSS via tokens.** Never hard-code color hex inside a component — read from `var(--accent)` etc. The only places that define colors are `themes/*.ts` and `styles/tokens.css`.
- **Wrapper-scoped DOM.** Never touch `<html>`, `<body>`, or `document`-level state. The form is a guest in someone's page.
- **`localStorage` key** is exactly `slate-forms-theme`. Never `psw-theme` (that's the PSW site's key).
- **Conventional Commits.** `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`. One commit per build phase minimum.

## What agents should never touch

- The `BUILD_BRIEF.md` file — frozen.
- The `intake-form.jsx` file — frozen reference.
- The PSW theme toggle CSS in `src/styles/toggle.css` once written — that's a verbatim port from palmstreetweb.com per brief §8. Tweaks need a DECISIONS.md entry.
- The published `dist/` folder — built artifact only.

## How to add a question type

First ask whether it's an **option** on an existing type (ADR-063): a new look or input style for the same stored answer (stars vs numbers, stepper vs box, date + time) is an option, not a type. Only a new answer shape is a new type.

1. Add the type (or option) to `src/types/Question.ts`, and its answer to `src/types/Answers.ts`. Answers must fit the server's shapes: `string`, `number`, `string[]`, `Record<string, string | string[]>` (a group of parts — contact, address, signature, pins, a location, a week — is a `Record`, ADR-064/065).
2. Add a validator branch in `src/logic/validation.ts`, and a `schemaCheck.ts` rule for any new way a schema can be wrong.
3. Build the field. New UIs go in `src/components/questions/ext/` behind the on-demand registry (`lazyFields.tsx`: a key, a loader and a line in `extFieldKey`), so they don't grow the engine's initial load; import `extensions.css` and your stylesheet (`extensions-c.css` for Wave C, `extensions-d.css` for Wave D, listed in `scripts/bundle-css.mjs`). Keep helpers only the field needs out of modules the core imports (validation, piping, conditions, schemaCheck): a shared chunk carries everything any importer uses. Browser APIs (camera, microphone, location) are asked for only on a tap, and released when the question leaves. Run `npm run size` (budget 50 kB gzip; Wave D ended at 49.8, so the next UI needs room made first). A helper the core needs only a sliver of goes in its own small module (`signupAnswer.ts` beside `signup.ts`), and a field shouldn't import a core util it can inline (`letters.ts`): either splits a core chunk and costs bytes.
4. Keyboard (`useKeyboardNav`), piping text (`formatAnswerFor` in `logic/piping.ts`), conditions and scoring if it has options. A derived yes/no a condition should test (like "outside the service area") is a sentinel value compared in `conditional.ts`, never stored (`OTHER_VALUE`, `OUT_OF_AREA_VALUE`).
5. Server: a branch in `clampForQuestion` (`neon/functions/submit-response/answerShape.ts`; its third argument carries the form id for storage refs and the published ZIP areas). Anything the server must recompute or re-check exactly as the engine does (the estimate, signature paths, pins, locations, availability) lives in a `shared with the server (keep identical)` section of the engine module, copied byte for byte into the Function folder; a test compares the two. What the server stores can be less than what the page sends: a location is checked from its coordinates, then only the verdict is stored unless the owner opts in (`locationStoredCore`, ADR-068), and the studio's own writes (test runs, local and portable links) reduce answers the same way (`examples/_admin/storedAnswers.ts`). A type that uploads files also needs an entry in `neon/functions/storage-sign/uploadPolicy.ts` (and a storagesign redeploy), or public uploads for it are refused. A type whose answers use up something shared (sign-up spots, ADR-066) is enforced by the database in the same transaction as the insert, under the per-form lock `insert_public_submission` already takes, with its rule mirrored in SQL and checked against the engine on a branch; the page learns a refusal from a 409 and sends the respondent back with an `onSubmit` rejection that carries `goTo`.
6. Studio: `TYPE_LABEL` / `ADDABLE_TYPES` (`questionTypeMeta.ts`), an icon in `components/TypeIcon.tsx`, a default in `makeDefaultQuestion` (`pages/FormEditor.tsx`), inspector settings (`Inspector.tsx`; Wave B's in `InspectorWaveB.tsx`, Wave C's in `InspectorWaveC.tsx` — never nest a control group inside `Field`, which is a `<label>`), the logic editor (`LogicEditor.tsx`: `PART_TYPES`, area answers), `sanitizeUntrustedSchema.ts`, Responses (`responsesFormat.ts` incl. `csvParts` for a multi-part answer, Summary distribution in `responses/model.ts` or a card of its own like `SummaryWaveC.tsx`, `ResponseAnswers.tsx` for anything that isn't text, `fileRefsOf` for stored files), the Build with AI modal's type labels, and Build with AI (`api/generateFormSchema.ts` + `api/mapGeneratedForm.ts`; new required fields need a default in `withDraftDefaults` so an older draft can still be revised). Embeds: a type that needs a browser permission adds it to the snippet's `allow` in `shareUrls.ts`, and to `Permissions-Policy` in `vercel.json` if it isn't there.
7. Check it in all 12 themes, at 375 px (ADR-062), light and dark, with reduced motion (ADR-059).
8. Update the README question-types list, and add Vitest specs. `tests/catalogCoverage.test.tsx` fails until a new type reaches every surface above; add its sample there.

## How to add a theme

1. Create `src/themes/<name>.ts` exporting `{ light, dark }` token sets matching the `Theme` shape.
2. Register it in `src/themes/index.ts`.
3. Mirror tokens in `src/styles/tokens.css`.
4. Update README "Theme system" table.
5. Add an example in `examples/` if the theme has unusual decoration.
6. Run `npm run test` — `tests/themeContrast.test.ts` enforces ≥3:1 contrast between `accent` and `bg` in both modes (ADR-024). Accent fills in components always use `color: var(--slate-on-accent)`; never hardcode `#fff`.

No engine changes should be needed.

## When you must add a runtime dep

The package's bundle budget is **<50kb gzipped for the engine** (per brief §2.9). Adding a runtime dep:

1. Open a new ADR in `DECISIONS.md` first.
2. Confirm tree-shaking works (lazy-import where possible).
3. Re-run `npm run build` and check output size.
4. If it pushes us over budget, the dep doesn't ship. Find another way.

Current runtime deps: `libphonenumber-js` (lazy-imported inside `PhoneField.tsx` only).

## Testing expectations

- `src/logic/*` is pure — every file gets unit tests, edge cases too.
- `src/hooks/*` — React Testing Library + Vitest.
- `src/components/*` — render + interaction tests for the engine and one snapshot per question type.
- Run `npm run test` before every commit. CI enforces it.

## When you're stuck

Ask. The brief is canonical. The prototype is illustrative. ADRs in `DECISIONS.md` capture every architectural choice. Everything else is conversation.
