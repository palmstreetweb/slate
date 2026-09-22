/** Branded sign-in email (ADR-037). Logo is embedded as a CID PNG. */

export const AUTH_EMAIL_FROM = 'Slate <notifications@palmstreetweb.com>';
export const AUTH_EMAIL_SUBJECT = 'Sign in to Slate';
export const AUTH_LOGO_CID = 'slate-logo';

const BG = '#15181D';
const PANEL = '#1E232B';
const PANEL_2 = '#23282F';
const INK = '#F2EFE8';
const MUTED = '#8A93A1';
const LINE = '#2D333D';
const RED = '#E23B2D';
const FOOT = '#6B7280';
const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";

export type SignInEmailInput = {
  otpCode?: string | null;
  linkUrl?: string | null;
};

export type SignInEmailOptions = {
  /** Defaults to `cid:slate-logo`. Preview pages pass a file or data URI. */
  logoSrc?: string;
};

export function digestSignInEmail(input: SignInEmailInput): string {
  return `${input.otpCode?.trim() ?? ''}|${input.linkUrl?.trim() ?? ''}`;
}

export function buildSignInEmail(
  input: SignInEmailInput,
  opts?: SignInEmailOptions,
): { html: string; text: string } {
  const otp = digitsOnly(input.otpCode);
  const link = safeLink(input.linkUrl);
  const logoSrc = opts?.logoSrc ?? `cid:${AUTH_LOGO_CID}`;
  const intro =
    link && otp
      ? 'Use the button, or type the code on the login screen. This expires in about 10 minutes.'
      : otp
        ? 'Enter the 6-digit code on the login screen. This expires in about 10 minutes.'
        : 'Use the button to open Slate. This link expires in about 10 minutes.';
  const preheader = otp
    ? `Your sign-in code is ${otp}. Expires in about 10 minutes.`
    : 'Your Slate sign-in link is ready. Expires in about 10 minutes.';

  const buttonHtml = link
    ? `<table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:0 auto 8px;">
        <tr>
          <td align="center" bgcolor="${RED}" style="background:${RED};border-radius:999px;">
            <a href="${escapeAttr(link)}" style="display:inline-block;background:${RED};color:${INK};font:600 15px/1 ${SANS};text-decoration:none;padding:16px 36px;border-radius:999px;letter-spacing:.02em;">Sign in to Slate</a>
          </td>
        </tr>
      </table>`
    : '';

  const codeHtml = otp ? renderCodeBlock(otp, Boolean(link), copyCodeHref(otp, link)) : '';

  const linkFallback = link
    ? `<p style="margin:28px 0 0;font:400 12px/1.55 ${SANS};color:${MUTED};word-break:break-all;">If the button does not work, paste this link into your browser:<br/><a href="${escapeAttr(link)}" style="color:${INK};text-decoration:underline;">${escapeHtml(shortLink(link))}</a></p>`
    : '';

  const copyScript = otp ? renderCopyScript() : '';

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <meta name="color-scheme" content="dark"/>
  <meta name="supported-color-schemes" content="dark"/>
  <title>${AUTH_EMAIL_SUBJECT}</title>
</head>
<body style="margin:0;padding:0;background:${BG};">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${BG};">${escapeHtml(preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${BG}" style="background:${BG};">
    <tr>
      <td align="center" style="padding:40px 16px 48px;">
        <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="width:520px;max-width:100%;">
          <tr>
            <td align="center" style="padding:0 0 28px;">
              <img src="${escapeAttr(logoSrc)}" width="200" height="62" alt="Slate" style="display:block;border:0;outline:none;text-decoration:none;height:62px;width:200px;margin:0 auto;"/>
            </td>
          </tr>
          <tr>
            <td>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PANEL};border:1px solid ${LINE};border-radius:20px;overflow:hidden;">
                <tr>
                  <td height="4" bgcolor="${RED}" style="background:${RED};font-size:0;line-height:4px;height:4px;">&nbsp;</td>
                </tr>
                <tr>
                  <td style="padding:36px 36px 40px;">
                    <p style="margin:0 0 12px;font:700 11px/1 ${SANS};letter-spacing:.2em;text-transform:uppercase;color:${MUTED};">Sign in</p>
                    <h1 style="margin:0 0 12px;font:600 28px/1.2 ${SANS};color:${INK};letter-spacing:-0.03em;">Your login is ready.</h1>
                    <p style="margin:0 0 32px;font:400 15px/1.6 ${SANS};color:${MUTED};">${escapeHtml(intro)}</p>
                    ${buttonHtml}
                    ${codeHtml}
                    ${linkFallback}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:24px 12px 0;font:400 12px/1.55 ${SANS};color:${FOOT};">
              If you did not ask to sign in, you can ignore this email.<br/>
              <span style="color:${MUTED};">Palm Street Web · Slate</span>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
  ${copyScript}
</body>
</html>`;

  const textParts = ['Sign in to Slate', ''];
  if (link) textParts.push(`Sign-in link: ${link}`, '');
  if (otp) textParts.push(`Or type this code: ${otp}`, '');
  textParts.push('If you did not ask to sign in, you can ignore this email.');

  return { html, text: textParts.join('\n') };
}

function copyCodeHref(otp: string, link: string | null): string {
  try {
    const origin = link ? new URL(link).origin : 'https://slateforms.vercel.app';
    return `${origin}/?otp=${encodeURIComponent(otp)}`;
  } catch {
    return `https://slateforms.vercel.app/?otp=${encodeURIComponent(otp)}`;
  }
}

function renderCodeBlock(otp: string, hasLink: boolean, copyHref: string): string {
  const label = hasLink ? 'Or enter this code' : 'Your code';
  const digits = otp.length === 6 ? otp.split('') : null;
  const boxes = digits
    ? `<table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:0 auto;">
        <tr>
          ${digits
            .map(
              (d, i) =>
                `${i > 0 ? `<td width="8" style="width:8px;font-size:0;">&nbsp;</td>` : ''}<td width="44" height="54" align="center" valign="middle" bgcolor="${PANEL_2}" style="width:44px;height:54px;background:${PANEL_2};border:1px solid ${LINE};border-radius:10px;font:600 22px/54px ${SANS};color:${INK};letter-spacing:0;">${escapeHtml(d)}</td>`,
            )
            .join('')}
        </tr>
      </table>`
    : `<p style="margin:0;font:700 32px/1.1 ${SANS};letter-spacing:.28em;color:${INK};text-align:center;">${escapeHtml(otp)}</p>`;

  // Real https href so Gmail keeps the pill. Script copies in preview / rare clients.
  const copyBtn = `<table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:18px auto 0;">
        <tr>
          <td align="center" bgcolor="${PANEL_2}" style="background:${PANEL_2};border:1px solid ${LINE};border-radius:999px;">
            <a id="slate-copy-code" href="${escapeAttr(copyHref)}" data-code="${escapeAttr(otp)}" data-idle="Copy code" data-done="Copied" style="display:inline-block;background:${PANEL_2};color:${INK};font:600 13px/1 ${SANS};text-decoration:none;padding:12px 20px;border-radius:999px;letter-spacing:.01em;">Copy code</a>
          </td>
        </tr>
      </table>`;

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:${hasLink ? '28px' : '0'} 0 0;">
    <tr>
      <td align="center">
        <p style="margin:0 0 14px;font:700 11px/1 ${SANS};letter-spacing:.18em;text-transform:uppercase;color:${MUTED};">${label}</p>
        ${boxes}
        ${copyBtn}
      </td>
    </tr>
  </table>`;
}

function renderCopyScript(): string {
  return `<script>
(function(){
  var btn = document.getElementById('slate-copy-code');
  if (!btn) return;
  var idle = btn.getAttribute('data-idle') || 'Copy code';
  var done = btn.getAttribute('data-done') || 'Copied';
  btn.addEventListener('click', function(e){
    var code = btn.getAttribute('data-code') || '';
    if (!code) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      e.preventDefault();
    } else {
      return;
    }
    var mark = function(){
      btn.textContent = done;
      window.setTimeout(function(){ btn.textContent = idle; }, 1600);
    };
    var fallback = function(){
      try {
        var t = document.createElement('textarea');
        t.value = code;
        t.setAttribute('readonly','');
        t.style.cssText = 'position:fixed;left:-9999px;top:0;';
        document.body.appendChild(t);
        t.select();
        document.execCommand('copy');
        document.body.removeChild(t);
        mark();
      } catch (err) {}
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(code).then(mark).catch(fallback);
    } else {
      fallback();
    }
  });
})();
</script>`;
}

function shortLink(url: string): string {
  try {
    const u = new URL(url);
    const tail = `${u.pathname}${u.search}${u.hash}`;
    const clipped = tail.length > 48 ? `${tail.slice(0, 45)}…` : tail;
    return `${u.host}${clipped}`;
  } catch {
    return url;
  }
}

function digitsOnly(value: string | null | undefined): string | null {
  const digits = (value ?? '').replace(/\D/g, '');
  return digits.length >= 4 ? digits : null;
}

function safeLink(value: string | null | undefined): string | null {
  const raw = (value ?? '').trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/'/g, '&#39;');
}
