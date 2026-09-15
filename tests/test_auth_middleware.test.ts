/**
 * Contract tests for the incoming OpenMRS auth middleware
 * (src/middleware/auth.ts).
 *
 * Covers:
 * - extractJSESSIONID: multi-cookie, quoting, case, JSESSIONIDSSO ignored
 * - requireSession 401 family: missing / invalid / non-ok / timeout /
 *   fetch-error / authenticated:false / invalid body
 * - valid session → next() with req.authUser attached as-is (roles/privileges
 *   preserved); Set-Cookie discarded; no-cache (repeated calls hit upstream)
 * - no Authorization / service credentials / extra cookies in fetch args
 * - public exemptions: /health, /docs, /docs/* public; /docsfoo NOT exempt
 * - requirePrivilege: has (display/uuid/string) / lacks / unset (fail-closed)
 * - handler-visible req.authUser propagation through a real Express mount
 */

import { jest } from "@jest/globals";

// ── Mock config (no env file dependency) ─────────────────────────────────

jest.mock("../src/config/index.js", () => ({
  settings: {
    openmrs_api_url: "http://fake-openmrs/openmrs",
    openmrs_api_user: "admin",
    openmrs_api_password: "test",
    openmrs_required_privilege: undefined,
    auth_disabled: false,
  },
}));

import { settings } from "../src/config/index.js";
import express from "express";
import supertest from "supertest";
import type { NextFunction, Request, Response } from "express";
import {
  extractJSESSIONID,
  requireSession,
  requirePrivilege,
  SESSION_VALIDATION_TIMEOUT_MS,
  type AuthUser,
} from "../src/middleware/auth.js";

// ── Fixtures ─────────────────────────────────────────────────────────────

const SESSION_URL = "http://fake-openmrs/openmrs/ws/rest/v1/session";

const MOCKED_USER: AuthUser = {
  uuid: "user-uuid-1",
  display: "Dr. Test",
  systemId: "admin",
  roles: [{ display: "System Developer", uuid: "role-uuid-1" }],
  privileges: [
    { display: "app:indicadores:write", uuid: "priv-uuid-1" },
    { display: "View Patients", uuid: "priv-uuid-2" },
  ],
};

function mockFetchRes(
  status: number,
  body: unknown,
  extra?: Partial<Response>,
): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
    ...extra,
  } as Response;
}

function makeReq(overrides: Partial<Request> = {}): Request {
  return {
    path: "/indicadores",
    headers: {},
    ...overrides,
  } as Request;
}

function makeRes(): Response {
  const res = {
    statusCode: 200,
    status: jest.fn(),
    json: jest.fn(),
    setHeader: jest.fn(),
  } as unknown as Response;
  (res.status as jest.Mock).mockReturnValue(res);
  (res.json as jest.Mock).mockReturnValue(res);
  return res;
}

function makeNext(): jest.Mock {
  return jest.fn();
}

const originalFetch = globalThis.fetch;

beforeEach(() => {
  jest.clearAllMocks();
  globalThis.fetch = jest.fn() as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  (settings as { auth_disabled: boolean }).auth_disabled = false;
});

// ── extractJSESSIONID ────────────────────────────────────────────────────

describe("extractJSESSIONID", () => {
  test("returns null when no Cookie header", () => {
    expect(extractJSESSIONID(undefined)).toBeNull();
    expect(extractJSESSIONID("")).toBeNull();
  });

  test("returns null when JSESSIONID missing", () => {
    expect(extractJSESSIONID("OTHER=value")).toBeNull();
  });

  test("extracts a bare JSESSIONID", () => {
    expect(extractJSESSIONID("JSESSIONID=abc123")).toBe("abc123");
  });

  test("extracts JSESSIONID among other cookies (only it is returned)", () => {
    expect(
      extractJSESSIONID("OTHER=x; JSESSIONID=abc123; ANOTHER=y"),
    ).toBe("abc123");
  });

  test("is case-insensitive on the cookie name", () => {
    expect(extractJSESSIONID("jsessionid=abc123")).toBe("abc123");
    expect(extractJSESSIONID("JSessionID=abc123")).toBe("abc123");
  });

  test("strips surrounding quotes", () => {
    expect(extractJSESSIONID('JSESSIONID="abc123"')).toBe("abc123");
  });

  test("ignores JSESSIONIDSSO (different cookie)", () => {
    expect(extractJSESSIONID("JSESSIONIDSSO=token-x; JSESSIONID=abc123")).toBe(
      "abc123",
    );
    expect(extractJSESSIONID("JSESSIONIDSSO=token-x")).toBeNull();
  });

  test("returns null for an empty value", () => {
    expect(extractJSESSIONID("JSESSIONID=")).toBeNull();
    expect(extractJSESSIONID("JSESSIONID=; OTHER=x")).toBeNull();
  });
});

// ── requireSession ───────────────────────────────────────────────────────

describe("requireSession", () => {
  test("401 with no upstream call when cookie is missing", async () => {
    const req = makeReq();
    const res = makeRes();
    const next = makeNext();

    await requireSession(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ detail: "No autorizado" });
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  test("401 with no upstream call when JSESSIONID is absent from cookies", async () => {
    const req = makeReq({ headers: { cookie: "OTHER=only" } });
    const res = makeRes();
    const next = makeNext();

    await requireSession(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  test("forwards ONLY Cookie: JSESSIONID=<value> upstream, never Authorization", async () => {
    (globalThis.fetch as jest.Mock).mockResolvedValue(
      mockFetchRes(200, { authenticated: true, user: MOCKED_USER }),
    );
    const req = makeReq({
      headers: { cookie: "OTHER=x; JSESSIONID=abc123; ANOTHER=y" },
    });
    const res = makeRes();
    const next = makeNext();

    await requireSession(req, res, next);

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (globalThis.fetch as jest.Mock).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe(SESSION_URL);
    expect(init.headers).toEqual({ Cookie: "JSESSIONID=abc123" });
    expect(Object.keys(init.headers as Record<string, string>).sort()).toEqual([
      "Cookie",
    ]);
    expect(init.signal).toBeDefined();
  });

  test("uses a bounded timeout on the upstream call", async () => {
    (globalThis.fetch as jest.Mock).mockResolvedValue(
      mockFetchRes(200, { authenticated: true, user: MOCKED_USER }),
    );
    const req = makeReq({ headers: { cookie: "JSESSIONID=abc123" } });
    const res = makeRes();
    const next = makeNext();

    await requireSession(req, res, next);

    const init = (globalThis.fetch as jest.Mock).mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(SESSION_VALIDATION_TIMEOUT_MS).toBe(3000);
  });

  test("accepts a valid session and attaches body.user as-is to req.authUser", async () => {
    (globalThis.fetch as jest.Mock).mockResolvedValue(
      mockFetchRes(200, { authenticated: true, user: MOCKED_USER }),
    );
    const req = makeReq({ headers: { cookie: "JSESSIONID=abc123" } });
    const res = makeRes();
    const next = makeNext();

    await requireSession(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.authUser).toEqual(MOCKED_USER);
    expect(req.authUser?.roles).toEqual(MOCKED_USER.roles);
    expect(req.authUser?.privileges).toEqual(MOCKED_USER.privileges);
    expect(res.status).not.toHaveBeenCalled();
  });

  test("401 when authenticated is false (200 response)", async () => {
    (globalThis.fetch as jest.Mock).mockResolvedValue(
      mockFetchRes(200, { authenticated: false, user: MOCKED_USER }),
    );
    const req = makeReq({ headers: { cookie: "JSESSIONID=abc123" } });
    const res = makeRes();
    const next = makeNext();

    await requireSession(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ detail: "No autorizado" });
    expect(req.authUser).toBeUndefined();
    expect(next).not.toHaveBeenCalled();
  });

  test("401 when authenticated is truthy but not exactly true", async () => {
    (globalThis.fetch as jest.Mock).mockResolvedValue(
      mockFetchRes(200, { authenticated: "true", user: MOCKED_USER }),
    );
    const req = makeReq({ headers: { cookie: "JSESSIONID=abc123" } });
    const res = makeRes();
    const next = makeNext();

    await requireSession(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
  });

  test("401 when authenticated field is missing", async () => {
    (globalThis.fetch as jest.Mock).mockResolvedValue(
      mockFetchRes(200, { user: MOCKED_USER }),
    );
    const req = makeReq({ headers: { cookie: "JSESSIONID=abc123" } });
    const res = makeRes();
    const next = makeNext();

    await requireSession(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
  });

  test("401 on upstream non-OK response (5xx)", async () => {
    (globalThis.fetch as jest.Mock).mockResolvedValue(
      mockFetchRes(500, {}),
    );
    const req = makeReq({ headers: { cookie: "JSESSIONID=abc123" } });
    const res = makeRes();
    const next = makeNext();

    await requireSession(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
  });

  test("401 on upstream 401 (invalid session)", async () => {
    (globalThis.fetch as jest.Mock).mockResolvedValue(
      mockFetchRes(401, {}),
    );
    const req = makeReq({ headers: { cookie: "JSESSIONID=abc123" } });
    const res = makeRes();
    const next = makeNext();

    await requireSession(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
  });

  test("401 on network error", async () => {
    (globalThis.fetch as jest.Mock).mockRejectedValue(
      new Error("Connection refused"),
    );
    const req = makeReq({ headers: { cookie: "JSESSIONID=abc123" } });
    const res = makeRes();
    const next = makeNext();

    await requireSession(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ detail: "No autorizado" });
  });

  test("401 on timeout (AbortError)", async () => {
    (globalThis.fetch as jest.Mock).mockRejectedValue(
      new DOMException("The operation was aborted.", "AbortError"),
    );
    const req = makeReq({ headers: { cookie: "JSESSIONID=abc123" } });
    const res = makeRes();
    const next = makeNext();

    await requireSession(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
  });

  test("401 on invalid upstream body (json parse failure)", async () => {
    (globalThis.fetch as jest.Mock).mockResolvedValue(
      mockFetchRes(200, { authenticated: true, user: MOCKED_USER }, {
        json: async () => {
          throw new SyntaxError("Unexpected token");
        },
      } as Partial<Response>),
    );
    const req = makeReq({ headers: { cookie: "JSESSIONID=abc123" } });
    const res = makeRes();
    const next = makeNext();

    await requireSession(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
  });

  test("discards upstream Set-Cookie (never forwarded to the client)", async () => {
    (globalThis.fetch as jest.Mock).mockResolvedValue(
      mockFetchRes(200, { authenticated: true, user: MOCKED_USER }, {
        headers: {
          get: (name: string) =>
            name.toLowerCase() === "set-cookie"
              ? "JSESSIONID=UPSTREAM_NEW"
              : null,
        },
      } as unknown as Partial<Response>),
    );
    const req = makeReq({ headers: { cookie: "JSESSIONID=abc123" } });
    const res = makeRes();
    const next = makeNext();

    await requireSession(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.setHeader).not.toHaveBeenCalled();
  });

  test("no-cache: two sequential requests both hit upstream", async () => {
    (globalThis.fetch as jest.Mock).mockResolvedValue(
      mockFetchRes(200, { authenticated: true, user: MOCKED_USER }),
    );
    const req = makeReq({ headers: { cookie: "JSESSIONID=abc123" } });
    const res = makeRes();
    const next = makeNext();

    await requireSession(req, res, next);
    await requireSession(req, res, next);

    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(next).toHaveBeenCalledTimes(2);
  });

  test("exempts /health without any upstream call", async () => {
    const req = makeReq({ path: "/health" });
    const res = makeRes();
    const next = makeNext();

    await requireSession(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  test("exempts /docs exactly", async () => {
    const req = makeReq({ path: "/docs" });
    const res = makeRes();
    const next = makeNext();

    await requireSession(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  test("exempts /docs/ and /docs/* (including /docs/openapi.json)", async () => {
    for (const path of ["/docs/", "/docs/openapi.json", "/docs/swagger-ui.css"]) {
      const req = makeReq({ path });
      const res = makeRes();
      const next = makeNext();

      await requireSession(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(globalThis.fetch).not.toHaveBeenCalled();
    }
  });

  test("does NOT exempt /docsfoo (precise path match)", async () => {
    const req = makeReq({ path: "/docsfoo" });
    const res = makeRes();
    const next = makeNext();

    await requireSession(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  test("AUTH_DISABLED bypasses session validation (no cookie, no upstream call)", async () => {
    (settings as { auth_disabled: boolean }).auth_disabled = true;
    const req = makeReq();
    const res = makeRes();
    const next = makeNext();

    await requireSession(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
    expect(req.authUser).toBeUndefined();
  });
});

// ── requirePrivilege ─────────────────────────────────────────────────────

describe("requirePrivilege", () => {
  const PRIVILEGE = "app:indicadores:write";

  function privilegedReq(privileges: unknown): Request {
    return makeReq({
      authUser: { uuid: "u1", privileges: privileges as AuthUser["privileges"] },
    });
  }

  test("next() when the user has the privilege (display match)", () => {
    const res = makeRes();
    const next = makeNext();

    requirePrivilege(PRIVILEGE)(
      privilegedReq([{ display: PRIVILEGE, uuid: "p1" }]),
      res,
      next,
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test("next() when the user has the privilege (uuid match)", () => {
    const res = makeRes();
    const next = makeNext();

    requirePrivilege(PRIVILEGE)(
      privilegedReq([{ display: "Other", uuid: PRIVILEGE }]),
      res,
      next,
    );

    expect(next).toHaveBeenCalledTimes(1);
  });

  test("next() when privileges are plain strings", () => {
    const res = makeRes();
    const next = makeNext();

    requirePrivilege(PRIVILEGE)(privilegedReq([PRIVILEGE]), res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  test("403 when the authenticated user lacks the privilege", () => {
    const res = makeRes();
    const next = makeNext();

    requirePrivilege(PRIVILEGE)(
      privilegedReq([{ display: "View Patients", uuid: "p2" }]),
      res,
      next,
    );

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ detail: "Sin privilegios" });
    expect(next).not.toHaveBeenCalled();
  });

  test("403 when the user has no privileges array", () => {
    const res = makeRes();
    const next = makeNext();

    requirePrivilege(PRIVILEGE)(privilegedReq(undefined), res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  test("fail-closed: 403 when the required privilege is unset (undefined)", () => {
    const res = makeRes();
    const next = makeNext();

    requirePrivilege(undefined)(
      privilegedReq([{ display: PRIVILEGE, uuid: "p1" }]),
      res,
      next,
    );

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ detail: "Sin privilegios" });
    expect(next).not.toHaveBeenCalled();
  });

  test("fail-closed: 403 when the required privilege is empty string", () => {
    const res = makeRes();
    const next = makeNext();

    requirePrivilege("")(
      privilegedReq([{ display: PRIVILEGE, uuid: "p1" }]),
      res,
      next,
    );

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  test("AUTH_DISABLED bypasses the privilege guard (even unset privilege, no authUser)", () => {
    (settings as { auth_disabled: boolean }).auth_disabled = true;
    const res = makeRes();
    const next = makeNext();

    requirePrivilege(undefined)(makeReq(), res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });
});

// ── Handler-visible propagation (real Express mount) ─────────────────────

describe("requireSession through Express (handler-visible authUser)", () => {
  function buildApp() {
    const app = express();
    app.use(requireSession);
    app.get("/probe", (req: Request, res: Response) => {
      res.json({ authUser: req.authUser ?? null });
    });
    app.get("/health", (_req: Request, res: Response) => {
      res.json({ status: "ok" });
    });
    app.get("/docs", (_req: Request, res: Response) => {
      res.json({ docs: true });
    });
    return app;
  }

  test("handler sees req.authUser with roles and privileges preserved", async () => {
    (globalThis.fetch as jest.Mock).mockResolvedValue(
      mockFetchRes(200, { authenticated: true, user: MOCKED_USER }),
    );

    const res = await supertest(buildApp())
      .get("/probe")
      .set("Cookie", "JSESSIONID=abc123");

    expect(res.status).toBe(200);
    expect(res.body.authUser).toEqual(MOCKED_USER);
    expect(res.body.authUser.roles).toEqual(MOCKED_USER.roles);
    expect(res.body.authUser.privileges).toEqual(MOCKED_USER.privileges);
  });

  test("401 when no cookie at handler level", async () => {
    const res = await supertest(buildApp()).get("/probe");

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ detail: "No autorizado" });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  test("/health and /docs stay public at handler level (no cookie needed)", async () => {
    const healthRes = await supertest(buildApp()).get("/health");
    expect(healthRes.status).toBe(200);
    expect(healthRes.body).toEqual({ status: "ok" });

    const docsRes = await supertest(buildApp()).get("/docs");
    expect(docsRes.status).toBe(200);

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
