# Migration Notes

Versioning protocol and upgrade guidance for `@palmstreetweb/slate`.

## Semver protocol

We follow [semver](https://semver.org/) strictly:

| Change | Bump |
|---|---|
| Bug fix, no API change | patch (`x.y.Z`) |
| New question type, new prop, new theme | minor (`x.Y.0`) |
| Removed/renamed prop, changed default behavior, changed `Answers` shape | **major** (`X.0.0`) |
| Theme token rename (consumers may have CSS reading the old token) | **major** |
| Internal refactor invisible to consumers | patch |

### Pre-1.0

While on `1.0.0-beta.*`, breaking changes ship in any beta increment. Once we promote to `1.0.0`, the table above governs.

## Breaking-change template

Every major version bump must include an entry in this file using the template below.

```markdown
## v2.0.0 — YYYY-MM-DD

### Breaking
- **What changed.** One-line summary.
  - **Before:** code snippet.
  - **After:** code snippet.
  - **Why:** brief reasoning + link to the relevant ADR in DECISIONS.md.
  - **Migration:** step-by-step or codemod link.

### Added
- New non-breaking features.

### Changed
- Non-breaking behavior tweaks.

### Fixed
- Bug fixes.
```

## Upgrade matrix

| From | To | Effort |
|---|---|---|
| `@palmstreetweb/forms@1.0.0-beta.1` | `@palmstreetweb/slate@1.0.0-beta.1` | Medium — see below |
| `@palmstreetweb/slate@1.0.0-beta.1` | `@palmstreetweb/slate@1.0.0-beta.2` | Low — check the Breaking list below |

## v1.0.0-beta.2 — 2026-10-05 (QA pass, ADR-069)

The QA pass of 2026-10 (ADR-069) tested every question type and option. The changes a host can notice are below; ADR-069 has the rest. While on `1.0.0-beta.*` these ship in a beta increment (ADR-007), so the version is `1.0.0-beta.2`.

### Breaking
- **`onSubmit`, `onPartialChange` and `onQuestionChange` get the answers on the respondent's path.** Answers to questions a logic jump now passes over (the respondent went Back and took the other branch) are left out, as hidden ones already were. They stay in the form's state, so taking that branch again brings them back.
  - **Before:** a skipped question kept its answer in the payload while its `visibleIf` passed (ADR-015).
  - **After:** only the questions on the path the answers lead through (`pathOf`, ADR-069 part A §4).
  - **Why:** the respondent's answers are what they would see on Review; a branch they backed out of isn't part of them.
  - **Migration:** nothing for most hosts. A host that relied on answers from an abandoned branch should model them as answers on the path (or a `visibleIf` question) instead.
- **`<Form>` no longer runs the `psw-*` → `slate-*` storage migration** (the ADR-025 shim, past its ~2026-07-15 removal date).
  - **Before:** on first mount, `<Form>` copied the legacy `psw-forms-theme` and `psw-forms-resume:<schema.id>` keys (saved before the 2026-06-14 rebrand) to `slate-forms-theme` and `slate-forms-resume:<schema.id>`.
  - **After:** it doesn't; a light / dark choice or a resume session saved only under a `psw-*` key isn't picked up.
  - **Why:** the shim's removal date had passed, and the engine needed its bytes (ADR-069).
  - **Migration:** none for anything saved since the rebrand. A host that must still pick up older ones can copy those `localStorage` keys to their `slate-*` names before mounting `<Form>`.
- **Text answers stop at 10,000 characters when `maxLength` is unset**, what the Slate server keeps; text is never cut while typing (the `maxlength` attribute is gone): a counter shows near the limit, and OK asks for a shorter answer.
  - **Migration:** set `maxLength` if your own storage keeps less, or more is wanted (the Slate server keeps up to 64 KiB).
- **`formatFileUploadError` shows a host's message only from a plain `Error`.** Any other error class (`TypeError`, `DOMException`, your own subclasses) gets the plain fallback, so no technical text reaches respondents.
  - **Migration:** reject `onFileUpload` with `new Error('A sentence for the respondent.')` when its text should show.
- **The file field checks `accept` itself.** A file whose type isn't in the list is refused with a plain sentence before `onFileUpload` is called (dragged-in files no longer skip the picker's filter). A list the filter can read none of takes every file.
- **"Try again" after an on-demand part fails to download reloads the page**, on the respondent's tap only (browsers won't fetch a failed module again). Use `resume="tab"` so the answers come back after it; `<Form>` never reloads the page by itself.
- **The form scrolls the host page to a new question's top** when the page was scrolled past it (`scrollIntoView` on the form's wrapper, never on `<html>`), so the title and Back are in view after a tall question.
- **Bounds set the wrong way round are read safely.** A `number` or `date` question with `min` above `max` ignores both limits; a `scale` is drawn from the lower number to the higher. A scale draws at most 101 cells (it was 21).
- **`checkSchema` messages are new owner sentences** (the `kind`s are unchanged): match on `kind`, never on the text.

### Added
- `resume: 'tab'`: save-and-resume in `sessionStorage`, kept through a reload in the same tab only (ADR-017 addendum).
- Optional one-tap questions (single choice, yes / no, picture choice, ratings, NPS, consent) offer **Skip**, and Enter skips them; multiple-pick questions say their rule up front ("Pick up to 3") and the maximum blocks further picks (ADR-069).
- Question types and options added since beta.1 (ADR-063 to ADR-068) are additive; the README's question-type table lists them.

### Changed
- A redirect without a scheme (`example.com/thanks`) opens as https; `/path` stays on the page's own site.
- A held Enter (key repeat) never confirms a question.
- `SLATE_IMAGE_TYPE_HINT` reads "Try a different photo."
- `focusAfter` doesn't move focus inside an element marked `data-slate-preview` (the studio's live preview).
- Respondent messages are plain sentences throughout: no codes, ISO dates or raw server text.

### Fixed
- Respondents are never trapped by settings nobody could meet: pick limits above the choices, optional questions with no way past, bounds set the wrong way round (ADR-069 parts A and B).

## v1.0.0-beta.1 — 2026-06-14 (Slate rebrand)

### Breaking
- **Package renamed** `@palmstreetweb/forms` → `@palmstreetweb/slate`.
  - **Before:** `import { Form } from '@palmstreetweb/forms'`
  - **After:** `import { Form } from '@palmstreetweb/slate'`
  - **Why:** ADR-025 — unified Slate product identity.
  - **Migration:** Update `package.json` dependency + all imports/stylesheet paths. CSS: `@palmstreetweb/slate/styles.css`.
- **DOM/CSS tokens renamed** `psw-*` → `slate-*`.
  - **Before:** `[data-psw-forms]`, `.psw-input`, `--psw-accent`
  - **After:** `[data-slate-forms]`, `.slate-input`, `--slate-accent`
  - **Migration:** Update any host-page CSS overrides. In-progress resume sessions migrated automatically via the built-in localStorage shim (legacy keys copied on first load) until 1.0.0-beta.2, which removed the shim from `<Form>` (see above).
- **Dev-tool brand** Studio → Slate (examples only; not published).

### Added
- `migrateSlateLocalStorageKeys()` shim (temporary; remove ~2026-07-15). `<Form>` stopped running it in 1.0.0-beta.2.

### Changed
- Admin localStorage keys: `psw-studio-*` → `slate-theme`, `slate-forms`, `slate-submissions`.

### Fixed
- _(none)_

---

## Upgrade matrix (legacy)

| From | To | Effort |
|---|---|---|
| _(no other upgrades yet)_ | | |

## Pre-release path

1. `1.0.0-beta.1` — initial private publish, dogfood on Wild Wash.
2. After 2 weeks of Wild Wash production traffic with no major bugs: promote to `1.0.0`.
3. Backport into Wallace Plumbing.
4. 805 Sealcoating lead intake.
5. PSW v2 contact page.

## Deprecation policy

When a public-facing API needs to change:

1. Add the new API in a minor release.
2. Mark the old one with a `@deprecated` JSDoc tag and a console warning in dev mode (`process.env.NODE_ENV !== 'production'`).
3. Document the migration path in this file under the relevant version.
4. Remove the old API in the next major release (no sooner than two minors after deprecation).

Never remove a public API in a minor release.
