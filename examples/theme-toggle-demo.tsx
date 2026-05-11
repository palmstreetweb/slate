/**
 * STEP 4 demo — minimal page that renders just the PSW theme toggle on a
 * sample wrapper, with both themes' tokens swapped via a small dev-only
 * theme picker. Compare side-by-side with palmstreetweb.com.
 */

import { useRef, useState } from 'react';
import { ThemeToggle } from '@/components/chrome/ThemeToggle.js';
import { useTheme } from '@/hooks/useTheme.js';
import { themes } from '@/themes/index.js';
import type { ThemeName } from '@/types/Theme.js';

import '@/styles/tokens.css';
import '@/styles/toggle.css';

export function ThemeToggleDemo() {
  const [themeName, setThemeName] = useState<ThemeName>('editorial');
  const wrapperRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  const { resolved, toggle } = useTheme({
    mode: 'toggle',
    wrapperRef,
    toggleRef,
  });

  const t = themes[themeName];

  return (
    <div
      ref={wrapperRef}
      data-psw-forms
      data-theme-name={themeName}
      data-theme={resolved}
      style={{
        minHeight: '100vh',
        background: 'var(--psw-bg)',
        color: 'var(--psw-text)',
        fontFamily: 'var(--psw-font-body)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 48,
        padding: 48,
        transition: 'background 0.4s ease, color 0.4s ease',
      }}
    >
      <ThemePicker value={themeName} onChange={setThemeName} />

      <div style={{ textAlign: 'center', maxWidth: 640 }}>
        <p
          style={{
            fontSize: 12,
            letterSpacing: '0.18em',
            textTransform: 'var(--psw-transform)' as 'lowercase' | 'none',
            opacity: 0.55,
            margin: 0,
            marginBottom: 24,
            fontFamily: 'var(--psw-font-mono)',
          }}
        >
          {t.name} · {resolved}
        </p>
        <h1
          style={{
            fontFamily: 'var(--psw-font-display)',
            fontSize: 'var(--psw-title-size)',
            fontWeight: 'var(--psw-title-weight)' as unknown as number,
            letterSpacing: 'var(--psw-title-tracking)',
            lineHeight: 'var(--psw-title-line-height)' as unknown as number,
            textTransform: 'var(--psw-transform)' as 'lowercase' | 'none',
            margin: 0,
            color: 'var(--psw-text)',
          }}
        >
          {themeName === 'swiss' ? 'palm street web.' : 'Palm Street Web.'}
        </h1>
        <p
          style={{
            marginTop: 16,
            opacity: 0.65,
            color: 'var(--psw-text)',
            textTransform: 'var(--psw-transform)' as 'lowercase' | 'none',
          }}
        >
          {t.tagline}
        </p>
      </div>

      <ThemeToggle mode={resolved} onToggle={toggle} ref={toggleRef} />

      <p
        style={{
          fontSize: 11,
          letterSpacing: '0.15em',
          opacity: 0.4,
          margin: 0,
          fontFamily: 'var(--psw-font-mono)',
        }}
      >
        toggle me · localStorage key: psw-forms-theme
      </p>
    </div>
  );
}

function ThemePicker({
  value,
  onChange,
}: {
  value: ThemeName;
  onChange: (n: ThemeName) => void;
}) {
  return (
    <div
      style={{
        position: 'fixed',
        top: 16,
        right: 16,
        zIndex: 100,
        display: 'flex',
        gap: 6,
        padding: 6,
        borderRadius: 999,
        background: 'rgba(0,0,0,0.55)',
        backdropFilter: 'blur(8px)',
        border: '1px solid rgba(255,255,255,0.08)',
      }}
    >
      {(Object.keys(themes) as ThemeName[]).map((name) => {
        const active = value === name;
        return (
          <button
            key={name}
            type="button"
            onClick={() => onChange(name)}
            style={{
              padding: '6px 14px',
              borderRadius: 999,
              border: 'none',
              background: active ? '#fff' : 'transparent',
              color: active ? '#000' : '#fff',
              fontSize: 12,
              fontFamily: 'system-ui, sans-serif',
              fontWeight: 600,
              letterSpacing: '0.05em',
              cursor: 'pointer',
              textTransform: 'uppercase',
            }}
          >
            {name}
          </button>
        );
      })}
    </div>
  );
}
