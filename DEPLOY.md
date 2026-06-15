# Slate production deploy checklist (ADR-028)

## Supabase

- [ ] Create **staging** and **production** projects
- [ ] Run migrations: `supabase db push` or apply `supabase/migrations/*.sql` in order
- [ ] Deploy Edge Function: `supabase functions deploy submit-response`
- [ ] Set function secrets:
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `RESEND_API_KEY` (optional — new submission emails)
  - `PSW_NOTIFY_EMAIL` (optional — defaults to hello@palmstreetweb.com)
  - `PUBLIC_FORM_BASE` (optional — link in notification emails)
- [ ] Enable Auth magic link for `@palmstreetweb.com` (or configure OAuth)
- [ ] RLS audit: anonymous users cannot `select` from `forms` / `submissions` directly

## Vercel (slateforms.vercel.app)

- [ ] `VITE_SUPABASE_URL` — project URL
- [ ] `VITE_SUPABASE_ANON_KEY` — anon key (RLS protects data)
- [ ] `VITE_PUBLIC_FORM_BASE` — optional custom domain for share links
- [ ] Preview and production use the same Supabase project (or separate staging keys on preview)

## Smoke test

1. Sign in with a `@palmstreetweb.com` email
2. Create form → Publish → copy `#/f/{slug}` link
3. Open link in incognito → complete form → submission appears in Responses
4. Optional: attach a file on a `file_upload` question → download from Responses

## Local dev without Supabase

Leave `VITE_SUPABASE_*` unset — admin uses localStorage (same as before).
