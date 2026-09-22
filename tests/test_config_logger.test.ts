/**
 * Unit tests for src/config/logger.ts
 *
 * Uses jest.resetModules() + dynamic import() to get fresh module state
 * under different NODE_ENV / LOG_LEVEL combinations.
 */
import { jest } from "@jest/globals";
import type { Logger } from "../src/config/logger.js";

// ── Helpers ────────────────────────────────────────────────────────────────

function spyConsole() {
  return {
    debug: jest.spyOn(console, "debug").mockImplementation(() => {}),
    info: jest.spyOn(console, "info").mockImplementation(() => {}),
    warn: jest.spyOn(console, "warn").mockImplementation(() => {}),
    error: jest.spyOn(console, "error").mockImplementation(() => {}),
    restore() {
      this.debug.mockRestore();
      this.info.mockRestore();
      this.warn.mockRestore();
      this.error.mockRestore();
    },
  };
}

async function importFresh(): Promise<{
  logger: Logger;
  requestLogger: (id: string) => Logger;
}> {
  // Clear the cached module so process.env is re-read
  jest.resetModules();
  return await import("../src/config/logger.js");
}

beforeEach(() => {
  delete process.env["NODE_ENV"];
  delete process.env["LOG_LEVEL"];
});

// ── Dev mode (default) ─────────────────────────────────────────────────────

describe("Logger — dev mode (default)", () => {
  test("debug is emitted in dev", async () => {
    const c = spyConsole();
    const { logger } = await importFresh();

    logger.debug("hello");
    expect(c.debug).toHaveBeenCalledTimes(1);
    c.restore();
  });

  test("info, warn, error are all emitted in dev", async () => {
    const c = spyConsole();
    const { logger } = await importFresh();

    logger.info("i");
    logger.warn("w");
    logger.error("e");

    expect(c.info).toHaveBeenCalledTimes(1);
    expect(c.warn).toHaveBeenCalledTimes(1);
    expect(c.error).toHaveBeenCalledTimes(1);
    c.restore();
  });

  test("human-readable format (no JSON)", async () => {
    const c = spyConsole();
    const { logger } = await importFresh();

    logger.info("hi", { key: "val" });
    const line = c.info.mock.calls[0]?.[0] as string;

    expect(line).toContain("[INFO]");
    expect(line).toContain("hi");
    // Human format has date preamble, not JSON root
    expect(line).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(line).toContain('{"key":"val"}');
    c.restore();
  });
});

// ── Production mode ────────────────────────────────────────────────────────

describe("Logger — production mode", () => {
  test("JSON output when NODE_ENV=production", async () => {
    process.env["NODE_ENV"] = "production";
    const c = spyConsole();
    const { logger } = await importFresh();

    logger.warn("disk low", { pct: 92 });
    const parsed = JSON.parse(c.warn.mock.calls[0]?.[0] as string);

    expect(parsed.level).toBe("warn");
    expect(parsed.msg).toBe("disk low");
    expect(parsed.pct).toBe(92);
    expect(parsed.ts).toBeDefined();
    c.restore();
  });

  test("JSON without meta only has ts/level/msg", async () => {
    process.env["NODE_ENV"] = "production";
    const c = spyConsole();
    const { logger } = await importFresh();

    logger.info("plain");
    const parsed = JSON.parse(c.info.mock.calls[0]?.[0] as string);
    expect(Object.keys(parsed).sort()).toEqual(["level", "msg", "ts"]);
    c.restore();
  });

  test("default level info suppresses debug", async () => {
    process.env["NODE_ENV"] = "production";
    const c = spyConsole();
    const { logger } = await importFresh();

    logger.debug("no");
    logger.info("yes");
    expect(c.debug).toHaveBeenCalledTimes(0);
    expect(c.info).toHaveBeenCalledTimes(1);
    c.restore();
  });
});

// ── LOG_LEVEL override ─────────────────────────────────────────────────────

describe("Logger — LOG_LEVEL override", () => {
  test("LOG_LEVEL=error suppresses everything below", async () => {
    process.env["LOG_LEVEL"] = "error";
    const c = spyConsole();
    const { logger } = await importFresh();

    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");

    expect(c.debug).toHaveBeenCalledTimes(0);
    expect(c.info).toHaveBeenCalledTimes(0);
    expect(c.warn).toHaveBeenCalledTimes(0);
    expect(c.error).toHaveBeenCalledTimes(1);
    c.restore();
  });

  test("LOG_LEVEL=warn allows warn+error", async () => {
    process.env["LOG_LEVEL"] = "warn";
    const c = spyConsole();
    const { logger } = await importFresh();

    logger.info("i");
    logger.warn("w");
    logger.error("e");

    expect(c.info).toHaveBeenCalledTimes(0);
    expect(c.warn).toHaveBeenCalledTimes(1);
    expect(c.error).toHaveBeenCalledTimes(1);
    c.restore();
  });

  test("LOG_LEVEL=info in dev suppresses debug", async () => {
    process.env["LOG_LEVEL"] = "info";
    const c = spyConsole();
    const { logger } = await importFresh();

    logger.debug("d");
    logger.info("i");

    expect(c.debug).toHaveBeenCalledTimes(0);
    expect(c.info).toHaveBeenCalledTimes(1);
    c.restore();
  });
});

// ── Child loggers ──────────────────────────────────────────────────────────

describe("Logger — child()", () => {
  test("child carries bound context into log line", async () => {
    const c = spyConsole();
    const { logger } = await importFresh();

    const child = logger.child({ requestId: "abc-123" });
    child.info("incoming", { route: "/health" });

    const line = c.info.mock.calls[0]?.[0] as string;
    expect(line).toContain('"requestId":"abc-123"');
    expect(line).toContain('"route":"/health"');
    c.restore();
  });

  test("child bindings do not leak to parent logger", async () => {
    const c = spyConsole();
    const { logger } = await importFresh();

    logger.child({ reqId: "x" });
    logger.info("parent only");

    const line = c.info.mock.calls[0]?.[0] as string;
    expect(line).not.toContain("reqId");
    c.restore();
  });

  test("nested child merges bindings", async () => {
    const c = spyConsole();
    const { logger } = await importFresh();

    const c1 = logger.child({ a: 1 });
    const c2 = c1.child({ b: 2 });
    c2.info("nested");

    const line = c.info.mock.calls[0]?.[0] as string;
    expect(line).toContain('"a":1');
    expect(line).toContain('"b":2');
    c.restore();
  });

  test("child meta overrides parent binding with same key", async () => {
    const c = spyConsole();
    const { logger } = await importFresh();

    const child = logger.child({ reqId: "old" });
    child.info("override", { reqId: "new" });

    const line = c.info.mock.calls[0]?.[0] as string;
    expect(line).toContain('"reqId":"new"');
    expect(line).not.toContain('"reqId":"old"');
    c.restore();
  });
});

// ── requestLogger shortcut ─────────────────────────────────────────────────

describe("Logger — requestLogger", () => {
  test("requestLogger creates a child with requestId", async () => {
    const c = spyConsole();
    const { requestLogger } = await importFresh();

    const rl = requestLogger("rq-001");
    rl.info("processing");

    const line = c.info.mock.calls[0]?.[0] as string;
    expect(line).toContain('"requestId":"rq-001"');
    c.restore();
  });
});

// ── Edge cases ─────────────────────────────────────────────────────────────

describe("Logger — edge cases", () => {
  test("empty meta {} is suppressed (no trailing metadata)", async () => {
    const c = spyConsole();
    const { logger } = await importFresh();

    logger.info("plain msg", {});
    const line = c.info.mock.calls[0]?.[0] as string;
    // Should not contain "{}"
    expect(line).not.toContain("{}");
    c.restore();
  });

  test("undefined meta values are dropped by JSON serialisation", async () => {
    const c = spyConsole();
    const { logger } = await importFresh();

    logger.info("msg", { a: undefined });
    const line = c.info.mock.calls[0]?.[0] as string;
    // undefined keys are omitted during JSON.stringify
    expect(line).not.toContain("undefined");
    c.restore();
  });
});
