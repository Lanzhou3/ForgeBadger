import assert from "node:assert/strict";
import Database from "better-sqlite3";
import express from "express";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { ServerResponse } from "node:http";
import path from "node:path";
import { Readable } from "node:stream";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { Socket } from "node:net";

import { createGatewayApp } from "../src/server.js";
import { InMemoryApiKeyStore } from "../src/secrets/api-key-store.js";
import { OpenForgeEventBus } from "../src/services/event-bus.js";
import { InMemorySessionManager } from "../src/services/session-manager.js";
import type { TmuxClient } from "../src/services/tmux.js";

const masterKey = "abcdef0123456789abcdef0123456789";

describe("Gateway app auth secret injection", () => {
  it("verifies authenticated routes with the app jwt secret instead of process env", async () => {
    const injectedSecret = "injected-jwt-secret-0123456789abcdef";
    process.env.OPENFORGE_JWT_SECRET = "process-env-jwt-secret-0123456789";
    process.env.OPENFORGE_MASTER_KEY = masterKey;

    const db = createTestDb();
    const gateway = createGatewayApp({
      jwtSecret: injectedSecret,
      masterKey,
      db,
      sessionManager: new InMemorySessionManager(createMockTmuxClient()),
      apiKeyStore: new InMemoryApiKeyStore({ masterKey }),
      eventBus: new OpenForgeEventBus()
    });

    try {
      const registered = await makeRequest(gateway.app, "POST", "/api/v1/auth/register", {
        email: "injected-secret@example.com",
        password: "password123"
      });
      assert.equal(registered.status, 201);

      const token = registered.body.data.token;
      const me = await makeRequest(gateway.app, "GET", "/api/v1/auth/me", undefined, {
        authorization: `Bearer ${token}`
      });

      assert.equal(me.status, 200);
      assert.equal(me.body.code, 0);
      assert.equal(me.body.data.email, "injected-secret@example.com");
    } finally {
      await gateway.close();
    }
  });
});

function createTestDb(): Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  const drizzleDb = drizzle(db);
  const migrationsFolder = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../src/db/migrations"
  );
  migrate(drizzleDb, { migrationsFolder });
  return db;
}

function createMockTmuxClient(): TmuxClient {
  return {
    async createSession() {},
    async killSession() {},
    async capturePane() {
      return "";
    },
    async listSessions() {
      return [];
    }
  };
}

async function makeRequest(
  app: express.Express,
  method: string,
  url: string,
  body?: unknown,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = new Readable({ read() {} }) as Readable & {
      method?: string;
      url?: string;
      headers: Record<string, string>;
      socket: Socket;
      connection: Socket;
    };
    req.method = method;
    req.url = url;
    req.headers = {
      ...headers,
      ...(payload === undefined
        ? {}
        : {
            "content-type": "application/json",
            "content-length": String(Buffer.byteLength(payload))
          })
    };
    const socket = new Socket();
    req.socket = socket;
    req.connection = socket;
    if (payload !== undefined) {
      req.push(payload);
    }
    req.push(null);

    const res = new ServerResponse(req);
    const chunks: Buffer[] = [];
    res.write = (chunk: string | Buffer) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      return true;
    };
    res.end = (chunk?: string | Buffer) => {
      if (chunk) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const rawBody = Buffer.concat(chunks).toString("utf8");
      resolve({
        status: res.statusCode,
        body: rawBody ? JSON.parse(rawBody) : undefined
      });
      return res;
    };

    app.handle(req, res, reject);
  });
}
