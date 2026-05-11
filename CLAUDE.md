# CLAUDE.md

Claude-specific operating notes for this repo. Read alongside [`AGENTS.md`](./AGENTS.md).

## Before structural changes

Always read [`DECISIONS.md`](./DECISIONS.md) end-to-end before proposing a change that:

- Adds, removes, or restructures a top-level folder under `src/`.
- Adds a runtime dependency.
- Changes the public API exported from `src/index.ts`.
- Touches the PSW theme toggle CSS in `src/styles/toggle.css` (verbatim port; tweaks need a new ADR).
- Changes the `localStorage` key (`psw-forms-theme`) or any user-visible config name.

If an ADR already covers the area, follow it. If not, propose a new ADR in your response *before* writing the code.

## The brief is canon

[`BUILD_BRIEF.md`](./BUILD_BRIEF.md) is the source of truth for v1. If something in the brief looks wrong, surface it as a question — don't silently deviate. If the brief is silent, you have judgment; document the choice in a new ADR.

## The prototype is reference, not production

[`intake-form.jsx`](./intake-form.jsx) is the visual fidelity target. Read it for layout, spacing, animation timing, copy tone. **Never import from it. Never modify it.** Production code is fully rewritten in TypeScript with the theme registry and token system per the brief.

## Token discipline

Inside `src/components/**`, the only color values allowed are CSS variable references (`var(--accent)`, `rgb(var(--accent-rgb) / 0.2)`). Hex literals belong in `src/styles/tokens.css` and `src/themes/*.ts`. If you find yourself reaching for `#FAF6EE` inside a component, stop — that token already exists.

## Wrapper-scoped, always

The form is embedded in someone else's page. We **read** `document.documentElement.dataset.theme` on first mount for inheritance, but we **never write** to `<html>` or any element outside our wrapper. The wrapper is the element with `data-psw-forms` attached.

## When tests break

Don't loosen the test to make it pass. If a test is wrong, fix the test for the right reason — and explain why in the commit. If a behavior changed intentionally, update the test along with the implementation in the same commit.

## Pause-for-me cadence

The build proceeds in phases (see `BUILD_BRIEF.md` and the golden prompt). At each PAUSE FOR ME, stop and surface:

1. What was built in that phase.
2. Anything that surprised you or required judgment.
3. Open questions for the next phase.

Don't roll multiple phases together.

## Commit hygiene

Conventional Commits. One commit per phase minimum (`feat:`, `chore:`, etc.). Reference the phase in the body if useful. Never amend a previous commit — make a new one.

## On asking vs. guessing

The brief tells you what to do. The prototype shows you how it should feel. When both are silent: ask. Better to interrupt for thirty seconds than to drift for thirty minutes.
