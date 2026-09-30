/**
 * Small building blocks shared by the Inspector's sections (Inspector.tsx and
 * InspectorWaveB.tsx): collapsible sections, label + control + hint fields,
 * two-up rows and checkboxes.
 */

import { useEffect, useState } from 'react';

export function CollapsibleSection({
  label,
  hint,
  summary,
  defaultOpen,
  questionId,
  children,
}: {
  label: string;
  hint?: string;
  summary: string;
  defaultOpen: boolean;
  questionId: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    setOpen(defaultOpen);
  }, [questionId, defaultOpen]);

  return (
    <div className="slate-collapsible">
      <button
        type="button"
        className="slate-collapsible-trigger"
        aria-expanded={open}
        onClick={() => setOpen((cur) => !cur)}
      >
        <span className="slate-collapsible-label">{label}</span>
        <span className="slate-collapsible-meta">
          {!open && <span className="slate-collapsible-summary">{summary}</span>}
          <span
            className={`slate-collapsible-chevron${open ? ' slate-collapsible-chevron--open' : ''}`}
            aria-hidden
          />
        </span>
      </button>
      {open && (
        <div className="slate-collapsible-body">
          {hint && (
            <p className="slate-help" style={{ marginTop: 0 }}>
              {hint}
            </p>
          )}
          {children}
        </div>
      )}
    </div>
  );
}

export function Row({ children }: { children: React.ReactNode }) {
  // Subgrid: label / control / hint share row tracks so inputs stay level
  // even when one label wraps or only one side has a hint.
  return <div className="slate-inspector-row">{children}</div>;
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="slate-inspector-field">
      <span className="slate-label">{label}</span>
      <span className="slate-inspector-field-control">{children}</span>
      {hint ? (
        <p className="slate-help">{hint}</p>
      ) : (
        <span className="slate-help slate-help--empty" aria-hidden />
      )}
    </label>
  );
}

export function Checkbox({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="slate-checkbox" style={{ marginBottom: 6 }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}
