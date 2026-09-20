/**
 * Writes brand/auth-email-preview.html so we can see the login email in a browser.
 * Usage: npx vite-node scripts/preview-auth-email.ts
 */

import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AUTH_EMAIL_FROM, AUTH_EMAIL_SUBJECT, buildSignInEmail } from '../neon/functions/auth-email/emailHtml.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sample = buildSignInEmail(
  {
    otpCode: '482195',
    linkUrl: 'https://slateforms.vercel.app/#/?token=preview',
  },
  { logoSrc: 'slate-lockup.png' },
);

const mailBody =
  sample.html.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1]?.trim() ?? sample.html;

const page = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Slate login email preview</title>
  <style>
    :root { --bg:#0E1014; --panel:#1E232B; --ink:#F2EFE8; --muted:#8A93A1; --line:#2D333D; --red:#E23B2D; }
    * { box-sizing: border-box; }
    body { margin:0; background:var(--bg); color:var(--ink); font:14px/1.45 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif; }
    .chrome { max-width:640px; margin:0 auto; padding:28px 16px 64px; }
    .kicker { font:700 11px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif; letter-spacing:.18em; text-transform:uppercase; color:var(--muted); margin:0 0 10px; }
    h1 { font:600 22px/1.2 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif; letter-spacing:-0.03em; margin:0 0 8px; }
    .note { color:var(--muted); margin:0 0 22px; font-size:13px; }
    .inbox { background:var(--panel); border:1px solid var(--line); border-radius:16px; overflow:hidden; margin-bottom:18px; }
    .row { display:grid; grid-template-columns:72px 1fr; gap:10px; padding:12px 16px; border-bottom:1px solid var(--line); font-size:13px; }
    .row span { color:var(--muted); }
    .mail { background:#15181D; }
    a.back { color:var(--red); font-size:13px; }
  </style>
</head>
<body>
  <div class="chrome">
    <p class="kicker">Email preview</p>
    <h1>What people get when they sign in</h1>
    <p class="note">This is the real HTML (logo loaded from this folder). Production still uses the attached lockup PNG.</p>
    <div class="inbox">
      <div class="row"><span>From</span><div>${escapeHtml(AUTH_EMAIL_FROM)}</div></div>
      <div class="row"><span>Subject</span><div>${escapeHtml(AUTH_EMAIL_SUBJECT)}</div></div>
      <div class="mail">${mailBody}</div>
    </div>
    <p class="note">Edit <code>neon/functions/auth-email/emailHtml.ts</code>, then run <code>npx vite-node scripts/preview-auth-email.ts</code>.</p>
    <a class="back" href="index.html">Brand page</a>
  </div>
</body>
</html>
`;

writeFileSync(resolve(root, 'brand/auth-email-preview.html'), page);
console.log('Wrote brand/auth-email-preview.html');

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
