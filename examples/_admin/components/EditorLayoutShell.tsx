/**
 * Editor three-pane shell with resizable gutters (examples/ only).
 */

import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react';
import {
  clampEditorWidths,
  persistEditorLayoutWidths,
  readEditorLayoutWidths,
  type EditorLayoutWidths,
} from '../editorLayout.js';
import { useEditorResize } from '../hooks/useEditorResize.js';

type Props = {
  outline: ReactNode;
  canvas: ReactNode;
  inspector: ReactNode;
};

function EditorGutter({
  side,
  dragging,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onDoubleClick,
}: {
  side: 'left' | 'right';
  dragging: 'left' | 'right' | null;
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerCancel: (event: PointerEvent<HTMLDivElement>) => void;
  onDoubleClick: () => void;
}) {
  return (
    <div
      className={`slate-editor-gutter slate-editor-gutter--${side}${dragging === side ? ' is-dragging' : ''}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={side === 'left' ? 'Resize outline panel' : 'Resize inspector panel'}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onDoubleClick={onDoubleClick}
    >
      <span className="slate-editor-gutter-grip" aria-hidden />
    </div>
  );
}

export function EditorLayoutShell({ outline, canvas, inspector }: Props) {
  const shellRef = useRef<HTMLDivElement>(null);
  const [widths, setWidths] = useState<EditorLayoutWidths>(() => readEditorLayoutWidths());

  const handleWidthsChange = useCallback((next: EditorLayoutWidths) => {
    setWidths(next);
    persistEditorLayoutWidths(next);
  }, []);

  const {
    dragging,
    onGutterPointerDown,
    onGutterPointerMove,
    onGutterPointerUp,
    onGutterPointerCancel,
    onGutterDoubleClick,
  } = useEditorResize(shellRef, widths, handleWidthsChange);

  useEffect(() => {
    const onResize = () => {
      setWidths((cur) => clampEditorWidths(window.innerWidth, cur));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return (
    <div
      ref={shellRef}
      className="slate-editor"
      style={
        {
          '--slate-editor-left': `${widths.left}px`,
          '--slate-editor-right': `${widths.right}px`,
        } as CSSProperties
      }
    >
      <div className="slate-editor-pane slate-editor-pane--outline">{outline}</div>

      <EditorGutter
        side="left"
        dragging={dragging}
        onPointerDown={onGutterPointerDown('left')}
        onPointerMove={onGutterPointerMove}
        onPointerUp={onGutterPointerUp}
        onPointerCancel={onGutterPointerCancel}
        onDoubleClick={onGutterDoubleClick('left')}
      />

      <div className="slate-editor-pane slate-editor-pane--canvas">{canvas}</div>

      <EditorGutter
        side="right"
        dragging={dragging}
        onPointerDown={onGutterPointerDown('right')}
        onPointerMove={onGutterPointerMove}
        onPointerUp={onGutterPointerUp}
        onPointerCancel={onGutterPointerCancel}
        onDoubleClick={onGutterDoubleClick('right')}
      />

      <div className="slate-editor-pane slate-editor-pane--inspector">{inspector}</div>
    </div>
  );
}
