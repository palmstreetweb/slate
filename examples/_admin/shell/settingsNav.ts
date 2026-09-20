/**
 * Shared return path when leaving Settings (FAB close + click-outside).
 */

import { navigate } from '../_router.js';

let returnTo = '/';

export function rememberSettingsReturn(path: string): void {
  returnTo = path && path !== '/settings' ? path : '/';
}

export function closeSettings(): void {
  navigate(returnTo || '/');
}
