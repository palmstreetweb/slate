# Slate production deploy checklist (ADR-029)

## Neon (free project)

Follow [`neon/SETUP.md`](./neon/SETUP.md) in full:

- [ ] Enable **Data API** + **Managed Better Auth**
- [ ] Configure **Google OAuth** (redirect `{NEON_AUTH_BASE_URL}/callback/google`)
- [ ] Create Object Storage bucket **`form-uploads`** (private)
- [ ] Apply `neon/migrations/001_initial.sql` … `010_form_quota.sql`
- [ ] Refresh Data API schema cache
- [ ] Deploy Functions: `submitresponse`, `storagesign`, `authemail` (ADR-030/031/037)
- [ ] Function env: `STORAGE_SIGN_*` / `SUBMIT_RATE_*` / `UNLOCK_RATE_*` (optional), `authemail`: `RESEND_API_KEY` + `NEON_AUTH_URL`, `storagesign`: `NEON_AUTH_URL`
- [ ] Auth webhooks: `send.otp` + `send.magic_link` → `https://slateforms.vercel.app/api/auth-email` (proxies to `authemail`)
- [ ] Confirm Neon Auth / Google OAuth allows any account (not org-restricted)

## Vercel (slateforms.vercel.app)

- [ ] `VITE_NEON_URL` — HTTPS Neon database URL
- [ ] `VITE_SUBMIT_URL` — submitresponse Function URL
- [ ] `VITE_STORAGE_SIGN_URL` — storagesign Function URL
- [ ] `VITE_PUBLIC_FORM_BASE` — optional custom domain for share links
- [ ] `AUTH_EMAIL_FUNCTION_URL` — authemail Function URL (webhook proxy)
- [ ] Remove legacy `VITE_SUPABASE_*` env vars
- [ ] `ANTHROPIC_API_KEY` — server-only, Build with AI (`/api/generate`). Never `VITE_`.

## Local `/api`

`npm run dev` proxies `POST /api/generate` through Vite (loads `ANTHROPIC_API_KEY` from `.env.local`).

Alternatively run `vercel dev` so Vercel serves `/api` the same way production does.

Golden prompts: `npm run qa:ai` (needs the key).

## Smoke test

1. Sign in with Google (`@palmstreetweb.com`) or magic link
2. Create form → Publish → copy `#/f/{slug}` link
3. Open link in incognito → complete form → submission appears in Responses
4. Optional: attach a file on a `file_upload` question → download from Responses

## Local dev without Neon

Set `VITE_ADMIN_OFFLINE=1` (or leave `VITE_NEON_URL` unset) — admin uses localStorage.
