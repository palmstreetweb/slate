import { useCallback, useEffect, useRef, useState, type PointerEvent, type RefObject } from 'react';
import {
  clampEditorWidths,
  EDITOR_LAYOUT_DEFAULTS,
  type EditorLayoutWidths,
} from '../editorLayout.js';

const DRAG_THRESHOLD_PX = 4;

type ResizeSide = 'left' | 'right';

type DragSession = {
  side: ResizeSide;
  pointerId: number;
  startX: number;
  startLeft: number;
  startRight: number;
  active: boolean;
  captureTarget: HTMLElement;
};

function applyWidthVars(el: HTMLElement, widths: EditorLayoutWidths): void {
  el.style.setProperty('--slate-editor-left', `${widths.left}px`);
  el.style.setProperty('--slate-editor-right', `${widths.right}px`);
}

export function useEditorResize(
  containerRef: RefObject<HTMLElement | null>,
  widths: EditorLayoutWidths,
  onWidthsChange: (next: EditorLayoutWidths) => void,
) {
  const [dragging, setDragging] = useState<ResizeSide | null>(null);
  const sessionRef = useRef<DragSession | null>(null);
  const widthsRef = useRef(widths);
  widthsRef.current = widths;

  const commitWidths = useCallback(
    (next: EditorLayoutWidths) => {
      const el = containerRef.current;
      const clamped = clampEditorWidths(el?.clientWidth ?? window.innerWidth, next);
      if (el) applyWidthVars(el, clamped);
      onWidthsChange(clamped);
    },
    [containerRef, onWidthsChange],
  );

  const onGutterPointerDown = useCallback(
    (side: ResizeSide) => (event: PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const target = event.currentTarget;
      target.setPointerCapture(event.pointerId);
      sessionRef.current = {
        side,
        pointerId: event.pointerId,
        startX: event.clientX,
        startLeft: widthsRef.current.left,
        startRight: widthsRef.current.right,
        active: false,
        captureTarget: target,
      };
    },
    [],
  );

  const onGutterPointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const session = sessionRef.current;
      if (!session || session.pointerId !== event.pointerId) return;

      const delta = event.clientX - session.startX;
      if (!session.active && Math.abs(delta) < DRAG_THRESHOLD_PX) return;

      if (!session.active) {
        session.active = true;
        setDragging(session.side);
        document.body.classList.add('slate-editor-resizing');
      }

      const el = containerRef.current;
      if (!el) return;

      const next =
        session.side === 'left'
          ? {
              left: session.startLeft + delta,
              right: session.startRight,
            }
          : {
              left: session.startLeft,
              right: session.startRight - delta,
            };

      applyWidthVars(el, clampEditorWidths(el.clientWidth, next));
    },
    [containerRef],
  );

  const endDrag = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const session = sessionRef.current;
      if (!session || session.pointerId !== event.pointerId) return;

      sessionRef.current = null;
      setDragging(null);
      document.body.classList.remove('slate-editor-resizing');

      try {
        session.captureTarget.releasePointerCapture(event.pointerId);
      } catch {
        // ignored
      }

      if (!session.active) return;

      const el = containerRef.current;
      if (!el) return;

      const left = parseInt(el.style.getPropertyValue('--slate-editor-left'), 10);
      const right = parseInt(el.style.getPropertyValue('--slate-editor-right'), 10);
      if (Number.isFinite(left) && Number.isFinite(right)) {
        commitWidths({ left, right });
      }
    },
    [commitWidths, containerRef],
  );

  const onGutterDoubleClick = useCallback(
    (side: ResizeSide) => () => {
      const el = containerRef.current;
      if (!el) return;
      const next = {
        ...widthsRef.current,
        ...(side === 'left'
          ? { left: EDITOR_LAYOUT_DEFAULTS.left }
          : { right: EDITOR_LAYOUT_DEFAULTS.right }),
      };
      commitWidths(next);
    },
    [commitWidths, containerRef],
  );

  useEffect(() => {
    const el = containerRef.current;
    if (el) applyWidthVars(el, widths);
  }, [containerRef, widths.left, widths.right]);

  return {
    dragging,
    onGutterPointerDown,
    onGutterPointerMove,
    onGutterPointerUp: endDrag,
    onGutterPointerCancel: endDrag,
    onGutterDoubleClick,
  };
}
