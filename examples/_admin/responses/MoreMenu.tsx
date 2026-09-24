/**
 * The ⋯ menu in the Responses toolbar (ADR-055). A small popover menu:
 * the trigger has aria-haspopup="menu"; opening focuses the first item;
 * arrow keys, Home and End move; Esc or an outside click closes and Tab
 * leaves. Picking an item returns focus to the trigger first, so a confirm
 * dialog opened by the item hands focus back there when it closes.
 */

'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { IconMore } from './icons.js';

export type MoreMenuItem = {
  id: string;
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  /** Hairline above this item — use it to set destructive items apart. */
  separatorBefore?: boolean;
  onSelect(): void;
};

type Props = {
  items: ReadonlyArray<MoreMenuItem>;
  label?: string;
};

export function MoreMenu({ items, label = 'More actions' }: Props) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    menuRef.current
      ?.querySelector<HTMLElement>('[role="menuitem"]')
      ?.focus({ preventScroll: true });
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (!t || btnRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [open]);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) btnRef.current?.focus({ preventScroll: true });
  };

  const onMenuKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const els = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
    );
    if (els.length === 0) return;
    const at = els.indexOf(document.activeElement as HTMLElement);
    const focusAt = (i: number) => els[(i + els.length) % els.length]?.focus();
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        focusAt(at + 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        focusAt(at - 1);
        break;
      case 'Home':
        e.preventDefault();
        focusAt(0);
        break;
      case 'End':
        e.preventDefault();
        focusAt(els.length - 1);
        break;
      case 'Escape':
        e.preventDefault();
        // Keep page-level Esc handlers (close reader, clear search) out of it.
        e.stopPropagation();
        close(true);
        break;
      case 'Tab':
        setOpen(false);
        break;
    }
  };

  if (items.length === 0) return null;

  return (
    <div className="rsp-menu-wrap">
      <button
        ref={btnRef}
        type="button"
        className={`rsp-iconbtn${open ? ' rsp-iconbtn--active' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={label}
        title={label}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <IconMore />
      </button>
      {open ? (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={label}
          className="rsp-menu"
          onKeyDown={onMenuKeyDown}
        >
          {items.map((item) => (
            <div key={item.id} role="none">
              {item.separatorBefore ? <div className="rsp-menu-sep" role="separator" /> : null}
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                className={`rsp-menu-item${item.danger ? ' rsp-menu-item--danger' : ''}`}
                onClick={() => {
                  close(true);
                  item.onSelect();
                }}
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
