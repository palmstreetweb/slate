/**
 * Keeps one broken component from unmounting the whole studio (audit H1).
 * React has no hook for this, so it is the one class component in the admin.
 * `resetKey` clears the error when it changes (e.g. on navigation).
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';
import './errorBoundary.css';

type Props = {
  children: ReactNode;
  /** Rendered instead of `children` after a crash. `null` hides the area. */
  fallback: ReactNode | ((reset: () => void) => ReactNode);
  resetKey?: string;
  /** Short name for the console, e.g. "notifications". */
  label: string;
};

type State = { failed: boolean; key: string | undefined };

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { failed: false, key: this.props.resetKey };

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (props.resetKey !== state.key) return { failed: false, key: props.resetKey };
    return null;
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    // Message only — never the props or answers that may have caused it.
    const message = error instanceof Error ? error.message : 'unknown error';
    console.error(`[slate] ${this.props.label} crashed: ${message}`, info.componentStack ?? '');
  }

  private reset = () => this.setState({ failed: false });

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    const { fallback } = this.props;
    return typeof fallback === 'function' ? fallback(this.reset) : fallback;
  }
}

/** Page-level fallback: the header stays up so the owner can navigate away. */
export function PageCrashFallback({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="slate-page-crash" role="alert">
      <h2 className="slate-page-crash-title">This page hit a problem.</h2>
      <p className="slate-page-crash-body">
        Your forms and responses are safe. Try again, or go back to your forms.
      </p>
      <div className="slate-page-crash-actions">
        <button type="button" className="slate-btn" onClick={onRetry}>
          Try again
        </button>
        <a className="slate-btn slate-btn--ghost" href="/">
          Your forms
        </a>
      </div>
    </div>
  );
}
