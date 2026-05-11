import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeToggleDemo } from './theme-toggle-demo.js';
import { BasicQuoteForm } from './basic-quote-form.js';
import { ConditionalLogicDemo } from './conditional-logic.js';
import { PSWContact } from './psw-contact.js';
import { PSWInbox } from './psw-inbox.js';

type DemoKey = 'psw' | 'inbox' | 'form' | 'branching' | 'toggle';

const DEMOS: Record<
  DemoKey,
  { label: string; render: () => React.ReactNode; group: 'psw' | 'lib' }
> = {
  psw: { label: 'PSW contact', render: () => <PSWContact />, group: 'psw' },
  inbox: { label: 'PSW inbox', render: () => <PSWInbox />, group: 'psw' },
  form: { label: 'Basic quote form', render: () => <BasicQuoteForm />, group: 'lib' },
  branching: { label: 'Conditional logic', render: () => <ConditionalLogicDemo />, group: 'lib' },
  toggle: { label: 'Theme toggle demo', render: () => <ThemeToggleDemo />, group: 'lib' },
};

function readDemoFromHash(): DemoKey {
  const v = window.location.hash.replace('#', '');
  return v in DEMOS ? (v as DemoKey) : 'psw';
}

function App() {
  const [demo, setDemo] = useState<DemoKey>(() => readDemoFromHash());

  useEffect(() => {
    const handler = () => setDemo(readDemoFromHash());
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  }, []);

  return (
    <>
      <DemoSwitcher value={demo} onChange={setDemo} />
      {DEMOS[demo].render()}
    </>
  );
}

function DemoSwitcher({
  value,
  onChange,
}: {
  value: DemoKey;
  onChange: (v: DemoKey) => void;
}) {
  return (
    <div
      style={{
        position: 'fixed',
        top: 16,
        left: 16,
        zIndex: 1000,
        display: 'flex',
        gap: 4,
        padding: 4,
        background: 'rgba(0,0,0,0.7)',
        borderRadius: 999,
        backdropFilter: 'blur(8px)',
        border: '1px solid rgba(255,255,255,0.08)',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      {(Object.keys(DEMOS) as DemoKey[]).map((k, i, arr) => {
        const prev = i > 0 ? arr[i - 1] : null;
        const showDivider = prev && DEMOS[prev].group !== DEMOS[k].group;
        return (
          <span key={k} style={{ display: 'contents' }}>
            {showDivider && (
              <span
                aria-hidden
                style={{ width: 1, background: 'rgba(255,255,255,0.18)', margin: '4px 2px' }}
              />
            )}
            <button
              type="button"
              onClick={() => {
                window.location.hash = k;
                onChange(k);
              }}
              style={{
                padding: '6px 12px',
                fontSize: 11,
                border: 'none',
                background: value === k ? '#fff' : 'transparent',
                color: value === k ? '#000' : '#fff',
                cursor: 'pointer',
                borderRadius: 999,
                letterSpacing: '0.05em',
                fontWeight: 600,
                textTransform: 'uppercase',
              }}
            >
              {DEMOS[k].label}
            </button>
          </span>
        );
      })}
    </div>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
