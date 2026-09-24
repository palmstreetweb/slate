/**
 * Loading placeholder shaped like the view that is about to appear
 * (ADR-055), so nothing jumps when a form's responses land.
 */

'use client';

import type { ResponsesViewName } from './types.js';

type Props = { view: ResponsesViewName };

function Bar({ width, size }: { width: string; size?: 'sm' | 'lg' }) {
  return (
    <span className={`rsp-skel-bar${size ? ` rsp-skel-bar--${size}` : ''}`} style={{ width }} />
  );
}

const ROWS = ['62%', '48%', '70%', '55%', '66%', '44%'];

export function ResponsesSkeleton({ view }: Props) {
  return (
    <div className="rsp-view" role="status" aria-label="Loading responses">
      <span className="rsp-sr">Loading responses…</span>
      {view === 'inbox' ? (
        <div className="rsp-skel-panel" aria-hidden="true">
          <div className="rsp-skel-list">
            <div className="rsp-skel-search" />
            <Bar width="46%" size="lg" />
            {ROWS.map((w, i) => (
              <div key={i} className="rsp-skel-row">
                <Bar width={w} />
                <Bar width={`${Math.min(92, parseInt(w, 10) + 24)}%`} size="sm" />
              </div>
            ))}
          </div>
          <div className="rsp-skel-reader">
            <Bar width="28%" size="sm" />
            <Bar width="44%" size="lg" />
            <Bar width="60%" />
          </div>
        </div>
      ) : (
        <div className="rsp-skel-sum" aria-hidden="true">
          <div className="rsp-skel-summary">
            <div className="rsp-skel-card">
              <Bar width="40%" size="sm" />
              <Bar width="30%" size="lg" />
              <Bar width="70%" size="sm" />
            </div>
            <div className="rsp-skel-card">
              <Bar width="55%" />
              {ROWS.slice(0, 4).map((w, i) => (
                <Bar key={i} width={w} size="sm" />
              ))}
            </div>
            <div className="rsp-skel-card">
              <Bar width="50%" />
              {ROWS.slice(2, 6).map((w, i) => (
                <Bar key={i} width={w} size="sm" />
              ))}
            </div>
          </div>
          <div className="rsp-skel-rows">
            {ROWS.slice(0, 4).map((w, i) => (
              <span key={i}>
                <Bar width={w} size="sm" />
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
