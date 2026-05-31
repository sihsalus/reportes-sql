/**
 * Integration tests for the conceptos router (OpenMRS proxy).
 * Uses jest.mock to intercept fetch() and config.
 */

import { jest } from "@jest/globals";

// ── Mock config to avoid env file dependency ────────────────────────────
jest.mock("../src/config/index.js", () => ({
  settings: {
    openmrs_api_url: "http://fake-openmrs/openmrs",
    openmrs_api_user: "admin",
    openmrs_api_password: "test",
    indicadores_db_host: "localhost",
    indicadores_db_port: 5432,
    indicadores_db_name: "test",
    indicadores_db_user: "test",
    indicadores_db_password: "test",
    openmrs_db_host: "localhost",
    openmrs_db_port: 3306,
    openmrs_db_name: "test",
    openmrs_db_user: "test",
    openmrs_db_password: "test",
    port: 8000,
  },
  getIndicadoresDatabaseUrl: () =>
    "postgres://test:test@localhost:5432/test",
}));

import express from "express";
import supertest from "supertest";
import { conceptosRouter } from "../src/routers/conceptos.js";

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use("/conceptos", conceptosRouter);
  return app;
}

function mockFetchRes(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

// Mock global fetch
const originalFetch = globalThis.fetch;

beforeEach(() => {
  jest.clearAllMocks();
  globalThis.fetch = jest.fn() as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("Conceptos Router", () => {
  describe("GET /conceptos/encounter-types", () => {
    test("proxies OpenMRS and returns mapped results", async () => {
      (globalThis.fetch as jest.Mock).mockResolvedValue(
        mockFetchRes(200, {
          results: [
            { uuid: "uuid-1", display: "Consulta externa" },
          ],
        }),
      );

      const app = createTestApp();
      const res = await supertest(app).get(
        "/conceptos/encounter-types",
      );

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].display).toBe("Consulta externa");
    });

    test("returns 502 when OpenMRS is unavailable", async () => {
      (globalThis.fetch as jest.Mock).mockRejectedValue(
        new Error("Connection refused"),
      );

      const app = createTestApp();
      const res = await supertest(app).get(
        "/conceptos/encounter-types",
      );

      expect(res.status).toBe(502);
    });

    test("returns 502 on HTTP error", async () => {
      (globalThis.fetch as jest.Mock).mockResolvedValue(
        mockFetchRes(500, {}),
      );

      const app = createTestApp();
      const res = await supertest(app).get(
        "/conceptos/encounter-types",
      );

      expect(res.status).toBe(502);
    });
  });

  describe("GET /conceptos/buscar", () => {
    test("returns search results", async () => {
      (globalThis.fetch as jest.Mock).mockResolvedValue(
        mockFetchRes(200, {
          results: [{ uuid: "uuid-c", display: "Malaria" }],
        }),
      );

      const app = createTestApp();
      const res = await supertest(app).get(
        "/conceptos/buscar?q=malaria",
      );

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
    });
  });

  describe("GET /conceptos/diagnosticos/buscar", () => {
    test("extracts CIE-10 code and nombre from names", async () => {
      (globalThis.fetch as jest.Mock).mockResolvedValue(
        mockFetchRes(200, {
          results: [
            {
              uuid: "uuid-d1",
              display: "J00.X Nasofaringitis aguda",
              names: [
                { display: "J00.X" },
                { display: "Nasofaringitis aguda" },
              ],
            },
          ],
        }),
      );

      const app = createTestApp();
      const res = await supertest(app).get(
        "/conceptos/diagnosticos/buscar?q=j00",
      );

      expect(res.status).toBe(200);
      expect(res.body[0].codigo).toBe("J00.X");
      expect(res.body[0].nombre).toBe("Nasofaringitis aguda");
    });

    test("omits codigo when no CIE-10 pattern found", async () => {
      (globalThis.fetch as jest.Mock).mockResolvedValue(
        mockFetchRes(200, {
          results: [
            {
              uuid: "uuid-d2",
              display: "Cefalea",
              names: [{ display: "Cefalea" }],
            },
          ],
        }),
      );

      const app = createTestApp();
      const res = await supertest(app).get(
        "/conceptos/diagnosticos/buscar?q=cefalea",
      );

      expect(res.status).toBe(200);
      expect(res.body[0].codigo).toBeUndefined();
    });

    test("returns 400 when q is empty (rejected before OpenMRS)", async () => {
      const app = createTestApp();
      const res = await supertest(app).get(
        "/conceptos/diagnosticos/buscar?q=",
      );

      expect(res.status).toBe(400);
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    test("returns 502 on OpenMRS failure", async () => {
      (globalThis.fetch as jest.Mock).mockRejectedValue(
        new Error("Network error"),
      );

      const app = createTestApp();
      const res = await supertest(app).get(
        "/conceptos/diagnosticos/buscar?q=test",
      );

      expect(res.status).toBe(502);
    });
  });

  describe("GET /conceptos/locations", () => {
    test("filters by query locally", async () => {
      (globalThis.fetch as jest.Mock).mockResolvedValue(
        mockFetchRes(200, {
          results: [
            { uuid: "l1", display: "UPSS Cirugía" },
            { uuid: "l2", display: "UPSS Pediatría" },
            { uuid: "l3", display: "Farmacia" },
          ],
        }),
      );

      const app = createTestApp();
      const res = await supertest(app).get(
        "/conceptos/locations?q=upss",
      );

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
    });

    test("returns 400 when q is empty", async () => {
      const app = createTestApp();
      const res = await supertest(app).get(
        "/conceptos/locations?q=",
      );

      expect(res.status).toBe(400);
    });
  });

  describe("GET /conceptos/locations/resolve", () => {
    test("resolves UUIDs in parallel", async () => {
      (globalThis.fetch as jest.Mock)
        .mockResolvedValueOnce(
          mockFetchRes(200, { uuid: "a", display: "Loc A" }),
        )
        .mockResolvedValueOnce(
          mockFetchRes(200, { uuid: "b", display: "Loc B" }),
        );

      const app = createTestApp();
      const res = await supertest(app).get(
        "/conceptos/locations/resolve?uuids=a,b",
      );

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
    });

    test("skips 404 UUIDs silently", async () => {
      (globalThis.fetch as jest.Mock)
        .mockResolvedValueOnce(mockFetchRes(404, {}))
        .mockResolvedValueOnce(
          mockFetchRes(200, { uuid: "b", display: "Loc B" }),
        );

      const app = createTestApp();
      const res = await supertest(app).get(
        "/conceptos/locations/resolve?uuids=a,b",
      );

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].uuid).toBe("b");
    });

    test("returns 400 for empty uuids", async () => {
      const app = createTestApp();
      const res = await supertest(app).get(
        "/conceptos/locations/resolve?uuids=",
      );

      expect(res.status).toBe(400);
    });
  });

  describe("GET /conceptos/diagnosticos/resolve", () => {
    test("resolves diagnosis with CIE-10 extraction", async () => {
      (globalThis.fetch as jest.Mock).mockResolvedValue(
        mockFetchRes(200, {
          uuid: "d1",
          display: "J00.X Nasofaringitis",
          names: [
            { display: "J00.X" },
            { display: "Nasofaringitis aguda" },
          ],
        }),
      );

      const app = createTestApp();
      const res = await supertest(app).get(
        "/conceptos/diagnosticos/resolve?uuids=d1",
      );

      expect(res.status).toBe(200);
      expect(res.body[0].codigo).toBe("J00.X");
    });

    test("returns 400 for empty uuids", async () => {
      const app = createTestApp();
      const res = await supertest(app).get(
        "/conceptos/diagnosticos/resolve?uuids=",
      );

      expect(res.status).toBe(400);
    });
  });
});
