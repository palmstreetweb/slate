import { describe, expect, it } from 'vitest';
import {
  AUTH_LOGO_CID,
  buildSignInEmail,
  digestSignInEmail,
} from '../neon/functions/auth-email/emailHtml.ts';

describe('buildSignInEmail', () => {
  it('includes the Slate lockup CID, magic link, and code in one message', () => {
    const { html, text } = buildSignInEmail({
      otpCode: '482195',
      linkUrl: 'https://slateforms.vercel.app/#/?token=abc',
    });
    expect(html).toContain(`cid:${AUTH_LOGO_CID}`);
    expect(html).toContain('alt="Slate"');
    expect(html).toContain('482195');
    expect(html).toContain('>4</td>');
    expect(html).toContain('>9</td>');
    expect(html).toContain('https://slateforms.vercel.app/#/?token=abc');
    expect(html).toContain('Sign in to Slate');
    expect(html).toContain('Your login is ready.');
    expect(html).toContain('Copy code');
    expect(html).toContain('data-code="482195"');
    expect(html).toContain('id="slate-copy-code"');
    expect(html).toContain('/#/?otp=482195');
    expect(text).toContain('482195');
    expect(text).toContain('https://slateforms.vercel.app/#/?token=abc');
  });

  it('omits the button when only a code is present', () => {
    const { html, text } = buildSignInEmail({ otpCode: '111222' });
    expect(html).not.toContain('Sign in to Slate</a>');
    expect(html).toContain('111222');
    expect(html).toContain('Copy code');
    expect(html).toContain('/#/?otp=111222');
    expect(text).not.toContain('Sign-in link');
  });

  it('rejects non-http links', () => {
    const { html } = buildSignInEmail({
      otpCode: '111222',
      linkUrl: 'javascript:alert(1)',
    });
    expect(html).not.toContain('javascript:');
  });

  it('changes digest when otp or link changes', () => {
    const a = digestSignInEmail({ otpCode: '1', linkUrl: 'https://a.example/' });
    const b = digestSignInEmail({ otpCode: '2', linkUrl: 'https://a.example/' });
    expect(a).not.toBe(b);
  });
});
