/**
 * The editor's "things to fix" banner (S9): plain sentences that name each
 * question by its title, the ones that hold Publish back first. It folds to
 * one line (on a phone it starts folded past three items, and folds itself
 * after a tap so the question it opens is in view). Tapping an item opens
 * that question.
 */

'use client';

import { useState } from 'react';
import { issuesHeading, type OwnerIssue } from '../editorIssues.js';

export function IssuesBanner({
  issues,
  phone,
  cloud,
  onPick,
}: {
  issues: ReadonlyArray<OwnerIssue>;
  phone: boolean;
  cloud: boolean;
  onPick: (questionId: string) => void;
}) {
  // null = not chosen yet: open, except a long list on a phone.
  const [open, setOpen] = useState<boolean | null>(null);
  if (issues.length === 0) return null;
  const expanded = open ?? !(phone && issues.length > 3);
  const blocking = issues.some((i) => i.blocking);

  return (
    <section
      className={`slate-editor-alert slate-issues${blocking ? '' : ' slate-issues--check'}`}
      aria-label="Things to fix"
    >
      <div className="slate-issues-head">
        <strong className="slate-issues-title" aria-live="polite">
          {issuesHeading(issues, cloud)}
        </strong>
        <button
          type="button"
          className="slate-issues-toggle"
          aria-expanded={expanded}
          onClick={() => setOpen(!expanded)}
          data-slate-sound="none"
        >
          {expanded ? 'Hide' : 'Show'}
        </button>
      </div>
      {expanded ? (
        <ul className="slate-issues-list">
          {issues.map((issue, i) => (
            <li key={`${issue.questionId}:${i}`}>
              <button
                type="button"
                className={`slate-issues-item${issue.blocking ? ' slate-issues-item--block' : ''}`}
                onClick={() => {
                  if (phone) setOpen(false);
                  onPick(issue.questionId);
                }}
              >
                {issue.text}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
