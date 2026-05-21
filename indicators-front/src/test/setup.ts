/// <reference types="vitest/globals" />
/**
 * Vitest setup file — runs before every test suite.
 *
 * - Extends Vitest's `expect` with jest-dom matchers (toBeInTheDocument, etc.)
 * - Lifecycle: starts MSW server before all tests, resets handlers between
 *   each test, and closes the server after all tests complete.
 */

import '@testing-library/jest-dom/vitest';
import { server } from './server';
import { resetFixtures } from './handlers';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

afterEach(() => {
  server.resetHandlers();
  resetFixtures();
});

afterAll(() => server.close());
