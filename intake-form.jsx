import React, { useState, useEffect, useRef } from 'react';

/* ───────────────────────────────────────────────────────────────
   QUESTION SCHEMA
   ─────────────────────────────────────────────────────────────── */
const QUESTIONS = [
  {
    id: 'welcome',
    type: 'welcome',
    title: 'Hey there.',
    subtitle: "Let's get you a free quote. Takes about 60 seconds — no high-pressure sales, promise.",
    cta: 'Start',
  },
  { id: 'name', type: 'short_text', title: "What's your first name?", placeholder: 'Type your answer...', required: true },
  { id: 'email', type: 'email', title: (a) => `Nice to meet you, ${a.name || 'there'}. What's your email?`, placeholder: 'name@example.com', required: true },
  {
    id: 'service', type: 'choice', title: 'Which service are you interested in?',
    options: [
      { label: 'Driveway sealcoating', value: 'sealcoat' },
      { label: 'Parking lot striping', value: 'striping' },
      { label: 'Crack filling & repair', value: 'repair' },
      { label: 'Not sure yet — need advice', value: 'advice' },
    ],
  },
  {
    id: 'size', type: 'choice', title: 'Roughly how big is the area?',
    options: [
      { label: 'Small (under 1,000 sq ft)', value: 'sm' },
      { label: 'Medium (1,000–5,000 sq ft)', value: 'md' },
      { label: 'Large (5,000–15,000 sq ft)', value: 'lg' },
      { label: 'Commercial / huge', value: 'xl' },
    ],
  },
  { id: 'phone', type: 'short_text', title: 'Best number to reach you?', placeholder: '(805) 555-1234', required: true },
  {
    id: 'when', type: 'choice', title: "When's a good time to call?",
    options: [
      { label: 'Morning (8am – 12pm)', value: 'am' },
      { label: 'Afternoon (12pm – 5pm)', value: 'pm' },
      { label: 'Evening (5pm – 8pm)', value: 'eve' },
      { label: 'Anytime — just call me', value: 'any' },
    ],
  },
  { id: 'notes', type: 'long_text', title: 'Anything else we should know?', placeholder: 'Optional...', required: false },
  { id: 'done', type: 'thanks', title: "You're all set.", subtitle: "We'll be in touch within 24 hours." },
];

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

/* ───────────────────────────────────────────────────────────────
   THEME REGISTRY — add a new theme = add a new object here.
   ─────────────────────────────────────────────────────────────── */
const THEMES = {
  editorial: {
    name: 'Editorial',
    tagline: 'Refined serif · warm cream',
    fonts: {
      display: '"Fraunces", Georgia, serif',
      body: '"Fraunces", Georgia, serif',
      mono: '"JetBrains Mono", monospace',
    },
    colors: {
      bg: '#FAF6EE',
      ink: '#1A1A1A',
      accent: '#2D5BFF',
      accentSoft: 'rgba(45,91,255,0.06)',
      muted: 'rgba(26,26,26,0.18)',
      error: '#C8421A',
    },
    radius: '3px',
    borderWidth: '1.5px',
    titleWeight: 500,
    titleTracking: '-0.025em',
    titleLineHeight: 1.08,
    titleSize: 'clamp(2rem, 5.2vw, 3.4rem)',
    transform: 'none',
    badgeFont: 'mono',
    grain: true,
    decoration: 'none',
    animSpeed: 'smooth',
  },
  swiss: {
    name: 'Swiss',
    tagline: 'Bold geometric · poster energy',
    fonts: {
      display: '"Archivo Black", sans-serif',
      body: '"Archivo", sans-serif',
      mono: '"Archivo", sans-serif',
    },
    colors: {
      bg: '#F2EFE3',
      ink: '#000000',
      accent: '#DC2626',
      accentSoft: '#000000',
      muted: 'rgba(0,0,0,0.85)',
      error: '#DC2626',
    },
    radius: '0px',
    borderWidth: '2.5px',
    titleWeight: 900,
    titleTracking: '-0.04em',
    titleLineHeight: 0.95,
    titleSize: 'clamp(2.5rem, 6.2vw, 4.2rem)',
    transform: 'lowercase',
    badgeFont: 'sans',
    grain: false,
    decoration: 'shapes',
    animSpeed: 'snap',
  },
};

/* ───────────────────────────────────────────────────────────────
   SWISS DECORATIONS — a different geometric poster per question
   ─────────────────────────────────────────────────────────────── */
const SWISS_PALETTE = { red: '#DC2626', yellow: '#FACC15', blue: '#1D4ED8', black: '#000000' };

const SWISS_COMPOSITIONS = [
  // 0 — welcome
  (p) => (
    <>
      <circle cx="1050" cy="-50" r="420" fill={p.red} />
      <rect x="-30" y="780" width="200" height="200" fill={p.yellow} />
    </>
  ),
  // 1 — name
  (p) => (
    <>
      <rect x="-50" y="600" width="500" height="500" fill={p.yellow} />
      <rect x="850" y="-20" width="220" height="220" fill={p.black} />
    </>
  ),
  // 2 — email
  (p) => (
    <>
      <rect x="-50" y="50" width="800" height="40" fill={p.black} transform="rotate(-12 200 100)" />
      <rect x="-50" y="180" width="800" height="40" fill={p.red} transform="rotate(-12 200 230)" />
      <circle cx="900" cy="850" r="120" fill={p.yellow} />
    </>
  ),
  // 3 — service
  (p) => (
    <>
      <circle cx="0" cy="1050" r="500" fill={p.blue} />
      <rect x="700" y="0" width="400" height="120" fill={p.yellow} />
    </>
  ),
  // 4 — size
  (p) => (
    <>
      <circle cx="-100" cy="500" r="450" fill="none" stroke={p.red} strokeWidth="50" />
      <circle cx="-100" cy="500" r="320" fill="none" stroke={p.red} strokeWidth="50" />
      <circle cx="-100" cy="500" r="180" fill={p.red} />
      <rect x="900" y="700" width="180" height="180" fill={p.black} />
    </>
  ),
  // 5 — phone
  (p) => (
    <>
      <polygon points="1080,1080 1080,400 400,1080" fill={p.yellow} />
      <circle cx="120" cy="120" r="80" fill={p.red} />
    </>
  ),
  // 6 — when
  (p) => (
    <>
      <rect x="-50" y="850" width="1180" height="100" fill={p.red} />
      <rect x="50" y="50" width="180" height="180" fill={p.black} />
      <circle cx="950" cy="200" r="100" fill={p.yellow} />
    </>
  ),
  // 7 — notes
  (p) => (
    <>
      <circle cx="120" cy="900" r="160" fill={p.blue} />
      <rect x="850" y="80" width="200" height="200" fill={p.red} />
      <polygon points="500,1000 700,1080 500,1080" fill={p.black} />
    </>
  ),
  // 8 — thanks
  (p) => (
    <>
      <circle cx="950" cy="150" r="200" fill={p.red} />
      <rect x="-50" y="400" width="700" height="60" fill={p.black} transform="rotate(45 300 430)" />
      <rect x="100" y="300" width="350" height="60" fill={p.black} transform="rotate(45 275 330)" />
    </>
  ),
];

function SwissDecoration({ step }) {
  const Comp = SWISS_COMPOSITIONS[step % SWISS_COMPOSITIONS.length];
  return (
    <svg
      viewBox="0 0 1080 1080"
      preserveAspectRatio="xMidYMid slice"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', zIndex: 0, pointerEvents: 'none' }}
    >
      <Comp {...SWISS_PALETTE} />
    </svg>
  );
}

/* ───────────────────────────────────────────────────────────────
   THEME SWITCHER — demo only, drop in production
   ─────────────────────────────────────────────────────────────── */
function ThemeSwitcher({ value, onChange }) {
  return (
    <div
      style={{
        position: 'fixed', top: '50%', right: '20px',
        transform: 'translateY(-50%)', zIndex: 100,
        background: 'white',
        boxShadow: '0 4px 24px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.05)',
        borderRadius: '12px', padding: '8px',
        display: 'flex', flexDirection: 'column', gap: '4px',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      <div style={{ fontSize: '10px', letterSpacing: '0.12em', padding: '4px 8px 2px', color: '#888', textTransform: 'uppercase', fontWeight: 600 }}>
        Theme
      </div>
      {Object.entries(THEMES).map(([key, theme]) => {
        const active = value === key;
        return (
          <button
            key={key}
            onClick={() => onChange(key)}
            style={{
              textAlign: 'left', padding: '8px 12px', borderRadius: '8px',
              border: 'none',
              background: active ? '#0A0A0A' : 'transparent',
              color: active ? 'white' : '#1A1A1A',
              cursor: 'pointer', fontSize: '13px', fontWeight: 500,
              transition: 'all 150ms', minWidth: '160px',
            }}
            onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = '#F3F4F6'; }}
            onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
          >
            <div>{theme.name}</div>
            <div style={{ fontSize: '11px', opacity: active ? 0.6 : 0.5, marginTop: '1px', fontWeight: 400 }}>
              {theme.tagline}
            </div>
          </button>
        );
      })}
    </div>
  );
}

/* ───────────────────────────────────────────────────────────────
   INTAKE FORM (theme-aware) — for production use directly
   ─────────────────────────────────────────────────────────────── */
function IntakeForm({ theme: themeName = 'editorial', brandName = '805 SEALCOATING' }) {
  const t = THEMES[themeName];
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState({});
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [anim, setAnim] = useState('in');
  const inputRef = useRef(null);

  const q = QUESTIONS[step];
  const total = QUESTIONS.filter(x => x.type !== 'welcome' && x.type !== 'thanks').length;
  const answeredCount = Object.keys(answers).length;
  const progress = (answeredCount / total) * 100;

  useEffect(() => { setStep(0); setAnswers({}); setValue(''); setError(''); }, [themeName]);

  useEffect(() => {
    setError('');
    setValue(answers[q.id] || '');
    if (inputRef.current) setTimeout(() => inputRef.current?.focus(), 380);
  }, [step]);

  const transitionMs = t.animSpeed === 'snap' ? 180 : 240;

  const goNext = () => {
    setAnim('out');
    setTimeout(() => { setStep(s => Math.min(s + 1, QUESTIONS.length - 1)); setAnim('in'); }, transitionMs);
  };
  const goBack = () => {
    if (step === 0) return;
    setAnim('out');
    setTimeout(() => { setStep(s => Math.max(s - 1, 0)); setAnim('in'); }, transitionMs);
  };

  const submitText = () => {
    if (q.required && !value.trim()) { setError('Please fill this in'); return; }
    if (q.type === 'email' && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      setError("That doesn't look like a valid email"); return;
    }
    setAnswers(a => ({ ...a, [q.id]: value.trim() }));
    goNext();
  };

  const selectChoice = (opt) => {
    setAnswers(a => ({ ...a, [q.id]: opt.value }));
    setValue(opt.value);
    setTimeout(goNext, t.animSpeed === 'snap' ? 240 : 320);
  };

  useEffect(() => {
    const onKey = (e) => {
      if (q.type === 'choice' && !e.metaKey && !e.ctrlKey) {
        const idx = LETTERS.indexOf(e.key.toUpperCase());
        if (idx >= 0 && q.options[idx]) { e.preventDefault(); selectChoice(q.options[idx]); return; }
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        if (q.type === 'welcome') { e.preventDefault(); goNext(); return; }
        if (q.type === 'thanks') return;
        if (q.type === 'short_text' || q.type === 'email' || q.type === 'long_text') {
          e.preventDefault(); submitText();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [q, value, answers, themeName]);

  const titleText = typeof q.title === 'function' ? q.title(answers) : q.title;
  const transformText = (s) => t.transform === 'lowercase' ? String(s).toLowerCase() : s;
  const isSwiss = themeName === 'swiss';
  const easeIn = 'cubic-bezier(0.16, 1, 0.3, 1)';
  const easeOut = 'cubic-bezier(0.4, 0, 1, 1)';
  const badgeFontFamily = t.badgeFont === 'mono' ? t.fonts.mono : t.fonts.body;

  return (
    <div className="min-h-screen w-full relative overflow-hidden" style={{
      background: t.colors.bg,
      fontFamily: t.fonts.body,
      color: t.colors.ink,
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;700&family=Archivo+Black&family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=JetBrains+Mono:wght@400;500&display=swap');

        .q-in-${themeName} { animation: qIn-${themeName} ${transitionMs * 2.3}ms ${easeIn} both; }
        .q-out-${themeName} { animation: qOut-${themeName} ${transitionMs}ms ${easeOut} both; }
        @keyframes qIn-${themeName} {
          0%   { opacity: 0; transform: translateY(${isSwiss ? 18 : 28}px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        @keyframes qOut-${themeName} {
          0%   { opacity: 1; transform: translateY(0); }
          100% { opacity: 0; transform: translateY(${isSwiss ? -12 : -18}px); }
        }
        .grain-overlay {
          position: absolute; inset: 0;
          pointer-events: none; opacity: 0.06;
          background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
        }
        .btn-pulse { transition: all 180ms ease; }
        .btn-pulse:hover { transform: translateY(-1px); }
        .btn-pulse:active { transform: translateY(0); }
        input::placeholder, textarea::placeholder {
          color: rgba(0,0,0,0.28);
          font-style: ${isSwiss ? 'normal' : 'italic'};
        }
      `}</style>

      {t.decoration === 'shapes' && <SwissDecoration step={step} />}
      {t.grain && <div className="grain-overlay" />}

      {/* Progress bar */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0,
        height: isSwiss ? '4px' : '2px',
        background: isSwiss ? 'rgba(0,0,0,0.08)' : 'rgba(26,26,26,0.06)',
        zIndex: 20,
      }}>
        <div style={{
          height: '100%', width: `${progress}%`,
          background: isSwiss ? t.colors.ink : t.colors.accent,
          transition: `width ${isSwiss ? 200 : 600}ms ${easeIn}`,
        }} />
      </div>

      {/* Top chrome */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0,
        padding: '20px 24px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        zIndex: 10,
      }}>
        <div style={{
          fontSize: isSwiss ? '13px' : '12px',
          letterSpacing: '0.18em',
          fontFamily: badgeFontFamily,
          fontWeight: isSwiss ? 700 : 500,
          color: t.colors.ink,
          textTransform: t.transform === 'lowercase' ? 'lowercase' : 'uppercase',
        }}>
          {transformText(brandName)}
        </div>
        {step > 0 && q.type !== 'thanks' && (
          <button
            onClick={goBack}
            style={{
              fontSize: '11px', letterSpacing: '0.18em',
              fontWeight: isSwiss ? 700 : 400,
              opacity: 0.55, cursor: 'pointer',
              background: 'transparent', border: 'none',
              color: t.colors.ink,
              fontFamily: badgeFontFamily,
              textTransform: t.transform === 'lowercase' ? 'lowercase' : 'uppercase',
            }}
            onMouseEnter={(e) => e.currentTarget.style.opacity = 1}
            onMouseLeave={(e) => e.currentTarget.style.opacity = 0.55}
          >
            ← {transformText('BACK')}
          </button>
        )}
      </div>

      {/* Stage */}
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '0 24px', position: 'relative', zIndex: 5,
      }}>
        <div
          key={step}
          className={anim === 'in' ? `q-in-${themeName}` : `q-out-${themeName}`}
          style={{ width: '100%', maxWidth: '720px', position: 'relative' }}
        >
          {/* Question number */}
          {q.type !== 'welcome' && q.type !== 'thanks' && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              marginBottom: '20px',
              fontSize: isSwiss ? '15px' : '13px',
              fontFamily: t.badgeFont === 'mono' ? t.fonts.mono : t.fonts.display,
              color: isSwiss ? t.colors.ink : t.colors.accent,
              fontWeight: isSwiss ? 900 : 400,
              letterSpacing: isSwiss ? '0.05em' : 'normal',
            }}>
              <span>{String(step).padStart(2, '0')}</span>
              <span style={{ opacity: 0.5 }}>{isSwiss ? '/' : '→'}</span>
            </div>
          )}

          {/* Title */}
          <h1 style={{
            fontSize: t.titleSize,
            fontWeight: t.titleWeight,
            fontFamily: t.fonts.display,
            letterSpacing: t.titleTracking,
            lineHeight: t.titleLineHeight,
            marginBottom: '0.6rem',
            textTransform: t.transform === 'lowercase' ? 'lowercase' : 'none',
            color: t.colors.ink,
          }}>
            {transformText(titleText)}
          </h1>

          {/* Subtitle */}
          {q.subtitle && (
            <p style={{
              fontSize: 'clamp(1.05rem, 1.9vw, 1.2rem)',
              lineHeight: 1.5,
              opacity: isSwiss ? 0.75 : 0.65,
              maxWidth: '560px', marginBottom: '32px',
              fontFamily: t.fonts.body,
              fontWeight: isSwiss ? 500 : 400,
              color: t.colors.ink,
              textTransform: t.transform === 'lowercase' ? 'lowercase' : 'none',
            }}>
              {transformText(q.subtitle)}
            </p>
          )}

          {/* WELCOME */}
          {q.type === 'welcome' && (
            <button
              onClick={goNext}
              className="btn-pulse"
              style={{
                marginTop: '32px',
                display: 'inline-flex', alignItems: 'center', gap: '12px',
                padding: isSwiss ? '16px 32px' : '14px 28px',
                background: t.colors.ink, color: t.colors.bg,
                border: 'none', borderRadius: t.radius,
                fontSize: isSwiss ? '15px' : '16px',
                fontWeight: isSwiss ? 700 : 500,
                fontFamily: t.fonts.body, cursor: 'pointer',
                textTransform: t.transform === 'lowercase' ? 'lowercase' : 'none',
                letterSpacing: isSwiss ? '0.05em' : 'normal',
              }}
            >
              {transformText(q.cta)}
              <span style={{ opacity: 0.55, fontFamily: badgeFontFamily, fontSize: '0.78rem', fontWeight: 400 }}>
                {transformText('press Enter ↵')}
              </span>
            </button>
          )}

          {/* SHORT TEXT / EMAIL */}
          {(q.type === 'short_text' || q.type === 'email') && (
            <div style={{ marginTop: '24px' }}>
              <input
                ref={inputRef}
                type={q.type === 'email' ? 'email' : 'text'}
                value={value}
                onChange={e => { setValue(e.target.value); setError(''); }}
                placeholder={q.placeholder}
                style={{
                  width: '100%', background: 'transparent', outline: 'none',
                  borderTop: 'none', borderLeft: 'none', borderRight: 'none',
                  borderBottom: `${t.borderWidth} solid ${error ? t.colors.error : (isSwiss ? t.colors.ink : 'rgba(26,26,26,0.18)')}`,
                  paddingBottom: '0.6rem',
                  fontSize: isSwiss ? 'clamp(1.4rem, 3.4vw, 2rem)' : 'clamp(1.35rem, 3.2vw, 1.85rem)',
                  fontFamily: t.fonts.body,
                  fontWeight: isSwiss ? 500 : 400,
                  color: t.colors.ink,
                  transition: 'border-color 180ms',
                }}
                onFocus={(e) => { if (!error) e.target.style.borderBottomColor = t.colors.accent; }}
                onBlur={(e) => { if (!error) e.target.style.borderBottomColor = isSwiss ? t.colors.ink : 'rgba(26,26,26,0.18)'; }}
              />
              {error && (
                <p style={{
                  marginTop: '12px', fontSize: '13px',
                  color: t.colors.error,
                  fontFamily: badgeFontFamily,
                  fontWeight: isSwiss ? 700 : 400,
                  textTransform: t.transform === 'lowercase' ? 'lowercase' : 'none',
                }}>
                  {isSwiss ? '✕' : '!'} {transformText(error)}
                </p>
              )}
              <div style={{ marginTop: '36px', display: 'flex', alignItems: 'center', gap: '16px' }}>
                <button
                  onClick={submitText}
                  className="btn-pulse"
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: '8px',
                    padding: isSwiss ? '12px 24px' : '10px 20px',
                    background: t.colors.accent, color: 'white',
                    border: 'none', borderRadius: t.radius,
                    fontSize: isSwiss ? '14px' : '15px',
                    fontWeight: isSwiss ? 700 : 500,
                    fontFamily: t.fonts.body, cursor: 'pointer',
                    textTransform: t.transform === 'lowercase' ? 'lowercase' : 'none',
                    letterSpacing: isSwiss ? '0.05em' : 'normal',
                  }}
                >
                  {transformText('OK')} <span>✓</span>
                </button>
                <span style={{
                  fontSize: '11px', letterSpacing: '0.15em',
                  fontFamily: badgeFontFamily, opacity: 0.45,
                  fontWeight: isSwiss ? 700 : 400,
                  textTransform: t.transform === 'lowercase' ? 'lowercase' : 'none',
                }}>
                  {transformText('press Enter ↵')}
                </span>
              </div>
            </div>
          )}

          {/* LONG TEXT */}
          {q.type === 'long_text' && (
            <div style={{ marginTop: '24px' }}>
              <textarea
                ref={inputRef}
                value={value}
                onChange={e => setValue(e.target.value)}
                placeholder={q.placeholder}
                rows={3}
                style={{
                  width: '100%', background: 'transparent', outline: 'none', resize: 'none',
                  borderTop: 'none', borderLeft: 'none', borderRight: 'none',
                  borderBottom: `${t.borderWidth} solid ${isSwiss ? t.colors.ink : 'rgba(26,26,26,0.18)'}`,
                  paddingBottom: '0.6rem',
                  fontSize: 'clamp(1.15rem, 2.5vw, 1.45rem)',
                  fontFamily: t.fonts.body,
                  color: t.colors.ink, lineHeight: 1.5,
                  transition: 'border-color 180ms',
                }}
                onFocus={(e) => e.target.style.borderBottomColor = t.colors.accent}
                onBlur={(e) => e.target.style.borderBottomColor = isSwiss ? t.colors.ink : 'rgba(26,26,26,0.18)'}
              />
              <div style={{ marginTop: '28px', display: 'flex', alignItems: 'center', gap: '16px' }}>
                <button
                  onClick={submitText}
                  className="btn-pulse"
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: '8px',
                    padding: isSwiss ? '12px 24px' : '10px 20px',
                    background: t.colors.accent, color: 'white',
                    border: 'none', borderRadius: t.radius,
                    fontSize: isSwiss ? '14px' : '15px',
                    fontWeight: isSwiss ? 700 : 500,
                    fontFamily: t.fonts.body, cursor: 'pointer',
                    textTransform: t.transform === 'lowercase' ? 'lowercase' : 'none',
                    letterSpacing: isSwiss ? '0.05em' : 'normal',
                  }}
                >
                  {transformText('OK')} <span>✓</span>
                </button>
                <span style={{
                  fontSize: '11px', letterSpacing: '0.15em',
                  fontFamily: badgeFontFamily, opacity: 0.45,
                  fontWeight: isSwiss ? 700 : 400,
                  textTransform: t.transform === 'lowercase' ? 'lowercase' : 'none',
                }}>
                  {transformText('Shift + Enter for new line')}
                </span>
              </div>
            </div>
          )}

          {/* CHOICE */}
          {q.type === 'choice' && (
            <div style={{ marginTop: '36px', display: 'flex', flexDirection: 'column', gap: isSwiss ? '8px' : '10px' }}>
              {q.options.map((opt, i) => {
                const selected = answers[q.id] === opt.value;
                return (
                  <button
                    key={opt.value}
                    onClick={() => selectChoice(opt)}
                    style={{
                      width: '100%', textAlign: 'left',
                      display: 'flex', alignItems: 'center', gap: '16px',
                      padding: isSwiss ? '18px 20px' : '16px 20px',
                      border: `${t.borderWidth} solid ${selected ? t.colors.ink : (isSwiss ? t.colors.ink : 'rgba(26,26,26,0.16)')}`,
                      background: selected ? (isSwiss ? t.colors.ink : t.colors.accentSoft) : (isSwiss ? 'white' : 'transparent'),
                      borderRadius: t.radius,
                      cursor: 'pointer',
                      transition: 'all 150ms',
                      color: selected && isSwiss ? 'white' : t.colors.ink,
                      fontFamily: t.fonts.body,
                      fontWeight: isSwiss ? 600 : 400,
                    }}
                    onMouseEnter={(e) => {
                      if (!selected) {
                        if (isSwiss) { e.currentTarget.style.background = t.colors.ink; e.currentTarget.style.color = 'white'; }
                        else { e.currentTarget.style.borderColor = t.colors.accent; e.currentTarget.style.background = 'rgba(45,91,255,0.03)'; }
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!selected) {
                        if (isSwiss) { e.currentTarget.style.background = 'white'; e.currentTarget.style.color = t.colors.ink; }
                        else { e.currentTarget.style.borderColor = 'rgba(26,26,26,0.16)'; e.currentTarget.style.background = 'transparent'; }
                      }
                    }}
                  >
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      width: isSwiss ? '32px' : '28px',
                      height: isSwiss ? '32px' : '28px',
                      fontSize: isSwiss ? '14px' : '12px',
                      fontFamily: badgeFontFamily,
                      fontWeight: isSwiss ? 900 : 500,
                      border: `${t.borderWidth} solid ${selected ? (isSwiss ? 'white' : t.colors.accent) : (isSwiss ? 'currentColor' : 'rgba(26,26,26,0.22)')}`,
                      background: selected ? (isSwiss ? 'white' : t.colors.accent) : 'transparent',
                      color: selected ? (isSwiss ? t.colors.ink : 'white') : 'currentColor',
                      borderRadius: t.radius,
                      flexShrink: 0,
                    }}>
                      {LETTERS[i]}
                    </span>
                    <span style={{
                      fontSize: 'clamp(1.05rem, 2vw, 1.2rem)',
                      textTransform: t.transform === 'lowercase' ? 'lowercase' : 'none',
                    }}>
                      {transformText(opt.label)}
                    </span>
                  </button>
                );
              })}
              <p style={{
                paddingTop: '20px', fontSize: '11px', letterSpacing: '0.15em',
                fontFamily: badgeFontFamily, opacity: 0.4,
                fontWeight: isSwiss ? 700 : 400,
              }}>
                {transformText(isSwiss ? 'TAP A KEY (A B C D) OR CLICK' : 'TAP A KEY (A, B, C, D) OR CLICK TO SELECT')}
              </p>
            </div>
          )}

          {/* THANKS */}
          {q.type === 'thanks' && (
            <div style={{ marginTop: '24px' }}>
              <div style={{
                display: 'inline-block',
                padding: isSwiss ? '12px 20px' : '8px 16px',
                marginTop: '8px',
                fontSize: '11px', letterSpacing: '0.18em',
                fontFamily: badgeFontFamily,
                fontWeight: isSwiss ? 700 : 500,
                background: t.colors.ink, color: t.colors.bg,
                borderRadius: t.radius,
                textTransform: t.transform === 'lowercase' ? 'lowercase' : 'uppercase',
              }}>
                ✓ {transformText('CONFIRMATION SENT')}
              </div>
              <button
                onClick={() => { setStep(0); setAnswers({}); setValue(''); }}
                style={{
                  display: 'block', marginTop: '32px', fontSize: '14px',
                  textDecoration: 'underline', opacity: 0.6,
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  fontFamily: t.fonts.body, color: t.colors.ink,
                  textTransform: t.transform === 'lowercase' ? 'lowercase' : 'none',
                }}
              >
                {transformText('Submit another quote')}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Footer counter */}
      {q.type !== 'thanks' && q.type !== 'welcome' && (
        <div style={{
          position: 'absolute', bottom: '20px', right: '24px',
          fontSize: '11px', letterSpacing: '0.15em',
          fontFamily: badgeFontFamily, opacity: 0.4,
          fontWeight: isSwiss ? 700 : 400,
          color: t.colors.ink, zIndex: 10,
        }}>
          {answeredCount} / {total}
        </div>
      )}
    </div>
  );
}

/* ───────────────────────────────────────────────────────────────
   DEMO WRAPPER — theme switcher + form
   PRODUCTION: just <IntakeForm theme="swiss" brandName="Wild Wash" />
   ─────────────────────────────────────────────────────────────── */
export default function App() {
  const [theme, setTheme] = useState('editorial');
  return (
    <div>
      <ThemeSwitcher value={theme} onChange={setTheme} />
      <IntakeForm theme={theme} />
    </div>
  );
}
