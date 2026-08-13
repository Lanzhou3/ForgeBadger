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
import { OpenAiChatCompletionsClient } from "../src/services/copilot/openai-chat-completions-client.js";
import { AnthropicMessagesClient } from "../src/services/copilot/anthropic-messages-client.js";
import { CopilotOrchestrator } from "../src/services/copilot/orchestrator.js";
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
    assert.equal(allowed.selection.clientKind, "openai-chat-completions");
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

  it("returns provider-not-configured when a selected credential cannot be decrypted", () => {
    const setup = createProvider("openai", "openai");

    const result = selectCopilotProvider({
      db,
      userId,
      masterKey: "fedcba9876543210fedcba9876543210",
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

  it("skips disabled default providers when another compatible provider is ready", () => {
    const disabled = createProvider("openai", "openai", { isDefault: true });
    disableProvider(disabled.providerId);
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
  });

  it("rejects explicitly selected disabled providers", () => {
    const setup = createProvider("openai", "openai");
    disableProvider(setup.providerId);

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

  it("preserves OpenAI Responses tool calls when output_text is present", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const client = new OpenAiResponsesClient({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-openai",
      fetch: fakeFetch(requests, {
        output_text: "I will inspect the project and sessions.",
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: "I will inspect the project and sessions." }]
          },
          {
            type: "function_call",
            call_id: "tool-call-projects",
            name: "openforge__dot__list_projects",
            arguments: "{}"
          },
          {
            type: "function_call",
            call_id: "tool-call-sessions",
            name: "openforge__dot__list_sessions",
            arguments: "{\"limit\":10}"
          }
        ]
      })
    });

    const events = await client.createResponse({
      model: "gpt-5.1",
      instructions: "Answer as OpenForge Copilot.",
      input: "Check projects and sessions."
    });

    assert.deepEqual(events, [
      { type: "assistant_message", text: "I will inspect the project and sessions." },
      { type: "tool_call_requested", id: "tool-call-projects", name: "openforge.list_projects", input: {} },
      { type: "tool_call_requested", id: "tool-call-sessions", name: "openforge.list_sessions", input: { limit: 10 } }
    ]);
  });

  it("streams OpenAI Responses text deltas while returning the final assistant event", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const deltas: string[] = [];
    const client = new OpenAiResponsesClient({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-openai",
      fetch: fakeSseFetch(requests, [
        { type: "response.output_text.delta", delta: "Gate" },
        { type: "response.output_text.delta", delta: "way" }
      ])
    });

    const events = await client.createResponse({
      model: "gpt-5.1",
      instructions: "Answer as OpenForge Copilot.",
      input: "Status?"
    }, { onTextDelta: (delta) => deltas.push(delta) });

    assert.deepEqual(deltas, ["Gate", "way"]);
    assert.deepEqual(events, [{ type: "assistant_message", text: "Gateway" }]);
    assert.equal((JSON.parse(String(requests[0]?.init.body)) as { stream?: boolean }).stream, true);
  });

  it("emits OpenAI Responses text deltas before the SSE stream closes", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const deltas: string[] = [];
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    const encoder = new TextEncoder();
    const client = new OpenAiResponsesClient({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-openai",
      fetch: (async (input: string | URL | Request, init?: RequestInit) => {
        requests.push({ url: String(input), init: init ?? {} });
        return new Response(new ReadableStream<Uint8Array>({
          start(streamController) {
            controller = streamController;
          }
        }), {
          headers: { "Content-Type": "text/event-stream" }
        });
      }) as typeof fetch
    });

    const response = client.createResponse({
      model: "gpt-5.1",
      instructions: "Answer as OpenForge Copilot.",
      input: "Status?"
    }, { onTextDelta: (delta) => deltas.push(delta) });

    let failure: unknown;
    try {
      controller?.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "response.output_text.delta", delta: "Gate" })}\n\n`));
      await delay(25);
      assert.deepEqual(deltas, ["Gate"]);
    } catch (error) {
      failure = error;
    } finally {
      controller?.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller?.close();
      await response.catch(() => []);
    }
    if (failure) throw failure;
  });

  it("rejects malformed OpenAI Responses SSE frames", async () => {
    const client = new OpenAiResponsesClient({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-openai",
      fetch: (async () => new Response("data: {not-json}\n\n", {
        headers: { "Content-Type": "text/event-stream" }
      })) as typeof fetch
    });

    await assert.rejects(
      () => client.createResponse({
        model: "gpt-5.1",
        instructions: "Answer as OpenForge Copilot.",
        input: "Status?"
      }, { onTextDelta: () => {} }),
      /Invalid provider SSE frame/
    );
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

    const body = JSON.parse(String(requests[0]?.init.body)) as { tools: unknown[]; parallel_tool_calls?: boolean };
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
    assert.equal(body.parallel_tool_calls, false);
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

  it("normalizes OpenAI-compatible Chat Completions text output", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const client = new OpenAiChatCompletionsClient({
      baseUrl: "https://api.minimaxi.com/v1",
      apiKey: "sk-minimax",
      fetch: fakeFetch(requests, {
        choices: [{ message: { role: "assistant", content: "你好，我在。" } }]
      })
    });

    const events = await client.createResponse({
      model: "MiniMax-M2.7",
      instructions: "Answer as OpenForge Copilot.",
      input: "你好",
      maxOutputTokens: 128
    });

    assert.deepEqual(events, [{ type: "assistant_message", text: "你好，我在。" }]);
    assert.equal(requests[0]?.url, "https://api.minimaxi.com/v1/chat/completions");
    assert.equal((requests[0]?.init.headers as Record<string, string>).Authorization, "Bearer sk-minimax");
  });

  it("streams OpenAI-compatible Chat Completions text deltas while preserving final events", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const deltas: string[] = [];
    const client = new OpenAiChatCompletionsClient({
      baseUrl: "https://api.minimaxi.com/v1",
      apiKey: "sk-minimax",
      fetch: fakeSseFetch(requests, [
        { choices: [{ delta: { content: "你" } }] },
        { choices: [{ delta: { content: "好" } }] }
      ])
    });

    const events = await client.createResponse({
      model: "MiniMax-M2.7",
      instructions: "Answer as OpenForge Copilot.",
      input: "你好"
    }, { onTextDelta: (delta) => deltas.push(delta) });

    assert.deepEqual(deltas, ["你", "好"]);
    assert.deepEqual(events, [{ type: "assistant_message", text: "你好" }]);
    assert.equal((JSON.parse(String(requests[0]?.init.body)) as { stream?: boolean }).stream, true);
  });

  it("emits OpenAI-compatible Chat Completions deltas before the SSE stream closes", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const deltas: string[] = [];
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    const encoder = new TextEncoder();
    const client = new OpenAiChatCompletionsClient({
      baseUrl: "https://api.minimaxi.com/v1",
      apiKey: "sk-minimax",
      fetch: (async (input: string | URL | Request, init?: RequestInit) => {
        requests.push({ url: String(input), init: init ?? {} });
        return new Response(new ReadableStream<Uint8Array>({
          start(streamController) {
            controller = streamController;
          }
        }), {
          headers: { "Content-Type": "text/event-stream" }
        });
      }) as typeof fetch
    });

    const response = client.createResponse({
      model: "MiniMax-M2.7",
      instructions: "Answer as OpenForge Copilot.",
      input: "你好"
    }, { onTextDelta: (delta) => deltas.push(delta) });

    let failure: unknown;
    try {
      controller?.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: "你" } }] })}\n\n`));
      await delay(25);
      assert.deepEqual(deltas, ["你"]);
    } catch (error) {
      failure = error;
    } finally {
      controller?.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller?.close();
      await response.catch(() => []);
    }
    if (failure) throw failure;
  });

  it("serializes OpenAI-compatible Chat Completions tools as function definitions", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const client = new OpenAiChatCompletionsClient({
      baseUrl: "https://api.deepseek.com",
      apiKey: "sk-compatible",
      fetch: fakeFetch(requests, {
        choices: [{ message: { role: "assistant", content: "Ready." } }]
      })
    });

    await client.createResponse({
      model: "deepseek-chat",
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

    const body = JSON.parse(String(requests[0]?.init.body)) as {
      messages: unknown[];
      tools: unknown[];
      parallel_tool_calls?: boolean;
    };
    assert.deepEqual(body.messages, [
      { role: "system", content: "Answer as OpenForge Copilot." },
      { role: "user", content: "Status?" }
    ]);
    assert.deepEqual(body.tools, [{
      type: "function",
      function: {
        name: "openforge__dot__get_dashboard_summary",
        description: "Read dashboard health.",
        parameters: {
          type: "object",
          properties: {},
          additionalProperties: false
        }
      }
    }]);
    assert.equal(body.parallel_tool_calls, false);
  });

  it("normalizes OpenAI-compatible Chat Completions tool calls", async () => {
    const client = new OpenAiChatCompletionsClient({
      baseUrl: "https://api.deepseek.com",
      apiKey: "sk-compatible",
      fetch: fakeFetch([], {
        choices: [{
          message: {
            tool_calls: [{
              id: "call-1",
              type: "function",
              function: {
                name: "openforge__dot__memory_search",
                arguments: "{\"query\":\"release gates\"}"
              }
            }]
          }
        }]
      })
    });

    assert.deepEqual(await client.createResponse({
      model: "deepseek-chat",
      instructions: "Answer as OpenForge Copilot.",
      input: "Search memory"
    }), [{
      type: "tool_call_requested",
      id: "call-1",
      name: "openforge.memory_search",
      input: { query: "release gates" }
    }]);
  });

  it("passes abort signals through to OpenAI-compatible Chat Completions fetch", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const controller = new AbortController();
    const client = new OpenAiChatCompletionsClient({
      baseUrl: "https://api.deepseek.com",
      apiKey: "sk-compatible",
      fetch: fakeFetch(requests, {
        choices: [{ message: { role: "assistant", content: "Ready." } }]
      })
    });

    await client.createResponse({
      model: "deepseek-chat",
      instructions: "Answer as OpenForge Copilot.",
      input: "Status?"
    }, { signal: controller.signal });

    assert.equal(requests[0]?.init.signal, controller.signal);
  });

  it("classifies OpenAI-compatible Chat Completions HTTP failures without leaking provider error secrets", async () => {
    const authFailure = new OpenAiChatCompletionsClient({
      baseUrl: "https://api.deepseek.com",
      apiKey: "sk-compatible",
      fetch: fakeFetch([], {
        error: { message: "Invalid API key token=secret-value" }
      }, 401)
    });
    const requestFailure = new OpenAiChatCompletionsClient({
      baseUrl: "https://api.minimaxi.com/v1",
      apiKey: "sk-compatible",
      fetch: fakeFetch([], {
        error: { message: "Not found" }
      }, 404)
    });

    const authEvents = await authFailure.createResponse({
      model: "deepseek-chat",
      instructions: "Answer as OpenForge Copilot.",
      input: "Status?"
    });
    const requestEvents = await requestFailure.createResponse({
      model: "MiniMax-M2.7",
      instructions: "Answer as OpenForge Copilot.",
      input: "Status?"
    });

    assert.deepEqual(authEvents, [{
      type: "run_failed",
      code: "copilot_provider_auth_failed",
      message: "Invalid API key token=[REDACTED]"
    }]);
    assert.equal(requestEvents[0]?.type, "run_failed");
    assert.equal(requestEvents[0]?.code, "copilot_provider_request_failed");
    assert.doesNotMatch(JSON.stringify([authEvents, requestEvents]), /secret-value/);
  });

  it("uses the OpenAI-compatible endpoint, not the Claude endpoint, for Copilot chat requests", async () => {
    const repo = new ModelProviderRepository(db, userId, masterKey);
    const provider = repo.createProviderProfile({
      providerKey: "minimax-cn",
      name: "MiniMax M2.7 中国大陆",
      baseUrl: "https://api.minimaxi.com/anthropic",
      anthropicBaseUrl: "https://api.minimaxi.com/anthropic",
      openaiBaseUrl: "https://api.minimaxi.com/v1",
      authType: "api_key",
      apiFormat: "openai-compatible",
      supportedAdapters: ["claude", "opencode"]
    });
    repo.createModelProfile({
      providerProfileId: provider.id,
      name: "MiniMax M2.7",
      modelId: "MiniMax-M2.7",
      isDefault: true
    });
    repo.createCredential({
      providerProfileId: provider.id,
      plaintextSecret: "sk-minimax"
    });
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const originalFetch = globalThis.fetch;
    (globalThis as { fetch: typeof fetch }).fetch = fakeFetch(requests, {
      choices: [{ message: { role: "assistant", content: "你好，我在。" } }]
    });

    try {
      const result = await new CopilotOrchestrator({ db, masterKey }).runText({
        userId,
        prompt: "你好",
        source: "copilot"
      });

      assert.equal(result.ok, true);
      assert.equal(requests[0]?.url, "https://api.minimaxi.com/v1/chat/completions");
      assert.doesNotMatch(requests[0]?.url ?? "", /anthropic/u);
    } finally {
      (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
    }
  });

  it("adopts a source-idempotent completed run without invoking the model twice", async () => {
    createProvider("openai", "openai");
    let modelCalls = 0;
    const orchestrator = new CopilotOrchestrator({
      db,
      masterKey,
      modelClientFactory: () => ({
        async createResponse() {
          modelCalls += 1;
          return [{ type: "assistant_message" as const, text: "Recovered answer" }];
        }
      })
    });
    const input = {
      userId,
      prompt: "hello from Feishu",
      source: "feishu" as const,
      sourceIdempotencyKey: "account-1:message-1"
    };

    const first = await orchestrator.runText(input);
    const recovered = await orchestrator.runText(input);

    assert.equal(first.ok, true);
    assert.equal(recovered.ok, true);
    assert.equal(modelCalls, 1);
    assert.equal(recovered.run.id, first.run.id);
    assert.equal(recovered.events.filter((event) => event.type === "assistant_message").length, 1);
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

  it("streams Anthropic Messages text deltas while returning the final assistant event", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const deltas: string[] = [];
    const client = new AnthropicMessagesClient({
      baseUrl: "https://api.anthropic.com",
      apiKey: "sk-ant",
      fetch: fakeSseFetch(requests, [
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Gate" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "way" } }
      ])
    });

    const events = await client.createResponse({
      model: "claude-sonnet-4-5",
      instructions: "Answer as OpenForge Copilot.",
      input: "Status?"
    }, { onTextDelta: (delta) => deltas.push(delta) });

    assert.deepEqual(deltas, ["Gate", "way"]);
    assert.deepEqual(events, [{ type: "assistant_message", text: "Gateway" }]);
    assert.equal((JSON.parse(String(requests[0]?.init.body)) as { stream?: boolean }).stream, true);
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

    const body = JSON.parse(String(requests[0]?.init.body)) as {
      tools: unknown[];
      tool_choice?: unknown;
    };
    assert.deepEqual(body.tools, [{
      name: "openforge__dot__get_dashboard_summary",
      description: "Read dashboard health.",
      input_schema: {
        type: "object",
        properties: {},
        additionalProperties: false
      }
    }]);
    assert.deepEqual(body.tool_choice, { type: "auto", disable_parallel_tool_use: true });
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

  it("redacts PEM private key blocks from Copilot text", () => {
    const text = [
      "Rotate this credential:",
      "-----BEGIN PRIVATE KEY-----",
      "MIIEvwIBADANBgkqhkiG9w0BAQEFAASCBKkwggSl",
      "-----END PRIVATE KEY-----",
      "project OpenForge"
    ].join("\n");

    const redacted = redactCopilotText(text);

    assert.match(redacted, /\[REDACTED PRIVATE KEY\]/);
    assert.doesNotMatch(redacted, /BEGIN PRIVATE KEY|MIIEvwIBADAN|END PRIVATE KEY/);
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
      supportedAdapters: ["opencode"]
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

  function disableProvider(providerId: string): void {
    db.prepare(`
      UPDATE model_provider_profiles
      SET status = 'disabled'
      WHERE id = ? AND user_id = ?
    `).run(providerId, userId);
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

function fakeSseFetch(
  requests: Array<{ url: string; init: RequestInit }>,
  chunks: unknown[],
  status = 200
): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(input), init: init ?? {} });
    const body = chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n";
    return new Response(body, {
      status,
      headers: { "Content-Type": "text/event-stream" }
    });
  }) as typeof fetch;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
