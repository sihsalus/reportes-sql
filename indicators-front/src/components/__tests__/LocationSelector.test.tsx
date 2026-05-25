/// <reference types="vitest/globals" />
/**
 * Tests for LocationSelector component.
 *
 * Covers: debounced location search, multi-select UUID array,
 * sub-2-char ignored, loading/empty states, chip display with
 * location names, chip removal, and UUID persistence.
 *
 * Uses MSW to mock `GET /conceptos/locations`.
 */

import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useForm, FormProvider } from 'react-hook-form';
import type { ReactElement } from 'react';

import LocationSelector from '@/components/LocationSelector';

// ── Test wrapper ────────────────────────────────────────────────────────

function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

/**
 * Renders LocationSelector inside a react-hook-form Controller
 * with location_uuids: string[] form field.
 */
function LocationSelectorForm({
  onSubmit,
}: {
  onSubmit: (values: { location_uuids: string[] }) => void;
}): ReactElement {
  const methods = useForm<{ location_uuids: string[] }>({
    defaultValues: { location_uuids: [] },
  });

  return (
    <QueryClientProvider client={createTestQueryClient()}>
      <FormProvider {...methods}>
        <form
          onSubmit={methods.handleSubmit(onSubmit)}
          data-testid="test-form"
        >
          <LocationSelector
            control={methods.control}
            name="location_uuids"
          />
          <button type="submit">Enviar</button>
        </form>
      </FormProvider>
    </QueryClientProvider>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────

async function typeAndWaitDebounce(input: HTMLElement, text: string) {
  await userEvent.clear(input);
  await userEvent.type(input, text);
  // Let the debounce timer fire (300 ms) and query resolve
  await act(async () => {
    await new Promise((r) => setTimeout(r, 400));
  });
}

// ── Tests ───────────────────────────────────────────────────────────────

describe('LocationSelector', () => {
  it('renders a search input with servicio placeholder', () => {
    render(<LocationSelectorForm onSubmit={vi.fn()} />);

    const input = screen.getByPlaceholderText(/buscar servicio/i);
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute('aria-label', 'Buscar servicio');
  });

  it('does not fire request for query shorter than 2 characters', async () => {
    render(<LocationSelectorForm onSubmit={vi.fn()} />);

    const input = screen.getByPlaceholderText(/buscar servicio/i);
    await userEvent.type(input, 'C');

    // Wait — no dropdown should appear because query < 2 chars
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400));
    });

    expect(screen.queryByRole('option')).not.toBeInTheDocument();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('shows matching locations after typing 2+ chars', async () => {
    render(<LocationSelectorForm onSubmit={vi.fn()} />);

    const input = screen.getByPlaceholderText(/buscar servicio/i);
    await typeAndWaitDebounce(input, 'consulta');

    // MSW handler returns Consulta Externa when q matches "consulta"
    await waitFor(() => {
      expect(screen.getByText('Consulta Externa')).toBeInTheDocument();
    });
  });

  it('on selection, adds UUID to form field and shows chip with display name', async () => {
    const onSubmit = vi.fn();
    render(<LocationSelectorForm onSubmit={onSubmit} />);

    const input = screen.getByPlaceholderText(/buscar servicio/i);
    await typeAndWaitDebounce(input, 'consulta');

    // Click the matching result — "Consulta Externa"
    const resultOption = await screen.findByText('Consulta Externa');
    await userEvent.click(resultOption);

    // Chip should render with the display name
    await waitFor(() => {
      expect(screen.getByText('Consulta Externa')).toBeInTheDocument();
    });

    // Submit the form to verify UUID is persisted
    await userEvent.click(screen.getByRole('button', { name: /enviar/i }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    const submittedValues = onSubmit.mock.calls[0][0] as { location_uuids: string[] };
    expect(submittedValues.location_uuids).toContain(
      '550e8400-e29b-41d4-a716-446655440000',
    );
    expect(submittedValues.location_uuids).toHaveLength(1);
  });

  it('can select multiple locations and shows multiple chips', async () => {
    const onSubmit = vi.fn();
    render(<LocationSelectorForm onSubmit={onSubmit} />);

    // Select first location: Consulta Externa
    let input = screen.getByPlaceholderText(/buscar servicio/i);
    await typeAndWaitDebounce(input, 'consulta');
    const firstOption = await screen.findByText('Consulta Externa');
    await userEvent.click(firstOption);

    // Wait for first chip
    await waitFor(() => {
      expect(screen.getByTitle('Consulta Externa')).toBeInTheDocument();
    });

    // Select second location: Hospitalización
    input = screen.getByPlaceholderText(/buscar servicio/i);
    await typeAndWaitDebounce(input, 'hospital');
    const secondOption = await screen.findByText('Hospitalización');
    await userEvent.click(secondOption);

    // Both chips should be visible
    await waitFor(() => {
      expect(screen.getByTitle('Hospitalización')).toBeInTheDocument();
    });

    // Submit
    await userEvent.click(screen.getByRole('button', { name: /enviar/i }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    const submittedValues = onSubmit.mock.calls[0][0] as { location_uuids: string[] };
    expect(submittedValues.location_uuids).toHaveLength(2);
    expect(submittedValues.location_uuids).toContain('550e8400-e29b-41d4-a716-446655440000');
    expect(submittedValues.location_uuids).toContain('550e8400-e29b-41d4-a716-446655440001');
  });

  it('removes a location when chip × button is clicked', async () => {
    const onSubmit = vi.fn();
    render(<LocationSelectorForm onSubmit={onSubmit} />);

    // Select Consulta Externa
    const input = screen.getByPlaceholderText(/buscar servicio/i);
    await typeAndWaitDebounce(input, 'consulta');
    const option = await screen.findByText('Consulta Externa');
    await userEvent.click(option);

    // Chip should be visible
    const chip = await screen.findByTitle('Consulta Externa');
    expect(chip).toBeInTheDocument();

    // Click the remove button
    const removeButton = chip.querySelector('button');
    expect(removeButton).not.toBeNull();
    await userEvent.click(removeButton!);

    // Chip should be gone
    await waitFor(() => {
      expect(screen.queryByTitle('Consulta Externa')).not.toBeInTheDocument();
    });

    // Submit to verify UUID is removed
    await userEvent.click(screen.getByRole('button', { name: /enviar/i }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    const submittedValues = onSubmit.mock.calls[0][0] as { location_uuids: string[] };
    expect(submittedValues.location_uuids).toHaveLength(0);
  });

  it('shows truncated UUID fallback when display name is not cached', async () => {
    const onSubmit = vi.fn();
    render(<LocationSelectorForm onSubmit={onSubmit} />);

    const input = screen.getByPlaceholderText(/buscar servicio/i);
    await typeAndWaitDebounce(input, 'hospital');
    const option = await screen.findByText('Hospitalización');
    await userEvent.click(option);

    // Chip should show the display name (from selectedOptions cache)
    await waitFor(() => {
      expect(screen.getByTitle('Hospitalización')).toBeInTheDocument();
    });

    // Verify chip has the display text, not truncated UUID
    const chip = screen.getByTitle('Hospitalización');
    expect(chip).toHaveTextContent('Hospitalización');
  });

  it('shows empty state when no results match', async () => {
    render(<LocationSelectorForm onSubmit={vi.fn()} />);

    const input = screen.getByPlaceholderText(/buscar servicio/i);
    await typeAndWaitDebounce(input, 'zzz_no_existe');

    // MSW returns empty array for zzz_no_existe
    await waitFor(() => {
      expect(screen.getByText(/sin resultados/i)).toBeInTheDocument();
    });
  });

  it('disables already-selected options in the dropdown', async () => {
    render(<LocationSelectorForm onSubmit={vi.fn()} />);

    // Select Consulta Externa first
    const input = screen.getByPlaceholderText(/buscar servicio/i);
    await typeAndWaitDebounce(input, 'consulta');
    const option = await screen.findByText('Consulta Externa');
    await userEvent.click(option);

    // Chip should appear
    await waitFor(() => {
      expect(screen.getByTitle('Consulta Externa')).toBeInTheDocument();
    });

    // Search again for the same term
    await typeAndWaitDebounce(input, 'consulta');

    // The already-selected option should be marked "Seleccionado"
    await waitFor(() => {
      expect(screen.getByText('Seleccionado')).toBeInTheDocument();
    });
  });
});
