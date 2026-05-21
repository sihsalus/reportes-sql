/// <reference types="vitest/globals" />
/**
 * Unit tests for parseApiError and ApiRequestError.
 *
 * Tests the public parseApiError function that translates API errors
 * into user-friendly Spanish messages per the error-handling spec.
 */

import { ApiRequestError, parseApiError } from './client';

describe('parseApiError', () => {
  it('returns "Error del servidor" for status 500', () => {
    const error = new ApiRequestError(500, 'Internal Error');
    expect(parseApiError(error)).toBe('Error del servidor');
  });

  it('returns "Error del servidor" for status 502', () => {
    const error = new ApiRequestError(502, 'Bad Gateway');
    expect(parseApiError(error)).toBe('Error del servidor');
  });

  it('returns "Error del servidor" for status 503', () => {
    const error = new ApiRequestError(503, 'Unavailable');
    expect(parseApiError(error)).toBe('Error del servidor');
  });

  it('returns "Solicitud inválida" for status 400', () => {
    const error = new ApiRequestError(400, 'Bad Request');
    expect(parseApiError(error)).toBe('Solicitud inválida');
  });

  it('returns "Recurso no encontrado" for status 404', () => {
    const error = new ApiRequestError(404, 'Not Found');
    expect(parseApiError(error)).toBe('Recurso no encontrado');
  });

  it('formats 422 validation array as "field: msg" joined by " / "', () => {
    const body = {
      detail: [
        { loc: ['body', 'nombre'], msg: 'field required', type: 'value_error.missing' },
      ],
    };
    const error = new ApiRequestError(422, 'Validation Error', body);
    expect(parseApiError(error)).toBe('nombre: field required');
  });

  it('joins multiple 422 validation errors with " / "', () => {
    const body = {
      detail: [
        { loc: ['body', 'nombre'], msg: 'field required', type: 'value_error.missing' },
        { loc: ['body', 'descripcion'], msg: 'too short', type: 'value_error.any_str.min_length' },
      ],
    };
    const error = new ApiRequestError(422, 'Validation Error', body);
    expect(parseApiError(error)).toBe('nombre: field required / descripcion: too short');
  });

  it('falls back to the string detail for 422 when detail is a string', () => {
    const body = { detail: 'already exists' };
    const error = new ApiRequestError(422, 'already exists', body);
    expect(parseApiError(error)).toBe('already exists');
  });

  it('returns "Error del servidor" for 422 with no body', () => {
    const error = new ApiRequestError(422, 'Unprocessable');
    expect(parseApiError(error)).toBe('Error del servidor');
  });

  it('returns "Error inesperado" for unknown status codes', () => {
    const error = new ApiRequestError(418, "I'm a teapot");
    expect(parseApiError(error)).toBe('Error inesperado');
  });

  it('returns "Error inesperado" for status 200 (should not happen, but gives default)', () => {
    const error = new ApiRequestError(200, 'OK');
    expect(parseApiError(error)).toBe('Error inesperado');
  });
});

describe('ApiRequestError', () => {
  it('preserves the raw body for inspection', () => {
    const body = { detail: 'something went wrong', code: 'ERR_001' };
    const error = new ApiRequestError(500, 'Internal Error', body);
    expect(error.body).toEqual(body);
  });

  it('body defaults to undefined when not provided', () => {
    const error = new ApiRequestError(404, 'Not Found');
    expect(error.body).toBeUndefined();
  });
});
