# Slate (`@palmstreetweb/slate`)

> Slate — conversational form engine for Palm Street Web client projects. Schema in → Typeform-quality form out.

**Status:** `1.0.0-beta.2`. Internal Palm Street Web tooling — restricted npm scope.

**Live demo:** [slateforms.vercel.app](https://slateforms.vercel.app) — also `npm run dev` locally

**Admin backend:** Neon (Data API + Auth + Object Storage + Functions). Setup: [`neon/SETUP.md`](./neon/SETUP.md) · Deploy: [`DEPLOY.md`](./DEPLOY.md)

**Brand reference:** [slateforms.vercel.app/brand](https://slateforms.vercel.app/brand) (static page in [`brand/`](./brand/))

---

## Install

```bash
npm install @palmstreetweb/slate
```

You also need React ≥ 18 (the package declares it as a peer dep) and the bundled stylesheet:

```ts
import '@palmstreetweb/slate/styles.css';
```

## 30-second quickstart

```tsx
'use client';
import { Form, defineSchema } from '@palmstreetweb/slate';
import '@palmstreetweb/slate/styles.css';

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
| `onSubmit` | `(answers, meta) => void \| Promise<void>` | ✓ | Fires exactly once on entering `thanks`, with the answers on the respondent's path (ADR-069). Async errors flip the thanks screen to a Retry state. |
| `onQuestionChange` | `(questionId, answers) => void` |  | Fires on every step transition. Good for analytics. |
| `hiddenFields` | `Record<string, unknown>` |  | Passed through to `meta.hiddenFields`. Never rendered. |
| `errorMessage` | `string` |  | Fallback shown when `onSubmit` rejects (default: "Something went wrong submitting your form. Please try again."). |
| `onFileUpload` | `(file, questionId) => Promise<string>` |  | Host-controlled storage for `file_upload` questions. Resolved string is stored as the answer; omit it to receive raw `File` objects in `onSubmit`. See `DECISIONS.md` ADR-012. |
| `resume` | `boolean \| 'tab'` |  | Save-and-resume (ADR-017). Autosaves progress to `localStorage` under `slate-forms-resume:<schema.id>`, prompts to resume on remount (Resume or Start over), clears on submit. `'tab'` uses `sessionStorage` instead: it survives a reload, back / forward and a phone discarding the tab, and goes with the tab when the browser copies it (a duplicated tab, a closed tab reopened, a restored session); it is offered back only within 30 minutes of the last answer. Requires `schema.id`. With either, a question whose part didn't download reloads the page when the respondent taps Try again (the answers come back); without `resume` the form never reloads your page — Try again asks for the part again in place, and the message says the page can be reloaded. |
| `onPartialChange` | `(answers, meta) => void` |  | Fires on every answer change with the answers on the respondent's path, as `onSubmit` gets them (hidden questions and a branch they backed out of are left out) — abandonment capture. `meta` carries `startedAt`, `lastQuestionId`, `questionsVisited`, `hiddenFields`, `score`. |

### `defineSchema(schema)`

Identity helper — returns the schema unchanged but freezes literal types via TypeScript 5.x `const` type parameters. Use it on every schema; it has zero runtime cost.

### `Schema` shape

```ts
type Schema = {
  id?: string;
  brand: { name: string; logo?: string };
  theme: 'classic' | 'editorial' | 'swiss' | (string & {});
  themeMode: 'auto' | 'light' | 'dark' | 'toggle';
  /** Opt-in step sound: `'off'` or one of ten built-in presets (ADR-023).
   *  When on, text fields also play typewriter key ticks (ADR-034). */
  sound?: FormSound | boolean;
  /** Instant estimate settings (ADR-064): currency, base price, labels, breakdown. */
  estimate?: EstimateSettings;
  questions: ReadonlyArray<Question>;
};
```

`brand.logo` shows left of the brand name (24px tall, width from its aspect ratio, max 160px) when it is an `https:` URL, a same-origin `/path`, or a base64 PNG/JPEG/WebP/GIF `data:` URL. Anything else — or an image that fails to load — falls back to the name alone.

`themeMode` decides whether to render the toggle UI:

| Mode | Behavior |
|---|---|
| `'auto'` | Reactively follows `prefers-color-scheme`. No toggle. |
| `'light'` \| `'dark'` | Forced. No toggle. |
| `'toggle'` | Reads `localStorage['slate-forms-theme']` → host page `<html data-theme>` → `prefers-color-scheme` → `'dark'`. Renders the PSW pill toggle. |

### Question types

Every question has `id: string` and (where applicable) an optional `visibleIf?: Condition`. Stored answer types per the brief:

| `type` | Schema additions | Validation | Stored as |
|---|---|---|---|
| `welcome` | `title`, `subtitle?`, `cta?` (default `'Start'`) | — | _not stored_ |
| `statement` | `title`, `body?`, `cta?` (default `'Continue'`) | — | _not stored_ |
| `short_text` | `title`, `placeholder?`, `required?`, `maxLength?`, `pattern?`, `patternError?` | required + length (never cut: a counter near the limit; 10,000 when unset) + pattern | `string` |
| `long_text` | `title`, `placeholder?`, `required?`, `maxLength?` | required + length (never cut: a counter near the limit; 10,000 when unset) | `string` |
| `email` | `title`, `placeholder?`, `required?` | RFC-lite regex | `string` |
| `phone` | `title`, `placeholder?`, `required?`, `defaultCountry?` (default `'US'`; a blank or unknown one reads local numbers as US) | E.164 normalization via `libphonenumber-js`; if the checker can't download, a number with 7+ digits is kept as typed | `string` (E.164) |
| `url` | `title`, `placeholder?`, `required?` | website shape; bare domains get `https://` prefixed | `string` |
| `number` | `title`, `placeholder?`, `min?`, `max?`, `step?`, `required?`, `display?` (`'input'` \| `'stepper'`), `prefix?`, `unit?` | range ("1,000" and "$150" read as typed; bounds set the wrong way round are ignored) | `number` |
| `date` | `title`, `required?`, `format?` (`'MM/DD/YYYY'` default), `min?`, `max?` (ISO), `includeTime?`, `range?` | real calendar date + bounds, said in the form's own format (set the wrong way round, ignored); range in order; a 2-digit year is 20xx, years before 1900 are refused | `string`: `YYYY-MM-DD`, `YYYY-MM-DDTHH:MM` with a time, `start/end` for a range |
| `file_upload` | `title`, `required?`, `accept?`, `maxSizeMb?`, `multiple?`, `maxFiles?` | presence + size; max files when multiple (below 1 is 10); `accept` reads endings with or without the dot (`pdf, jpg`), MIME types (`image/*`) and the words "photos", "Word", "Excel" — a word it can't read is left out | `File` / `string`, or `(File \| string)[]` when `multiple` |
| `single_choice` | `title`, `options: Option[]`, `required?` (default `true`), `allowOther?`, `otherLabel?` | required | `string` (option value, or the typed Other text) |
| `multi_choice` | `title`, `options: Option[]`, `min?`, `max?`, `allowOther?`, `otherLabel?` | min/max selections, eased when nobody could meet them (ADR-069) | `string[]` (plus at most one typed Other text) |
| `dropdown` | `title`, `options: Option[]`, `placeholder?`, `required?` (default `true`), `allowOther?`, `otherLabel?` | required | `string` |
| `picture_choice` | `title`, `options: PictureOption[]`, `multiple?`, `required?`, `min?`, `max?`, `allowOther?`, `otherLabel?`, `display?` (`'grid'` \| `'swipe'`) | required / min-max | `string` or `string[]` |
| `ranking` | `title`, `options: Option[]` | full permutation | `string[]` (ordered) |
| `matrix` | `title`, `rows: Option[]`, `columns: Option[]`, `multiple?`, `required?` | all rows when required | `Record<row, col \| col[]>` |
| `yes_no` | `title`, `yesLabel?`, `noLabel?`, `required?` (default `true`), `display?` (`'buttons'` \| `'swipe'`) | required | `'yes' \| 'no'` |
| `legal` | `title`, `body?`, `acceptLabel?`, `declineLabel?`, `required?` (default `true`) | required | `'accept' \| 'decline'` |
| `scale` | `title`, `min`, `max`, `minLabel?`, `maxLabel?`, `step?`, `required?`, `display?` (`'numbers'` \| `'stars'` \| `'emoji'` \| `'slider'`), `sliderIcon?` | range (min and max set the wrong way round read in order; the cells draw at most 101 points, in wrapped rows) | `number` |
| `nps` | `title`, `minLabel?`, `maxLabel?`, `required?` | 0–10 | `number` |
| `contact_info` | `title`, `fields?` (`name` / `email` / `phone`: `'required'` \| `'optional'` \| `'off'`; default name + email required, phone optional), `defaultCountry?` | per part: required, email shape, phone parses | `{ name?, email?, phone? }` (phone as E.164) |
| `address` | `title`, `required?`, `line2?` (default `true`), `country?`, `format?` (`'us'` \| `'international'`), `serviceArea?` (ZIP codes or prefixes) | complete once started; 5-digit ZIP (US) | `{ street, line2?, city, region?, postal, country? }` |
| `signature` | `title`, `body?`, `required?`, `allowTyped?` (default `true`) | a real stroke, not a dot; or a typed name | `{ path }` (vector strokes, 500 × 200 box) or `{ typed }` |
| `image_pin` | `title`, `image?` (https or a small `data:image`), `imageAlt?`, `required?`, `maxPins?` (1–10, default 3), `notes?` (default `true`) | pins inside the photo, under the limit | `{ pins: ['x,y', …], notes?, img? }` (0–1 from the top left) |
| `voice_note` | `title`, `body?`, `required?`, `maxSeconds?` (5–300, default 60), `allowTyped?` (default `true`) | a recording or typed text | `{ audio, sec }` (a stored file) or `{ typed }` |
| `location` | `title`, `required?`, `center?` (`{ lat, lng }`), `radius?`, `radiusUnit?` (`'mi'` default \| `'km'`), `privacyNote?`, `keepLocation?` (default off) | coordinates, a ZIP or a place | sent as `{ lat, lng, area? }` (3 decimals) / `{ zip, area? }` / `{ typed }`; stored as `{ area?, via }` unless `keepLocation` (ADR-068) |
| `photo_checklist` | `title`, `items: Option[]`, `required?` (default `true`: every shot) | every shot when required | `{ [itemValue]: fileRef }` |
| `availability` | `title`, `required?`, `days?` (`'mon'`…`'sun'`, default Mon–Fri), `startTime?` / `endTime?` (`'HH:MM'`, default 08:00–18:00), `slotMinutes?` (15, 30, 60, 120) | at least one slot when required | `{ [day]: 'HH:MM-HH:MM,…' }` |
| `signup_slots` | `title`, `body?`, `slots: SignupSlot[]`, `required?` (default `true`), `maxPicks?` (1–50, default 1), `waitlist?`, `showRemaining?` (default `true`) | picks among the slots, at most `maxPicks`; waitlists only with `waitlist` | `{ slots: [value, …], wait?: [value, …] }` |
| `review` | `title`, `subtitle?`, `cta?`, `visibleIf?` | — | _not stored; lists the answers on the respondent's path with jump-to-edit; an edit comes back here_ |
| `thanks` | `title`, `subtitle?`, `cta?`, `visibleIf?`, `redirectUrl?`, `showEstimate?` | — | _not stored; fires `onSubmit`_ |

`Option` is `{ label: string; value: string; description?: string; score?: number; price?: number; priceMax?: number; features?: string[]; badge?: string }` (prices and card details from ADR-064). `PictureOption` adds `{ src: string; alt?: string }`. `SignupSlot` is `{ label: string; value: string; capacity: number; date?: string; start?: string; end?: string; description?: string }` (capacity 1–1,000; `date` ISO `YYYY-MM-DD`, times `HH:MM`).

**Options added in ADR-063** (Wave A of the question catalog expansion; BUILD_BRIEF §5 stays the canonical v1 table):

- **"Other: ___"** — `allowOther: true` on single / multi / dropdown / picture choice adds an Other choice (next letter key) with a text box. The typed text is stored in place of an option value; text that names an option is stored as that option. In conditions, `OTHER_VALUE` (exported) means "picked Other". Typed Other scores 0.
- **Prefill from the link** — `prefillKey` on text, number, date, choice, yes/no, scale and NPS questions, plus `<Form prefill={params}>`. Values are checked against the question and ignored when they don't fit; the respondent still sees and can change them. Consent, files, rankings and grids are never prefilled; `src`, `utm_*` and `embed` are reserved.
- **Scale styles** — `display: 'stars' | 'emoji' | 'slider'` (drawn faces in theme ink; the slider's face or stars react while dragging). Same `number` answer.
- **Quantity stepper** — `number` with `display: 'stepper'`: big − / + buttons, hold to repeat, `prefix` / `unit` shown around the value.
- **Date time / range** — `includeTime` (12-hour entry on month-first forms, 24-hour otherwise) and `range` (From / To).

**Added in ADR-064** (Wave B):

- **Instant estimate** — put a `price` (and `priceMax` for a range) on choice options, a `unitPrice` (and `unitPriceMax`) on number questions, and optionally `schema.estimate.base`. An ending with `showEstimate` reveals "Your estimate: $2,400 – $3,100" once the response is received (counting up; a line per priced answer with `estimate.breakdown`; `estimate.disclaimer` as small print). `{{estimate}}` pipes the same text into any copy, and `SubmitMeta.estimate` carries `{ low, high, currency, lines }`. A server that stores responses should recompute it from its own copy of the schema (the Slate submit Function does).
- **Package cards** — `display: 'cards'` on `single_choice` draws each option as a card with its price, `features` and `badge`. Same answer as the list.
- **Contact info**, **Address** and **Signature** — the three new types above. Addresses use the browser's autofill tokens (no lookup service). With a `serviceArea`, a condition can test `IN_AREA_VALUE` / `OUT_OF_AREA_VALUE` (exported) to route out-of-area answers to their own ending.

**Added in ADR-065** (Wave C):

- **Swipe cards** — `display: 'swipe'` on a multi-select `picture_choice` is a card stack: swipe right (or →, or ♥) to like, left to pass; the answer is the list of liked values, as the grid stores it. On `yes_no` it is one "this or that" card holding the question. Letter keys don't pick cards; the buttons and arrow keys always work.
- **Pin the spot**, **Voice note**, **Location**, **Photo checklist** and **Availability** — the five new types above. The microphone, the camera and the location are asked for only when the respondent taps. A location with a `center` and `radius` can be tested with `IN_AREA_VALUE` / `OUT_OF_AREA_VALUE`, like an address; a ZIP typed instead is checked against the form's address service areas. Voice notes and photos go through `onFileUpload`; without it they can't be stored (a voice note falls back to typing). A server that stores responses should re-derive pins, locations and availability from its own copy of the schema (the Slate submit Function does, so an "inside the area" verdict can't be forged).

**Changed in ADR-068** — a location stores only its verdict by default. `onSubmit` still receives the rounded coordinates (or the ZIP, or the place typed) so a server can re-check "inside the area"; after checking, the Slate submit Function keeps only `{ area?, via: 'gps' | 'zip' }` — no coordinates, no distance, no ZIP — or, for a place typed as words, `{ typed }` as written, unless the question has `keepLocation: true`, which stores the answer as above. The field always tells the respondent which: "We only save whether you're in the service area." (while typing: "We save what you type here, not your exact location.") or "Your approximate location (about 110 m) is shared with this business." (after the owner's `privacyNote`, which no longer replaces it). A host with its own server should do the same reduction before storing.

**Added in ADR-066** (Wave D):

- **Sign-up slots** — `signup_slots` lists slots with limited spots ("Sat 10–11am, 8 spots", "Bring drinks, 3 spots"); slots with a `date` are grouped by day. Pass live counts with `<Form slotsLeft={{ [questionId]: { [slotValue]: spotsLeft } }}>`: slots show "3 of 8 left" or "Full", and with `waitlist` a full slot can be joined as a waitlist instead. Taking the last spot gets its own moment. Capacity has to be enforced by whatever stores responses — the Slate submit Function takes each spot in the same transaction as the response (migration 020), so a slot never holds more people than its capacity. When a slot fills while someone is answering, reject `onSubmit` with an `Error` that carries `goTo: questionId`: the form returns to that question, shows the message there and keeps every answer. In conditions a slot's value means "took that slot"; `WAITLIST_VALUE` (exported) means "joined a waitlist".

Stars, faces, the slider, the stepper, date ranges / times, the file field, picture choice, ranking, the matrix, package cards, the contact block, the address, the signature pad, the estimate reveal, every Wave C UI, sign-up slots, the dropdown, plain date, number, phone, website, consent and NPS fields, multi choice and the Review step load on demand in their own chunks (`import { Form }` stays under the <50 kB budget; `node scripts/engine-size.mjs` after a build reports it).

**Pick limits (ADR-069).** A multiple-pick question (multi choice, picture choice with `multiple`, swipe cards) says its rule above the choices ("Pick up to 3", "Pick at least 2"), and once the most picks are made the other choices step back. A respondent is never held to a limit they can't meet: `min` counts at most the choices on offer (Other included) and rounds to whole picks, and a `max` below 1 or below `min` is ignored. Single choice, yes / no, single picture choice and package cards, and the numbers scale, NPS, legal consent, stars and faces offer **Skip** (and Enter, once the question has been up a moment) while nothing is picked — only with `required: false` set; a question with no `required` stays one-tap, as forms made before ADR-069 expect.

### Answer piping

`{{field:questionId}}` in any `title`, `subtitle`, or `body` is replaced with the formatted answer; `{{score}}` resolves to the running score total and `{{estimate}}` to the instant estimate ("$2,400 – $3,100"). A contact block pipes as the name, files as their names (never a stored ref), and sign-up slots and availability on a 12-hour clock. Unanswered fields resolve to `''`.

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

Back returns to the jump origin. The respondent's path is replayed from the current answers (ADR-069), so:

- answers to questions a jump now passes over (the respondent went Back and took the other branch) are left out of the submit payload, as hidden ones are; they stay in state, so taking that branch again brings them back;
- a question that becomes visible because of a later answer is asked before the form moves on, then the respondent continues where they were going;
- an edit from the Review step comes back to Review.

### Schema sanity checking

`checkSchema(questions)` is a pure helper that returns `SchemaIssue[]` — duplicate ids, `visibleIf`/jump conditions referencing unknown questions, and dangling or self jump targets. The engine is forgiving at runtime (bad refs fall through to normal flow); use this in CI or on save to catch authoring mistakes early. Each `message` is written for the form's owner: it names the question by its title and says what to do (ADR-069), so match on `kind`, never on the text. Slate's editor lists these in plain words with its own settings and logic-rule checks, and holds Publish back only for the ones that would stop people finishing the form.

```ts
import { checkSchema } from '@palmstreetweb/slate';
const issues = checkSchema(schema.questions); // [] when clean
```

### Scoring and multiple endings

Give options a `score` and the engine accumulates a total — available in piping as `{{score}}` and delivered in `SubmitMeta.score` (ADR-016); it counts the answers that are sent. Several `thanks` screens can coexist, each gated by `visibleIf`; the first visible one is shown. A `redirectUrl` on a thanks screen navigates there after `onSubmit` resolves. It resolves the way a link on your page does — `thanks`, `/thanks`, `?done` and `#done` stay on your site — so another site needs its full address (`https://example.com/thanks`); only http and https are followed. (Slate's own pages turn an address an owner typed without `https://` into the full one before the form is shown.)

Logic jumps decide each step on what had been answered by then: a rule that reads a later answer never moves the path behind it, and a question shown only by a later answer is asked right after that answer. `onSubmit` receives the answers on the respondent's path, the same questions the Review step lists (ADR-069).

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
  /** The instant estimate, when the schema has prices (ADR-064). */
  estimate?: { low: number; high: number; currency: string; lines: EstimateLine[] };
  /**
   * One UUID per fill: the same on Retry, on a question the submit sent the
   * respondent back to, and (with `resume`) after a reload and Resume; new for
   * "Submit another" and Start over. Store it as a retry key so a submit
   * whose reply was lost is never stored twice. Missing on a page not served
   * over https.
   */
  fillId?: string;
};
```

### Keyboard

| Key | Action |
|---|---|
| `Enter` | Advance from welcome / statement; submit text-type fields; on an optional (`required: false`) rating, NPS, legal or choice question with no answer, skip it (ADR-069). A held Enter (key repeat) never confirms |
| `Shift + Enter` | New line in `long_text` (on touch screens Return is a new line; OK submits) |
| `A`–`F` | Select choice option (also `picture_choice` and `legal` accept/decline) |
| `Y` / `N` | Answer `yes_no` questions |
| `0`–`9` | Select scale / NPS value (within range) |
| `↑` / `↓` + `Enter` | Navigate + select in `dropdown` |
| `Tab` / `Shift+Tab` | Standard browser focus order |

`Esc → back` is opt-out by default to prevent accidental loss; not currently exposed as a `<Form>` prop (planned for V1.1).

## Theme system

Twelve themes ship built-in, each with light and dark token sets:

| Theme | Vibe | Display font | Body font | Accent (light → dark) | Decoration |
|---|---|---|---|---|---|
| `classic` | Calm, full-screen, conversational (default) | Inter (500) | Inter | `#2C6EF2` → `#5B9BFF` | none |
| `editorial` | Refined serif, warm cream | Fraunces | Fraunces | `#2D5BFF` → `#6E8FFF` | grain |
| `swiss` | Bold geometric, lowercase | Inter (900) | Inter | `#DC2626` → `#F87171` | shapes |
| `midnight` | Indigo night, aurora glow | Inter (600) | Inter | `#6366F1` → `#818CF8` | aurora |
| `sunset` | Warm coral, amber glow | Inter (600) | Inter | `#F4683C` → `#FF8A5C` | aurora |
| `terminal` | Monospace phosphor, blueprint | JetBrains Mono | JetBrains Mono | `#0E8C44` → `#36F58C` | grid |
| `forest` | Earthy sage, soft grain | Fraunces | Inter | `#3F7A3A` → `#7FB76B` | grain |
| `mono` | Brutalist black & white | Inter (800) | Inter | `#111111` → `#FFFFFF` | shapes |
| `constellation` | Cosmic; star map completes as you go | Inter (600) | Inter | `#4F46E5` → `#7DD3FC` | constellation |
| `bloom` | Botanical; vine flowers as you finish | Fraunces | Inter | `#4C8A4A` → `#88C07E` | growth |
| `riso` | Risograph duotone halftone | Inter (800) | Inter | `#FF4D8D` → `#FF6FA3` | riso |
| `memphis` | Playful 80s confetti shapes | Inter (800) | Inter | `#FF3D7F` → `#FF6FA3` | memphis |

(Swiss originally shipped with Archivo Black; it was swapped for Inter as a closer Akzidenz-Grotesk substitute — see `DECISIONS.md` ADR-009. The five themes after Swiss were added per ADR-021; the four narrative/print themes per ADR-022.)

Each theme can carry a `decoration` hint, rendered behind the form. Most vary **per question step** (the step index drives the composition):

- `none` — clean, intentional whitespace (`classic`).
- `grain` — static fractal-noise texture, no per-step variation (`editorial`, `forest`).
- `shapes` — geometric poster compositions; uses the `--slate-deco-red/yellow/blue/ink` tokens, so `mono` reuses it with a grayscale palette (`swiss`, `mono`).
- `aurora` — soft, blurred gradient blobs; uses `--slate-deco-1/2/3` (`midnight`, `sunset`).
- `grid` — a faint technical line grid with a per-step accent cell; uses `--slate-deco-line` + the accent (`terminal`).
- `riso` — duotone halftone blobs that overprint and mis-register like a real risograph; uses `--slate-deco-1/2` + `--slate-deco-blend` (`riso`).
- `memphis` — scattered 80s squiggles, zigzags, arcs and triangles; uses `--slate-deco-1/2/3` + `--slate-deco-line` (`memphis`).

Two decorations are **narrative** — instead of reshuffling, the picture *builds cumulatively* as the respondent advances, so finishing the form completes the artwork:

- `constellation` — each step lights the next star and draws its connector, completing a star map; uses `--slate-deco-1` + `--slate-deco-line` (`constellation`).
- `growth` — a vine climbs one segment per step and breaks into flower at the end; uses `--slate-deco-1/2/3` + `--slate-deco-line` (`bloom`).

Decorations draw themselves on as the form moves (ADR-059): the newest constellation line and star, the vine's new growth, an aurora cross-fade, Swiss shapes sliding in. On a confirmed submit the narrative ones finish their picture — every star lights, the vine flowers.

Both are wrapper-scoped on `[data-slate-forms]` — the package never writes to your host page's `<html>`. The PSW theme toggle is a 1:1 visual port of palmstreetweb.com (same morph, same easing).

### Customizing tokens

Override per-token via CSS specificity at the wrapper level:

```css
[data-slate-forms][data-theme-name='editorial'] {
  --slate-accent: #ff5500;
  --slate-radius: 8px;
}
```

A custom-theme registry API ships in V1.1 (`themes.register()`).

### Motion

Motion follows BUILD_BRIEF §10 and ADR-059, and all of it lives in `styles.css` (no JS dependency):

- **Question hand-off** — the next question rises in (480ms) while the outgoing one fades out over 220ms as an inert, `aria-hidden` copy. No View Transitions, so an embedded form never snapshots the host page.
- **Choice commit** — on auto-advancing choices the letter badge flips to a self-drawing check and the other options step back, inside the existing ~220ms pause.
- **Invalid input** — a 3px shake on every failed attempt, and the error slides in.
- **Progress** — the bar moves by `transform: scaleX()` with a glowing tip that flares on advance; the footer counter rolls to the next number. The bar only reaches 100% once `onSubmit` resolves.
- **Completion celebration** — only on a successful submit: the check draws, the chip pops and ~14 confetti pieces burst in the theme's own colours and shapes (swiss drops poster shapes, constellation sparkles, bloom petals…). With `sound` on, a short finale chord plays.

`prefers-reduced-motion: reduce` turns all of it off: instant swaps, a static check, no confetti, no tip. Only `transform`, `opacity` and stroke-dash animate, and nothing loops.

## Examples

The `examples/` folder isn't published. It hosts **Slate**, a supported internal dev tool (ADR-018) for building and previewing forms:

- Dashboard listing locally-stored form definitions (with two seed schemas).
- Three-pane editor (outline / canvas / inspector) with drag-and-drop reordering, duplication, bulk delete, a visual logic editor (conditions, jumps, scores), and an issues banner in plain words (`checkSchema`, settings checks and rule checks; Publish waits only for what would trap respondents, ADR-069).
- **Share panel** — copy link + QR for dev preview; optional public URL when `VITE_PUBLIC_FORM_BASE` is set (see `.env.example`).
- Live `<Form>` preview (with save-and-resume on) and a responses inbox with CSV export and per-question summaries, all backed by `localStorage`.
- **Motion gallery** at `/motion` — every animation above with a Replay button, in all twelve themes, with a Reduce-motion preview switch. Built-in demo schemas; no sign-in, nothing submitted.

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
