import assert from "node:assert/strict";
import { describe, it } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { ModelProviderRepository, type ProviderApiFormat } from "../src/db/repositories/model-provider-repository.js";
import { UserRepository } from "../src/db/repositories/user-repository.js";
import { createAgentLlmClient, type AgentLlmStreamEvent } from "../src/services/agent/llm-client.js";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  const migrationsFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/db/migrations");
  migrate(drizzle(db), { migrationsFolder });
  return db;
}

function setupClient(db: Database.Database, apiFormat: ProviderApiFormat, response: unknown) {
  const user = new UserRepository(db).create("thinking@example.com", "hash");
  const repo = new ModelProviderRepository(db, user.id, "abcdef0123456789abcdef0123456789");
  const provider = repo.createProviderProfile({
    name: "Stub",
    providerKey: "stub",
    baseUrl: "https://stub.example",
    authType: "api_key",
    apiFormat,
    supportedAdapters: ["opencode"]
  });
  repo.createModelProfile({
    providerProfileId: provider.id,
    name: "Stub model",
    modelId: "stub-model",
    capabilities: ["chat"],
    isDefault: true
  });
  repo.createCredential({ providerProfileId: provider.id, label: "key", plaintextSecret: "secret" });

  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
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

describe("copilot llm thinking", () => {
  it("surfaces Anthropic thinking blocks as their own thinking_delta", async () => {
    const db = createTestDb();
    const { client } = setupClient(db, "anthropic", {
      content: [
        { type: "thinking", thinking: "the user wants X so I should reason about Y" },
        { type: "text", text: "Here is the answer." }
      ],
      stop_reason: "end_turn"
    });

    const events: AgentLlmStreamEvent[] = [];
    await client.stream({
      messages: [{ role: "user", content: "question" }],
      tools: [],
      onEvent: (event) => events.push(event)
    });

    const types = events.map((event) => event.type);
    assert.deepEqual(types, ["thinking_delta", "text_delta", "done"]);
    const thinking = events.find((event) => event.type === "thinking_delta");
    const text = events.find((event) => event.type === "text_delta");
    assert.equal(thinking?.text, "the user wants X so I should reason about Y");
    assert.equal(text?.text, "Here is the answer.");
  });

  it("surfaces OpenAI reasoning_content as a thinking_delta separate from the answer", async () => {
    const db = createTestDb();
    const { client } = setupClient(db, "openai", {
      choices: [
        {
          message: {
            reasoning_content: "reasoning step 1\nreasoning step 2",
            content: "final answer",
            tool_calls: []
          }
        }
      ]
    });

    const events: AgentLlmStreamEvent[] = [];
    await client.stream({
      messages: [{ role: "user", content: "question" }],
      tools: [],
      onEvent: (event) => events.push(event)
    });

    const types = events.map((event) => event.type);
    assert.deepEqual(types, ["thinking_delta", "text_delta", "done"]);
    const thinking = events.find((event) => event.type === "thinking_delta");
    const text = events.find((event) => event.type === "text_delta");
    assert.equal(thinking?.text, "reasoning step 1\nreasoning step 2");
    assert.equal(text?.text, "final answer");
  });

  it("does not emit a thinking_delta when the provider returns no reasoning content", async () => {
    const db = createTestDb();
    const { client } = setupClient(db, "anthropic", {
      content: [{ type: "text", text: "just an answer" }],
      stop_reason: "end_turn"
    });

    const events: AgentLlmStreamEvent[] = [];
    await client.stream({
      messages: [{ role: "user", content: "question" }],
      tools: [],
      onEvent: (event) => events.push(event)
    });

    const types = events.map((event) => event.type);
    assert.deepEqual(types, ["text_delta", "done"]);
    assert.equal(events.some((event) => event.type === "thinking_delta"), false);
  });
});

for (const format of ["anthropic", "openai"] as const) {
  it(`preserves correlated tool batches in ${format} requests`, async () => {
    const db = createTestDb();
    try {
      const { client, calls } = setupClient(db, format, format === "openai" ? { choices: [{ message: { content: "okay" } }] } : { content: [{ type: "text", text: "okay" }] });
      await client.stream({ messages: [
        { role: "user", content: "inspect" },
        { role: "assistant", content: "checking", toolCalls: [
          { id: "a", name: "read_a", arguments: "{}" },
          { id: "b", name: "read_b", arguments: "{}" }
        ] },
        { role: "tool", toolCallId: "a", content: "result a" },
        { role: "tool", toolCallId: "b", content: "result b" }
      ], tools: [], onEvent() {} });
      const body = calls[0]!.body;
      assert.equal("max_steps" in body, false, "Agent step budgets are not provider request fields");
      const messages = body.messages as Array<Record<string, unknown>>;
      if (format === "openai") {
        assert.equal(messages[0]?.role, "system");
        assert.match(String(messages[0]?.content), /ForgeBadger/);
        assert.equal(messages[3]?.tool_call_id, "a");
        assert.equal(messages[4]?.tool_call_id, "b");
      } else {
        assert.deepEqual(messages[1]?.content, [
          { type: "text", text: "checking" },
          { type: "tool_use", id: "a", name: "read_a", input: {} },
          { type: "tool_use", id: "b", name: "read_b", input: {} }
        ]);
        assert.deepEqual(messages[2], { role: "user", content: [
          { type: "tool_result", tool_use_id: "a", content: "result a" },
          { type: "tool_result", tool_use_id: "b", content: "result b" }
        ] });
      }
    } finally { db.close(); }
  });
}

it("removes abort listeners after completion and avoids sending pre-cancelled requests", async () => {
  const { getEventListeners } = await import("node:events");
  const db = createTestDb();
  try {
    const { client, calls } = setupClient(db, "openai", { choices: [{ message: { content: "okay" } }] });
    const controller = new AbortController();
    await client.stream({ messages: [{ role: "user", content: "hi" }], tools: [], signal: controller.signal, onEvent() {} });
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
    controller.abort();
    await assert.rejects(client.stream({ messages: [], tools: [], signal: controller.signal, onEvent() {} }));
    assert.equal(calls.length, 1);
  } finally { db.close(); }
});

describe("copilot llm preferences", () => {
  const openaiResponse = { choices: [{ message: { content: "okay" } }] };
  const anthropicResponse = { content: [{ type: "text", text: "okay" }], stop_reason: "end_turn" };

  async function setupPreferenceClient(db: Database.Database, apiFormat: ProviderApiFormat, response: unknown, fetchImplOverride?: typeof fetch) {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const user = new UserRepository(db).create("preference@example.com", "hash");
    const repo = new ModelProviderRepository(db, user.id, "abcdef0123456789abcdef0123456789");
    const provider = repo.createProviderProfile({
      name: "Stub",
      providerKey: "stub",
      baseUrl: "https://stub.example",
      authType: "api_key",
      apiFormat,
      supportedAdapters: ["opencode"],
    });
    const defaultProfile = repo.createModelProfile({
      providerProfileId: provider.id,
      name: "Stub model",
      modelId: "stub-model",
      capabilities: ["chat"],
      isDefault: true,
    });
    const preferredProfile = repo.createModelProfile({
      providerProfileId: provider.id,
      name: "Preferred model",
      modelId: "preferred-model",
      capabilities: ["chat"],
      isDefault: false,
    });
    repo.createCredential({ providerProfileId: provider.id, label: "key", plaintextSecret: "secret" });
    const { CopilotPreferencesRepository } = await import("../src/db/repositories/copilot-preferences-repository.js");
    const preferences = new CopilotPreferencesRepository(db, user.id);
    const client = createAgentLlmClient({
      modelProviderRepository: repo,
      preferences,
      resolveHost: async () => [{ address: "8.8.8.8", family: 4 }],
      fetchImpl: fetchImplOverride ?? ((async (url: string, init?: RequestInit) => {
        calls.push({ url: String(url), body: JSON.parse((init?.body as string | undefined) ?? "{}") });
        return { ok: true, status: 200, json: async () => response } as Response;
      }) as typeof fetch),
    });
    return { client, calls, preferences, defaultProfile, preferredProfile };
  }

  it("uses the default model until a thinking preference is stored, then sends it", async () => {
    const db = createTestDb();
    try {
      const { client, calls, preferences } = await setupPreferenceClient(db, "openai", openaiResponse);
      await client.stream({ messages: [{ role: "user", content: "hello" }], tools: [], onEvent: () => {} });
      assert.equal(calls[0]!.body.model, "stub-model");
      assert.ok(!("reasoning_effort" in calls[0]!.body), "no thinking params before any preference is stored");
      preferences.set({ thinkingEffort: "medium" });
      await client.stream({ messages: [{ role: "user", content: "hello again" }], tools: [], onEvent: () => {} });
      assert.equal(calls[1]!.body.model, "stub-model");
      assert.equal(calls[1]!.body.reasoning_effort, "medium");
    } finally {
      db.close();
    }
  });

  it("summarize prefers the user model but omits thinking params", async () => {
    const db = createTestDb();
    try {
      const { client, calls, preferences, preferredProfile } = await setupPreferenceClient(db, "openai", openaiResponse);
      preferences.set({ modelId: preferredProfile.id, thinkingEffort: "high" });
      const text = await client.summarize({ messages: [{ role: "user", content: "summarize me" }] });
      assert.equal(text, "okay");
      assert.equal(calls[0]!.body.model, "preferred-model");
      assert.ok(!("reasoning_effort" in calls[0]!.body), "summarize must not forward thinking params");
    } finally {
      db.close();
    }
  });

  it("maps anthropic thinking effort to a budget and raises max_tokens", async () => {
    const db = createTestDb();
    try {
      const { client, calls, preferences } = await setupPreferenceClient(db, "anthropic", anthropicResponse);
      preferences.set({ thinkingEffort: "low" });
      await client.stream({ messages: [{ role: "user", content: "think" }], tools: [], onEvent: () => {} });
      assert.deepEqual(calls[0]!.body.thinking, { type: "enabled", budget_tokens: 2048 });
      assert.equal(calls[0]!.body.max_tokens, 10240);
      preferences.set({ thinkingEffort: "high" });
      await client.stream({ messages: [{ role: "user", content: "think harder" }], tools: [], onEvent: () => {} });
      assert.deepEqual(calls[1]!.body.thinking, { type: "enabled", budget_tokens: 8192 });
      assert.equal(calls[1]!.body.max_tokens, 16384);
    } finally {
      db.close();
    }
  });

  it("prefers the user model over the default when no modelId is requested", async () => {
    const db = createTestDb();
    try {
      const { client, calls, preferences, preferredProfile } = await setupPreferenceClient(db, "openai", openaiResponse);
      preferences.set({ modelId: preferredProfile.id });
      await client.stream({ messages: [{ role: "user", content: "hello" }], tools: [], onEvent: () => {} });
      assert.equal(calls[0]!.body.model, "preferred-model");
    } finally {
      db.close();
    }
  });

  it("falls back to the default model when the preferred profile is inactive", async () => {
    const db = createTestDb();
    try {
      const { client, calls, preferences, preferredProfile, defaultProfile } = await setupPreferenceClient(db, "openai", openaiResponse);
      preferences.set({ modelId: preferredProfile.id });
      db.prepare("UPDATE model_profiles SET status = 'inactive' WHERE id = ?").run(preferredProfile.id);
      await client.stream({ messages: [{ role: "user", content: "hello" }], tools: [], onEvent: () => {} });
      assert.equal(calls[0]!.body.model, defaultProfile.modelId);
    } finally {
      db.close();
    }
  });

  it("keeps an explicit request modelId in front of the stored preference", async () => {
    const db = createTestDb();
    try {
      const { client, calls, preferences, preferredProfile, defaultProfile } = await setupPreferenceClient(db, "openai", openaiResponse);
      preferences.set({ modelId: preferredProfile.id });
      await client.stream({ messages: [{ role: "user", content: "hello" }], modelId: defaultProfile.id, tools: [], onEvent: () => {} });
      assert.equal(calls[0]!.body.model, defaultProfile.modelId);
    } finally {
      db.close();
    }
  });

  it("retries once with thinking disabled when the provider 400s on thinking params", async () => {
    const db = createTestDb();
    try {
      const { client, calls, preferences } = await setupPreferenceClient(db, "openai", openaiResponse, ((url: string, init?: RequestInit) => {
        const body = JSON.parse((init?.body as string | undefined) ?? "{}");
        calls.push({ url: String(url), body });
        // First attempt carries reasoning_effort and the stub model rejects it;
        // the degraded retry (no thinking params) succeeds.
        if (body.reasoning_effort !== undefined) {
          return Promise.resolve({ ok: false, status: 400, json: async () => ({ error: "reasoning_effort is not supported" }) } as Response);
        }
        return Promise.resolve({ ok: true, status: 200, json: async () => openaiResponse } as Response);
      }) as typeof fetch);
      preferences.set({ thinkingEffort: "high" });
      const result = await client.stream({ messages: [{ role: "user", content: "think" }], tools: [], onEvent: () => {} });
      assert.equal(result.message, "okay");
      assert.equal(calls.length, 2);
      assert.equal(calls[0]!.body.reasoning_effort, "high");
      assert.ok(!("reasoning_effort" in calls[1]!.body), "retry must not forward thinking params");
    } finally {
      db.close();
    }
  });
});
