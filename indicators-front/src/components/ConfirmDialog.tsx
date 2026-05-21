/**
 * Reusable confirmation modal dialog.
 *
 * Renders a centered overlay with a title, message, and Confirm/Cancel
 * buttons. The dialog is controlled by the `isOpen` prop — the parent
 * manages open/close state.
 *
 * Supports:
 *  - Escape key to close
 *  - Overlay click to close (unless `isPending`)
 *  - Pending state to disable Confirm button while action is in flight
 */

import { useEffect, useCallback, type ReactElement } from 'react';

export interface ConfirmDialogProps {
  /** Whether the dialog is visible. */
  isOpen: boolean;
  /** Dialog heading. */
  title: string;
  /** Body message. */
  message: string;
  /** Called when the user clicks Confirm. */
  onConfirm: () => void;
  /** Called when the user clicks Cancel, presses Escape, or clicks the overlay. */
  onCancel: () => void;
  /** When true, disables the Confirm button (e.g. while a mutation is pending). */
  isPending?: boolean;
  /** Label for the confirm button. Default "Eliminar". */
  confirmLabel?: string;
  /** Label for the cancel button. Default "Cancelar". */
  cancelLabel?: string;
  /** Optional error message to display inside the dialog (e.g. mutation failure). */
  error?: string | null;
}

export default function ConfirmDialog({
  isOpen,
  title,
  message,
  onConfirm,
  onCancel,
  isPending = false,
  confirmLabel = 'Eliminar',
  cancelLabel = 'Cancelar',
  error = null,
}: ConfirmDialogProps): ReactElement | null {
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isPending) {
        onCancel();
      }
    },
    [onCancel, isPending],
  );

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [isOpen, handleKeyDown]);

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      aria-describedby="confirm-dialog-message"
    >
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-black/50 transition-opacity"
        onClick={isPending ? undefined : onCancel}
        aria-hidden="true"
      />

      {/* Panel */}
      <div className="relative z-10 w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
        <h2
          id="confirm-dialog-title"
          className="text-lg font-semibold text-gray-900"
        >
          {title}
        </h2>
        <p id="confirm-dialog-message" className="mt-2 text-sm text-gray-600">
          {message}
        </p>

        {error && (
          <div
            className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700"
            role="alert"
          >
            {error}
          </div>
        )}

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={isPending}
            className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isPending}
            className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
          >
            {isPending ? 'Eliminando…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
