import assert from "node:assert/strict";
import express from "express";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, it } from "node:test";

import { signJwt } from "../src/auth/jwt.js";
import { UserRepository } from "../src/db/repositories/user-repository.js";
import { ModelProviderRepository } from "../src/db/repositories/model-provider-repository.js";
import { createCopilotRoutes } from "../src/routes/copilot.js";
import type { CopilotModelClient, CopilotModelRequest } from "../src/services/copilot/types.js";

const secret = "0123456789abcdef0123456789abcdef";
const masterKey = "abcdef0123456789abcdef0123456789";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  const drizzleDb = drizzle(db);
  const migrationsFolder = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../src/db/migrations"
  );
  migrate(drizzleDb, { migrationsFolder });
  return db;
}

describe("copilot routes", () => {
  let app: express.Express;
  let db: Database.Database;
  let token: string;
  let userId: string;
  const calls: CopilotModelRequest[] = [];

  beforeEach(() => {
    db = createTestDb();
    const user = new UserRepository(db).create("copilot-routes@example.com", "hash");
    userId = user.id;
    token = signJwt({ userId: user.id, email: user.email }, secret);
    calls.length = 0;
    app = express();
    app.locals.jwtSecret = secret;
    app.use(express.json());
    app.use("/api/v1/copilot", createCopilotRoutes({
      db,
      masterKey,
      modelClientFactory: () => fakeModelClient(calls)
    }));
  });

  it("returns Copilot capabilities with tools disabled", async () => {
    const res = await makeRequest(app, "GET", "/api/v1/copilot/capabilities", undefined, authHeaders());

    assert.equal(res.status, 200);
    assert.equal(res.body.code, 0);
    assert.deepEqual(res.body.data.supportedProviderFormats, ["openai", "openai-compatible", "anthropic"]);
    assert.equal(res.body.data.toolExecutionEnabled, false);
  });

  it("rejects unauthenticated run creation", async () => {
    const res = await makeRequest(app, "POST", "/api/v1/copilot/runs", { prompt: "Status?" });

    assert.equal(res.status, 401);
    assert.equal(res.body.code, 1);
  });

  it("rejects empty prompts", async () => {
    const res = await makeRequest(app, "POST", "/api/v1/copilot/runs", { prompt: "" }, authHeaders());

    assert.equal(res.status, 400);
    assert.equal(res.body.code, 1);
  });

  it("returns provider-not-configured when no compatible provider exists", async () => {
    const res = await makeRequest(app, "POST", "/api/v1/copilot/runs", { prompt: "Status?" }, authHeaders());

    assert.equal(res.status, 400);
    assert.equal(res.body.code, 1);
    assert.equal(res.body.details.code, "copilot_provider_not_configured");
  });

  it("creates a completed text run with assistant events", async () => {
    createOpenAiProvider();

    const res = await makeRequest(app, "POST", "/api/v1/copilot/runs", {
      prompt: "Summarize Gateway health",
      source: "dashboard"
    }, authHeaders());

    assert.equal(res.status, 201);
    assert.equal(res.body.code, 0);
    assert.equal(res.body.message, "");
    assert.equal(res.body.data.run.status, "completed");
    assert.equal(res.body.data.events[0].type, "assistant_message");
    assert.equal(res.body.data.events[0].message, "Gateway is healthy.");
    assert.equal(calls[0]?.input, "Summarize Gateway health");
  });

  function createOpenAiProvider(): void {
    const repo = new ModelProviderRepository(db, userId, masterKey);
    const provider = repo.createProviderProfile({
      providerKey: "openai",
      name: "OpenAI",
      baseUrl: "https://api.openai.com/v1",
      authType: "api_key",
      apiFormat: "openai",
      supportedAdapters: ["opencode"]
    });
    repo.createModelProfile({
      providerProfileId: provider.id,
      name: "GPT",
      modelId: "gpt-5.1",
      isDefault: true
    });
    repo.createCredential({
      providerProfileId: provider.id,
      plaintextSecret: "sk-openai"
    });
  }

  function authHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    };
  }
});

function fakeModelClient(calls: CopilotModelRequest[]): CopilotModelClient {
  return {
    async createResponse(request) {
      calls.push(request);
      return [{ type: "assistant_message", text: "Gateway is healthy." }];
    }
  };
}

async function makeRequest(
  app: express.Express,
  method: string,
  pathName: string,
  body?: unknown,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: any }> {
  const server = http.createServer(app);
  const baseUrl = await listen(server);
  try {
    const res = await fetch(`${baseUrl}${pathName}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    const responseBody = await res.json().catch(() => ({}));
    return { status: res.status, body: responseBody };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function listen(server: http.Server): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("No TCP address"));
        return;
      }
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}
