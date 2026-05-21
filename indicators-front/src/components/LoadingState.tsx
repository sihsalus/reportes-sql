import type { ReactElement } from 'react';

/**
 * Loading spinner shown while data is being fetched.
 *
 * Uses a CSS-animated border spinner with accessible live region
 * so screen readers announce the loading state.
 */

export interface LoadingStateProps {
  /** Loading message shown below the spinner. Defaults to "Cargando…". */
  message?: string;
}

export default function LoadingState({
  message = 'Cargando\u2026',
}: LoadingStateProps): ReactElement {
  return (
    <div
      className="flex flex-col items-center justify-center py-16"
      role="status"
      aria-live="polite"
    >
      <div
        className="h-10 w-10 animate-spin rounded-full border-4 border-gray-200 border-t-blue-600"
        aria-hidden="true"
      />
      <p className="mt-4 text-sm text-gray-500">{message}</p>
      <span className="sr-only">{message}</span>
    </div>
  );
}
