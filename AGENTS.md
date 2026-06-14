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
├── styles/        tokens.css, toggle.css, animations.css, base.css
├── utils/         focus, letters, tokens (small helpers)
├── types/         Question.ts, Schema.ts, Answers.ts, Theme.ts (+ barrel)
└── index.ts       public exports barrel
examples/          dev-only demos served by `npm run dev`
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

1. Add the type to `src/types/Question.ts` discriminated union.
2. Add a validator branch in `src/logic/validation.ts`.
3. Create `src/components/questions/<NewType>Field.tsx`.
4. Wire it into `src/components/Form.tsx`'s renderer switch.
5. Update the README question-types list.
6. Add at least one Vitest spec.

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
