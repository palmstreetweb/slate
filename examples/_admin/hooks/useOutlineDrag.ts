import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  computeOutlineDropIndex,
  measureOutlineDropLineY,
  measureOutlineRowTarget,
} from '../outlineDropIndex.js';
import { playSendPip } from '@/utils/sendPip.js';
import { playDeepPop } from '@/utils/deepPop.js';

const DRAG_THRESHOLD_PX = 4;
const SETTLE_MS = 380;
const CANCEL_MS = 300;
const SETTLE_COMMIT_RATIO = 0.82;
const SETTLE_EASE = 'cubic-bezier(0.22, 1, 0.16, 1)';
const CANCEL_EASE = 'cubic-bezier(0.33, 0.9, 0.42, 1)';
const TRACKING_SCALE = 1.035;
const TRACKING_ROTATE_DEG = -1.5;

type GhostRect = { x: number; y: number; width: number; height: number };

type DragSession = {
  id: string;
  sourceIndex: number;
  startX: number;
  startY: number;
  active: boolean;
  offsetX: number;
  offsetY: number;
  origin: GhostRect;
  captureTarget: HTMLButtonElement;
};

type SettlePlan = {
  id: string;
  origin: GhostRect;
  cancel: boolean;
  dropIndex: number;
};

export type OutlineDragPhase = 'idle' | 'tracking' | 'settling' | 'canceling';

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

function clearGhostInlineStyles(el: HTMLElement | null) {
  if (!el) return;
  el.style.transform = '';
  el.style.opacity = '';
  const card = el.querySelector('.slate-outline-card');
  if (card instanceof HTMLElement) {
    card.style.transform = '';
  }
}

export function useOutlineDrag(
  questions: ReadonlyArray<{ id: string; type: string }>,
  onMove: (id: string, toIndex: number) => void,
) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [phase, setPhase] = useState<OutlineDragPhase>('idle');
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [lineY, setLineY] = useState<number | null>(null);
  const [lineAnimated, setLineAnimated] = useState(false);
  const [ghost, setGhost] = useState<GhostRect | null>(null);
  const [settleAnimating, setSettleAnimating] = useState(false);
  const [landedId, setLandedId] = useState<string | null>(null);

  const listRef = useRef<HTMLUListElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const ghostElRef = useRef<HTMLDivElement | null>(null);
  const sessionRef = useRef<DragSession | null>(null);
  const settleRef = useRef<SettlePlan | null>(null);
  const settleArmedRef = useRef(false);
  const settleAnimsRef = useRef<Animation[]>([]);
  const settleTimerRef = useRef<number | null>(null);
  const landedTimerRef = useRef<number | null>(null);
  const ghostRef = useRef<GhostRect | null>(null);
  const dropIndexRef = useRef<number | null>(null);
  const didDragRef = useRef(false);
  const questionsRef = useRef(questions);
  const onMoveRef = useRef(onMove);

  const dragActive = phase === 'tracking';
  const isSettling = phase === 'settling' || phase === 'canceling';
  const showDropLine = (dragActive || isSettling) && lineY !== null;

  const writeGhost = (next: GhostRect | null) => {
    ghostRef.current = next;
    setGhost(next);
  };

  const cancelSettleAnims = () => {
    if (settleTimerRef.current !== null) {
      window.clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    }
    if (landedTimerRef.current !== null) {
      window.clearTimeout(landedTimerRef.current);
      landedTimerRef.current = null;
    }
    for (const anim of settleAnimsRef.current) {
      anim.cancel();
    }
    settleAnimsRef.current = [];
  };

  const reset = () => {
    cancelSettleAnims();
    clearGhostInlineStyles(ghostElRef.current);
    sessionRef.current = null;
    settleRef.current = null;
    settleArmedRef.current = false;
    ghostRef.current = null;
    dropIndexRef.current = null;
    setDraggingId(null);
    setPhase('idle');
    setDropIndex(null);
    setLineY(null);
    setLineAnimated(false);
    setSettleAnimating(false);
    setGhost(null);
    setLandedId(null);
  };

  const finishSettle = () => {
    reset();
  };

  const syncDropLine = (index: number) => {
    const list = listRef.current;
    if (!list) return;
    setLineY(measureOutlineDropLineY(list, index));
  };

  const updateDropTarget = (clientY: number) => {
    const list = listRef.current;
    if (!list) return;
    const next = computeOutlineDropIndex(list, questionsRef.current, clientY);
    if (next === dropIndexRef.current) return;
    dropIndexRef.current = next;
    setDropIndex(next);
    syncDropLine(next);
  };

  const finishSettleRef = useRef(finishSettle);
  const resetRef = useRef(reset);
  const updateDropTargetRef = useRef(updateDropTarget);
  finishSettleRef.current = finishSettle;
  resetRef.current = reset;
  updateDropTargetRef.current = updateDropTarget;

  questionsRef.current = questions;
  onMoveRef.current = onMove;

  const beginPointerDrag = (
    id: string,
    sourceIndex: number,
    clientX: number,
    clientY: number,
    rowRect: DOMRect,
    pointerId: number,
    captureTarget: HTMLButtonElement,
  ) => {
    cancelSettleAnims();
    clearGhostInlineStyles(ghostElRef.current);
    settleRef.current = null;
    settleArmedRef.current = false;
    setSettleAnimating(false);
    setLandedId(null);

    captureTarget.setPointerCapture(pointerId);
    sessionRef.current = {
      id,
      sourceIndex,
      startX: clientX,
      startY: clientY,
      active: false,
      offsetX: clientX - rowRect.left,
      offsetY: clientY - rowRect.top,
      origin: {
        x: rowRect.left,
        y: rowRect.top,
        width: rowRect.width,
        height: rowRect.height,
      },
      captureTarget,
    };
    dropIndexRef.current = null;
    didDragRef.current = false;
    settleArmedRef.current = false;
    setDraggingId(id);
    setPhase('idle');
    setDropIndex(null);
    setLineY(null);
    setLineAnimated(false);
    setSettleAnimating(false);
    writeGhost(null);
  };

  useLayoutEffect(() => {
    if (!showDropLine || lineAnimated) return;
    requestAnimationFrame(() => {
      setLineAnimated(true);
    });
  }, [showDropLine, lineAnimated]);

  useLayoutEffect(() => {
    const plan = settleRef.current;
    const list = listRef.current;
    const el = ghostElRef.current;
    if (!plan || !isSettling || !settleAnimating || settleArmedRef.current || !list || !el) return;

    settleArmedRef.current = true;

    const release = ghostRef.current ?? plan.origin;
    const target = plan.cancel
      ? { x: plan.origin.x, y: plan.origin.y, width: plan.origin.width }
      : measureOutlineRowTarget(list, plan.dropIndex, questionsRef.current);

    const card = el.querySelector('.slate-outline-card');
    const reduced = prefersReducedMotion();
    const duration = reduced ? 0 : plan.cancel ? CANCEL_MS : SETTLE_MS;

    el.style.transform = `translate3d(${release.x}px, ${release.y}px, 0)`;
    el.style.opacity = '1';
    if (card instanceof HTMLElement) {
      card.style.transform = `scale(${TRACKING_SCALE}) rotate(${TRACKING_ROTATE_DEG}deg)`;
    }

    const commitReorder = () => {
      if (plan.cancel) return;
      playDeepPop();
      onMoveRef.current(plan.id, plan.dropIndex);
      setLandedId(plan.id);
      if (landedTimerRef.current !== null) {
        window.clearTimeout(landedTimerRef.current);
      }
      landedTimerRef.current = window.setTimeout(() => setLandedId(null), 360);
    };

    if (duration === 0) {
      commitReorder();
      finishSettleRef.current();
      return;
    }

    const moveKeyframes: Keyframe[] = plan.cancel
      ? [
          { transform: `translate3d(${release.x}px, ${release.y}px, 0)`, opacity: 1 },
          { transform: `translate3d(${target.x}px, ${target.y}px, 0)`, opacity: 1 },
        ]
      : [
          { transform: `translate3d(${release.x}px, ${release.y}px, 0)`, opacity: 1 },
          {
            transform: `translate3d(${target.x}px, ${target.y}px, 0)`,
            opacity: 1,
            offset: SETTLE_COMMIT_RATIO,
          },
          { transform: `translate3d(${target.x}px, ${target.y}px, 0)`, opacity: 0 },
        ];

    const moveAnim = el.animate(moveKeyframes, {
      duration,
      easing: plan.cancel ? CANCEL_EASE : SETTLE_EASE,
      fill: 'forwards',
    });

    const scaleKeyframes: Keyframe[] = [
      {
        transform: `scale(${TRACKING_SCALE}) rotate(${TRACKING_ROTATE_DEG}deg)`,
      },
      { transform: 'scale(1) rotate(0deg)' },
    ];

    const scaleAnim =
      card instanceof HTMLElement
        ? card.animate(scaleKeyframes, {
            duration,
            easing: plan.cancel ? CANCEL_EASE : SETTLE_EASE,
            fill: 'forwards',
          })
        : null;

    settleAnimsRef.current = scaleAnim ? [moveAnim, scaleAnim] : [moveAnim];

    void Promise.all(settleAnimsRef.current.map((a) => a.finished))
      .then(() => {
        if (!plan.cancel) commitReorder();
        finishSettleRef.current();
      })
      .catch(() => finishSettleRef.current());
  }, [isSettling, settleAnimating, phase]);

  useEffect(() => {
    if (!draggingId) return;

    const captureTarget = sessionRef.current?.captureTarget;

    const onPointerMove = (e: PointerEvent) => {
      const session = sessionRef.current;
      if (!session) return;

      if (!session.active) {
        if (Math.hypot(e.clientX - session.startX, e.clientY - session.startY) < DRAG_THRESHOLD_PX) {
          return;
        }
        session.active = true;
        didDragRef.current = true;
        playSendPip();

        const rowRect = session.origin;
        session.offsetX = e.clientX - rowRect.x;
        session.offsetY = e.clientY - rowRect.y;

        dropIndexRef.current = session.sourceIndex;
        setDropIndex(session.sourceIndex);
        syncDropLine(session.sourceIndex);
        writeGhost({ ...rowRect });
        setPhase('tracking');
        return;
      }

      writeGhost({
        x: e.clientX - session.offsetX,
        y: e.clientY - session.offsetY,
        width: session.origin.width,
        height: session.origin.height,
      });
      updateDropTargetRef.current(e.clientY);
    };

    const onPointerUp = () => {
      const session = sessionRef.current;
      if (!session?.active) {
        resetRef.current();
        return;
      }

      const targetIndex = dropIndexRef.current;
      const release = ghostRef.current;
      if (targetIndex === null || !release) {
        resetRef.current();
        return;
      }

      const unchanged =
        targetIndex === session.sourceIndex || targetIndex === session.sourceIndex + 1;
      settleRef.current = {
        id: session.id,
        origin: session.origin,
        cancel: unchanged,
        dropIndex: targetIndex,
      };
      sessionRef.current = null;
      settleArmedRef.current = false;
      syncDropLine(targetIndex);
      setSettleAnimating(true);
      setPhase(unchanged ? 'canceling' : 'settling');
    };

    const onPointerCancel = () => {
      resetRef.current();
    };

    const onLostPointerCapture = () => {
      if (sessionRef.current?.active) {
        resetRef.current();
      }
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
    captureTarget?.addEventListener('lostpointercapture', onLostPointerCapture);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
      captureTarget?.removeEventListener('lostpointercapture', onLostPointerCapture);
    };
  }, [draggingId]);

  useEffect(() => () => resetRef.current(), []);

  useEffect(() => {
    if (!draggingId) return;
    const prev = document.body.style.userSelect;
    document.body.style.userSelect = 'none';
    return () => {
      document.body.style.userSelect = prev;
    };
  }, [draggingId]);

  return {
    listRef,
    wrapRef,
    ghostElRef,
    draggingId,
    dragActive,
    phase,
    dropIndex,
    lineY,
    lineAnimated,
    showDropLine,
    ghost,
    isSettling,
    settleAnimating,
    landedId,
    didDragRef,
    beginPointerDrag,
  };
}
