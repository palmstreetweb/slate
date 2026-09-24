/**
 * brand.logo in the top chrome — the URL allow-list (`safeLogoSrc`) and the
 * rendered fallback when a logo is refused or fails to load.
 */

import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Form, defineSchema } from '@/index.js';
import { TopBar } from '@/components/chrome/TopBar.js';
import { MAX_LOGO_DATA_URL_LENGTH, safeLogoSrc } from '@/utils/brandLogo.js';
import { Outline } from '../examples/_admin/components/Outline.js';

const PNG_DATA =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

function makeSchema(logo?: string) {
  return defineSchema({
    brand: logo === undefined ? { name: 'Test Co' } : { name: 'Test Co', logo },
    theme: 'editorial',
    themeMode: 'light',
    questions: [
      { id: 'welcome', type: 'welcome', title: 'Hey there.', cta: 'Start' },
      { id: 'done', type: 'thanks', title: 'All set.' },
    ],
  });
}

const noop = () => {};

describe('safeLogoSrc', () => {
  it.each([
    ['https://cdn.example.com/logo.png', 'https://cdn.example.com/logo.png'],
    ['  https://cdn.example.com/logo.svg  ', 'https://cdn.example.com/logo.svg'],
    ['/logo.svg', '/logo.svg'],
    ['/brand/logo.png?v=2', '/brand/logo.png?v=2'],
    [PNG_DATA, PNG_DATA],
    ['data:image/jpeg;base64,/9j/4AAQSkZJRg==', 'data:image/jpeg;base64,/9j/4AAQSkZJRg=='],
    ['data:image/webp;base64,UklGRg==', 'data:image/webp;base64,UklGRg=='],
    ['data:image/gif;base64,R0lGODlhAQABAAAAACw=', 'data:image/gif;base64,R0lGODlhAQABAAAAACw='],
  ])('accepts %s', (input, expected) => {
    expect(safeLogoSrc(input)).toBe(expected);
  });

  it.each([
    ['javascript:alert(1)'],
    [' JavaScript:alert(1)'],
    ['data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='],
    ['data:image/svg+xml,<svg onload="alert(1)"/>'],
    ['data:text/html;base64,PGgxPmhpPC9oMT4='],
    ['data:image/png,notbase64'],
    ['data:image/png;base64,<script>'],
    ['http://cdn.example.com/logo.png'],
    ['blob:https://example.com/1234'],
    ['//evil.example/logo.png'],
    ['/\\evil.example/logo.png'],
    ['/\t/evil.example/logo.png'],
    ['logo.png'],
    ['./logo.png'],
    ['https://user:pass@cdn.example.com/logo.png'],
    [''],
    ['   '],
  ])('rejects %j', (input) => {
    expect(safeLogoSrc(input)).toBeNull();
  });

  it('rejects non-strings and oversized data URLs', () => {
    expect(safeLogoSrc(undefined)).toBeNull();
    expect(safeLogoSrc(42)).toBeNull();
    expect(safeLogoSrc({ href: 'https://x.example/l.png' })).toBeNull();
    const huge = `data:image/png;base64,${'A'.repeat(MAX_LOGO_DATA_URL_LENGTH)}`;
    expect(safeLogoSrc(huge)).toBeNull();
  });
});

describe('<Form> — brand logo', () => {
  it('renders a safe logo beside the brand name', () => {
    render(<Form schema={makeSchema('https://cdn.example.com/logo.png')} onSubmit={vi.fn()} />);
    const img = screen.getByRole('img', { name: 'Test Co' });
    expect(img).toHaveAttribute('src', 'https://cdn.example.com/logo.png');
    expect(img).toHaveAttribute('loading', 'eager');
    expect(img).toHaveAttribute('decoding', 'async');
    expect(img).toHaveAttribute('referrerpolicy', 'no-referrer');
    expect(img).toHaveClass('slate-brand-logo');
    // Name stays visible; the alt carries it for assistive tech.
    expect(screen.getByText('Test Co')).toHaveAttribute('aria-hidden', 'true');
  });

  it.each([
    ['javascript:alert(1)'],
    ['data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='],
    ['http://cdn.example.com/logo.png'],
    ['//evil.example/logo.png'],
  ])('renders only the text name for unsafe logo %s', (logo) => {
    const { container } = render(<Form schema={makeSchema(logo)} onSubmit={vi.fn()} />);
    expect(container.querySelector('img')).toBeNull();
    const name = screen.getByText('Test Co');
    expect(name).toHaveClass('slate-brand');
    expect(name).not.toHaveAttribute('aria-hidden');
  });

  it('renders the plain text brand when no logo is set', () => {
    const { container } = render(<Form schema={makeSchema()} onSubmit={vi.fn()} />);
    expect(container.querySelector('.slate-brand-logo')).toBeNull();
    expect(screen.getByText('Test Co')).toHaveClass('slate-brand');
  });

  it('falls back to the text name when the image fails to load', () => {
    const { container } = render(
      <Form schema={makeSchema('https://cdn.example.com/missing.png')} onSubmit={vi.fn()} />,
    );
    fireEvent.error(screen.getByRole('img', { name: 'Test Co' }));
    expect(container.querySelector('img')).toBeNull();
    const name = screen.getByText('Test Co');
    expect(name).toHaveClass('slate-brand');
    expect(name).not.toHaveAttribute('aria-hidden');
  });
});

describe('<TopBar> — logo retry', () => {
  it('tries a new URL after the previous one failed', () => {
    const { rerender } = render(
      <TopBar
        brandName="Acme"
        brandLogo="https://a.example/broken.png"
        showBack={false}
        onBack={noop}
      />,
    );
    fireEvent.error(screen.getByRole('img', { name: 'Acme' }));
    expect(screen.queryByRole('img')).toBeNull();

    rerender(
      <TopBar
        brandName="Acme"
        brandLogo="https://a.example/fixed.png"
        showBack={false}
        onBack={noop}
      />,
    );
    expect(screen.getByRole('img', { name: 'Acme' })).toHaveAttribute(
      'src',
      'https://a.example/fixed.png',
    );
  });

  it('shows the logo alone when the brand name is empty', () => {
    const { container } = render(
      <TopBar brandName="" brandLogo="/logo.svg" showBack={false} onBack={noop} />,
    );
    expect(container.querySelector('.slate-brand-logo')).toHaveAttribute('src', '/logo.svg');
    expect(container.querySelector('.slate-brand-name')).toBeNull();
  });
});

describe('Studio Outline — Logo URL setting', () => {
  function renderOutline(logo?: string) {
    const onLogoChange = vi.fn();
    render(
      <Outline
        schema={makeSchema(logo)}
        selectedId="welcome"
        onSelect={noop}
        onAddQuestion={noop}
        onReorder={noop}
        onMove={noop}
        onDuplicate={noop}
        onBulkDelete={noop}
        name="Test Co"
        onNameChange={noop}
        onBrandChange={noop}
        onLogoChange={onLogoChange}
        onThemeChange={noop}
        onThemeModeChange={noop}
        onSoundChange={noop}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /settings/i }));
    return { onLogoChange, input: screen.getByRole('textbox', { name: /logo url/i }) };
  }

  it('is bound to schema.brand.logo and reports edits', () => {
    const { onLogoChange, input } = renderOutline('https://cdn.example.com/logo.png');
    expect(input).toHaveValue('https://cdn.example.com/logo.png');
    expect(input).toHaveAccessibleDescription('https:// image, shown next to your form name');
    fireEvent.change(input, { target: { value: '' } });
    expect(onLogoChange).toHaveBeenCalledWith('');
  });

  it('warns when the engine would refuse the URL', () => {
    const { input } = renderOutline('http://cdn.example.com/logo.png');
    expect(input).toHaveAccessibleDescription('Not shown — use an https:// image link');
  });
});

describe('withBrandLogo (editor, ADR-053)', () => {
  it('blank or whitespace removes the logo key and keeps the name', async () => {
    const { withBrandLogo } = await import('../examples/_admin/brandLogo.js');
    expect(withBrandLogo({ name: 'Acme', logo: 'https://a/l.png' }, '')).toEqual({ name: 'Acme' });
    expect(withBrandLogo({ name: 'Acme', logo: 'https://a/l.png' }, '   ')).toEqual({
      name: 'Acme',
    });
    expect('logo' in withBrandLogo({ name: 'Acme' }, '')).toBe(false);
  });

  it('a value sets the logo and leaves other brand fields alone', async () => {
    const { withBrandLogo } = await import('../examples/_admin/brandLogo.js');
    const brand = { name: 'Acme', extra: 1 } as unknown as Parameters<typeof withBrandLogo>[0];
    expect(withBrandLogo(brand, 'https://a/l.png')).toEqual({
      name: 'Acme',
      extra: 1,
      logo: 'https://a/l.png',
    });
  });
});
