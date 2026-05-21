/// <reference types="vitest/globals" />
/**
 * Tests for the ErrorBoundary component.
 *
 * Verifies the fallback UI — "Algo salió mal" message and "Recargar página"
 * button — is rendered when a child component throws during render.
 */

import { render, screen } from '@testing-library/react';
import ErrorBoundary from '@/components/ErrorBoundary';

/** A component that always throws during render, triggering the boundary. */
function BrokenComponent(): never {
  throw new Error('Test render crash');
}

describe('ErrorBoundary', () => {
  it('renders fallback message when a child throws', () => {
    // Suppress console.error from the intentional throw
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <BrokenComponent />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Algo salió mal')).toBeInTheDocument();
    expect(
      screen.getByText('Ocurrió un error inesperado. Probá recargar la página.'),
    ).toBeInTheDocument();

    spy.mockRestore();
  });

  it('renders the "Recargar página" button', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <BrokenComponent />
      </ErrorBoundary>,
    );

    const reloadButton = screen.getByRole('button', { name: /recargar página/i });
    expect(reloadButton).toBeInTheDocument();

    spy.mockRestore();
  });

  it('renders children normally when no error occurs', () => {
    render(
      <ErrorBoundary>
        <p>Everything is fine</p>
      </ErrorBoundary>,
    );

    expect(screen.getByText('Everything is fine')).toBeInTheDocument();
    expect(screen.queryByText('Algo salió mal')).not.toBeInTheDocument();
  });
});
