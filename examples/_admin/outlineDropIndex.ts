/**
 * Clamp a drag-drop insert index to valid slots (welcome pinned first, thanks last).
 */
export function clampOutlineDropIndex(
  questions: ReadonlyArray<{ type: string }>,
  insertBefore: number,
): number {
  const min = questions[0]?.type === 'welcome' ? 1 : 0;
  const thanksIdx = questions.findIndex((q) => q.type === 'thanks');
  const max = thanksIdx === -1 ? questions.length : thanksIdx;
  return Math.max(min, Math.min(insertBefore, max));
}
