/**
 * Undo/redo stack for Slate form editor. Cmd+Z / Ctrl+Z undo;
 * Cmd+Shift+Z, Ctrl+Shift+Z, or Ctrl+Y redo.
 */

import { useCallback, useEffect, useRef } from 'react';
import type { Schema } from '@/index.js';

const MAX_HISTORY = 50;

export type EditorSnapshot = {
  name: string;
  schema: Schema;
  selectedId: string;
};

function cloneSnapshot<T extends EditorSnapshot>(s: T): T {
  return {
    ...s,
    schema: JSON.parse(JSON.stringify(s.schema)),
  };
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return target.isContentEditable;
}

type Options = {
  getSnapshot: () => EditorSnapshot;
  restore: (snap: EditorSnapshot) => void;
};

export function useEditorHistory({ getSnapshot, restore }: Options) {
  const undoStack = useRef<EditorSnapshot[]>([]);
  const redoStack = useRef<EditorSnapshot[]>([]);
  const restoring = useRef(false);
  const getSnapshotRef = useRef(getSnapshot);
  const restoreRef = useRef(restore);

  getSnapshotRef.current = getSnapshot;
  restoreRef.current = restore;

  const pushHistory = useCallback(() => {
    if (restoring.current) return;
    undoStack.current.push(cloneSnapshot(getSnapshotRef.current()));
    if (undoStack.current.length > MAX_HISTORY) undoStack.current.shift();
    redoStack.current = [];
  }, []);

  const undo = useCallback(() => {
    const past = undoStack.current.pop();
    if (!past) return;
    redoStack.current.push(cloneSnapshot(getSnapshotRef.current()));
    restoring.current = true;
    restoreRef.current(cloneSnapshot(past));
    queueMicrotask(() => {
      restoring.current = false;
    });
  }, []);

  const redo = useCallback(() => {
    const next = redoStack.current.pop();
    if (!next) return;
    undoStack.current.push(cloneSnapshot(getSnapshotRef.current()));
    restoring.current = true;
    restoreRef.current(cloneSnapshot(next));
    queueMicrotask(() => {
      restoring.current = false;
    });
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;

      const key = e.key.toLowerCase();
      const isUndo = key === 'z' && !e.shiftKey;
      const isRedo =
        (key === 'z' && e.shiftKey) || (key === 'y' && e.ctrlKey && !e.metaKey);

      if (isUndo) {
        e.preventDefault();
        undo();
      } else if (isRedo) {
        e.preventDefault();
        redo();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [undo, redo]);

  return { pushHistory, undo, redo };
}
