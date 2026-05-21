/**
 * MSW server instance for test interception.
 *
 * Import the `server` from here to control the server lifecycle
 * (listen, resetHandlers, close) in setup.ts.
 */

import { setupServer } from 'msw/node';
import { handlers } from './handlers';

export const server = setupServer(...handlers);
