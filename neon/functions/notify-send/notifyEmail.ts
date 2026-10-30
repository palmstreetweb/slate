/**
 * The new-response email (ADR-072). Same look as the sign-in email (ADR-037), without the logo
 * attachment: a count, the form's name and a button into the studio. Never an answer: names, emails
 * and free text stay in Slate, so a forwarded or leaked email carries nothing about a respondent, and
 * there is nothing in it worth faking.
 */

export const NOTIFY_EMAIL_FROM = 'Slate <notifications@palmstreetweb.com>';

const BG = '#15181D';
const PANEL = '#1E232B';
const INK = '#F2EFE8';
const MUTED = '#8A93A1';
const LINE = '#2D333D';
const RED = '#E23B2D';
const FOOT = '#6B7280';
const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";

/** response_emails_due stops counting here. */
export const COUNT_CAP = 1000;
const NAME_MAX = 80;

export type ResponseEmailInput = {
  formName: string;
  newCount: number;
  /** `{studio}/forms/{id}/submissions`. */
  responsesUrl: string;
  /** The signed one-click link (also the List-Unsubscribe header). */
  unsubscribeUrl: string;
};

/** The owner's form name as one short line: no control characters, no line breaks, ≤ 80. */
export function cleanFormName(name: string): string {
  // eslint-disable-next-line no-control-regex
  const flat = name.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ');
  const trimmed = flat.trim();
  const chars = Array.from(trimmed);
  const short = chars.length > NAME_MAX ? `${chars.slice(0, NAME_MAX - 1).join('')}…` : trimmed;
  return short || 'Untitled form';
}

export function countPhrase(n: number): string {
  if (n >= COUNT_CAP) return `${COUNT_CAP.toLocaleString('en-US')}+ new responses`;
  return n === 1 ? '1 new response' : `${n.toLocaleString('en-US')} new responses`;
}

export function responseEmailSubject(formName: string, newCount: number): string {
  return `${capitalize(countPhrase(newCount))} on “${cleanFormName(formName)}”`;
}

export function buildResponseEmail(input: ResponseEmailInput): {
  subject: string;
  html: string;
  text: string;
} {
  const name = cleanFormName(input.formName);
  const phrase = countPhrase(input.newCount);
  const subject = responseEmailSubject(name, input.newCount);
  const responses = safeHttpsLink(input.responsesUrl);
  const unsubscribe = safeHttpsLink(input.unsubscribeUrl);
  if (!responses || !unsubscribe) throw new Error('response email links must be https');
  const them = input.newCount === 1 ? 'it' : 'them';
  const preheader = `${capitalize(phrase)} on ${name}. Open Slate to read ${them}.`;

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <meta name="color-scheme" content="dark"/>
  <meta name="supported-color-schemes" content="dark"/>
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:${BG};">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${BG};">${escapeHtml(preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${BG}" style="background:${BG};">
    <tr>
      <td align="center" style="padding:40px 16px 48px;">
        <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="width:520px;max-width:100%;">
          <tr>
            <td>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PANEL};border:1px solid ${LINE};border-radius:20px;overflow:hidden;">
                <tr>
                  <td height="4" bgcolor="${RED}" style="background:${RED};font-size:0;line-height:4px;height:4px;">&nbsp;</td>
                </tr>
                <tr>
                  <td style="padding:36px 36px 40px;">
                    <p style="margin:0 0 12px;font:700 11px/1 ${SANS};letter-spacing:.2em;text-transform:uppercase;color:${MUTED};">Slate</p>
                    <h1 style="margin:0 0 12px;font:600 28px/1.2 ${SANS};color:${INK};letter-spacing:-0.03em;">${escapeHtml(capitalize(phrase))}.</h1>
                    <p style="margin:0 0 32px;font:400 15px/1.6 ${SANS};color:${MUTED};">On <span style="color:${INK};">${escapeHtml(name)}</span>. Open Slate to read ${them}.</p>
                    <table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:0 auto;">
                      <tr>
                        <td align="center" bgcolor="${RED}" style="background:${RED};border-radius:999px;">
                          <a href="${escapeHtml(responses)}" style="display:inline-block;background:${RED};color:${INK};font:600 15px/1 ${SANS};text-decoration:none;padding:16px 36px;border-radius:999px;letter-spacing:.02em;">See responses</a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:24px 12px 0;font:400 12px/1.55 ${SANS};color:${FOOT};">
              You get this because emails are on for this form. At most one every 15 minutes.<br/>
              <a href="${escapeHtml(unsubscribe)}" style="color:${MUTED};text-decoration:underline;">Turn off emails for this form</a><br/>
              <span style="color:${MUTED};">Palm Street Web · Slate</span>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = [
    `${capitalize(phrase)} on “${name}”.`,
    '',
    `See responses: ${responses}`,
    '',
    'You get this because emails are on for this form. At most one every 15 minutes.',
    `Turn off emails for this form: ${unsubscribe}`,
  ].join('\n');

  return { subject, html, text };
}

function capitalize(s: string): string {
  return s ? s[0]!.toUpperCase() + s.slice(1) : s;
}

function safeHttpsLink(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
