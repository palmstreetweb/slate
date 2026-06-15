/**
 * Custom dropdown for Slate admin UI. Native `<select>` menus are
 * can't match our chrome token design — this component
 * styles both the closed trigger and the open list.
 *
 * The menu is portaled to `document.body` with fixed coordinates so it
 * isn't clipped by the sidebar's `overflow-y: auto`. It flips upward when
 * there isn't room below, repositions on scroll/resize, and scrolls the
 * rail when needed so every option stays reachable.
 */

'use client';

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { createPortal } from 'react-dom';

export type SlateSelectOption<T extends string = string> = {
  value: T;
  label: string;
};

type MenuPlacement = 'below' | 'above';

type Props<T extends string> = {
  value: T;
  onChange: (value: T) => void;
  options: ReadonlyArray<SlateSelectOption<T>>;
  /** Shown on the trigger when `value` is empty and not in `options`. */
  placeholder?: string;
  'aria-label'?: string;
  style?: CSSProperties;
  className?: string;
};

const MENU_GAP = 4;
const MENU_MAX = 280;

export function SlateSelect<T extends string>({
  value,
  onChange,
  options,
  placeholder,
  'aria-label': ariaLabel,
  style,
  className,
}: Props<T>) {
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({ visibility: 'hidden' });
  const [placement, setPlacement] = useState<MenuPlacement>('below');
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const listId = useId();

  const selected = options.find((o) => o.value === value);
  const displayLabel = selected?.label ?? placeholder ?? value;

  const repositionMenu = () => {
    const trigger = triggerRef.current;
    const menu = menuRef.current;
    if (!trigger || !menu) return;

    const rect = trigger.getBoundingClientRect();
    const menuHeight = Math.min(menu.scrollHeight, MENU_MAX);
    const spaceBelow = window.innerHeight - rect.bottom - MENU_GAP;
    const spaceAbove = rect.top - MENU_GAP;
    const openUp = spaceBelow < menuHeight && spaceAbove > spaceBelow;
    setPlacement(openUp ? 'above' : 'below');

    const maxHeight = openUp
      ? Math.min(MENU_MAX, rect.top - MENU_GAP * 2)
      : Math.min(MENU_MAX, window.innerHeight - rect.bottom - MENU_GAP * 2);

    const top = openUp
      ? Math.max(MENU_GAP, rect.top - Math.min(menuHeight, maxHeight) - MENU_GAP)
      : rect.bottom + MENU_GAP;

    setMenuStyle({
      position: 'fixed',
      top,
      left: rect.left,
      width: rect.width,
      maxHeight,
      visibility: 'visible',
    });

    // Nudge scrollable ancestors (e.g. the left rail) so the menu isn't clipped.
    let parent: HTMLElement | null = trigger.parentElement;
    while (parent) {
      const { overflowY } = getComputedStyle(parent);
      if (overflowY === 'auto' || overflowY === 'scroll') {
        const parentRect = parent.getBoundingClientRect();
        const menuBottom = top + Math.min(menuHeight, maxHeight);
        if (menuBottom > parentRect.bottom - 8) {
          parent.scrollBy({ top: menuBottom - parentRect.bottom + 16, behavior: 'smooth' });
        } else if (top < parentRect.top + 8) {
          parent.scrollBy({ top: top - parentRect.top - 16, behavior: 'smooth' });
        }
        break;
      }
      parent = parent.parentElement;
    }
  };

  const portalRoot =
    wrapRef.current?.closest('[data-slate-forms][data-theme-name="slate"]') ?? document.body;

  useLayoutEffect(() => {
    if (!open) return;
    repositionMenu();
    menuRef.current
      ?.querySelector('.slate-select-option--selected')
      ?.scrollIntoView({ block: 'nearest' });
  }, [open, options.length]);

  useEffect(() => {
    if (!open) return;

    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onReposition = () => repositionMenu();

    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);

    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onReposition, true);
    };
  }, [open]);

  const menu =
    open &&
    createPortal(
      <ul
        ref={menuRef}
        className={`slate-select-menu slate-select-menu--portal slate-select-menu--${placement}`}
        role="listbox"
        id={listId}
        aria-label={ariaLabel}
        style={menuStyle}
      >
        {options.map((opt) => {
          const isSelected = opt.value === value;
          return (
            <li key={opt.value || '__empty'} role="none">
              <button
                type="button"
                role="option"
                aria-selected={isSelected}
                className={`slate-select-option${isSelected ? ' slate-select-option--selected' : ''}`}
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
              >
                <span className="slate-select-option-label">{opt.label}</span>
                {isSelected && <span className="slate-select-check" aria-hidden />}
              </button>
            </li>
          );
        })}
      </ul>,
      portalRoot,
    );

  return (
    <>
      <div
        ref={wrapRef}
        className={['slate-select-wrap', className].filter(Boolean).join(' ')}
        style={style}
      >
        <button
          ref={triggerRef}
          type="button"
          className={`slate-select-trigger${open ? ' slate-select-trigger--open' : ''}`}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listId}
          aria-label={ariaLabel}
          onClick={() => setOpen((cur) => !cur)}
        >
          <span className="slate-select-value">{displayLabel}</span>
          <span className="slate-select-chevron" aria-hidden />
        </button>
      </div>
      {menu}
    </>
  );
}
