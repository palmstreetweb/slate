/**
 * Editor three-pane shell with resizable gutters (examples/ only).
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import {
  clampEditorWidths,
  persistEditorLayoutWidths,
  readEditorLayoutWidths,
  type EditorLayoutWidths,
} from '../editorLayout.js';
import { useEditorResize } from '../hooks/useEditorResize.js';

export type EditorPhoneTab = 'outline' | 'edit' | 'preview';

type Props = {
  outline: ReactNode;
  canvas: ReactNode;
  inspector: ReactNode;
  /** Set on phones: show one pane behind a segmented control (ADR-062). */
  phoneTab?: EditorPhoneTab;
  onPhoneTabChange?: (tab: EditorPhoneTab) => void;
  /** Label for the inspector tab ("Question", "Welcome", "Ending"). */
  editLabel?: string;
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

export function EditorLayoutShell(props: Props) {
  if (props.phoneTab) return <PhoneEditor {...props} tab={props.phoneTab} />;
  return <DesktopEditor {...props} />;
}

const PHONE_TABS: ReadonlyArray<EditorPhoneTab> = ['outline', 'edit', 'preview'];

/**
 * One pane at a time. Only the active pane is mounted, so a hidden preview
 * never takes focus (and never opens the iOS keyboard) behind the outline.
 */
function PhoneEditor({
  outline,
  canvas,
  inspector,
  tab,
  onPhoneTabChange,
  editLabel = 'Question',
}: Props & { tab: EditorPhoneTab }) {
  const labels: Record<EditorPhoneTab, string> = {
    outline: 'Outline',
    edit: editLabel,
    preview: 'Preview',
  };
  const pick = (next: EditorPhoneTab) => {
    onPhoneTabChange?.(next);
    // Each pane starts at its top, under the sticky tabs.
    if (window.scrollY > 0) window.scrollTo({ top: 0 });
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const at = PHONE_TABS.indexOf(tab);
    const next = PHONE_TABS[(at + (e.key === 'ArrowRight' ? 1 : -1) + 3) % 3]!;
    pick(next);
    e.currentTarget.querySelector<HTMLButtonElement>(`[data-tab="${next}"]`)?.focus();
  };
  return (
    <div className={`slate-m-editor slate-m-editor--${tab}`}>
      <div className="slate-m-tabs" role="tablist" aria-label="Editor view" onKeyDown={onKeyDown}>
        {PHONE_TABS.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            id={`slate-m-tab-${t}`}
            data-tab={t}
            aria-selected={tab === t}
            aria-controls="slate-m-editor-panel"
            tabIndex={tab === t ? 0 : -1}
            className="slate-m-tab"
            onClick={() => pick(t)}
          >
            {labels[t]}
          </button>
        ))}
      </div>
      <div
        id="slate-m-editor-panel"
        role="tabpanel"
        aria-labelledby={`slate-m-tab-${tab}`}
        className={`slate-m-editor-pane slate-editor-pane--${tab === 'edit' ? 'inspector' : tab === 'preview' ? 'canvas' : 'outline'}`}
      >
        {tab === 'outline' ? outline : tab === 'edit' ? inspector : canvas}
      </div>
    </div>
  );
}

function DesktopEditor({ outline, canvas, inspector }: Props) {
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
