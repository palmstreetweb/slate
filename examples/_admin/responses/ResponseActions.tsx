/**
 * Actions for one open response, shared by both views (ADR-055).
 * `toolbar`: a compact row for the Inbox reader (Mark unread with its "u"
 * keycap, Reply, trash icon). `panel`: stacked full-width buttons for the
 * Summary's expanded row. Trash mode swaps in Restore + Delete forever.
 * Reply only appears for an address that passes `isSafeEmail`.
 */

'use client';

import { memo } from 'react';
import type { Question } from '@/index.js';
import type { StoredSubmission } from '../_submissionStore.js';
import { firstName, replyHref, respondentEmail, respondentName } from './model.js';
import { IconCheck, IconReply, IconRestore, IconTrash, IconUnread } from './icons.js';

export type ResponseActionsProps = {
  sub: StoredSubmission;
  questions: ReadonlyArray<Question>;
  formName: string;
  mode: 'responses' | 'trash';
  isUnread: boolean;
  variant: 'toolbar' | 'panel';
  onMarkRead(ids: string[]): void;
  onMarkUnread(id: string): void;
  onTrash(id: string): void;
  onRestore?(id: string): void;
  onDeleteForever?(id: string): void;
  className?: string;
};

export const ResponseActions = memo(function ResponseActions({
  sub,
  questions,
  formName,
  mode,
  isUnread,
  variant,
  onMarkRead,
  onMarkUnread,
  onTrash,
  onRestore,
  onDeleteForever,
  className,
}: ResponseActionsProps) {
  const cls = `rsp-actions rsp-actions--${variant}${className ? ` ${className}` : ''}`;

  if (mode === 'trash') {
    return (
      <div className={cls} role="group" aria-label="Response actions">
        {onRestore ? (
          <button
            type="button"
            className={`rsp-btn${variant === 'panel' ? ' rsp-btn--primary' : ''}`}
            onClick={() => onRestore(sub.id)}
          >
            <IconRestore />
            <span>Restore</span>
          </button>
        ) : null}
        {onDeleteForever ? (
          <button
            type="button"
            className="rsp-btn rsp-btn--danger"
            onClick={() => onDeleteForever(sub.id)}
          >
            <IconTrash />
            <span>Delete forever</span>
          </button>
        ) : null}
      </div>
    );
  }

  const href = replyHref(respondentEmail(questions, sub.answers), formName);
  const who = firstName(respondentName(questions, sub.answers, 0));
  const toolbar = variant === 'toolbar';

  const readToggle = (
    <button
      type="button"
      className="rsp-btn"
      onClick={() => (isUnread ? onMarkRead([sub.id]) : onMarkUnread(sub.id))}
      aria-keyshortcuts={toolbar ? 'u' : undefined}
      title={toolbar ? `${isUnread ? 'Mark read' : 'Mark unread'}  u` : undefined}
    >
      {isUnread ? <IconCheck /> : <IconUnread />}
      <span>{isUnread ? 'Mark read' : 'Mark unread'}</span>
      {toolbar ? (
        <kbd className="rsp-kbd rsp-kbd--hint" aria-hidden="true">
          u
        </kbd>
      ) : null}
    </button>
  );

  const reply = href ? (
    <a className={`rsp-btn${toolbar ? '' : ' rsp-btn--primary'}`} href={href}>
      <IconReply />
      <span>
        Reply<span className="rsp-btn-long"> to {who}</span>
      </span>
    </a>
  ) : null;

  if (toolbar) {
    return (
      <div className={cls} role="group" aria-label="Response actions">
        {readToggle}
        {reply}
        <button
          type="button"
          className="rsp-iconbtn"
          onClick={() => onTrash(sub.id)}
          aria-label="Move to trash"
          title="Move to trash"
        >
          <IconTrash />
        </button>
      </div>
    );
  }

  return (
    <div className={cls} role="group" aria-label="Response actions">
      {reply}
      {readToggle}
      <button type="button" className="rsp-btn rsp-btn--quiet" onClick={() => onTrash(sub.id)}>
        <IconTrash />
        <span>Move to trash</span>
      </button>
    </div>
  );
});
