# Neon Console setup (ADR-029)

Do this once on the **Palm Street Web** Neon project (AWS US East 2 / Ohio).

## 1. Data API + Managed Better Auth

1. Neon Console → **Postgres database → Data API**
2. Check **Use Managed Better Auth**
3. Check **Grant public schema access**
4. Click **Enable Data API**
5. Copy the HTTPS database URL for the SPA:

```text
https://ep-….aws.neon.tech/neondb
```

(That is `VITE_NEON_URL` — host + database name over HTTPS, **not** the `postgresql://` connection string.)

The SPA enables `allowAnonymous: true` on the Neon client so public fill links
(`#/f/{slug}`) can call `get_form_by_slug` with an anonymous JWT (no login).

## 2. Google OAuth

1. Neon Console → **Auth → Configuration**
2. Enable **Google**
3. Google Cloud OAuth client (Web):
   - Authorized redirect URI: `{NEON_AUTH_BASE_URL}/callback/google`
   - Origins: `http://localhost:5173`, `https://slateforms.vercel.app`
4. Trusted domains in Neon Auth: same origins

## 3. Object Storage

1. Neon Console → **Object storage** (or declare in `neon.ts` + `neon deploy`)
2. Create private bucket **`form-uploads`**
3. Ensure branch region is `aws-us-east-2` or `aws-eu-central-1` (Object Storage beta regions)

## 4. Apply SQL

In the Neon SQL Editor (or `psql` with the pooled connection string), run in order:

1. `neon/migrations/001_initial.sql`
2. `neon/migrations/002_team_allowlist.sql`
3. `neon/migrations/003_submit_rate_limit.sql`
4. `neon/migrations/004_auth_email_claims.sql`
5. `neon/migrations/005_fix_team_rls.sql`
6. `neon/migrations/006_auth_email_harden.sql`
7. `neon/migrations/007_team_allowlist_rpc.sql`
8. `neon/migrations/008_open_signup_owner_rls.sql`
9. `neon/migrations/009_auth_email_pending.sql`
10. `neon/migrations/010_form_quota.sql`
11. `neon/migrations/011_feedback.sql`
12. `neon/migrations/012_fill_password.sql`
13. `neon/migrations/013_hardening.sql`
14. `neon/migrations/014_ai_quota.sql`
15. `neon/migrations/015_slug_lock.sql`
16. `neon/migrations/016_crowd_rate_limits.sql`

Then **Data API → Refresh schema cache**. Do this after every migration that adds a column or
changes a function signature — 012 does both (`forms.fill_locked`, `get_form_by_slug` gains
`locked`, new `set_form_fill_password`). Until the cache is refreshed the Share password row
errors and locked forms can't be set.

After 012, redeploy `submitresponse` and `storagesign` (section 5). They hold the unlock op and
the unlock-token checks on submit and public uploads (ADR-043). Order that is always safe:
SQL → refresh cache → redeploy both Functions → ship the SPA.

Apply 014 (and refresh the cache) before deploying the `/api/generate` that calls it. Build with AI
fails closed with a 503 until `consume_ai_generation` exists (ADR-051). Caps: 25 per user and 500
overall per UTC day — edit `ai_quota_limits()` to change them.

014 also generates a server key. After pasting it, run `select key from public.ai_quota_key;` and set the value as `AI_QUOTA_KEY` on the Vercel project (Production), then redeploy. Build with AI stays at 503 until both exist (ADR-051).

015 locks form links (ADR-057): a slug never changes, trashed forms keep theirs, and a permanently deleted form retires its slug for good. No cache refresh or Function redeploy.

016 (ADR-058) replaces the rate core: `consume_submit_rates` (all or nothing, denials write nothing), `try_fill_password`, and a 6-character fill password minimum. Apply it BEFORE redeploying `submitresponse` and `storagesign`; the new Functions answer 503 on submit and upload, and every password reads as wrong, until it exists. `consume_submit_rate` keeps its signature, so today's Functions and `authemail` keep working on it. No cache refresh.

Anyone can sign up (Google, magic link, or email code). Each account owns its own forms (ADR-036).
Each account is capped at **50 forms** including Trash (ADR-038); permanent delete frees a slot.
Public fill links (`#/f/{slug}`) still work without login.

Enable **Auth → Plugins → Magic Link** so email sign-in can send a clickable link as well as a 6-digit code. Trusted origins must include `https://slateforms.vercel.app`, `http://127.0.0.1:5173`, and `http://localhost:5173` (localhost allowed). Google and magic-link callbacks return to whichever of those origins the user started on.

Branded mail (ADR-037): after deploying `authemail`, point **Auth → Configuration → Webhooks** at `https://slateforms.vercel.app/api/auth-email` (not the Neon Function URL — Neon rejects its own infrastructure) and subscribe to `send.otp` + `send.magic_link` (timeout 8s). That replaces Neon’s two default emails with one Slate-lockup message (link + code) via Resend.

## 5. Deploy Functions

```bash
npx neonctl@latest auth   # once
npx neonctl@latest functions deploy submitresponse --src neon/functions/submit-response --project-id <id>
npx neonctl@latest functions deploy storagesign --src neon/functions/storage-sign --project-id <id> --env NEON_AUTH_URL=https://<ep>.neonauth.<region>.aws.neon.tech/neondb/auth
npx neonctl@latest functions deploy authemail --src neon/functions/auth-email --project-id <id>
```

Or use `neon.ts` + `npx neonctl@latest deploy` when the project is linked.

Set function env (repeatable `--env KEY=VALUE`):

- `RESEND_API_KEY` — **required** on `authemail` only. `submitresponse` sends no email: responses live in the app (ADR-047).
- `authemail` and `storagesign`: `NEON_AUTH_URL` (Auth base, for JWKS — storagesign verifies owner JWTs with it, ADR-046)
- Optional rate limits (ADR-058). Integers only; anything else keeps the default, and each Function logs its effective limits on start. Windows are fixed.
  - `submitresponse`: `SUBMIT_RATE_IP_OWNER_MAX` (2000 units of 4 KiB per hour, IP + form owner), `SUBMIT_RATE_IP_MAX` (10000 units per hour, IP), `UNLOCK_RATE_PW_MAX` (2000 password attempts per 10 min, IP + owner), `UNLOCK_RATE_PW_IP_MAX` (10000 per 10 min, IP), `UNLOCK_RATE_FAIL_IP_MAX` (500 misses per hour, IP), `UNLOCK_RATE_FAIL_FORM_MAX` (300 misses per hour, form)
  - `storagesign`: `STORAGE_SIGN_MAX_BYTES` (32 MiB per file), `STORAGE_SIGN_IP_OWNER_MAX` (8192 units of 256 KiB per hour, public uploads, IP + owner), `STORAGE_SIGN_IP_MAX` (40960 units per hour, IP), `STORAGE_SIGN_DRAFT_USER_MAX` (8192 units per hour, draft uploads, account), `STORAGE_SIGN_READ_USER_MAX` (3000 reads per 10 min, account), `STORAGE_SIGN_READ_IP_MAX` (15000 reads per 10 min, IP), `STORAGE_SIGN_CONTENT_MAX_BYTES` (10485760, largest in-app preview)
  - Retired, no longer read: `SUBMIT_RATE_IP_FORM_MAX`, `SUBMIT_RATE_IP_FORM_WINDOW_SEC`, `SUBMIT_RATE_IP_WINDOW_SEC`, `UNLOCK_RATE_IP_SLUG_*`, `UNLOCK_RATE_IP_MAX`, `UNLOCK_RATE_IP_WINDOW_SEC`, `STORAGE_SIGN_IP_FORM_*`, `STORAGE_SIGN_IP_WINDOW_SEC`, `STORAGE_SIGN_READ_IP_WINDOW_SEC`. Remove any that are set with `--env NAME=`.
- Object Storage credentials are injected by Neon when Storage is enabled on the branch

Copy the function HTTPS URLs into Vercel / `.env.local`:

```text
VITE_SUBMIT_URL=https://….neon.tech/…/submitresponse
VITE_STORAGE_SIGN_URL=https://….neon.tech/…/storagesign
```

## 6. Local + Vercel env

```text
VITE_NEON_URL=https://ep-….aws.neon.tech/neondb
VITE_SUBMIT_URL=…
VITE_STORAGE_SIGN_URL=…
VITE_PUBLIC_FORM_BASE=https://slateforms.vercel.app
# VITE_ADMIN_OFFLINE=1   # local UI without Neon
```

Remove any `VITE_SUPABASE_*` keys from Vercel.

## 7. Own Google OAuth (before wider launch)

Neon’s shared Google keys are fine for demos. For branded production:

1. Google Cloud Console → create an OAuth **Web** client
2. Authorized JavaScript origins: `https://slateforms.vercel.app`, `http://localhost:5173`
3. Authorized redirect URI: `{NEON_AUTH_BASE_URL}/callback/google` (from Neon Auth → Configuration)
4. Neon Console → **Auth → Configuration → Google** → paste **your** Client ID + Secret (turn off shared keys)
5. Confirm trusted domains include `https://slateforms.vercel.app`

## 8. Rotate DB password (if it ever leaked)

If a Neon role password appeared in a terminal log or chat:

1. Neon Console → project → **Settings → Reset password** (or Roles)
2. Update any saved connection strings / `DATABASE_URL` used by Functions / local `psql`
3. SPA does **not** use the Postgres password — only `VITE_NEON_URL` (HTTPS Data API) — so no Vercel SPA env change unless you also stored the SQL URL somewhere
