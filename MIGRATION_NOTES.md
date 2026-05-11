# Migration Notes

Versioning protocol and upgrade guidance for `@palmstreetweb/forms`.

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
| _(no upgrades yet — initial beta)_ | | |

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
