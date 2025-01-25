/**
 * ErrorBoundary Component
 * Catches React errors and displays fallback UI
 */

import { Component, type ReactNode } from 'react';
import { Button, Text } from '@fluentui/react-components';
import { ErrorCircle24Regular } from '@fluentui/react-icons';

// Inline styles for ErrorFallback (outside React hooks)

interface ErrorFallbackProps {
  error: Error;
  onRetry: () => void;
}

export function ErrorFallback({ error, onRetry }: ErrorFallbackProps) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100%',
      gap: '16px',
      padding: '32px',
      textAlign: 'center',
    }}>
      <ErrorCircle24Regular style={{ fontSize: '48px', color: '#d13438' }} />
      <Text size={500} weight="semibold">Something went wrong</Text>
      <Text size={300}>{error.message}</Text>
      <Button appearance="primary" onClick={onRetry}>
        Try Again
      </Button>
    </div>
  );
}

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError && this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      return (
        <ErrorFallback
          error={this.state.error}
          onRetry={this.handleRetry}
        />
      );
    }

    return this.props.children;
  }
}
