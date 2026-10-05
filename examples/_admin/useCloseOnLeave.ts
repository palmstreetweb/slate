/**
 * A studio dialog belongs to the page it was opened on. The confirm and the
 * title prompt live above the router (studioApp.tsx), so without this they
 * outlived Back or a link: the next page stayed scroll-locked under them, and
 * "Move to trash" still acted on the page that was gone. Leaving the page now
 * cancels the dialog, the same as pressing Cancel.
 */

'use client';

import { useEffect, useRef } from 'react';
import { readRoute, routeKey, useRoute } from './_router.js';

export function useCloseOnLeave(open: boolean, onLeave: () => void): void {
  const here = routeKey(useRoute());
  const openedOn = useRef<string | null>(null);

  useEffect(() => {
    // The address now, not the last render's: a page that navigates and then
    // asks, in one go, owns the dialog it opened.
    openedOn.current = open ? routeKey(readRoute()) : null;
  }, [open]);

  useEffect(() => {
    if (openedOn.current !== null && openedOn.current !== here) {
      openedOn.current = null;
      onLeave();
    }
  }, [here, onLeave]);
}
