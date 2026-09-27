/**
 * Response arrivals (ADR-060) — which responses landed while the studio was
 * open, so lists can slide them in with a fading accent wash.
 *
 * The bell's ingest (shell/StudioInbox.tsx) is the one place that knows a
 * response is new to this browser; it calls `noteArrivals` for live arrivals
 * only, never for the batch that loads with the page. Lists read
 * `isArrival(id)` while rendering and re-render through `useArrivalsVersion`.
 * Module state, per tab, never persisted.
 */

import { useSyncExternalStore } from 'react';

/** How long a row counts as "just arrived" — a little longer than its 2 s wash. */
export const ARRIVAL_WINDOW_MS = 2400;
/** Old entries are dropped on the next note, so the map stays tiny. */
const KEEP_MS = 10_000;

const arrivedAt = new Map<string, number>();
const listeners = new Set<() => void>();
let version = 0;

export function noteArrivals(ids: ReadonlyArray<string>, now = Date.now()): void {
  if (ids.length === 0) return;
  for (const [id, at] of arrivedAt) {
    if (now - at > KEEP_MS) arrivedAt.delete(id);
  }
  for (const id of ids) arrivedAt.set(id, now);
  version += 1;
  listeners.forEach((l) => l());
}

export function isArrival(id: string, now = Date.now()): boolean {
  const at = arrivedAt.get(id);
  return at !== undefined && now - at < ARRIVAL_WINDOW_MS;
}

export function subscribeArrivals(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Bumps whenever arrivals are noted, so a list re-renders and tags its new rows. */
export function useArrivalsVersion(): number {
  return useSyncExternalStore(
    subscribeArrivals,
    () => version,
    () => 0,
  );
}

/** Tests only. */
export function resetArrivals(): void {
  arrivedAt.clear();
  version = 0;
}
