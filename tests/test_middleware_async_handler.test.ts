/**
 * Unit tests for src/middleware/async-handler.ts
 */
import { jest } from "@jest/globals";
import { asyncHandler } from "../src/middleware/async-handler.js";
import type { Request, Response, NextFunction } from "express";

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

function fakeNext(): NextFunction {
  return jest.fn() as unknown as NextFunction;
}

describe("asyncHandler", () => {
  test("calls through on success (no error, next not invoked)", async () => {
    const handler = jest
      .fn<(_req: Request, _res: Response) => Promise<void>>()
      .mockResolvedValue(undefined);
    const wrapped = asyncHandler(handler);

    const req = fakeReq();
    const res = fakeRes();
    const next = fakeNext();

    await wrapped(req, res, next);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  test("forwards rejected promise to next(err)", async () => {
    const boom = new Error("boom");
    const handler = jest
      .fn<(_req: Request, _res: Response) => Promise<void>>()
      .mockRejectedValue(boom);
    const wrapped = asyncHandler(handler);

    const req = fakeReq();
    const res = fakeRes();
    const next = fakeNext();

    await wrapped(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith(boom);
    // asyncHandler must NOT respond directly — classification is the error
    // middleware's job.
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  test("forwards req params to inner handler", async () => {
    const handler = jest
      .fn<(_req: Request, _res: Response) => Promise<void>>()
      .mockResolvedValue(undefined);
    const wrapped = asyncHandler(handler);

    const req = fakeReq({ params: { id: "42" }, query: { q: "test" } });
    const res = fakeRes();
    const next = fakeNext();

    await wrapped(req, res, next);

    expect(handler).toHaveBeenCalledWith(req, res);
  });
});
