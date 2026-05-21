/**
 * Shared test utilities for React Testing Library + TanStack Query.
 *
 * Provides a `QueryClient` wrapper with retries disabled (so error
 * states resolve immediately in tests) and resets the query cache
 * between tests.
 */

import { type ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * Create a fresh QueryClient suitable for testing.
 *
 * - `retry: false` — errors surface immediately instead of retrying.
 * - `gcTime: 0` — cache is garbage-collected immediately after unmount.
 */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

/** Props for the TanStack Query wrapper component. */
interface WrapperProps {
  children: React.ReactNode;
}

/**
 * React component that wraps children in a QueryClientProvider
 * with a fresh test QueryClient.
 */
export function QueryWrapper({ children }: WrapperProps): ReactElement {
  const queryClient = createTestQueryClient();
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

/**
 * React component that wraps children in a MemoryRouter.
 *
 * Use this when rendering components that rely on react-router
 * hooks such as `useNavigate` or `useParams`.
 */
export function RouterWrapper({ children }: WrapperProps): ReactElement {
  return <MemoryRouter>{children}</MemoryRouter>;
}

/**
 * Create a wrapper function for renderHook.
 *
 * Usage:
 *   const { result } = renderHook(() => useMyHook(), {
 *     wrapper: createWrapper(),
 *   });
 */
export function createWrapper(): (props: WrapperProps) => ReactElement {
  const queryClient = createTestQueryClient();
  return function Wrapper({ children }: WrapperProps): ReactElement {
    return (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    );
  };
}
