/** Human-readable question ids for new editor questions (answers key + logic). */

export function slugifyQuestionId(raw: string): string {
  const s = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
  return s || 'question';
}

export function uniqueQuestionId(title: string, existingIds: ReadonlySet<string>): string {
  const base = slugifyQuestionId(title);
  if (!existingIds.has(base)) return base;
  let n = 2;
  while (existingIds.has(`${base}_${n}`)) n += 1;
  return `${base}_${n}`;
}
