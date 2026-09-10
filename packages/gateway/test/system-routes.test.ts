import assert from "node:assert/strict";
import { describe, it } from "node:test";
import express from "express";
import http from "node:http";
import { fileURLToPath } from "node:url";

import { signJwt } from "../src/auth/jwt.js";
import { createSystemRoutes } from "../src/routes/system.js";

const secret = "0123456789abcdef0123456789abcdef";

function startServer(platform: NodeJS.Platform, picker?: () => Promise<unknown>) {
  const app = express();
  app.locals.jwtSecret = secret;
  app.use(express.json());
  app.use(
    "/api/v1/system",
    createSystemRoutes({ platform, picker: picker as Parameters<typeof createSystemRoutes>[0]["picker"] })
  );
  const server = http.createServer(app);
  return new Promise<{ server: http.Server; baseUrl: string }>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as { port: number };
      resolve({ server, baseUrl: `http://127.0.0.1:${address.port}` });
    });
  });
}

function authHeader(): string {
  return `Bearer ${signJwt({ userId: "u1", email: "u1@example.com" }, secret)}`;
}

describe("system routes", () => {
  it("rejects unauthenticated desktop capability requests", async () => {
    const { server, baseUrl } = await startServer("win32");
    try {
      const res = await fetch(`${baseUrl}/api/v1/system/desktop`);
      assert.equal(res.status, 401);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("reports desktop capabilities with picker support on win32", async () => {
    const { server, baseUrl } = await startServer("win32");
    try {
      const res = await fetch(`${baseUrl}/api/v1/system/desktop`, {
        headers: { authorization: authHeader() }
      });
      assert.equal(res.status, 200);
      const body = (await res.json()) as { code: number; data: { platform: string; directoryPickerSupported: boolean } };
      assert.equal(body.code, 0);
      assert.equal(body.data.platform, "win32");
      assert.equal(body.data.directoryPickerSupported, true);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("reports directory picking as unsupported on linux", async () => {
    const { server, baseUrl } = await startServer("linux");
    try {
      const res = await fetch(`${baseUrl}/api/v1/system/desktop`, {
        headers: { authorization: authHeader() }
      });
      const body = (await res.json()) as { data: { directoryPickerSupported: boolean } };
      assert.equal(body.data.directoryPickerSupported, false);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("returns the picked path from the host dialog", async () => {
    const { server, baseUrl } = await startServer("win32", async () => ({
      supported: true,
      path: "D:\\workspace\\project",
      cancelled: false
    }));
    try {
      const res = await fetch(`${baseUrl}/api/v1/system/select-directory`, {
        method: "POST",
        headers: { authorization: authHeader() }
      });
      assert.equal(res.status, 200);
      const body = (await res.json()) as { code: number; data: { path?: string } };
      assert.equal(body.code, 0);
      assert.equal(body.data.path, "D:\\workspace\\project");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
