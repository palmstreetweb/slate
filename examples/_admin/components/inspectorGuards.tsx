/**
 * A plain-words warning under an inspector setting, with an optional one-tap
 * fix ("Swap", "Fix it"). Never put one inside `Field` (a <label>): the fix is
 * a button.
 */

import type { ReactNode } from 'react';
import './inspectorGuards.css';

export function GuardNote({
  children,
  action,
  quiet = false,
}: {
  children: ReactNode;
  action?: { label: string; onClick: () => void };
  /** A heads-up rather than a problem (muted colour). */
  quiet?: boolean;
}) {
  return (
    <p className={`slate-guard${quiet ? ' slate-guard--quiet' : ''}`} role="status">
      <span>{children}</span>
      {action ? (
        <button type="button" className="slate-guard-action" onClick={action.onClick}>
          {action.label}
        </button>
      ) : null}
    </p>
  );
}
