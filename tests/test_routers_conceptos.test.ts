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
              display: "J00.9 Nasofaringitis aguda",
              names: [
                { display: "J00.9" },
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
      expect(res.body[0].codigo).toBe("J00.9");
      expect(res.body[0].nombre).toBe("Nasofaringitis aguda");
    });

    test("extracts subcategory code with trailing digits (E11.9 Diabetes)", async () => {
      (globalThis.fetch as jest.Mock).mockResolvedValue(
        mockFetchRes(200, {
          results: [
            {
              uuid: "uuid-e11",
              display: "E11.9 Diabetes mellitus no insulinodependiente",
              names: [
                { display: "E11.9 Diabetes" },
                { display: "Diabetes mellitus no insulinodependiente" },
              ],
            },
          ],
        }),
      );

      const app = createTestApp();
      const res = await supertest(app).get(
        "/conceptos/diagnosticos/buscar?q=e11",
      );

      expect(res.status).toBe(200);
      expect(res.body[0].codigo).toBe("E11.9 Diabetes");
      expect(res.body[0].nombre).toBe("Diabetes mellitus no insulinodependiente");
    });

    test("extracts bare category code (I10)", async () => {
      (globalThis.fetch as jest.Mock).mockResolvedValue(
        mockFetchRes(200, {
          results: [
            {
              uuid: "uuid-i10",
              display: "I10 Hipertensión esencial",
              names: [
                { display: "I10" },
                { display: "Hipertensión esencial" },
              ],
            },
          ],
        }),
      );

      const app = createTestApp();
      const res = await supertest(app).get(
        "/conceptos/diagnosticos/buscar?q=i10",
      );

      expect(res.status).toBe(200);
      expect(res.body[0].codigo).toBe("I10");
      expect(res.body[0].nombre).toBe("Hipertensión esencial");
    });

    test("does not match single-digit prefixes (A1C test)", async () => {
      (globalThis.fetch as jest.Mock).mockResolvedValue(
        mockFetchRes(200, {
          results: [
            {
              uuid: "uuid-a1c",
              display: "A1C test Hemoglobina glicosilada",
              names: [
                { display: "A1C test" },
                { display: "Hemoglobina glicosilada" },
              ],
            },
          ],
        }),
      );

      const app = createTestApp();
      const res = await supertest(app).get(
        "/conceptos/diagnosticos/buscar?q=a1c",
      );

      expect(res.status).toBe(200);
      // "A1C" starts with a single digit, so it is NOT a CIE-10 category
      expect(res.body[0].codigo).toBeUndefined();
      expect(res.body[0].nombre).toBe("A1C test");
    });

    test("known limitation: B12 deficiency still matches as a code", async () => {
      // Without a CIE-10 catalog there is no perfect regex: "B12 deficiency"
      // starts with B + two digits (B12), so it matches the category pattern.
      // This test pins the documented behavior — the name is treated as code.
      (globalThis.fetch as jest.Mock).mockResolvedValue(
        mockFetchRes(200, {
          results: [
            {
              uuid: "uuid-b12",
              display: "B12 deficiency Anemia por deficiencia de B12",
              names: [
                { display: "B12 deficiency" },
                { display: "Anemia por deficiencia de B12" },
              ],
            },
          ],
        }),
      );

      const app = createTestApp();
      const res = await supertest(app).get(
        "/conceptos/diagnosticos/buscar?q=b12",
      );

      expect(res.status).toBe(200);
      expect(res.body[0].codigo).toBe("B12 deficiency");
      expect(res.body[0].nombre).toBe("Anemia por deficiencia de B12");
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
          mockFetchRes(200, { uuid: "00000000-0000-0000-0000-000000000001", display: "Loc A" }),
        )
        .mockResolvedValueOnce(
          mockFetchRes(200, { uuid: "00000000-0000-0000-0000-000000000002", display: "Loc B" }),
        );

      const app = createTestApp();
      const res = await supertest(app).get(
        "/conceptos/locations/resolve?uuids=00000000-0000-0000-0000-000000000001,00000000-0000-0000-0000-000000000002",
      );

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
    });

    test("skips 404 UUIDs silently", async () => {
      (globalThis.fetch as jest.Mock)
        .mockResolvedValueOnce(mockFetchRes(404, {}))
        .mockResolvedValueOnce(
          mockFetchRes(200, { uuid: "00000000-0000-0000-0000-000000000002", display: "Loc B" }),
        );

      const app = createTestApp();
      const res = await supertest(app).get(
        "/conceptos/locations/resolve?uuids=00000000-0000-0000-0000-000000000001,00000000-0000-0000-0000-000000000002",
      );

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].uuid).toBe("00000000-0000-0000-0000-000000000002");
    });

    test("returns 400 for empty uuids", async () => {
      const app = createTestApp();
      const res = await supertest(app).get(
        "/conceptos/locations/resolve?uuids=",
      );

      expect(res.status).toBe(400);
    });

    test("returns 400 for invalid UUID format", async () => {
      const app = createTestApp();
      const res = await supertest(app).get(
        "/conceptos/locations/resolve?uuids=../../admin/session",
      );

      expect(res.status).toBe(400);
      expect(res.body.detail).toMatch(/inválido/);
    });
  });

  describe("GET /conceptos/diagnosticos/resolve", () => {
    test("resolves diagnosis with CIE-10 extraction", async () => {
      (globalThis.fetch as jest.Mock).mockResolvedValue(
        mockFetchRes(200, {
          uuid: "00000000-0000-0000-0000-000000000001",
          display: "J00.9 Nasofaringitis",
          names: [
            { display: "J00.9" },
            { display: "Nasofaringitis aguda" },
          ],
        }),
      );

      const app = createTestApp();
      const res = await supertest(app).get(
        "/conceptos/diagnosticos/resolve?uuids=00000000-0000-0000-0000-000000000001",
      );

      expect(res.status).toBe(200);
      expect(res.body[0].codigo).toBe("J00.9");
    });

    test("returns 400 for empty uuids", async () => {
      const app = createTestApp();
      const res = await supertest(app).get(
        "/conceptos/diagnosticos/resolve?uuids=",
      );

      expect(res.status).toBe(400);
    });
  });

  describe("GET /conceptos/buscar/resolve", () => {
    test("resolves concept UUIDs to display labels as a map", async () => {
      (globalThis.fetch as jest.Mock)
        .mockResolvedValueOnce(
          mockFetchRes(200, { uuid: "00000000-0000-0000-0000-000000000001", display: "Malaria" }),
        )
        .mockResolvedValueOnce(
          mockFetchRes(200, { uuid: "00000000-0000-0000-0000-000000000002", display: "Cefalea" }),
        );

      const app = createTestApp();
      const res = await supertest(app).get(
        "/conceptos/buscar/resolve?uuids=00000000-0000-0000-0000-000000000001,00000000-0000-0000-0000-000000000002",
      );

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        "00000000-0000-0000-0000-000000000001": "Malaria",
        "00000000-0000-0000-0000-000000000002": "Cefalea",
      });
    });

    test("returns empty object when no uuids found (silent skip)", async () => {
      (globalThis.fetch as jest.Mock)
        .mockResolvedValueOnce(mockFetchRes(404, {}))
        .mockResolvedValueOnce(mockFetchRes(404, {}));

      const app = createTestApp();
      const res = await supertest(app).get(
        "/conceptos/buscar/resolve?uuids=00000000-0000-0000-0000-000000000001,00000000-0000-0000-0000-000000000002",
      );

      expect(res.status).toBe(200);
      expect(res.body).toEqual({});
    });

    test("silently omits not-found UUIDs from result map", async () => {
      (globalThis.fetch as jest.Mock)
        .mockResolvedValueOnce(mockFetchRes(404, {}))
        .mockResolvedValueOnce(
          mockFetchRes(200, { uuid: "00000000-0000-0000-0000-000000000002", display: "Found" }),
        );

      const app = createTestApp();
      const res = await supertest(app).get(
        "/conceptos/buscar/resolve?uuids=00000000-0000-0000-0000-000000000001,00000000-0000-0000-0000-000000000002",
      );

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ "00000000-0000-0000-0000-000000000002": "Found" });
      expect(res.body).not.toHaveProperty("00000000-0000-0000-0000-000000000001");
    });

    test("returns 400 for empty uuids", async () => {
      const app = createTestApp();
      const res = await supertest(app).get(
        "/conceptos/buscar/resolve?uuids=",
      );

      expect(res.status).toBe(400);
    });

    test("returns 502 on OpenMRS connection failure", async () => {
      (globalThis.fetch as jest.Mock).mockRejectedValue(
        new Error("Connection refused"),
      );

      const app = createTestApp();
      const res = await supertest(app).get(
        "/conceptos/buscar/resolve?uuids=00000000-0000-0000-0000-000000000001",
      );

      expect(res.status).toBe(502);
    });

    test("returns 400 for invalid UUID format (SSRF protection)", async () => {
      const app = createTestApp();
      const res = await supertest(app).get(
        "/conceptos/buscar/resolve?uuids=../../admin/session",
      );

      expect(res.status).toBe(400);
      expect(res.body.detail).toMatch(/inválido/);
    });
  });
});
