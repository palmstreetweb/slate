'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';

type Props = {
  onPreview: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
};

export function FormCardMoreMenu({ onPreview, onDuplicate, onDelete }: Props) {
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({ visibility: 'hidden' });
  const anchorRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const anchor = anchorRef.current;
    const menu = menuRef.current;
    if (!anchor || !menu) return;

    const rect = anchor.getBoundingClientRect();
    const menuWidth = menu.offsetWidth || 160;
    const left = Math.max(8, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 8));
    setMenuStyle({
      visibility: 'visible',
      top: rect.bottom + 6,
      left,
      minWidth: 160,
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (anchorRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const pick = (fn: () => void) => {
    setOpen(false);
    fn();
  };

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className="slate-btn slate-btn--ghost slate-btn--compact slate-btn--icon"
        aria-label="More actions"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
      >
        ⋯
      </button>
      {open &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={menuRef}
            className="slate-popover slate-popover--portal slate-card-menu"
            role="menu"
            style={menuStyle}
          >
            <button type="button" className="slate-card-menu-item" role="menuitem" onClick={() => pick(onPreview)}>
              Preview
            </button>
            <button type="button" className="slate-card-menu-item" role="menuitem" onClick={() => pick(onDuplicate)}>
              Duplicate
            </button>
            <button
              type="button"
              className="slate-card-menu-item slate-card-menu-item--danger"
              role="menuitem"
              onClick={() => pick(onDelete)}
            >
              Delete
            </button>
          </div>,
          document.body,
        )}
    </>
  );
}
