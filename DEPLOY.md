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
- [ ] Enable Auth: magic link and/or **Google OAuth** (see below)
- [ ] RLS audit: anonymous users cannot `select` from `forms` / `submissions` directly

### Google OAuth (recommended for PSW team)

1. **Google Cloud Console** → APIs & Services → Credentials → Create **OAuth client ID** (Web application)
   - Authorized JavaScript origins: `http://localhost:5173`, `https://slateforms.vercel.app`
   - Authorized redirect URIs: `https://<project-ref>.supabase.co/auth/v1/callback` (from Supabase → Auth → Google)
2. **Supabase Dashboard** → Authentication → Providers → **Google** — enable, paste Client ID + Client Secret
3. **Authentication → URL Configuration** — Site URL `https://slateforms.vercel.app`; Redirect URLs include `http://localhost:5173` and production URL
4. Same allowlist rules apply: `@palmstreetweb.com` or a row in `team_allowlist` (migration `003_team_allowlist.sql`)

## Vercel (slateforms.vercel.app)

- [ ] `VITE_SUPABASE_URL` — project URL
- [ ] `VITE_SUPABASE_ANON_KEY` — anon key (RLS protects data)
- [ ] `VITE_PUBLIC_FORM_BASE` — optional custom domain for share links
- [ ] Preview and production use the same Supabase project (or separate staging keys on preview)

## Smoke test

1. Sign in with Google (`@palmstreetweb.com`) or magic link
2. Create form → Publish → copy `#/f/{slug}` link
3. Open link in incognito → complete form → submission appears in Responses
4. Optional: attach a file on a `file_upload` question → download from Responses

## Local dev without Supabase

Leave `VITE_SUPABASE_*` unset — admin uses localStorage (same as before).
