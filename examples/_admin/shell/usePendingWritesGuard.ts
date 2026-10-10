'use client';

import { useEffect } from 'react';
import { hasPendingFormWrites } from '../_formsStore.js';

/** What an older browser shows; modern ones show their own sentence. */
export const LEAVE_WITH_PENDING_WRITES = 'Some changes aren’t saved yet.';

/**
 * While a form write is still on its way to the server, closing the tab or
 * leaving the site asks first — a "Not saved" edit used to be gone with no
 * warning (audit B5). Studio pages only; nothing is written to `<html>`.
 */
export function usePendingWritesGuard(): void {
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!hasPendingFormWrites()) return;
      e.preventDefault();
      e.returnValue = LEAVE_WITH_PENDING_WRITES;
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);
}
