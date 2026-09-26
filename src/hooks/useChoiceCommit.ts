import { useCallback, useState } from 'react';

/**
 * Tracks the option a respondent just picked on an auto-advancing question
 * (single choice, yes/no, legal, single picture choice) so the field can
 * play its commit beat — the badge flips to a check and the other options
 * step back — during the ~220ms before auto-advance (ADR-059).
 *
 * A value that was already selected when the question mounted (Back, or a
 * resumed session) is not a commit. A new value arriving through props is,
 * which covers letter-key selection routed through `<Form>`. Clicking the
 * already-selected option calls `markCommitted` directly, since the answer
 * doesn't change.
 */
export function useChoiceCommit(selected: string | undefined): {
  committed: string | null;
  markCommitted: (value: string) => void;
} {
  const [seen, setSeen] = useState(selected);
  const [committed, setCommitted] = useState<string | null>(null);

  // Derive-from-props during render (React's documented pattern) so the
  // commit styles land in the same frame as the selection.
  if (selected !== seen) {
    setSeen(selected);
    setCommitted(selected ?? null);
  }

  const markCommitted = useCallback((value: string) => setCommitted(value), []);
  return { committed, markCommitted };
}
