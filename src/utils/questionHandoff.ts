/**
 * The outgoing half of the question hand-off (BUILD_BRIEF §10.2, ADR-059).
 *
 * React swaps questions by key, so the old question is gone the moment the
 * new one mounts. To give it the brief's 220ms exit, `<Form>` takes a static
 * copy of the old question's DOM just before React removes it and lays that
 * copy over the stage while the next question rises in.
 *
 * The copy is inert and aria-hidden: it can't take focus or clicks, screen
 * readers skip it, and React doesn't know it exists (no handlers, no state,
 * no effects). Ids and names are stripped so it can't collide with the live
 * question (labels, radio groups). It lives inside the form's own stage —
 * nothing outside the `[data-slate-forms]` wrapper is touched.
 *
 * Why not View Transitions: on an embedded form they snapshot the host page.
 * Why not keep the old React tree mounted: its effects (focus, confirm
 * handlers, autosave) would stay live for the duration of the exit.
 */

/** Longest exit (classic, 260ms) plus slack, in case animationend never fires. */
export const LEAVE_MAX_MS = 420;

/**
 * Copy `node` for its exit, positioned over the same spot inside `stage`.
 * Returns null when there is nothing sensible to copy.
 */
export function snapshotLeavingQuestion(
  node: HTMLElement,
  stage: HTMLElement | null,
): HTMLElement | null {
  if (!stage || !node.isConnected || node.childElementCount === 0) return null;

  const stageBox = stage.getBoundingClientRect();
  const box = node.getBoundingClientRect();
  const clone = node.cloneNode(true) as HTMLElement;

  // Form controls keep their live value in a property, not an attribute —
  // copy it across so typed text doesn't blank out as the question leaves.
  const liveFields = node.querySelectorAll<HTMLInputElement>('input, textarea, select');
  const copyFields = clone.querySelectorAll<HTMLInputElement>('input, textarea, select');
  liveFields.forEach((field, i) => {
    const copy = copyFields[i];
    if (!copy) return;
    if (field.type === 'checkbox' || field.type === 'radio') copy.checked = field.checked;
    else if (field.type !== 'file') copy.value = field.value;
  });

  for (const el of [clone, ...Array.from(clone.querySelectorAll('[id], [name], [for]'))]) {
    el.removeAttribute('id');
    el.removeAttribute('name');
    el.removeAttribute('for');
  }

  clone.classList.remove('slate-q-enter');
  clone.classList.add('slate-q-leave');
  clone.setAttribute('aria-hidden', 'true');
  clone.setAttribute('inert', '');
  clone.removeAttribute('data-direction');

  clone.style.position = 'absolute';
  clone.style.top = `${box.top - stageBox.top}px`;
  clone.style.left = `${box.left - stageBox.left}px`;
  if (box.width > 0) clone.style.width = `${box.width}px`;
  clone.style.margin = '0';
  return clone;
}
