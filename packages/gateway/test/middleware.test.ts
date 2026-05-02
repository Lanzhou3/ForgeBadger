import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ZodError, z } from "zod";
import type { Request, Response, NextFunction } from "express";

import { errorHandler } from "../src/middleware/error-handler.js";
import { validate } from "../src/middleware/validate.js";
import {
  AuthenticationError,
  NotFoundError,
  ConflictError,
  ValidationError
} from "../src/middleware/errors.js";

function fakeResponse(): Response {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    }
  };
  return res as unknown as Response;
}

function fakeRequest(body?: unknown): Request {
  return { body } as Request;
}

describe("errorHandler", () => {
  it("returns 422 for ZodError", () => {
    const err = new ZodError([
      { message: "Required", path: ["email"], code: "invalid_type" }
    ]);
    const req = fakeRequest();
    const res = fakeResponse();

    errorHandler(err, req, res, () => {});

    assert.equal(res.statusCode, 422);
    assert.deepEqual((res.body as any).code, 1);
    assert.equal((res.body as any).message, "Validation failed");
    assert.ok(Array.isArray((res.body as any).details));
  });

  it("returns 401 for AuthenticationError", () => {
    const err = new AuthenticationError("bad token");
    const req = fakeRequest();
    const res = fakeResponse();

    errorHandler(err, req, res, () => {});

    assert.equal(res.statusCode, 401);
    assert.deepEqual(res.body, { code: 1, message: "Unauthorized" });
  });

  it("returns 404 for NotFoundError", () => {
    const err = new NotFoundError("missing");
    const req = fakeRequest();
    const res = fakeResponse();

    errorHandler(err, req, res, () => {});

    assert.equal(res.statusCode, 404);
    assert.deepEqual(res.body, { code: 1, message: "Not found" });
  });

  it("returns 409 for ConflictError", () => {
    const err = new ConflictError("already exists");
    const req = fakeRequest();
    const res = fakeResponse();

    errorHandler(err, req, res, () => {});

    assert.equal(res.statusCode, 409);
    assert.deepEqual(res.body, { code: 1, message: "Conflict" });
  });

  it("returns 422 for ValidationError", () => {
    const err = new ValidationError("bad input");
    const req = fakeRequest();
    const res = fakeResponse();

    errorHandler(err, req, res, () => {});

    assert.equal(res.statusCode, 422);
    assert.deepEqual(res.body, { code: 1, message: "bad input" });
  });

  it("returns 500 for unknown errors without leaking details in production", () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";

    const err = new Error("secret stack trace");
    const req = fakeRequest();
    const res = fakeResponse();

    errorHandler(err, req, res, () => {});

    assert.equal(res.statusCode, 500);
    assert.deepEqual(res.body, { code: 1, message: "Internal server error" });

    process.env.NODE_ENV = originalEnv;
  });

  it("includes stack trace in development", () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";

    const err = new Error("something broke");
    const req = fakeRequest();
    const res = fakeResponse();

    errorHandler(err, req, res, () => {});

    assert.equal(res.statusCode, 500);
    assert.equal((res.body as any).code, 1);
    assert.equal((res.body as any).message, "Internal server error");
    assert.ok(typeof (res.body as any).details?.stack === "string");

    process.env.NODE_ENV = originalEnv;
  });
});

describe("validate middleware", () => {
  const schema = z.object({
    email: z.string().email(),
    name: z.string().min(1)
  });

  it("rejects invalid input and passes ValidationError to next", () => {
    const middleware = validate(schema);
    const req = fakeRequest({ email: "not-an-email", name: "" });
    const res = fakeResponse();
    let nextArg: unknown;

    const next: NextFunction = (arg: unknown) => {
      nextArg = arg;
    };
    middleware(req, res, next);

    assert.ok(nextArg instanceof ValidationError);
  });

  it("passes valid input to next without error", () => {
    const middleware = validate(schema);
    const req = fakeRequest({ email: "test@example.com", name: "Test" });
    const res = fakeResponse();
    let nextCalled = false;
    let nextArg: unknown;

    const next: NextFunction = (arg?: unknown) => {
      nextCalled = true;
      nextArg = arg;
    };
    middleware(req, res, next);

    assert.equal(nextCalled, true);
    assert.equal(nextArg, undefined);
  });
});
