# `@palmstreetweb/forms`

> Conversational form-rendering library for Palm Street Web client projects. Schema in → Typeform-quality form out.

**Status:** `1.0.0-beta.1` — under active build. API stable per [`BUILD_BRIEF.md`](./BUILD_BRIEF.md). Public docs below get fleshed out at the end of the build.

---

## Quickstart

```bash
npm install @palmstreetweb/forms
```

```tsx
'use client';
import { Form, defineSchema } from '@palmstreetweb/forms';
import '@palmstreetweb/forms/styles.css';

const schema = defineSchema({
  brand: { name: '805 Sealcoating' },
  theme: 'swiss',
  themeMode: 'toggle',
  questions: [
    { id: 'welcome', type: 'welcome', title: 'Hey there.', cta: 'Start' },
    { id: 'name', type: 'short_text', title: "What's your first name?", required: true },
    { id: 'email', type: 'email', title: 'Best email?', required: true },
    { id: 'done', type: 'thanks', title: "You're all set." },
  ],
});

export default function QuotePage() {
  return (
    <Form
      schema={schema}
      onSubmit={async (answers) => {
        await fetch('/api/quote', { method: 'POST', body: JSON.stringify(answers) });
      }}
    />
  );
}
```

## API outline (placeholder — full reference at v1.0.0)

- `Form` — main component. Props: `schema`, `onSubmit`, `onQuestionChange?`, `hiddenFields?`, `errorMessage?`.
- `defineSchema(schema)` — identity helper for full TypeScript inference.
- `themes` — registry. Currently: `editorial`, `swiss`. Each ships `light` + `dark` token sets.
- Types: `Schema`, `Question`, `Answers`, `Theme`, `Option`, `Condition`, `FormProps`, `SubmitMeta`.

## Question types

`welcome`, `statement`, `short_text`, `long_text`, `email`, `phone`, `number`, `single_choice`, `multi_choice`, `scale`, `thanks`. Full schema per type lives in [`BUILD_BRIEF.md`](./BUILD_BRIEF.md) §5.

## Theme system

Themes are config objects. Light + dark tokens per theme. PSW theme toggle (1:1 match to palmstreetweb.com) ships built-in. Wrapper-scoped, never touches `<html>` of the host page.

## Examples

See [`examples/`](./examples/) once implemented:

- `theme-toggle-demo.tsx` — minimal toggle on a wrapper
- `basic-quote-form.tsx` — full 8-question schema
- `conditional-logic.tsx` — branching with `visibleIf`
- `with-host-theme.tsx` — host-page theme inheritance

## Coming in V2

See [`DECISIONS.md`](./DECISIONS.md) "Deferred to V2" section. Includes file upload, date picker, calculator/scoring, save-and-resume, iframe embed, i18n, visual builder.

## Contributing

This is internal tooling. See [`AGENTS.md`](./AGENTS.md) for repo structure and conventions, [`CLAUDE.md`](./CLAUDE.md) for AI-agent guidance, [`DECISIONS.md`](./DECISIONS.md) for the architecture log, and [`MIGRATION_NOTES.md`](./MIGRATION_NOTES.md) for semver protocol.

## License

UNLICENSED — proprietary, internal use only by Palm Street Web. See [`LICENSE`](./LICENSE).
