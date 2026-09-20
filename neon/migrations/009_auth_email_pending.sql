-- Coalesce Neon Auth send.otp + send.magic_link into one branded email (ADR-037).
-- Written only by the `authemail` Neon Function (owner DATABASE_URL).

create table if not exists public.auth_email_pending (
  email text primary key,
  otp_code text,
  link_url text,
  expires_at timestamptz,
  sent_digest text,
  sent_at timestamptz,
  updated_at timestamptz not null default now()
);

comment on table public.auth_email_pending is
  'Staging row so OTP + magic-link webhooks can send a single Slate-branded email.';

alter table public.auth_email_pending enable row level security;

revoke all on table public.auth_email_pending from public;
do $$
begin
  revoke all on table public.auth_email_pending from anonymous;
exception when undefined_object then null;
end $$;
do $$
begin
  revoke all on table public.auth_email_pending from authenticated;
exception when undefined_object then null;
end $$;
