/**
 * Unit tests for src/middleware/async-handler.ts
 */
import { jest } from "@jest/globals";
import { asyncHandler } from "../src/middleware/async-handler.js";
import type { Request, Response } from "express";

let consoleErrorSpy: jest.SpiedFunction<typeof console.error>;

beforeAll(() => {
  consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
});

afterAll(() => {
  consoleErrorSpy.mockRestore();
});

function fakeReq(overrides?: Partial<Request>): Request {
  return {
    params: {},
    query: {},
    body: {},
    headers: {},
    ...overrides,
  } as Request;
}

function fakeRes(): Response {
  const res: Partial<Response> = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  (res.status as jest.Mock).mockReturnValue(res);
  return res as Response;
}

describe("asyncHandler", () => {
  test("calls through on success (no error)", async () => {
    const handler = jest
      .fn<(_req: Request, _res: Response) => Promise<void>>()
      .mockResolvedValue(undefined);
    const wrapped = asyncHandler(handler);

    const req = fakeReq();
    const res = fakeRes();

    await wrapped(req, res, jest.fn());

    expect(handler).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  test("returns 500 on rejected promise", async () => {
    const handler = jest
      .fn<(_req: Request, _res: Response) => Promise<void>>()
      .mockRejectedValue(new Error("boom"));
    const wrapped = asyncHandler(handler);

    const req = fakeReq();
    const res = fakeRes();

    await wrapped(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      detail: "Error interno del servidor",
    });
  });

  test("forwards req params to inner handler", async () => {
    const handler = jest
      .fn<(_req: Request, _res: Response) => Promise<void>>()
      .mockResolvedValue(undefined);
    const wrapped = asyncHandler(handler);

    const req = fakeReq({ params: { id: "42" }, query: { q: "test" } });
    const res = fakeRes();

    await wrapped(req, res, jest.fn());

    expect(handler).toHaveBeenCalledWith(req, res);
  });
});
