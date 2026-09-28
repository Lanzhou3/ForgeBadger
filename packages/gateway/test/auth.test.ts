import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  authenticate,
  requireAuth,
  signJwt,
  verifyJwt,
  decodeJwt
} from "../src/auth/index.js";

const secret = "0123456789abcdef0123456789abcdef";

process.env.FORGEBADGER_JWT_SECRET = secret;
process.env.FORGEBADGER_MASTER_KEY = "abcdef0123456789abcdef0123456789";

describe("jwt auth", () => {
  it("signs and verifies a token to user id and email", () => {
    const token = signJwt({ userId: "user_123", email: "test@example.com" }, secret);
    assert.deepEqual(verifyJwt(token, secret), { userId: "user_123", email: "test@example.com" });
  });

  it("rejects tampered tokens", () => {
    const token = signJwt({ userId: "user_123", email: "test@example.com" }, secret);
    const tampered = `${token.slice(0, -1)}x`;

    assert.throws(() => verifyJwt(tampered, secret), /invalid|signature/i);
  });

  it("rejects alg none tokens", () => {
    const header = base64UrlJson({ alg: "none", typ: "JWT" });
    const payload = base64UrlJson({ sub: "user_123", exp: unixNow() + 60 });

    assert.throws(() => verifyJwt(`${header}.${payload}.`, secret), /signature|algorithm|alg/i);
  });

  it("decodes a token without verifying", () => {
    const token = signJwt({ userId: "user_123", email: "test@example.com" }, secret);
    assert.deepEqual(decodeJwt(token), { userId: "user_123", email: "test@example.com" });
    assert.equal(decodeJwt("invalid"), null);
  });
});

describe("authenticate middleware", () => {
  it("injects authenticated user id from bearer token", () => {
    const token = signJwt({ userId: "user_123", email: "test@example.com" }, secret);
    const middleware = requireAuth();
    const request = {
      headers: { authorization: `Bearer ${token}` },
      app: { locals: { jwtSecret: secret } }
    } as any;
    const response = fakeResponse();
    let nextCalled = false;

    middleware(request, response as any, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, true);
    assert.equal(request.userId, "user_123");
  });

  it("rejects missing bearer tokens", () => {
    const middleware = requireAuth();
    const request = { headers: {} } as any;
    const response = fakeResponse();

    middleware(request, response as any, () => {
      throw new Error("next should not be called");
    });

    assert.equal(response.statusCode, 401);
    assert.deepEqual(response.body, { code: 1, message: "Unauthorized" });
  });

  it("rejects invalid bearer tokens", () => {
    const middleware = requireAuth();
    const request = { headers: { authorization: "Bearer invalid" } } as any;
    const response = fakeResponse();

    middleware(request, response as any, () => {
      throw new Error("next should not be called");
    });

    assert.equal(response.statusCode, 401);
    assert.deepEqual(response.body, { code: 1, message: "Unauthorized" });
  });

  it("rejects retired auth cookie names", () => {
    const token = signJwt({ userId: "user_old", email: "old@example.com" }, secret);
    const middleware = requireAuth();
    const request = { headers: { cookie: `old_product_session=${token}` } } as any;
    const response = fakeResponse();
    let nextCalled = false;

    middleware(request, response as any, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, false);
    assert.equal(response.statusCode, 401);
  });
});

function unixNow(): number {
  return Math.floor(Date.now() / 1000);
}

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function fakeResponse() {
  return {
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
}
