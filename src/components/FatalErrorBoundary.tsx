import { Component, type ErrorInfo, type ReactNode } from 'react';

import { reportDiagnostic } from '@/lib/diagnostics';

import { FatalErrorScreen } from './FatalErrorScreen';

type Props = { children: ReactNode };
type State = { failed: boolean };

/** Last line of defence: show a readable report instead of a silent release crash. */
export class FatalErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    reportDiagnostic(
      'Render error',
      new Error(`${error.message}\n${info.componentStack ?? ''}`)
    );
  }

  render(): ReactNode {
    if (this.state.failed) {
      return <FatalErrorScreen />;
    }

    return this.props.children;
  }
}
