'use client';

import type { ReactNode } from 'react';

type Props = {
  routeKey: string;
  children: ReactNode;
};

/** Subtle enter animation when hash routes change. Keyed remount per route. */
export function PageTransition({ routeKey, children }: Props) {
  return (
    <div key={routeKey} className="slate-page">
      {children}
    </div>
  );
}
