/**
 * The studio draws edge to edge on notched phones and pads itself with
 * env(safe-area-inset-*) (ADR-062). `viewport-fit=cover` is what makes those
 * insets non-zero, so the studio bundle adds it at mount. The public fill
 * bundle never loads this file, so respondents keep the browser's own
 * safe-area letterboxing.
 */
export function enableSafeAreaViewport(doc: Document = document): void {
  const meta = doc.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (!meta) return;
  const content = meta.content || 'width=device-width, initial-scale=1';
  if (/viewport-fit\s*=/.test(content)) return;
  meta.content = `${content}, viewport-fit=cover`;
}
