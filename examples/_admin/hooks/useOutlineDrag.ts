import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  computeOutlineDropIndex,
  measureOutlineDropLineY,
  measureOutlineRowTarget,
} from '../outlineDropIndex.js';
import { playSendPip } from '@/utils/sendPip.js';
import { playDeepPop } from '@/utils/deepPop.js';

const DRAG_THRESHOLD_PX = 4;
const SETTLE_MS = 200;
const SETTLE_FALLBACK_MS = SETTLE_MS + 80;

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
};

type SettlePlan = {
  id: string;
  origin: GhostRect;
  cancel: boolean;
  dropIndex: number;
};

type Phase = 'idle' | 'tracking' | 'settling' | 'canceling';

export function useOutlineDrag(
  questions: ReadonlyArray<{ id: string; type: string }>,
  onMove: (id: string, toIndex: number) => void,
) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [lineY, setLineY] = useState<number | null>(null);
  const [lineAnimated, setLineAnimated] = useState(false);
  const [ghost, setGhost] = useState<GhostRect | null>(null);
  const [settleAnimating, setSettleAnimating] = useState(false);

  const listRef = useRef<HTMLUListElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const ghostElRef = useRef<HTMLDivElement | null>(null);
  const sessionRef = useRef<DragSession | null>(null);
  const settleRef = useRef<SettlePlan | null>(null);
  const settleArmedRef = useRef(false);
  const ghostRef = useRef<GhostRect | null>(null);
  const dropIndexRef = useRef<number | null>(null);
  const didDragRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const questionsRef = useRef(questions);
  const onMoveRef = useRef(onMove);

  questionsRef.current = questions;
  onMoveRef.current = onMove;

  const dragActive = phase === 'tracking';
  const isSettling = phase === 'settling' || phase === 'canceling';
  const showDropLine = (dragActive || isSettling) && lineY !== null;

  const writeGhost = (next: GhostRect | null) => {
    ghostRef.current = next;
    setGhost(next);
  };

  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const finishSettle = () => {
    const plan = settleRef.current;
    if (!plan) return;
    if (!plan.cancel) {
      playDeepPop();
      onMoveRef.current(plan.id, plan.dropIndex);
    }
    reset();
  };

  const reset = () => {
    clearTimer();
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

  const beginPointerDrag = (
    id: string,
    sourceIndex: number,
    clientX: number,
    clientY: number,
    rowRect: DOMRect,
    pointerId: number,
    captureTarget: HTMLButtonElement,
  ) => {
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
    if (!plan || !isSettling || !settleAnimating || settleArmedRef.current || !list) return;

    settleArmedRef.current = true;

    const target = plan.cancel
      ? { x: plan.origin.x, y: plan.origin.y, width: plan.origin.width }
      : measureOutlineRowTarget(list, plan.dropIndex);

    const el = ghostElRef.current;

    const armFallback = () => {
      clearTimer();
      timerRef.current = window.setTimeout(finishSettle, SETTLE_FALLBACK_MS);
    };

    const onTransitionEnd = (event: TransitionEvent) => {
      const node = ghostElRef.current;
      if (!node || event.target !== node || event.propertyName !== 'transform') return;
      node.removeEventListener('transitionend', onTransitionEnd);
      clearTimer();
      finishSettle();
    };

    requestAnimationFrame(() => {
      writeGhost({ ...target, height: plan.origin.height });
      if (!el) {
        armFallback();
        return;
      }
      el.addEventListener('transitionend', onTransitionEnd);
      armFallback();
    });
  }, [isSettling, settleAnimating, phase]);

  useEffect(() => {
    if (!draggingId) return;

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
      updateDropTarget(e.clientY);
    };

    const onPointerUp = () => {
      const session = sessionRef.current;
      if (!session?.active) {
        reset();
        return;
      }

      const targetIndex = dropIndexRef.current;
      const release = ghostRef.current;
      if (targetIndex === null || !release) {
        reset();
        return;
      }

      const unchanged = targetIndex === session.sourceIndex;
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
      reset();
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
    };
  }, [draggingId]);

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
    dropIndex,
    lineY,
    lineAnimated,
    showDropLine,
    ghost,
    isSettling,
    settleAnimating,
    didDragRef,
    beginPointerDrag,
  };
}
