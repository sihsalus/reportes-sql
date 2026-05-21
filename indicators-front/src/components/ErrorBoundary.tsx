/**
 * React error boundary that catches render crashes and shows a fallback UI.
 *
 * Prevents the entire app from whitescreening when an unexpected error
 * occurs during rendering. Logs the error to the console for debugging.
 */

import { Component, type ReactNode, type ErrorInfo } from 'react';

export interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary] Render error:', error);
    console.error('[ErrorBoundary] Component stack:', info.componentStack);
  }

  handleRetry = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
          <div className="max-w-md rounded-lg border border-red-200 bg-white p-8 text-center shadow-lg">
            <div className="mb-4 text-4xl" aria-hidden="true">
              ⚠️
            </div>
            <h1 className="mb-2 text-xl font-semibold text-gray-900">
              Algo salió mal
            </h1>
            <p className="mb-6 text-sm text-gray-600">
              Ocurrió un error inesperado. Probá recargar la página.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
            >
              Recargar página
            </button>
            {this.state.error && (
              <details className="mt-4 text-left">
                <summary className="cursor-pointer text-xs text-gray-500 hover:text-gray-700">
                  Detalles técnicos
                </summary>
                <pre className="mt-2 max-h-32 overflow-auto rounded bg-gray-100 p-2 text-xs text-gray-800">
                  {this.state.error.message}
                </pre>
              </details>
            )}
          </div>
        </main>
      );
    }

    return this.props.children;
  }
}
