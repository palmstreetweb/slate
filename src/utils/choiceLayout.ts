/**
 * Long lists of short labels (towns, tags) sit in two columns.
 * A few options, or any long label, stay full width.
 */

type ChoiceLabel = { label: string; description?: string };

const SPLIT_AT = 8;
const SHORT_LABEL = 28;

export function choiceListIsSplit(options: readonly ChoiceLabel[]): boolean {
  if (options.length < SPLIT_AT) return false;
  return options.every((opt) => {
    if (opt.description?.trim()) return false;
    return opt.label.trim().length <= SHORT_LABEL;
  });
}
