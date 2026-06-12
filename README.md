# `@palmstreetweb/forms`

> Conversational form-rendering library for Palm Street Web client projects. Schema in → Typeform-quality form out.

**Status:** `1.0.0-beta.1`. Internal Palm Street Web tooling — restricted npm scope.

---

## Install

```bash
npm install @palmstreetweb/forms
```

You also need React ≥ 18 (the package declares it as a peer dep) and the bundled stylesheet:

```ts
import '@palmstreetweb/forms/styles.css';
```

## 30-second quickstart

```tsx
'use client';
import { Form, defineSchema } from '@palmstreetweb/forms';
import '@palmstreetweb/forms/styles.css';

const schema = defineSchema({
  brand: { name: '805 Sealcoating' },
  theme: 'editorial',
  themeMode: 'toggle',
  questions: [
    { id: 'welcome', type: 'welcome', title: 'Hey there.', cta: 'Start' },
    { id: 'name',    type: 'short_text', title: "What's your first name?", required: true },
    { id: 'email',   type: 'email', title: 'Best email?', required: true },
    {
      id: 'service', type: 'single_choice', title: 'Which service?',
      options: [
        { label: 'Sealcoating', value: 'sealcoat' },
        { label: 'Striping',    value: 'striping' },
      ],
    },
    { id: 'done', type: 'thanks', title: "You're all set." },
  ],
});

export default function QuotePage() {
  return (
    <Form
      schema={schema}
      onSubmit={async (answers, meta) => {
        await fetch('/api/quote', {
          method: 'POST',
          body: JSON.stringify({ answers, meta }),
        });
      }}
    />
  );
}
```

`defineSchema` preserves literal types — inside `onSubmit`, autocomplete on `answers.` reveals `name`, `email`, and `service: 'sealcoat' | 'striping'` typed correctly.

## API reference

### `<Form>` props

| Prop | Type | Required | Notes |
|---|---|---|---|
| `schema` | `Schema` | ✓ | Wrap with `defineSchema` for full type inference. |
| `onSubmit` | `(answers, meta) => void \| Promise<void>` | ✓ | Fires exactly once on entering `thanks`. Async errors flip the thanks screen to a Retry state. |
| `onQuestionChange` | `(questionId, answers) => void` |  | Fires on every step transition. Good for analytics. |
| `hiddenFields` | `Record<string, unknown>` |  | Passed through to `meta.hiddenFields`. Never rendered. |
| `errorMessage` | `string` |  | Fallback shown when `onSubmit` rejects (default: "Something went wrong submitting your form. Please try again."). |
| `onFileUpload` | `(file, questionId) => Promise<string>` |  | Host-controlled storage for `file_upload` questions. Resolved string is stored as the answer; omit it to receive raw `File` objects in `onSubmit`. See `DECISIONS.md` ADR-012. |
| `resume` | `boolean` |  | Save-and-resume (ADR-017). Autosaves progress to `localStorage` under `psw-forms-resume:<schema.id>`, prompts to resume on remount, clears on submit. Requires `schema.id`. |
| `onPartialChange` | `(answers, meta) => void` |  | Fires on every answer change with the visibility-filtered answers — abandonment capture. `meta` carries `startedAt`, `lastQuestionId`, `questionsVisited`, `hiddenFields`, `score`. |

### `defineSchema(schema)`

Identity helper — returns the schema unchanged but freezes literal types via TypeScript 5.x `const` type parameters. Use it on every schema; it has zero runtime cost.

### `Schema` shape

```ts
type Schema = {
  brand: { name: string; logo?: string };
  theme: 'editorial' | 'swiss' | (string & {});
  themeMode: 'auto' | 'light' | 'dark' | 'toggle';
  questions: ReadonlyArray<Question>;
};
```

`themeMode` decides whether to render the toggle UI:

| Mode | Behavior |
|---|---|
| `'auto'` | Reactively follows `prefers-color-scheme`. No toggle. |
| `'light'` \| `'dark'` | Forced. No toggle. |
| `'toggle'` | Reads `localStorage['psw-forms-theme']` → host page `<html data-theme>` → `prefers-color-scheme` → `'dark'`. Renders the PSW pill toggle. |

### Question types

Every question has `id: string` and (where applicable) an optional `visibleIf?: Condition`. Stored answer types per the brief:

| `type` | Schema additions | Validation | Stored as |
|---|---|---|---|
| `welcome` | `title`, `subtitle?`, `cta?` (default `'Start'`) | — | _not stored_ |
| `statement` | `title`, `body?`, `cta?` (default `'Continue'`) | — | _not stored_ |
| `short_text` | `title`, `placeholder?`, `required?`, `maxLength?`, `pattern?`, `patternError?` | required + pattern | `string` |
| `long_text` | `title`, `placeholder?`, `required?`, `maxLength?` | required + maxLength | `string` |
| `email` | `title`, `placeholder?`, `required?` | RFC-lite regex | `string` |
| `phone` | `title`, `placeholder?`, `required?`, `defaultCountry?` (default `'US'`) | E.164 normalization via `libphonenumber-js` | `string` (E.164) |
| `url` | `title`, `placeholder?`, `required?` | website shape; bare domains get `https://` prefixed | `string` |
| `number` | `title`, `placeholder?`, `min?`, `max?`, `step?`, `required?` | range | `number` |
| `date` | `title`, `required?`, `format?` (`'MM/DD/YYYY'` default), `min?`, `max?` (ISO) | real calendar date + bounds | `string` (ISO `YYYY-MM-DD`) |
| `file_upload` | `title`, `required?`, `accept?`, `maxSizeMb?` | presence + size | `File`, or `string` via `onFileUpload` |
| `single_choice` | `title`, `options: Option[]`, `required?` (default `true`) | required | `string` |
| `multi_choice` | `title`, `options: Option[]`, `min?`, `max?` | min/max selections | `string[]` |
| `dropdown` | `title`, `options: Option[]`, `placeholder?`, `required?` (default `true`) | required | `string` |
| `picture_choice` | `title`, `options: PictureOption[]`, `multiple?`, `required?`, `min?`, `max?` | required / min-max | `string` or `string[]` |
| `ranking` | `title`, `options: Option[]` | full permutation | `string[]` (ordered) |
| `matrix` | `title`, `rows: Option[]`, `columns: Option[]`, `multiple?`, `required?` | all rows when required | `Record<row, col \| col[]>` |
| `yes_no` | `title`, `yesLabel?`, `noLabel?`, `required?` (default `true`) | required | `'yes' \| 'no'` |
| `legal` | `title`, `body?`, `acceptLabel?`, `declineLabel?`, `required?` (default `true`) | required | `'accept' \| 'decline'` |
| `scale` | `title`, `min`, `max`, `minLabel?`, `maxLabel?`, `step?`, `required?` | range | `number` |
| `nps` | `title`, `minLabel?`, `maxLabel?`, `required?` | 0–10 | `number` |
| `review` | `title`, `subtitle?`, `cta?`, `visibleIf?` | — | _not stored; lists answers with jump-to-edit_ |
| `thanks` | `title`, `subtitle?`, `cta?`, `visibleIf?`, `redirectUrl?` | — | _not stored; fires `onSubmit`_ |

`Option` is `{ label: string; value: string; description?: string; score?: number }`. `PictureOption` adds `{ src: string; alt?: string }`.

### Answer piping

`{{field:questionId}}` in any `title`, `subtitle`, or `body` is replaced with the formatted answer; `{{score}}` resolves to the running score total. Unanswered fields resolve to `''`.

```ts
title: "Nice to meet you, {{field:name}}. What's your email?"
```

Function-style titles still work (and are piped after they run):

```ts
title: (answers) => `Nice to meet you, ${answers.name}. What's your email?`
```

### Conditional logic (`visibleIf`)

```ts
type Condition =
  | { field: string; op: 'equals' | 'not_equals'; value: string | number }
  | { field: string; op: 'in' | 'not_in'; value: ReadonlyArray<string | number> }
  | { field: string; op: 'gt' | 'lt' | 'gte' | 'lte'; value: number }
  | { field: string; op: 'is_empty' | 'is_not_empty' }
  | { all: ReadonlyArray<Condition> }
  | { any: ReadonlyArray<Condition> };
```

Composable infinitely. Unknown fields are treated as empty. For `multi_choice` (array) answers, `equals` checks membership and `in` checks any-of-overlap.

**Retain-but-exclude semantics:** if a question's `visibleIf` later evaluates false, its previously-collected answer is _retained in internal state_ (so toggling back doesn't lose data) but _excluded from the `onSubmit` payload_. See [`DECISIONS.md`](./DECISIONS.md) ADR-005.

### Logic jumps (`logic`)

Any answer-bearing question (and `statement`) can carry jump rules, evaluated when the user advances from it — first match wins, no match falls through to the next question:

```ts
{
  id: 'interested',
  type: 'yes_no',
  title: 'Interested in a quote?',
  logic: [{ if: { field: 'interested', op: 'equals', value: 'no' }, goTo: 'polite_end' }],
}
```

Jumps change navigation only; skipped questions keep their `visibleIf`-based inclusion in the submit payload (ADR-015). Back returns to the jump origin.

### Schema sanity checking

`checkSchema(questions)` is a pure helper that returns `SchemaIssue[]` — duplicate ids, `visibleIf`/jump conditions referencing unknown questions, and dangling or self jump targets. The engine is forgiving at runtime (bad refs fall through to normal flow); use this in CI or on save to catch authoring mistakes early. The PSW Studio surfaces these in an editor banner.

```ts
import { checkSchema } from '@palmstreetweb/forms';
const issues = checkSchema(schema.questions); // [] when clean
```

### Scoring and multiple endings

Give options a `score` and the engine accumulates a total — available in piping as `{{score}}` and delivered in `SubmitMeta.score` (ADR-016). Several `thanks` screens can coexist, each gated by `visibleIf`; the first visible one is shown. A `redirectUrl` on a thanks screen navigates there after `onSubmit` resolves.

### `SubmitMeta`

```ts
type SubmitMeta = {
  startedAt: Date;
  completedAt: Date;
  durationMs: number;
  /** Ordered IDs of questions actually shown. */
  questionsVisited: string[];
  /** The hiddenFields prop, passed through unchanged. */
  hiddenFields: Record<string, unknown>;
  /** Total of option-level `score` values (0 when nothing is scored). */
  score: number;
};
```

### Keyboard

| Key | Action |
|---|---|
| `Enter` | Advance from welcome / statement; submit text-type fields |
| `Shift + Enter` | New line in `long_text` |
| `A`–`F` | Select choice option (also `picture_choice` and `legal` accept/decline) |
| `Y` / `N` | Answer `yes_no` questions |
| `0`–`9` | Select scale / NPS value (within range) |
| `↑` / `↓` + `Enter` | Navigate + select in `dropdown` |
| `Tab` / `Shift+Tab` | Standard browser focus order |

`Esc → back` is opt-out by default to prevent accidental loss; not currently exposed as a `<Form>` prop (planned for V1.1).

## Theme system

Two themes ship built-in, each with light and dark token sets:

| Theme | Vibe | Display font | Body font | Accent (light → dark) |
|---|---|---|---|---|
| `editorial` | Refined serif, warm cream | Fraunces | Fraunces | `#2D5BFF` → `#6E8FFF` |
| `swiss` | Bold geometric, lowercase | Inter (900) | Inter | `#DC2626` → `#F87171` |

(Swiss originally shipped with Archivo Black; it was swapped for Inter as a closer Akzidenz-Grotesk substitute — see `DECISIONS.md` ADR-009.)

Each theme can carry a `decoration` hint: `editorial` renders a subtle grain overlay; `swiss` renders a rotating set of geometric poster compositions behind each step.

Both are wrapper-scoped on `[data-psw-forms]` — the package never writes to your host page's `<html>`. The PSW theme toggle is a 1:1 visual port of palmstreetweb.com (same morph, same easing).

### Customizing tokens

Override per-token via CSS specificity at the wrapper level:

```css
[data-psw-forms][data-theme-name='editorial'] {
  --psw-accent: #ff5500;
  --psw-radius: 8px;
}
```

A custom-theme registry API ships in V1.1 (`themes.register()`).

## Examples

The `examples/` folder isn't published. It hosts **PSW Studio**, a supported internal dev tool (ADR-018) for building and previewing forms:

- Dashboard listing locally-stored form definitions (with two seed schemas).
- Three-pane editor (outline / canvas / inspector) with drag-and-drop reordering, duplication, bulk delete, a visual logic editor (conditions, jumps, scores), and a schema-issue banner powered by `checkSchema`.
- Live `<Form>` preview (with save-and-resume on) and a responses inbox with CSV export and per-question summaries, all backed by `localStorage`.

Run `npm run dev` and open the printed URL to use it.

## Still deferred

Per [`DECISIONS.md`](./DECISIONS.md), currently out of scope (each gets an ADR when scheduled):

- iframe / HTML script-tag embed
- Built-in analytics event bus (use `onQuestionChange`)
- Translation / i18n system
- Multi-tenant form-storage backend
- Client-facing admin dashboard
- Payments

## Bundle

The engine is **<55kb gzipped** before `libphonenumber-js`, which is dynamically imported only inside `PhoneField.tsx` (~16kb gz extra, paid only when a phone question renders). React is a peer dependency, not bundled.

## Repo

Internal contributors should read [`AGENTS.md`](./AGENTS.md) for repo conventions and [`CLAUDE.md`](./CLAUDE.md) for AI-agent guidance. Architectural changes go through ADRs in [`DECISIONS.md`](./DECISIONS.md). Versioning protocol lives in [`MIGRATION_NOTES.md`](./MIGRATION_NOTES.md).

## License

UNLICENSED — proprietary, internal use only by Palm Street Web. See [`LICENSE`](./LICENSE).
