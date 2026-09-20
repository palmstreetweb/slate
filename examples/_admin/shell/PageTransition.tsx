'use client';

import type { ReactNode } from 'react';

type Props = {
  routeKey: string;
  children: ReactNode;
};

/** Route enter — keyed remount triggers the motion language in slateMotion.css. */
export function PageTransition({ routeKey, children }: Props) {
  return (
    <div key={routeKey} className="slate-page" data-slate-page={routeKey}>
      {children}
    </div>
  );
}
