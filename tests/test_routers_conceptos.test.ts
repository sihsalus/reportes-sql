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

function makeUuid(index: number): string {
  return `00000000-0000-0000-0000-${String(index).padStart(12, "0")}`;
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
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
    test("reads the CIE-10 code from an explicit ICD-10 mapping", async () => {
      (globalThis.fetch as jest.Mock).mockResolvedValue(
        mockFetchRes(200, {
          results: [
            {
              uuid: "uuid-d50",
              display: "Anemia ferropénica",
              names: [
                {
                  display: "Anemia ferropénica",
                  conceptNameType: "FULLY_SPECIFIED",
                },
              ],
              conceptMappings: [
                {
                  conceptReferenceTerm: {
                    code: "D50.9",
                    conceptSource: { name: "ICD-10-WHO" },
                  },
                },
              ],
            },
          ],
        }),
      );

      const app = createTestApp();
      const res = await supertest(app).get(
        "/conceptos/diagnosticos/buscar?q=anemia",
      );

      expect(res.status).toBe(200);
      expect(res.body[0].codigo).toBe("D50.9");
      expect(res.body[0].nombre).toBe("Anemia ferropénica");
    });

    test("falls back to the catalog SHORT name when there is no mapping", async () => {
      (globalThis.fetch as jest.Mock).mockResolvedValue(
        mockFetchRes(200, {
          results: [
            {
              uuid: "uuid-c020",
              display: "TUMOR MALIGNO DE LA CARA DORSAL DE LA LENGUA",
              names: [
                {
                  display: "TUMOR MALIGNO DE LA CARA DORSAL DE LA LENGUA",
                  conceptNameType: "FULLY_SPECIFIED",
                },
                { display: "C020", conceptNameType: "SHORT" },
              ],
              conceptMappings: [],
            },
          ],
        }),
      );

      const app = createTestApp();
      const res = await supertest(app).get(
        "/conceptos/diagnosticos/buscar?q=tumor",
      );

      expect(res.status).toBe(200);
      expect(res.body[0].codigo).toBe("C020");
      expect(res.body[0].nombre).toBe(
        "TUMOR MALIGNO DE LA CARA DORSAL DE LA LENGUA",
      );
    });

    test("prefers the explicit mapping over the SHORT name", async () => {
      (globalThis.fetch as jest.Mock).mockResolvedValue(
        mockFetchRes(200, {
          results: [
            {
              uuid: "uuid-e11",
              display: "Diabetes mellitus tipo II",
              names: [
                { display: "Diabetes mellitus tipo II", conceptNameType: "FULLY_SPECIFIED" },
                { display: "R51-LOCAL", conceptNameType: "SHORT" },
              ],
              conceptMappings: [
                {
                  conceptReferenceTerm: {
                    code: "E11.9",
                    conceptSource: { name: "ICD-10-WHO" },
                  },
                },
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
      expect(res.body[0].codigo).toBe("E11.9");
    });

    test("ignores a SHORT name that is not shaped like a CIE-10 code", async () => {
      (globalThis.fetch as jest.Mock).mockResolvedValue(
        mockFetchRes(200, {
          results: [
            {
              uuid: "uuid-hta",
              display: "Hipertensión arterial",
              names: [{ display: "HTA", conceptNameType: "SHORT" }],
              conceptMappings: [],
            },
          ],
        }),
      );

      const app = createTestApp();
      const res = await supertest(app).get(
        "/conceptos/diagnosticos/buscar?q=hipertension",
      );

      expect(res.status).toBe(200);
      expect(res.body[0].codigo).toBeUndefined();
      expect(res.body[0].nombre).toBe("Hipertensión arterial");
    });

    test("does not derive the code from display text alone", async () => {
      // A legacy display can merely look like a CIE-10 code; without a
      // mapping or a SHORT name it must not be returned as the code.
      (globalThis.fetch as jest.Mock).mockResolvedValue(
        mockFetchRes(200, {
          results: [
            {
              uuid: "uuid-i10",
              display: "I10",
              names: [{ display: "I10", conceptNameType: "SYNONYM" }],
              conceptMappings: [],
            },
          ],
        }),
      );

      const app = createTestApp();
      const res = await supertest(app).get(
        "/conceptos/diagnosticos/buscar?q=i10",
      );

      expect(res.status).toBe(200);
      expect(res.body[0].codigo).toBeUndefined();
    });

    test("strips a leading code from the display name", async () => {
      (globalThis.fetch as jest.Mock).mockResolvedValue(
        mockFetchRes(200, {
          results: [
            {
              uuid: "uuid-j00",
              display: "J00.9 Nasofaringitis aguda",
              names: [
                { display: "Nasofaringitis aguda", conceptNameType: "FULLY_SPECIFIED" },
              ],
              conceptMappings: [
                {
                  conceptReferenceTerm: {
                    code: "J00.9",
                    conceptSource: { name: "CIE-10 MINSA" },
                  },
                },
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

    test("limits OpenMRS requests to 8 and preserves input order", async () => {
      const uuids = Array.from({ length: 10 }, (_, index) => makeUuid(index + 1));
      const pending: Array<{
        uuid: string;
        resolve: (response: Response) => void;
      }> = [];
      let inFlight = 0;
      let maxInFlight = 0;
      let firstBatchReady!: () => void;
      let allRequestsStarted!: () => void;
      const firstBatch = new Promise<void>((resolve) => {
        firstBatchReady = resolve;
      });
      const allRequests = new Promise<void>((resolve) => {
        allRequestsStarted = resolve;
      });

      (globalThis.fetch as jest.Mock).mockImplementation(() => {
        const request = deferred<Response>();
        const uuid = uuids[pending.length];
        pending.push({ uuid, resolve: request.resolve });
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        if (pending.length === 8) firstBatchReady();
        if (pending.length === uuids.length) allRequestsStarted();
        return request.promise.finally(() => {
          inFlight -= 1;
        });
      });

      const app = createTestApp();
      const responsePromise = supertest(app)
        .get(`/conceptos/locations/resolve?uuids=${uuids.join(",")}`)
        .then((response) => response);

      await firstBatch;
      expect(globalThis.fetch).toHaveBeenCalledTimes(8);
      expect(maxInFlight).toBe(8);

      for (const request of pending.slice(0, 8)) {
        request.resolve(
          mockFetchRes(200, {
            uuid: request.uuid,
            display: request.uuid,
          }),
        );
      }

      await allRequests;
      for (const request of pending.slice(8)) {
        request.resolve(
          mockFetchRes(200, {
            uuid: request.uuid,
            display: request.uuid,
          }),
        );
      }

      const res = await responsePromise;
      expect(res.status).toBe(200);
      expect(res.body.map((item: { uuid: string }) => item.uuid)).toEqual(
        uuids,
      );
    });
  });

  describe("GET /conceptos/diagnosticos/resolve", () => {
    test("resolves diagnosis with the CIE-10 code from the mapping", async () => {
      (globalThis.fetch as jest.Mock).mockResolvedValue(
        mockFetchRes(200, {
          uuid: "00000000-0000-0000-0000-000000000001",
          display: "Faringoamigdalitis aguda",
          names: [
            {
              display: "Faringoamigdalitis aguda",
              conceptNameType: "FULLY_SPECIFIED",
            },
          ],
          conceptMappings: [
            {
              conceptReferenceTerm: {
                code: "J029",
                conceptSource: { name: "CIE-10 MINSA" },
              },
            },
          ],
        }),
      );

      const app = createTestApp();
      const res = await supertest(app).get(
        "/conceptos/diagnosticos/resolve?uuids=00000000-0000-0000-0000-000000000001",
      );

      expect(res.status).toBe(200);
      expect(res.body[0].codigo).toBe("J029");
      expect(res.body[0].nombre).toBe("Faringoamigdalitis aguda");
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

  describe("UUID resolve request limits", () => {
    test.each([
      "/conceptos/buscar/resolve",
      "/conceptos/locations/resolve",
      "/conceptos/diagnosticos/resolve",
    ])(
      "returns 413 and does not call OpenMRS when more than 100 UUIDs are sent (%s)",
      async (path) => {
        const uuids = Array.from({ length: 101 }, (_, index) =>
          makeUuid(index + 1),
        );
        const app = createTestApp();
        const res = await supertest(app).get(
          `${path}?uuids=${uuids.join(",")}`,
        );

        expect(res.status).toBe(413);
        expect(res.body.detail).toBe(
          "Se permite un máximo de 100 UUIDs por solicitud",
        );
        expect(globalThis.fetch).not.toHaveBeenCalled();
      },
    );
  });
});
