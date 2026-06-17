/** Editor column widths — defaults, limits, and localStorage (examples/ only). */

export const EDITOR_LAYOUT_WIDTHS_KEY = 'slate-editor-layout-widths';

export const EDITOR_LAYOUT_DEFAULTS = { left: 300, right: 360 } as const;

export const EDITOR_LAYOUT_LIMITS = {
  left: { min: 220, max: 420 },
  right: { min: 280, max: 480 },
  centerMin: 400,
} as const;

export type EditorLayoutWidths = { left: number; right: number };

export function readEditorLayoutWidths(): EditorLayoutWidths {
  if (typeof window === 'undefined') return { ...EDITOR_LAYOUT_DEFAULTS };
  try {
    const raw = window.localStorage.getItem(EDITOR_LAYOUT_WIDTHS_KEY);
    if (!raw) return { ...EDITOR_LAYOUT_DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<EditorLayoutWidths>;
    return clampEditorWidths(window.innerWidth, {
      left: typeof parsed.left === 'number' ? parsed.left : EDITOR_LAYOUT_DEFAULTS.left,
      right: typeof parsed.right === 'number' ? parsed.right : EDITOR_LAYOUT_DEFAULTS.right,
    });
  } catch {
    return { ...EDITOR_LAYOUT_DEFAULTS };
  }
}

export function persistEditorLayoutWidths(widths: EditorLayoutWidths): void {
  try {
    window.localStorage.setItem(EDITOR_LAYOUT_WIDTHS_KEY, JSON.stringify(widths));
  } catch {
    // ignored
  }
}

/** Keep rails within limits and preserve a usable canvas width. */
export function clampEditorWidths(
  containerWidth: number,
  widths: EditorLayoutWidths,
): EditorLayoutWidths {
  const gutterSpace = 16;
  const maxTotal = Math.max(
    containerWidth - EDITOR_LAYOUT_LIMITS.centerMin - gutterSpace,
    EDITOR_LAYOUT_LIMITS.left.min + EDITOR_LAYOUT_LIMITS.right.min,
  );

  let left = Math.round(
    Math.min(EDITOR_LAYOUT_LIMITS.left.max, Math.max(EDITOR_LAYOUT_LIMITS.left.min, widths.left)),
  );
  let right = Math.round(
    Math.min(EDITOR_LAYOUT_LIMITS.right.max, Math.max(EDITOR_LAYOUT_LIMITS.right.min, widths.right)),
  );

  if (left + right > maxTotal) {
    const ratio = left / (left + right);
    left = Math.round(maxTotal * ratio);
    right = maxTotal - left;
    left = Math.max(EDITOR_LAYOUT_LIMITS.left.min, left);
    right = Math.max(EDITOR_LAYOUT_LIMITS.right.min, right);
  }

  return { left, right };
}
