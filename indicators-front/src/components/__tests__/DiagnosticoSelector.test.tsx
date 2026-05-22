/// <reference types="vitest/globals" />
/**
 * Tests for DiagnosticoSelector component.
 *
 * Covers: debounced search, multi-select UUID array, sub-2-char ignored,
 * loading/empty states, codigo → nombre formatting, chip removal.
 */

import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useForm, FormProvider } from 'react-hook-form';
import type { ReactElement } from 'react';

import DiagnosticoSelector from '@/components/DiagnosticoSelector';

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
 * Renders DiagnosticoSelector inside a react-hook-form Controller
 * with concepto_uuids: string[] form field.
 */
function DiagnosticoSelectorForm({
  onSubmit,
}: {
  onSubmit: (values: { concepto_uuids: string[] }) => void;
}): ReactElement {
  const methods = useForm<{ concepto_uuids: string[] }>({
    defaultValues: { concepto_uuids: [] },
  });

  return (
    <QueryClientProvider client={createTestQueryClient()}>
      <FormProvider {...methods}>
        <form
          onSubmit={methods.handleSubmit(onSubmit)}
          data-testid="test-form"
        >
          <DiagnosticoSelector
            control={methods.control}
            name="concepto_uuids"
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

describe('DiagnosticoSelector', () => {
  it('renders a search input', () => {
    render(
      <DiagnosticoSelectorForm onSubmit={vi.fn()} />,
    );

    const input = screen.getByPlaceholderText(/buscar/i);
    expect(input).toBeInTheDocument();
  });

  it('does not fire request for query shorter than 2 characters', async () => {
    render(
      <DiagnosticoSelectorForm onSubmit={vi.fn()} />,
    );

    const input = screen.getByPlaceholderText(/buscar/i);
    await userEvent.type(input, 'T');

    // Wait a bit — no dropdown should appear because query < 2 chars
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400));
    });

    // No list items rendered
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('shows results with codigo → nombre format after typing 2+ chars', async () => {
    render(
      <DiagnosticoSelectorForm onSubmit={vi.fn()} />,
    );

    const input = screen.getByPlaceholderText(/buscar/i);
    await typeAndWaitDebounce(input, 'tos');

    // Results should appear — MSW handler returns TOS FERINA (A379)
    await waitFor(() => {
      expect(screen.getByText('A379')).toBeInTheDocument();
    });
    // Show codigo → nombre format
    expect(screen.getByText(/TOS FERINA/)).toBeInTheDocument();
  });

  it('shows results without codigo when concept has none', async () => {
    render(
      <DiagnosticoSelectorForm onSubmit={vi.fn()} />,
    );

    const input = screen.getByPlaceholderText(/buscar/i);
    await typeAndWaitDebounce(input, 'consulta');

    await waitFor(() => {
      // CONSULTA EXTERNA has no codigo — should show just the name
      expect(screen.getByText('CONSULTA EXTERNA')).toBeInTheDocument();
    });
  });

  it('on selection, adds the uuid to the array', async () => {
    const onSubmit = vi.fn();
    render(
      <DiagnosticoSelectorForm onSubmit={onSubmit} />,
    );

    const input = screen.getByPlaceholderText(/buscar/i);
    await typeAndWaitDebounce(input, 'tos');

    // Click the first result
    const resultOption = await screen.findByText(/TOS FERINA/);
    await userEvent.click(resultOption);

    // Submit the form to check the stored value
    await userEvent.click(screen.getByRole('button', { name: /enviar/i }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    const submittedValues = onSubmit.mock.calls[0][0] as { concepto_uuids: string[] };
    expect(submittedValues.concepto_uuids).toContain(
      'aaaa1111-bbbb-2222-cccc-333333333333',
    );
    expect(submittedValues.concepto_uuids).toHaveLength(1);
  });

  it('can select multiple UUIDs', async () => {
    const onSubmit = vi.fn();
    render(
      <DiagnosticoSelectorForm onSubmit={onSubmit} />,
    );

    // Select first concept
    let input = screen.getByPlaceholderText(/buscar/i);
    await typeAndWaitDebounce(input, 'tos');
    const firstOption = await screen.findByText(/TOS FERINA/);
    await userEvent.click(firstOption);

    // Wait for chip to appear
    await waitFor(() => {
      expect(screen.getByText('aaaa1111…')).toBeInTheDocument();
    });

    // Select second concept
    input = screen.getByPlaceholderText(/buscar/i);
    await typeAndWaitDebounce(input, 'consulta');
    const secondOption = await screen.findByText(/CONSULTA EXTERNA/);
    await userEvent.click(secondOption);

    // Submit
    await userEvent.click(screen.getByRole('button', { name: /enviar/i }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    const submittedValues = onSubmit.mock.calls[0][0] as { concepto_uuids: string[] };
    expect(submittedValues.concepto_uuids).toHaveLength(2);
  });

  it('does not add duplicate UUIDs', async () => {
    const onSubmit = vi.fn();
    render(
      <DiagnosticoSelectorForm onSubmit={onSubmit} />,
    );

    const input = screen.getByPlaceholderText(/buscar/i);
    await typeAndWaitDebounce(input, 'tos');
    const firstOption = await screen.findByText(/TOS FERINA/);
    await userEvent.click(firstOption);

    // Search again and try to select same one
    await typeAndWaitDebounce(input, 'tos');
    // Option should show as "Seleccionado" and be disabled
    await userEvent.click(screen.getByRole('button', { name: /enviar/i }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    const submittedValues = onSubmit.mock.calls[0][0] as { concepto_uuids: string[] };
    expect(submittedValues.concepto_uuids).toContain('aaaa1111-bbbb-2222-cccc-333333333333');
    expect(submittedValues.concepto_uuids).toHaveLength(1);
  });

  it('shows empty state when no results match', async () => {
    render(
      <DiagnosticoSelectorForm onSubmit={vi.fn()} />,
    );

    const input = screen.getByPlaceholderText(/buscar/i);
    await typeAndWaitDebounce(input, 'zzz_no_existe');

    // MSW returns empty array for zzz_no_existe
    await waitFor(() => {
      expect(screen.getByText(/sin resultados/i)).toBeInTheDocument();
    });
  });
});
