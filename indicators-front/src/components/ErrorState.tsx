import type { ReactElement } from 'react';

/**
 * Error display with a retry action.
 *
 * Shown when a data-fetch query fails. The retry button invokes the
 * `onRetry` callback — typically a TanStack Query `refetch()` call.
 */

export interface ErrorStateProps {
  /** Human-readable error message. */
  message: string;
  /** Click handler for the "Reintentar" button. */
  onRetry?: () => void;
}

export default function ErrorState({
  message,
  onRetry,
}: ErrorStateProps): ReactElement {
  return (
    <div
      className="flex flex-col items-center justify-center py-16"
      role="alert"
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
        <svg
          className="h-6 w-6 text-red-600"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
          />
        </svg>
      </div>
      <p className="mt-4 max-w-md text-center text-sm text-gray-700">
        {message}
      </p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          aria-label="Reintentar la carga de datos"
        >
          Reintentar
        </button>
      )}
    </div>
  );
}
