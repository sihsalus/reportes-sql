import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import App from './App.tsx'
import ErrorBoundary from '@/components/ErrorBoundary'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
})

// Log unhandled query errors as a safety net so no failure stays silent.
// Pages are still expected to handle errors locally for user-facing messages.
queryClient.getQueryCache().subscribe((event) => {
  if (event.type === 'observerResultsUpdated') {
    return;
  }
  if (
    'query' in event &&
    event.query.state.status === 'error' &&
    event.query.state.error
  ) {
    console.error(
      '[QueryCache] Unhandled query error:',
      event.query.queryKey,
      event.query.state.error,
    );
  }
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
)
