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

Then **Data API → Refresh schema cache**.

Anyone can sign up (Google, magic link, or email code). Each account owns its own forms (ADR-036).
Each account is capped at **50 forms** including Trash (ADR-038); permanent delete frees a slot.
Public fill links (`#/f/{slug}`) still work without login.

Enable **Auth → Plugins → Magic Link** so email sign-in can send a clickable link as well as a 6-digit code. Trusted origins must include `https://slateforms.vercel.app`. Localhost (`http://localhost:5173` / `http://127.0.0.1:5173`) is optional — when missing, the admin SPA sends magic-link callbacks to production so OTP still works on local.

Branded mail (ADR-037): after deploying `authemail`, point **Auth → Configuration → Webhooks** at `https://slateforms.vercel.app/api/auth-email` (not the Neon Function URL — Neon rejects its own infrastructure) and subscribe to `send.otp` + `send.magic_link` (timeout 8s). That replaces Neon’s two default emails with one Slate-lockup message (link + code) via Resend.

## 5. Deploy Functions

```bash
npx neonctl@latest auth   # once
npx neonctl@latest functions deploy submitresponse --src neon/functions/submit-response --project-id <id>
npx neonctl@latest functions deploy storagesign --src neon/functions/storage-sign --project-id <id>
npx neonctl@latest functions deploy authemail --src neon/functions/auth-email --project-id <id>
```

Or use `neon.ts` + `npx neonctl@latest deploy` when the project is linked.

Set function env (repeatable `--env KEY=VALUE`):

- `RESEND_API_KEY` (optional for submit notify; **required** on `authemail`)
- `PSW_NOTIFY_EMAIL` (optional)
- `PUBLIC_FORM_BASE=https://slateforms.vercel.app`
- `authemail` only: `NEON_AUTH_URL` (Auth base, for JWKS), optional `AUTH_EMAIL_FROM`
- Optional upload guards (`storagesign`, ADR-031): `STORAGE_SIGN_MAX_BYTES`, `STORAGE_SIGN_IP_FORM_MAX`, `STORAGE_SIGN_IP_FORM_WINDOW_SEC`, `STORAGE_SIGN_IP_MAX`, `STORAGE_SIGN_IP_WINDOW_SEC`
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
