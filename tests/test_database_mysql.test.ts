/**
 * Tests for src/database/mysql.ts
 *
 * Coverage target: getMysqlPool lazily creates the pool with the configured
 * timeouts; queryMysql bounds connection acquisition and query execution,
 * destroys timed-out connections, and maps every pool/connection/query
 * failure to OpenMRSUnavailableError so routers can uniformly translate
 * upstream outages to HTTP 502.
 *
 * mysql2 (pool.query) is mocked so the tests never reach a real socket.
 * The module-level `pool` singleton is reset between tests via disposeMysql.
 */

import { jest } from "@jest/globals";

const mockCreatePool = jest.fn();
const mockGetConnection = jest.fn();
const mockQuery = jest.fn();
const mockRelease = jest.fn();
const mockDestroy = jest.fn();
const mockEnd = jest.fn();

jest.mock("mysql2/promise", () => ({
  createPool: (...args: unknown[]) => mockCreatePool(...args),
}));

import { getMysqlPool, queryMysql, disposeMysql } from "../src/database/mysql.js";
import { OpenMRSUnavailableError } from "../src/errors.js";

function connectionLike(): {
  query: jest.Mock;
  release: jest.Mock;
  destroy: jest.Mock;
} {
  return { query: mockQuery, release: mockRelease, destroy: mockDestroy };
}

function poolLike(): { getConnection: jest.Mock; end: jest.Mock } {
  return { getConnection: mockGetConnection, end: mockEnd };
}

// Reset the module-level pool singleton before every test so createPool is
// exercised fresh and cross-test state never leaks.
beforeEach(async () => {
  jest.clearAllMocks();
  jest.spyOn(console, "error").mockImplementation(() => {});
  // Each createPool call returns a distinct pool object sharing the same
  // query/end mocks, so "dispose then recreate" assertions see new instances.
  mockCreatePool.mockImplementation(() => poolLike());
  mockGetConnection.mockResolvedValue(connectionLike());
  await disposeMysql();
  // After the cleanup dispose, clear mockEnd's call count so tests that
  // assert on end() see only their own invocations, not the cleanup.
  mockEnd.mockClear();
  mockQuery.mockClear();
  mockRelease.mockClear();
  mockDestroy.mockClear();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("getMysqlPool", () => {
  it("creates the pool once lazily and reuses the same instance", () => {
    const p1 = getMysqlPool();
    const p2 = getMysqlPool();
    expect(mockCreatePool).toHaveBeenCalledTimes(1);
    expect(p1).toBe(p2);
  });

  it("configures connectionLimit, queueLimit, and timeouts from settings", () => {
    getMysqlPool();
    expect(mockCreatePool).toHaveBeenCalledTimes(1);
    const opts = mockCreatePool.mock.calls[0][0];
    expect(opts.connectionLimit).toBe(5);
    expect(opts.queueLimit).toBe(50);
    expect(opts.waitForConnections).toBe(true);
    expect(opts.connectTimeout).toBe(10_000);
    expect(opts.namedPlaceholders).toBe(true);
  });
});

describe("queryMysql", () => {
  it("returns rows on a successful query", async () => {
    // connection.query returns a [rows, fields] tuple; queryMysql destructures rows.
    mockQuery.mockResolvedValueOnce([[{ id: 1 }, { id: 2 }], []]);

    const rows = await queryMysql("SELECT id FROM t WHERE id = :id", { id: 1 });

    expect(rows).toEqual([{ id: 1 }, { id: 2 }]);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const opts = mockQuery.mock.calls[0][0];
    expect(opts.sql).toBe("SELECT id FROM t WHERE id = :id");
    expect(opts.namedPlaceholders).toBe(true);
    expect(opts.values).toEqual({ id: 1 });
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });

  it("maps a generic Error to OpenMRSUnavailableError (no leakage)", async () => {
    mockQuery.mockRejectedValueOnce(new Error("ECONNREFUSED 10.0.0.5:3306"));

    await expect(queryMysql("SELECT 1", {})).rejects.toThrow(OpenMRSUnavailableError);
  });

  it("maps a non-Error rejection to OpenMRSUnavailableError", async () => {
    mockQuery.mockRejectedValueOnce("a string, not an Error");

    await expect(queryMysql("SELECT 1", {})).rejects.toThrow(OpenMRSUnavailableError);
  });

  it("maps a query error to OpenMRSUnavailableError", async () => {
    mockQuery.mockRejectedValueOnce(new Error("query interrupted"));

    await expect(queryMysql("SELECT 1", {})).rejects.toThrow(OpenMRSUnavailableError);
  });

  it("maps a pool-exhausted error to OpenMRSUnavailableError", async () => {
    const poolErr = new Error("No connections available.");
    (poolErr as NodeJS.ErrnoException).code = "POOL_EXHAUSTED";
    mockQuery.mockRejectedValueOnce(poolErr);

    await expect(queryMysql("SELECT 1", {})).rejects.toThrow(OpenMRSUnavailableError);
  });

  it("the thrown OpenMRSUnavailableError never exposes the raw message", async () => {
    mockQuery.mockRejectedValueOnce(new Error("ECONNREFUSED 10.0.0.5:3306"));

    try {
      await queryMysql("SELECT 1", {});
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(OpenMRSUnavailableError);
      expect((err as Error).message).toBe("OpenMRS no disponible");
      expect((err as Error).message).not.toContain("10.0.0.5");
      expect((err as Error).message).not.toContain("ECONNREFUSED");
    }
  });

  it("destroys the connection when the query timeout expires", async () => {
    jest.useFakeTimers();
    try {
      mockQuery.mockImplementationOnce(() => new Promise(() => undefined));
      const result = expect(queryMysql("SELECT 1", {})).rejects.toThrow(
        OpenMRSUnavailableError,
      );
      await jest.advanceTimersByTimeAsync(30_000);
      await result;
      expect(mockDestroy).toHaveBeenCalled();
      expect(mockRelease).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it("fails when acquiring a connection exceeds the acquire timeout", async () => {
    jest.useFakeTimers();
    try {
      mockGetConnection.mockImplementationOnce(() => new Promise(() => undefined));
      const result = expect(queryMysql("SELECT 1", {})).rejects.toThrow(
        OpenMRSUnavailableError,
      );
      await jest.advanceTimersByTimeAsync(10_000);
      await result;
    } finally {
      jest.useRealTimers();
    }
  });

  it("releases the connection after a successful query", async () => {
    mockQuery.mockResolvedValueOnce([[], []]);

    await queryMysql("SELECT 1", {});

    expect(mockRelease).toHaveBeenCalledTimes(1);
    expect(mockDestroy).not.toHaveBeenCalled();
  });
});

describe("disposeMysql", () => {
  it("closes the pool and allows a fresh pool to be created afterwards", async () => {
    const first = getMysqlPool();
    await disposeMysql();
    expect(mockEnd).toHaveBeenCalledTimes(1);

    const second = getMysqlPool();
    expect(second).not.toBe(first);
    expect(mockCreatePool).toHaveBeenCalledTimes(2);
  });

  it("is a no-op when the pool was never created", async () => {
    // Pool was already disposed by the top-level beforeEach; ensure no
    // additional end() call occurs on a second dispose.
    mockEnd.mockClear();
    await disposeMysql();
    expect(mockEnd).not.toHaveBeenCalled();
  });
});
