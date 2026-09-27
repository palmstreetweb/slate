/**
 * Motion gallery bundle (ADR-059, ADR-060): `/motion` only. A dev demo that replays
 * every delight-pass animation with schemas built into the page — no studio,
 * no auth provider, no Neon, nothing submitted anywhere.
 */

import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { useRoute } from './_admin/_router.js';
import { MotionGallery } from './motion/MotionGallery.js';
import { ToastProvider } from './_admin/toast.js';

// Studio chrome for the pass 4–5 studio moments (ADR-060).
import './_admin/slateChromeTokens.css';
import './_admin/publicChrome.css';
import './_admin/_adminTheme.css';
import './_admin/slateMotion.css';
import './_admin/delight/delight.css';
import './motion/motionGallery.css';

function MotionRoute() {
  const route = useRoute();
  const here = route.name === 'motion';

  useEffect(() => {
    // Anything else needs another bundle — reload so the entry picks it.
    if (!here) window.location.reload();
  }, [here]);

  // Studio moments push real studio toasts (bottom-right), as in the studio.
  return here ? (
    <ToastProvider>
      <MotionGallery />
    </ToastProvider>
  ) : null;
}

/** Fraunces for the editorial / forest / bloom cards (Inter + JetBrains Mono load in index.html). */
function loadDisplayFont(): void {
  const id = 'slate-motion-fraunces';
  if (document.getElementById(id)) return;
  const link = document.createElement('link');
  link.id = id;
  link.rel = 'stylesheet';
  link.href =
    'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&display=swap';
  document.head.appendChild(link);
}

export function mountMotion(root: HTMLElement): void {
  document.title = 'Motion gallery · Slate';
  loadDisplayFont();
  createRoot(root).render(
    <StrictMode>
      <MotionRoute />
    </StrictMode>,
  );
}
