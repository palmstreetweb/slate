# QA Golden Sweep — Bug Log

Branch: `qa/golden-sweep`  
Date: 2026-06-14  
Scope: `@palmstreetweb/slate` form engine + `examples/_admin` builder (localStorage). Phases 5–6 from the original prompt (Supabase, Resend, Playwright) are **N/A** for this repo — see Final Report.

Format: **ID | Phase | Severity | Surface | Root Cause | Fix | Status**

---

## Bug log

| ID | Phase | Severity | Surface | Root Cause | Fix | Status |
|----|-------|----------|---------|------------|-----|--------|
| GS-001 | 1 | Medium | Admin / delete form | `deleteForm()` removed form record but left submissions in `slate-submissions` | Call `clearSubmissions(formId)` inside `deleteForm()` | Fixed |
| GS-002 | 1 | Medium | Admin / autosave | `write()` swallowed `localStorage` quota/errors; UI showed "Saved" on failure | `write()` returns boolean; `updateForm()` returns `[record, persisted]`; editor shows save error | Fixed |
| GS-003 | 1 | High | Admin / confirm dialog | Global Enter key confirmed destructive dialogs | Removed document-level Enter→confirm handler | Fixed |
| GS-004 | 2 | High | Engine / navigation | Step history stored **indices**; visibility changes remapped steps incorrectly after Back | History stores question **IDs**; `set_answer` remaps step by current question id | Fixed |
| GS-005 | 2 | High | Engine / auto-advance | `setTimeout` from auto-advance fields fired after Back/step change (ghost advance) | `useAutoAdvanceTimer` clears timers on step change/unmount | Fixed |
| GS-006 | 2 | Medium | Engine / submit | Rapid double-submit could race async `onSubmit` | Generation counter invalidates stale submit promises | Fixed |
| GS-007 | 2 | Medium | Engine / dropdown | Stale selection when filter query diverged from stored value; weak keyboard listbox a11y | Validate from query text; clear stale selection; `aria-activedescendant` | Fixed |
| GS-008 | 2 | Medium | Engine / NPS & scale | Keyboard could not compose two-digit values (e.g. 10) | `scaleStep.ts` + keyboard compose in `useKeyboardNav`; validation step check | Fixed |
| GS-009 | 2 | Low | Engine / phone | Enter could double-advance while async phone validation ran | `submittingRef` guard in `PhoneField` | Fixed |
| GS-010 | 3 | Medium | Admin / FormEditor | Navigating to deleted form left stale editor state | Subscribe to store; redirect + error when form missing | Fixed |
| GS-011 | 3 | Medium | Admin / FormEditor | StrictMode double-mount on `/forms/new` created duplicate forms | Creation guard ref | Fixed |
| GS-012 | 3 | Medium | Admin / bulk delete | Select mode exited even when confirm was cancelled | Only exit select mode after successful confirm | Fixed |
| GS-013 | 3 | Low | Admin / LogicEditor | Composite jump rules had no Remove control | Added Remove button per rule | Fixed |
| GS-014 | 3 | Low | Admin / LogicEditor | New condition rules defaulted `field: ''` (invalid) | `defaultConditionField()` picks first answer-bearing question | Fixed |
| GS-015 | 3 | Low | Admin / LogicEditor | Accidental removal of `isAnswerBearing` broke build | Restored helper before `defaultConditionField` | Fixed |
| GS-016 | 3 | Medium | Admin / Outline | Add-question popover clipped inside scroll container | Portal popover to `document.body` | Fixed |
| GS-017 | 3 | Medium | Admin / SlateSelect | Arrow keys did not move highlight; duplicate React keys on options | Keyboard nav + stable keys | Fixed |
| GS-018 | 3 | Medium | Admin / SharePanel | Focus escaped modal on Tab | `useFocusTrap` on share panel | Fixed |
| GS-019 | 3 | Low | Admin / Dashboard | Corrupt `localStorage` JSON crashed list silently | Parse guard + recovery banner | Fixed |
| GS-020 | 3 | Low | Admin / createForm | Quota failure returned phantom form id | `createForm()` returns `null` on write failure | Fixed |
| GS-021 | 3 | Low | Admin / Inspector | "+ Add rule" button styling broken (invisible/wrong size) | `slate-btn--compact` variant | Fixed |
| GS-022 | 3 | Medium | Admin / Responses | Raw JSON "Meta + raw payload" exposed to authors; answers showed internal option values | `responsesFormat.ts` + lead preview / Q&A stack with `formatAnswerForQuestion` | Fixed |
| GS-023 | 3 | Medium | Admin / FormSubmissions | Missing `AdminShell` import; duplicate `titleOf` vs import — typecheck failed | Import `AdminShell`; remove local `titleOf`; drop dead `formatValue` | Fixed |
| GS-024 | 1 | Low | Tooling / ESLint | `examples/dist/**` linted as source | Added ignore in `eslint.config.mjs` | Fixed |
| GS-025 | 7 | Low | Tests / setup | Node 22+ warns when `localStorage` exists but is unusable | Probe read/write in `tests/setup.ts`; polyfill memory storage when needed | Fixed |

---

## Phases not applicable (architecture)

| Phase | Reason |
|-------|--------|
| 5 — Supabase / RLS / public token | No Supabase in this repo; persistence is browser `localStorage` (`slate-forms`, `slate-submissions`). No server-side token surface to audit. |
| 6 — Playwright public E2E | No Playwright harness; coverage via **282 Vitest** tests (engine RTL, logic pure functions, admin helpers). Manual respondent flow available via `npm run dev` → admin preview + public form routes. |
| Resend email | Not integrated in v1 admin (ADR-018 local-only tool). |

---

## DESIGN-TOUCHING (deferred for Caleb)

Visual/CSS changes intentionally **not** made during design freeze:

1. **Responses list polish** — dedicated CSS classes, spacing rhythm, and typography for collapsed/expanded rows (current fix uses existing inline structure + data formatting only).
2. **`/brand/` deploy path** — brand page exists at `brand/index.html` but is not wired into `examples` Vercel build.
3. **Prior `_adminTheme.css` tweaks** from earlier sessions (compact buttons, outline focus) — already in working tree; not reverted to avoid churn.

---

## Verification (final)

```
npm run typecheck   ✓
npm run lint        ✓
npm run test        ✓  (282 tests)
npm run build       ✓
npm run build:examples ✓
```

Branch `qa/golden-sweep` is ready for review. **Not committed** (per user preference — commit on request).
