import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { UserRepository } from "../src/db/repositories/user-repository.js";
import { ModelProviderRepository, type ProviderApiFormat } from "../src/db/repositories/model-provider-repository.js";
import { selectCopilotProvider } from "../src/services/copilot/provider-selection.js";
import { OpenAiResponsesClient } from "../src/services/copilot/openai-responses-client.js";
import { AnthropicMessagesClient } from "../src/services/copilot/anthropic-messages-client.js";
import { redactCopilotText } from "../src/services/copilot/redaction.js";

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

describe("copilot model client", () => {
  let db: Database.Database;
  let userId: string;

  beforeEach(() => {
    db = createTestDb();
    userId = new UserRepository(db).create("copilot-model@example.com", "hash").id;
  });

  it("selects OpenAI Responses for OpenAI providers", () => {
    const setup = createProvider("openai", "openai");

    const result = selectCopilotProvider({
      db,
      userId,
      masterKey,
      providerProfileId: setup.providerId,
      modelProfileId: setup.modelId
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.selection.format, "openai");
    assert.equal(result.selection.clientKind, "openai-responses");
    assert.equal(result.selection.apiKey, "sk-openai");
  });

  it("requires explicit policy opt-in for OpenAI-compatible providers", () => {
    const setup = createProvider("deepseek", "openai-compatible");

    const denied = selectCopilotProvider({
      db,
      userId,
      masterKey,
      providerProfileId: setup.providerId,
      modelProfileId: setup.modelId
    });
    const allowed = selectCopilotProvider({
      db,
      userId,
      masterKey,
      providerProfileId: setup.providerId,
      modelProfileId: setup.modelId,
      allowOpenAiCompatible: true
    });

    assert.equal(denied.ok, false);
    assert.equal(denied.error.code, "copilot_provider_unsupported");
    assert.equal(allowed.ok, true);
    if (!allowed.ok) return;
    assert.equal(allowed.selection.clientKind, "openai-responses");
  });

  it("selects Anthropic Messages for Anthropic providers", () => {
    const setup = createProvider("anthropic", "anthropic");

    const result = selectCopilotProvider({
      db,
      userId,
      masterKey,
      providerProfileId: setup.providerId,
      modelProfileId: setup.modelId
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.selection.format, "anthropic");
    assert.equal(result.selection.clientKind, "anthropic-messages");
  });

  it("returns provider-not-configured when credentials are missing", () => {
    const setup = createProvider("openai", "openai", { withCredential: false });

    const result = selectCopilotProvider({
      db,
      userId,
      masterKey,
      providerProfileId: setup.providerId,
      modelProfileId: setup.modelId
    });

    assert.equal(result.ok, false);
    assert.equal(result.error.code, "copilot_provider_not_configured");
  });

  it("skips uncredentialed default providers when another compatible provider is ready", () => {
    createProvider("openai", "openai", { isDefault: true, withCredential: false });
    const ready = createProvider("anthropic", "anthropic", { isDefault: false });

    const result = selectCopilotProvider({
      db,
      userId,
      masterKey
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.selection.provider.id, ready.providerId);
    assert.equal(result.selection.model.id, ready.modelId);
    assert.equal(result.selection.clientKind, "anthropic-messages");
    assert.equal(result.selection.apiKey, "sk-ant");
  });

  it("does not use Codex subscription identity for Copilot credentials", () => {
    const setup = createProvider("openai", "openai", { withCredential: false });

    const result = selectCopilotProvider({
      db,
      userId,
      masterKey,
      providerProfileId: setup.providerId,
      modelProfileId: setup.modelId
    });

    assert.equal(result.ok, false);
    assert.equal(result.error.code, "copilot_provider_not_configured");
  });

  it("normalizes OpenAI Responses text output", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const client = new OpenAiResponsesClient({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-openai",
      fetch: fakeFetch(requests, { output_text: "Gateway is healthy." })
    });

    const events = await client.createResponse({
      model: "gpt-5.1",
      instructions: "Answer as OpenForge Copilot.",
      input: "Status?",
      maxOutputTokens: 128
    });

    assert.deepEqual(events, [{ type: "assistant_message", text: "Gateway is healthy." }]);
    assert.equal(requests[0]?.url, "https://api.openai.com/v1/responses");
    assert.equal((requests[0]?.init.headers as Record<string, string>).Authorization, "Bearer sk-openai");
  });

  it("serializes OpenAI Responses tools as function definitions", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const client = new OpenAiResponsesClient({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-openai",
      fetch: fakeFetch(requests, { output_text: "Ready." })
    });

    await client.createResponse({
      model: "gpt-5.1",
      instructions: "Answer as OpenForge Copilot.",
      input: "Status?",
      tools: [{
        name: "openforge.get_dashboard_summary",
        description: "Read dashboard health.",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false
        }
      }]
    });

    const body = JSON.parse(String(requests[0]?.init.body)) as { tools: unknown[] };
    assert.deepEqual(body.tools, [{
      type: "function",
      name: "openforge__dot__get_dashboard_summary",
      description: "Read dashboard health.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false
      },
      strict: false
    }]);
  });

  it("passes abort signals through to OpenAI Responses fetch", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const controller = new AbortController();
    const client = new OpenAiResponsesClient({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-openai",
      fetch: fakeFetch(requests, { output_text: "Ready." })
    });

    await client.createResponse({
      model: "gpt-5.1",
      instructions: "Answer as OpenForge Copilot.",
      input: "Status?"
    }, { signal: controller.signal });

    assert.equal(requests[0]?.init.signal, controller.signal);
  });

  it("classifies OpenAI provider HTTP failures without leaking provider error secrets", async () => {
    const authFailure = new OpenAiResponsesClient({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-openai",
      fetch: fakeFetch([], {
        error: { message: "Invalid API key token=secret-value" }
      }, 401)
    });
    const rateLimit = new OpenAiResponsesClient({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-openai",
      fetch: fakeFetch([], {
        error: { message: "Rate limit exceeded" }
      }, 429)
    });
    const unavailable = new OpenAiResponsesClient({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-openai",
      fetch: fakeFetch([], {
        error: { message: "Upstream overloaded" }
      }, 503)
    });

    const authEvents = await authFailure.createResponse({
      model: "gpt-5.1",
      instructions: "Answer as OpenForge Copilot.",
      input: "Status?"
    });
    const rateEvents = await rateLimit.createResponse({
      model: "gpt-5.1",
      instructions: "Answer as OpenForge Copilot.",
      input: "Status?"
    });
    const unavailableEvents = await unavailable.createResponse({
      model: "gpt-5.1",
      instructions: "Answer as OpenForge Copilot.",
      input: "Status?"
    });

    assert.deepEqual(authEvents, [{
      type: "run_failed",
      code: "copilot_provider_auth_failed",
      message: "Invalid API key token=[REDACTED]"
    }]);
    assert.equal(rateEvents[0]?.type, "run_failed");
    assert.equal(rateEvents[0]?.code, "copilot_provider_rate_limited");
    assert.equal(unavailableEvents[0]?.type, "run_failed");
    assert.equal(unavailableEvents[0]?.code, "copilot_provider_unavailable");
    assert.doesNotMatch(JSON.stringify([authEvents, rateEvents, unavailableEvents]), /secret-value/);
  });

  it("normalizes Anthropic Messages text output", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const client = new AnthropicMessagesClient({
      baseUrl: "https://api.anthropic.com",
      apiKey: "sk-ant",
      fetch: fakeFetch(requests, {
        content: [{ type: "text", text: "Gateway is healthy." }]
      })
    });

    const events = await client.createResponse({
      model: "claude-sonnet-4-5",
      instructions: "Answer as OpenForge Copilot.",
      input: "Status?",
      maxOutputTokens: 128
    });

    assert.deepEqual(events, [{ type: "assistant_message", text: "Gateway is healthy." }]);
    assert.equal(requests[0]?.url, "https://api.anthropic.com/v1/messages");
    assert.equal((requests[0]?.init.headers as Record<string, string>)["x-api-key"], "sk-ant");
  });

  it("serializes Anthropic Messages tools with input_schema", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const client = new AnthropicMessagesClient({
      baseUrl: "https://api.anthropic.com",
      apiKey: "sk-ant",
      fetch: fakeFetch(requests, {
        content: [{ type: "text", text: "Ready." }]
      })
    });

    await client.createResponse({
      model: "claude-sonnet-4-5",
      instructions: "Answer as OpenForge Copilot.",
      input: "Status?",
      tools: [{
        name: "openforge.get_dashboard_summary",
        description: "Read dashboard health.",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false
        }
      }]
    });

    const body = JSON.parse(String(requests[0]?.init.body)) as { tools: unknown[] };
    assert.deepEqual(body.tools, [{
      name: "openforge__dot__get_dashboard_summary",
      description: "Read dashboard health.",
      input_schema: {
        type: "object",
        properties: {},
        additionalProperties: false
      }
    }]);
  });

  it("passes abort signals through to Anthropic Messages fetch", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const controller = new AbortController();
    const client = new AnthropicMessagesClient({
      baseUrl: "https://api.anthropic.com",
      apiKey: "sk-ant",
      fetch: fakeFetch(requests, {
        content: [{ type: "text", text: "Ready." }]
      })
    });

    await client.createResponse({
      model: "claude-sonnet-4-5",
      instructions: "Answer as OpenForge Copilot.",
      input: "Status?"
    }, { signal: controller.signal });

    assert.equal(requests[0]?.init.signal, controller.signal);
  });

  it("classifies Anthropic provider HTTP failures without leaking provider error secrets", async () => {
    const authFailure = new AnthropicMessagesClient({
      baseUrl: "https://api.anthropic.com",
      apiKey: "sk-ant",
      fetch: fakeFetch([], {
        error: { message: "Permission denied api_key: visible-secret" }
      }, 403)
    });
    const rateLimit = new AnthropicMessagesClient({
      baseUrl: "https://api.anthropic.com",
      apiKey: "sk-ant",
      fetch: fakeFetch([], {
        error: { message: "Too many requests" }
      }, 429)
    });
    const unavailable = new AnthropicMessagesClient({
      baseUrl: "https://api.anthropic.com",
      apiKey: "sk-ant",
      fetch: fakeFetch([], {
        error: { message: "Service unavailable" }
      }, 500)
    });

    const authEvents = await authFailure.createResponse({
      model: "claude-sonnet-4-5",
      instructions: "Answer as OpenForge Copilot.",
      input: "Status?"
    });
    const rateEvents = await rateLimit.createResponse({
      model: "claude-sonnet-4-5",
      instructions: "Answer as OpenForge Copilot.",
      input: "Status?"
    });
    const unavailableEvents = await unavailable.createResponse({
      model: "claude-sonnet-4-5",
      instructions: "Answer as OpenForge Copilot.",
      input: "Status?"
    });

    assert.deepEqual(authEvents, [{
      type: "run_failed",
      code: "copilot_provider_auth_failed",
      message: "Permission denied api_key: [REDACTED]"
    }]);
    assert.equal(rateEvents[0]?.type, "run_failed");
    assert.equal(rateEvents[0]?.code, "copilot_provider_rate_limited");
    assert.equal(unavailableEvents[0]?.type, "run_failed");
    assert.equal(unavailableEvents[0]?.code, "copilot_provider_unavailable");
    assert.doesNotMatch(JSON.stringify([authEvents, rateEvents, unavailableEvents]), /visible-secret/);
  });

  it("normalizes provider-safe tool names back to OpenForge tool names", async () => {
    const openAiClient = new OpenAiResponsesClient({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-openai",
      fetch: fakeFetch([], {
        output: [{
          type: "function_call",
          call_id: "call-1",
          name: "openforge__dot__memory_search",
          arguments: "{\"query\":\"release gates\"}"
        }]
      })
    });
    const anthropicClient = new AnthropicMessagesClient({
      baseUrl: "https://api.anthropic.com",
      apiKey: "sk-ant",
      fetch: fakeFetch([], {
        content: [{
          type: "tool_use",
          id: "toolu-1",
          name: "openforge__dot__memory_get",
          input: { id: "memory-1" }
        }]
      })
    });

    assert.deepEqual(await openAiClient.createResponse({
      model: "gpt-5.1",
      instructions: "Answer as OpenForge Copilot.",
      input: "Search memory"
    }), [{
      type: "tool_call_requested",
      id: "call-1",
      name: "openforge.memory_search",
      input: { query: "release gates" }
    }]);
    assert.deepEqual(await anthropicClient.createResponse({
      model: "claude-sonnet-4-5",
      instructions: "Answer as OpenForge Copilot.",
      input: "Get memory"
    }), [{
      type: "tool_call_requested",
      id: "toolu-1",
      name: "openforge.memory_get",
      input: { id: "memory-1" }
    }]);
  });

  it("redacts common credential forms without removing normal project names", () => {
    const text = [
      "Bearer abc.def.ghi",
      "sk-test123456789",
      "OPENFORGE_ATTACH_TOKEN=attach-secret",
      "api_key: visible-secret",
      "project OpenForge"
    ].join("\n");

    const redacted = redactCopilotText(text);

    assert.match(redacted, /Bearer \[REDACTED\]/);
    assert.match(redacted, /sk-\[REDACTED\]/);
    assert.match(redacted, /OPENFORGE_ATTACH_TOKEN=\[REDACTED\]/);
    assert.match(redacted, /api_key: \[REDACTED\]/);
    assert.match(redacted, /project OpenForge/);
  });

  function createProvider(
    providerKey: string,
    apiFormat: Extract<ProviderApiFormat, "openai" | "openai-compatible" | "anthropic">,
    options: { isDefault?: boolean; withCredential?: boolean } = {}
  ) {
    const repo = new ModelProviderRepository(db, userId, masterKey);
    const provider = repo.createProviderProfile({
      providerKey,
      name: providerKey,
      baseUrl: providerKey === "anthropic" ? "https://api.anthropic.com" : "https://api.openai.com/v1",
      authType: "api_key",
      apiFormat,
      supportedAdapters: apiFormat === "anthropic" ? ["claude"] : ["opencode"]
    });
    const model = repo.createModelProfile({
      providerProfileId: provider.id,
      name: "Default",
      modelId: apiFormat === "anthropic" ? "claude-sonnet-4-5" : "gpt-5.1",
      isDefault: options.isDefault ?? true
    });
    if (options.withCredential !== false) {
      repo.createCredential({
        providerProfileId: provider.id,
        plaintextSecret: apiFormat === "anthropic" ? "sk-ant" : "sk-openai"
      });
    }
    return { providerId: provider.id, modelId: model.id };
  }
});

function fakeFetch(
  requests: Array<{ url: string; init: RequestInit }>,
  body: unknown,
  status = 200
): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(input), init: init ?? {} });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" }
    });
  }) as typeof fetch;
}
