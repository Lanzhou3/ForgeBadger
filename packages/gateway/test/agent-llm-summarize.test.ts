import assert from "node:assert/strict";
import { describe, it } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { ModelProviderRepository, type ProviderApiFormat } from "../src/db/repositories/model-provider-repository.js";
import { UserRepository } from "../src/db/repositories/user-repository.js";
import { createAgentLlmClient } from "../src/services/agent/llm-client.js";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  const migrationsFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/db/migrations");
  migrate(drizzle(db), { migrationsFolder });
  return db;
}

interface FetchCall {
  url: string;
  body: Record<string, unknown>;
}

function setupClient(db: Database.Database, apiFormat: ProviderApiFormat, response: unknown) {
  const user = new UserRepository(db).create("llm-summarize@example.com", "hash");
  const repo = new ModelProviderRepository(db, user.id, "abcdef0123456789abcdef0123456789");
  const provider = repo.createProviderProfile({
    name: "Test",
    providerKey: "test",
    baseUrl: "https://api.test.example",
    authType: "api_key",
    apiFormat,
    supportedAdapters: ["opencode"]
  });
  repo.createModelProfile({
    providerProfileId: provider.id,
    name: "Test model",
    modelId: "m1",
    capabilities: ["chat"],
    isDefault: true
  });
  repo.createCredential({ providerProfileId: provider.id, label: "key", plaintextSecret: "secret" });

  const calls: FetchCall[] = [];
  const client = createAgentLlmClient({
    modelProviderRepository: repo,
    resolveHost: async () => [{ address: "8.8.8.8", family: 4 }],
    fetchImpl: (async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse((init?.body as string | undefined) ?? "{}") as Record<string, unknown> });
      return { ok: true, status: 200, json: async () => response } as Response;
    }) as typeof fetch
  });
  return { client, calls };
}

describe("copilot llm summarize", () => {
  it("folds messages to a summary over the Anthropic wire format", async () => {
    const db = createTestDb();
    const { client, calls } = setupClient(db, "anthropic", {
      content: [{ type: "text", text: "SUMMED" }],
      stop_reason: "end_turn"
    });

    const result = await client.summarize({
      messages: [{ role: "user", content: "hello" }, { role: "assistant", content: "hi" }]
    });
    assert.equal(result, "SUMMED");
    assert.equal(calls.length, 1);
    const call = calls[0]!;
    assert.match(call.url, /\/v1\/messages$/);
    assert.match(call.body.system as string, /conversation summarizer/);
    assert.equal((call.body.messages as unknown[]).length, 2);
  });

  it("folds messages to a summary over the OpenAI wire format", async () => {
    const db = createTestDb();
    const { client, calls } = setupClient(db, "openai", {
      choices: [{ message: { content: "SUMMED", tool_calls: [] } }]
    });

    const result = await client.summarize({ messages: [{ role: "user", content: "hello" }] });
    assert.equal(result, "SUMMED");
    assert.equal(calls.length, 1);
    const call = calls[0]!;
    assert.match(call.url, /\/chat\/completions$/);
    const messages = call.body.messages as Array<{ role: string; content: string }>;
    assert.equal(messages[0]!.role, "system");
    assert.match(messages[0]!.content, /conversation summarizer/);
    assert.equal(messages[1]!.content, "hello");
  });
});
