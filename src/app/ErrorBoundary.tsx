/**
 * Route-level error boundary.
 *
 * A render error in one screen must not blank the whole application. This
 * catches it, logs it through the redacting logger, and shows a recoverable
 * state with the rest of the shell still usable.
 *
 * Per master prompt section 54 the user never sees a stack trace: the message
 * is a written explanation, and the underlying error goes to the console only.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';

import { ErrorState } from '../ui/primitives';
import { logInternal } from '../data/errors';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    logInternal(error, `render${info.componentStack ? '' : ''}`);
  }

  private reset = (): void => {
    this.setState({ hasError: false });
  };

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children;

    return (
      <ErrorState
        title="This screen ran into a problem"
        message="Nothing was saved or changed. Your data is intact - reloading this screen usually clears it."
        onRetry={this.reset}
        retryLabel="Reload this screen"
      />
    );
  }
}
