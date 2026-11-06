import assert from "node:assert/strict";
import express from "express";
import http from "node:http";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, it } from "node:test";

import { signJwt } from "../src/auth/jwt.js";
import { ClaudeRouteRepository } from "../src/db/repositories/claude-route-repository.js";
import { ModelProviderRepository } from "../src/db/repositories/model-provider-repository.js";
import { UserRepository } from "../src/db/repositories/user-repository.js";
import { createClaudeRouteRoutes } from "../src/routes/claude-route.js";
import { createCliConfigRoutes } from "../src/routes/cli-config.js";
import {
  ClaudeRouteError,
  forwardClaudeCountTokens,
  forwardClaudeMessages,
  listClaudeRouteModels,
  resolveRouteTarget,
  streamFirstByteBudgetMs,
  type SseResponseLike
} from "../src/services/claude-route/forwarder.js";
import { gatewayLoopbackUrl } from "../src/services/claude-route/gateway-url.js";
import {
  circuitBreakerFor,
  defaultCircuitBreakerConfig,
  resetAllCircuitBreakers
} from "../src/services/claude-route/circuit-breaker.js";
import { anthropicToOpenaiRequest } from "../src/services/claude-route/transform-request.js";
import { estimateInputTokens, openaiToAnthropicResponse } from "../src/services/claude-route/transform-response.js";
import { openaiSseToAnthropicSse } from "../src/services/claude-route/transform-stream.js";
import {
  applyCliConfigToAdapter,
  CliConfigApplyError,
  previewCliConfigApply
} from "../src/services/cli-config-apply.js";

const masterKey = "abcdef0123456789abcdef0123456789";
const jwtSecret = "0123456789abcdef0123456789abcdef";
const publicResolver = async () => [{ address: "93.184.216.34", family: 4 }];

function createTestDb(): Database.Database {
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

interface FakeRes extends SseResponseLike {
  statusCode: number;
  headers: Record<string, string>;
  written: string[];
  jsonBody: unknown;
  headersSent: boolean;
}

function fakeRes(): FakeRes {
  return {
    statusCode: 200,
    headers: {},
    written: [],
    jsonBody: undefined,
    headersSent: false,
    status(code: number) { this.statusCode = code; return this; },
    setHeader(name: string, value: string) { this.headers[name] = value; },
    write(chunk: string) { this.written.push(chunk); return true; },
    end() { this.headersSent = true; },
    json(body: unknown) { this.jsonBody = body; }
  };
}

type FetchCall = { url: string; init: RequestInit | undefined };

function stubFetch(responseFor: (call: FetchCall) => Response): {
  calls: FetchCall[];
  fetchImpl: typeof fetch;
} {
  const calls: FetchCall[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = { url: String(input), init };
    calls.push(call);
    return responseFor(call);
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

function sseStream(lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(`${line}\n`));
      controller.close();
    }
  });
}

async function collectStream(
  source: AsyncIterable<Uint8Array>,
  requestedModel: string
): Promise<string[]> {
  const events: string[] = [];
  for await (const event of openaiSseToAnthropicSse(source, { requestedModel })) {
    events.push(event);
  }
  return events;
}

function sseSource(lines: string[]): AsyncIterable<Uint8Array> {
  const encoder = new TextEncoder();
  return {
    async *[Symbol.asyncIterator]() {
      for (const line of lines) yield encoder.encode(`${line}\n`);
    }
  };
}

/**
 * A streaming body whose FIRST chunk only arrives after `delayMs` — models an
 * upstream that returns response headers and then stalls before producing any
 * data (stuck inference / dead proxy half-connection).
 */
function delayedSseStream(delayMs: number, lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      for (const line of lines) controller.enqueue(encoder.encode(`${line}\n`));
      controller.close();
    }
  });
}

interface RouteFixture {
  db: Database.Database;
  userId: string;
  providerId: string;
  credentialId: string;
  token: string;
}

/** OpenAI-protocol provider routed through an enabled Claude route. */
async function createRouteFixture(enabled = true): Promise<RouteFixture> {
  const db = createTestDb();
  const user = new UserRepository(db).create("claude-route@example.com", "hash", { role: "admin" });
  const repo = new ModelProviderRepository(db, user.id, masterKey);
  const provider = repo.createProviderProfile({
    name: "DeepSeek",
    providerKey: "deepseek",
    baseUrl: "https://api.deepseek.com/v1",
    authType: "api_key",
    apiFormat: "openai-compatible",
    supportedAdapters: ["claude", "opencode"]
  });
  const model = repo.createModelProfile({
    providerProfileId: provider.id,
    name: "DeepSeek Chat",
    modelId: "deepseek-chat",
    isDefault: true
  });
  const credential = repo.createCredential({
    providerProfileId: provider.id,
    label: "Primary",
    plaintextSecret: "sk-upstream-secret"
  });
  const routeRepo = new ClaudeRouteRepository(db, user.id, masterKey);
  const settings = routeRepo.setEnabled(enabled);
  routeRepo.upsertAssignment(provider.id, credential.id);
  return { db, userId: user.id, providerId: provider.id, credentialId: credential.id, token: settings.token ?? "" };
}

/** Anthropic-protocol relay routed through an enabled Claude route. */
async function createAnthropicRouteFixture(): Promise<RouteFixture> {
  const db = createTestDb();
  const user = new UserRepository(db).create("anthropic-route@example.com", "hash");
  const repo = new ModelProviderRepository(db, user.id, masterKey);
  const provider = repo.createProviderProfile({
    name: "Relay",
    providerKey: "relay",
    baseUrl: "https://relay.example.com/anthropic",
    authType: "api_key",
    apiFormat: "anthropic",
    supportedAdapters: ["claude"]
  });
  repo.createModelProfile({ providerProfileId: provider.id, name: "M", modelId: "relay-model", isDefault: true });
  const credential = repo.createCredential({ providerProfileId: provider.id, label: "K", plaintextSecret: "sk-relay" });
  const routeRepo = new ClaudeRouteRepository(db, user.id, masterKey);
  const settings = routeRepo.setEnabled(true);
  routeRepo.upsertAssignment(provider.id, credential.id);
  return { db, userId: user.id, providerId: provider.id, credentialId: credential.id, token: settings.token ?? "" };
}

describe("anthropic -> openai request transform", () => {
  it("maps system, tool results, tool use, images, tools, sampling params; drops thinking", () => {
    const request = anthropicToOpenaiRequest({
      model: "deepseek-chat",
      max_tokens: 1024,
      temperature: 0.2,
      top_p: 0.9,
      stop_sequences: ["\n\nHuman:"],
      stream: true,
      system: "x-anthropic-billing-header: xyz\nYou are helpful.",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Look at this" },
            {
              type: "image",
              source: { type: "base64", media_type: "image/png", data: "aGVsbG8=" }
            },
            { type: "tool_result", tool_use_id: "toolu_1", content: [{ type: "text", text: "ok" }] }
          ]
        },
        {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "let me think" },
            { type: "text", text: "Calling the tool" },
            { type: "tool_use", id: "toolu_1", name: "get_weather", input: { city: "Paris" } }
          ]
        }
      ],
      tools: [
        {
          name: "get_weather",
          description: "Get weather",
          input_schema: { $schema: "http://json-schema.org/draft-07/schema#", type: "object", properties: { city: { type: "string" } } }
        },
        { type: "BatchTool", name: "should-be-dropped" }
      ],
      tool_choice: { type: "any" }
    });

    assert.equal(request.model, "deepseek-chat");
    assert.equal(request.stream, true);
    assert.equal(request.max_tokens, 1024);
    assert.equal(request.temperature, 0.2);
    assert.equal(request.top_p, 0.9);
    assert.deepEqual(request.stop, ["\n\nHuman:"]);
    assert.deepEqual(request.stream_options, { include_usage: true });
    assert.deepEqual(request.messages, [
      { role: "system", content: "You are helpful." },
      {
        role: "user",
        content: [
          { type: "text", text: "Look at this" },
          { type: "image_url", image_url: { url: "data:image/png;base64,aGVsbG8=" } }
        ]
      },
      { role: "tool", tool_call_id: "toolu_1", content: "ok" },
      {
        role: "assistant",
        content: "Calling the tool",
        tool_calls: [
          {
            id: "toolu_1",
            type: "function",
            function: { name: "get_weather", arguments: '{"city":"Paris"}' }
          }
        ]
      }
    ]);
    assert.equal(request.tools?.length, 1);
    assert.equal(request.tools?.[0]?.function?.name, "get_weather");
    assert.equal((request.tools?.[0]?.function?.parameters as Record<string, unknown>)?.$schema, undefined);
    assert.deepEqual(request.tool_choice, "required");
  });
});

describe("openai -> anthropic response transform", () => {
  it("maps text, usage, and finish reasons", () => {
    const response = openaiToAnthropicResponse(
      {
        id: "cmpl-1",
        choices: [{ message: { role: "assistant", content: "Hello" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 4 } }
      },
      "deepseek-chat"
    );
    assert.equal(response.id, "msg_cmpl-1");
    assert.equal(response.role, "assistant");
    assert.equal(response.model, "deepseek-chat");
    assert.deepEqual(response.content, [{ type: "text", text: "Hello" }]);
    assert.equal(response.stop_reason, "end_turn");
    assert.deepEqual(response.usage, {
      input_tokens: 10,
      output_tokens: 5,
      cache_read_input_tokens: 4,
      cache_creation_input_tokens: 0
    });
  });

  it("maps tool calls and tool/length finish reasons", () => {
    const response = openaiToAnthropicResponse(
      {
        id: "cmpl-2",
        choices: [{
          message: {
            role: "assistant",
            content: null,
            tool_calls: [{ id: "call_9", function: { name: "get_weather", arguments: '{"city":"Oslo"}' } }]
          },
          finish_reason: "tool_calls"
        }]
      },
      "m"
    );
    assert.equal(response.stop_reason, "tool_use");
    assert.deepEqual(response.content, [
      { type: "tool_use", id: "call_9", name: "get_weather", input: { city: "Oslo" } }
    ]);

    const truncated = openaiToAnthropicResponse(
      { id: "x", choices: [{ message: { content: "partial" }, finish_reason: "length" }] },
      "m"
    );
    assert.equal(truncated.stop_reason, "max_tokens");
  });

  it("estimates tokens locally for count_tokens", () => {
    assert.ok(estimateInputTokens({ messages: [{ content: "x".repeat(400) }] }) >= 100);
  });
});

describe("openai -> anthropic SSE stream transform", () => {
  it("emits the full event sequence with deferred usage tail", async () => {
    const events = await collectStream(sseSource([
      `data: ${JSON.stringify({ id: "cmpl-1", choices: [{ delta: { content: "Hel" } }] })}`,
      `data: ${JSON.stringify({ id: "cmpl-1", choices: [{ delta: { content: "lo" } }] })}`,
      `data: ${JSON.stringify({ id: "cmpl-1", choices: [{ delta: {}, finish_reason: "stop" }] })}`,
      `data: ${JSON.stringify({ id: "cmpl-1", usage: { prompt_tokens: 7, completion_tokens: 2 } })}`,
      "data: [DONE]"
    ]), "deepseek-chat");

    const names = events.map((event) => {
      const match = /event: (\w+)/u.exec(event);
      return match?.[1];
    });
    assert.deepEqual(names, [
      "message_start",
      "content_block_start",
      "content_block_delta",
      "content_block_delta",
      "content_block_stop",
      "message_delta",
      "message_stop"
    ]);
    const messageDelta = /data: (\{.*\})/u.exec(events[5] ?? "")?.[1] ?? "{}";
    const delta = JSON.parse(messageDelta) as Record<string, any>;
    assert.equal(delta.delta.stop_reason, "end_turn");
    assert.deepEqual(delta.usage, { input_tokens: 7, output_tokens: 2 });
    const start = JSON.parse(/data: (\{.*\})/u.exec(events[0] ?? "")?.[1] ?? "{}") as Record<string, any>;
    assert.equal(start.message.model, "deepseek-chat");
    assert.equal(start.message.id, "msg_cmpl-1");
  });

  it("streams tool calls as a tool_use block with reassembled input json", async () => {
    const events = await collectStream(sseSource([
      `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "get_weather", arguments: '{"cit' } }] } }] })}`,
      `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'y":"Paris"}' } }] } }] })}`,
      `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "tool_calls" }] })}`,
      `data: ${JSON.stringify({ usage: { prompt_tokens: 3, completion_tokens: 9 } })}`,
      "data: [DONE]"
    ]), "m");

    const names = events.map((event) => /event: (\w+)/u.exec(event)?.[1]);
    assert.deepEqual(names, [
      "message_start",
      "content_block_start",
      "content_block_delta",
      "content_block_delta",
      "content_block_stop",
      "message_delta",
      "message_stop"
    ]);
    const blockStart = JSON.parse(/data: (\{.*\})/u.exec(events[1] ?? "")?.[1] ?? "{}") as Record<string, any>;
    assert.deepEqual(blockStart.content_block, { type: "tool_use", id: "call_1", name: "get_weather", input: {} });
    const partials = names.slice(2, 4).map((_, i) => {
      const raw = /data: (\{.*\})/u.exec(events[2 + i] ?? "")?.[1] ?? "{}";
      return (JSON.parse(raw) as Record<string, any>).delta.partial_json as string;
    });
    assert.deepEqual(JSON.parse(partials.join("")), { city: "Paris" });
    const delta = JSON.parse(/data: (\{.*\})/u.exec(events[5] ?? "")?.[1] ?? "{}") as Record<string, any>;
    assert.equal(delta.delta.stop_reason, "tool_use");
  });

  it("closes gracefully when the upstream stream fails mid-response", async () => {
    const failing: AsyncIterable<Uint8Array> = {
      async *[Symbol.asyncIterator]() {
        const encoder = new TextEncoder();
        yield encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: "partial" } }] })}\n`);
        throw new Error("upstream dropped");
      }
    };
    const events = await collectStream(failing, "m");
    const names = events.map((event) => /event: (\w+)/u.exec(event)?.[1]);
    assert.ok(names.includes("content_block_start"));
    assert.deepEqual(names.slice(-2), ["message_delta", "message_stop"]);
    const delta = JSON.parse(/data: (\{.*\})/u.exec(events.at(-2) ?? "")?.[1] ?? "{}") as Record<string, any>;
    assert.equal(delta.delta.stop_reason, "end_turn");
  });

  it("rethrows when the upstream fails before any event was emitted", async () => {
    const failing: AsyncIterable<Uint8Array> = {
      async *[Symbol.asyncIterator]() {
        throw new Error("connection refused");
        yield;
      }
    };
    await assert.rejects(
      collectStream(failing, "m"),
      /connection refused/u
    );
  });

  // Regression: the terminal pair MUST be emitted at [DONE] even when the
  // upstream sent no usage chunk. Before the fix, [DONE] flushed into a
  // discarded buffer and dropped both message_delta and message_stop, leaving
  // the client hanging on a stream that never terminates.
  it("still emits message_delta + message_stop at [DONE] when there is no usage chunk", async () => {
    const events = await collectStream(sseSource([
      `data: ${JSON.stringify({ id: "c1", choices: [{ delta: { content: "Hi" } }] })}`,
      `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}`,
      "data: [DONE]"
    ]), "m");
    const names = events.map((event) => /event: (\w+)/u.exec(event)?.[1]);
    assert.deepEqual(names.slice(-2), ["message_delta", "message_stop"]);
    assert.equal(names.filter((n) => n === "message_delta").length, 1);
    const delta = JSON.parse(/data: (\{.*\})/u.exec(events.at(-2) ?? "")?.[1] ?? "{}") as Record<string, any>;
    assert.equal(delta.delta.stop_reason, "end_turn");
    assert.deepEqual(delta.usage, { input_tokens: 0, output_tokens: 0 });
  });

  // Finalization must also fire when the upstream simply closes the socket
  // after sending its last chunk, without the [DONE] marker.
  it("finalizes the message when the stream closes without [DONE]", async () => {
    const events = await collectStream(sseSource([
      `data: ${JSON.stringify({ id: "c1", choices: [{ delta: { content: "Hi" } }] })}`,
      `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}`,
      `data: ${JSON.stringify({ usage: { prompt_tokens: 5, completion_tokens: 2 } })}`
    ]), "m");
    const names = events.map((event) => /event: (\w+)/u.exec(event)?.[1]);
    assert.deepEqual(names.slice(-2), ["message_delta", "message_stop"]);
    const delta = JSON.parse(/data: (\{.*\})/u.exec(events.at(-2) ?? "")?.[1] ?? "{}") as Record<string, any>;
    assert.deepEqual(delta.usage, { input_tokens: 5, output_tokens: 2 });
  });

  // vLLM/OpenRouter shape: the finish chunk carries `usage: null`, and the real
  // usage arrives in a later chunk. The final usage must reflect the trailing
  // chunk, not be zeroed by an early flush.
  it("folds in a trailing usage chunk that follows a usage-null finish chunk", async () => {
    const events = await collectStream(sseSource([
      `data: ${JSON.stringify({ id: "c1", choices: [{ delta: { content: "Hello" }, finish_reason: "stop" }], usage: null })}`,
      `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 9, completion_tokens: 4 } })}`,
      "data: [DONE]"
    ]), "m");
    const names = events.map((event) => /event: (\w+)/u.exec(event)?.[1]);
    assert.equal(names.filter((n) => n === "message_delta").length, 1);
    const delta = JSON.parse(/data: (\{.*\})/u.exec(events.at(-2) ?? "")?.[1] ?? "{}") as Record<string, any>;
    assert.deepEqual(delta.usage, { input_tokens: 9, output_tokens: 4 });
  });

  // An upstream may close (or send [DONE]) after emitting no chunks at all —
  // an empty completion. The client must still receive a well-formed message
  // (message_start present), never a bare message_delta/message_stop.
  it("emits a well-formed empty message when the stream has no content chunks", async () => {
    const events = await collectStream(sseSource(["data: [DONE]"]), "m");
    const names = events.map((event) => /event: (\w+)/u.exec(event)?.[1]);
    assert.deepEqual(names, ["message_start", "message_delta", "message_stop"]);
  });

  // Some gateways repeat the finish chunk; only ONE message_delta may be emitted.
  it("emits only one message_delta when the finish chunk is repeated", async () => {
    const events = await collectStream(sseSource([
      `data: ${JSON.stringify({ id: "c1", choices: [{ delta: { content: "Hi" } }] })}`,
      `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}`,
      `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}`,
      `data: ${JSON.stringify({ usage: { prompt_tokens: 1, completion_tokens: 1 } })}`,
      "data: [DONE]"
    ]), "m");
    const names = events.map((event) => /event: (\w+)/u.exec(event)?.[1]);
    assert.equal(names.filter((n) => n === "message_delta").length, 1);
    assert.equal(names.filter((n) => n === "message_stop").length, 1);
  });
});

describe("stream first-byte budget", () => {
  // A small request must still fail fast (base budget, no per-token growth)
  // so a genuinely stalled upstream is answered as 502 within seconds.
  it("keeps a small request on the base budget", () => {
    const small = streamFirstByteBudgetMs(100);
    assert.ok(small >= 120_000, `expected base budget, got ${small}`);
    assert.ok(small <= 130_000, `small request should stay near base, got ${small}`);
  });

  // A large context must get a much larger budget — this is the regression
  // guard for the flat-90s deadline that cut legitimate 200K+ prefill requests.
  it("grows the budget with input size", () => {
    const large = streamFirstByteBudgetMs(200_000);
    assert.ok(large > 90_000, `expected >90s for a 200K context, got ${large}`);
    assert.ok(large > streamFirstByteBudgetMs(1_000), "budget must be monotonic in size");
  });

  // The budget can never exceed the total stream backstop.
  it("caps the budget at the total stream timeout", () => {
    const huge = streamFirstByteBudgetMs(10_000_000);
    assert.ok(huge <= 600_000, `budget must not exceed the 10min backstop, got ${huge}`);
  });
});

describe("ClaudeRouteRepository", () => {
  it("generates an encrypted loopback token on first enable and keeps it across toggles", () => {
    const db = createTestDb();
    const user = new UserRepository(db).create("route-repo@example.com", "hash");
    const repo = new ClaudeRouteRepository(db, user.id, masterKey);

    assert.deepEqual(repo.getSettings(), { userId: user.id, enabled: false, token: null });

    const enabled = repo.setEnabled(true);
    assert.equal(enabled.enabled, true);
    assert.match(enabled.token ?? "", /^[a-f0-9]{64}$/u);

    const reloaded = new ClaudeRouteRepository(db, user.id, masterKey).getSettings();
    assert.equal(reloaded.enabled, true);
    assert.equal(reloaded.token, enabled.token);

    const disabled = repo.setEnabled(false);
    assert.equal(disabled.enabled, false);
    // Disabling keeps the token so re-enabling is stable for already-applied CLIs.
    assert.equal(disabled.token, enabled.token);
  });

  it("resolves the token owner for data-plane auth", () => {
    const db = createTestDb();
    const user = new UserRepository(db).create("route-owner@example.com", "hash");
    const settings = new ClaudeRouteRepository(db, user.id, masterKey).setEnabled(true);

    const owner = ClaudeRouteRepository.resolveTokenOwner(db, masterKey, settings.token ?? "");
    assert.equal(owner?.userId, user.id);
    assert.equal(owner?.enabled, true);

    assert.equal(ClaudeRouteRepository.resolveTokenOwner(db, masterKey, "deadbeef".repeat(8)), undefined);
    assert.equal(ClaudeRouteRepository.resolveTokenOwner(db, masterKey, undefined), undefined);
  });

  it("upserts, reads, and clears the routed assignment", () => {
    const db = createTestDb();
    const user = new UserRepository(db).create("route-assign@example.com", "hash");
    const providerRepo = new ModelProviderRepository(db, user.id, masterKey);
    const provider = providerRepo.createProviderProfile({
      name: "Assign",
      providerKey: "assign",
      baseUrl: "https://api.deepseek.com/v1",
      authType: "api_key",
      apiFormat: "openai-compatible",
      supportedAdapters: ["claude"]
    });
    const credentialA = providerRepo.createCredential({ providerProfileId: provider.id, label: "A", plaintextSecret: "sk-a" });
    const credentialB = providerRepo.createCredential({ providerProfileId: provider.id, label: "B", plaintextSecret: "sk-b" });
    const repo = new ClaudeRouteRepository(db, user.id, masterKey);

    assert.equal(repo.getAssignment(), undefined);
    repo.upsertAssignment(provider.id, credentialA.id);
    assert.equal(repo.getAssignment()?.providerProfileId, provider.id);
    assert.equal(repo.getAssignment()?.credentialId, credentialA.id);
    repo.upsertAssignment(provider.id, credentialB.id);
    assert.equal(repo.getAssignment()?.credentialId, credentialB.id);
    repo.clearAssignment();
    assert.equal(repo.getAssignment(), undefined);
  });
});

describe("claude route forwarder", () => {
  it("rejects missing, unknown, and disabled tokens", async () => {
    const fixture = await createRouteFixture(true);
    const deps = { db: fixture.db, masterKey, resolveHost: publicResolver };
    const messageBody = { model: "deepseek-chat", messages: [] };

    await assert.rejects(
      forwardClaudeMessages(deps, fakeRes(), undefined, messageBody, {}),
      (error: unknown) => error instanceof ClaudeRouteError && error.code === "CLAUDE_ROUTE_UNAUTHORIZED" && error.status === 401
    );

    await assert.rejects(
      forwardClaudeMessages(deps, fakeRes(), "nope", messageBody, {}),
      (error: unknown) => error instanceof ClaudeRouteError && error.code === "CLAUDE_ROUTE_UNAUTHORIZED" && error.status === 401
    );

    // Disabling keeps the token, so a presented token resolves to a disabled owner.
    const disabledDb = createTestDb();
    const disabledUser = new UserRepository(disabledDb).create("route-disabled@example.com", "hash");
    const disabledRepo = new ClaudeRouteRepository(disabledDb, disabledUser.id, masterKey);
    disabledRepo.setEnabled(true);
    const disabledSettings = disabledRepo.setEnabled(false);
    await assert.rejects(
      forwardClaudeMessages(
        { db: disabledDb, masterKey, resolveHost: publicResolver },
        fakeRes(),
        disabledSettings.token ?? "",
        messageBody,
        {}
      ),
      (error: unknown) => error instanceof ClaudeRouteError && error.code === "CLAUDE_ROUTE_DISABLED" && error.status === 503
    );

    const unassignedDb = createTestDb();
    const unassignedUser = new UserRepository(unassignedDb).create("route-unassigned@example.com", "hash");
    const unassignedSettings = new ClaudeRouteRepository(unassignedDb, unassignedUser.id, masterKey).setEnabled(true);
    await assert.rejects(
      forwardClaudeMessages(
        { db: unassignedDb, masterKey, resolveHost: publicResolver },
        fakeRes(),
        unassignedSettings.token ?? "",
        messageBody,
        {}
      ),
      (error: unknown) => error instanceof ClaudeRouteError && error.code === "CLAUDE_ROUTE_NOT_ASSIGNED" && error.status === 404
    );
  });

  it("falls back to the oldest active credential when the assigned one was rotated away", async () => {
    const db = createTestDb();
    const user = new UserRepository(db).create("route-rotate@example.com", "hash");
    const repo = new ModelProviderRepository(db, user.id, masterKey);
    const provider = repo.createProviderProfile({
      name: "Rotating",
      providerKey: "rotating",
      baseUrl: "https://api.deepseek.com/v1",
      authType: "api_key",
      apiFormat: "openai-compatible",
      supportedAdapters: ["claude"]
    });
    repo.createModelProfile({ providerProfileId: provider.id, name: "M", modelId: "m-1", isDefault: true });
    const rotated = repo.createCredential({ providerProfileId: provider.id, label: "Old", plaintextSecret: "sk-old" });
    const current = repo.createCredential({ providerProfileId: provider.id, label: "New", plaintextSecret: "sk-new" });
    db.prepare("UPDATE provider_credentials SET status = 'inactive' WHERE id = ?").run(rotated.id);
    const routeRepo = new ClaudeRouteRepository(db, user.id, masterKey);
    routeRepo.setEnabled(true);
    routeRepo.upsertAssignment(provider.id, rotated.id);

    const target = resolveRouteTarget(db, masterKey, routeRepo.getSettings().token ?? "");
    assert.equal(target.credential.id, current.id);
    assert.equal(target.secret, "sk-new");
  });

  it("converts an OpenAI provider response (non-stream) to the Anthropic shape", async () => {
    const fixture = await createRouteFixture();
    const { calls, fetchImpl } = stubFetch(() => new Response(
      JSON.stringify({
        id: "cmpl-1",
        choices: [{ message: { role: "assistant", content: "Hi from upstream" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 4, completion_tokens: 3 }
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    ));

    const res = fakeRes();
    await forwardClaudeMessages(
      { db: fixture.db, masterKey, resolveHost: publicResolver, fetchImpl },
      res,
      fixture.token,
      { model: "deepseek-chat", max_tokens: 64, messages: [{ role: "user", content: "hi" }], stream: false },
      {}
    );

    assert.equal(res.statusCode, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, "https://api.deepseek.com/v1/chat/completions");
    const init = calls[0]?.init as RequestInit;
    const headers = init.headers as Record<string, string>;
    assert.equal(headers.Authorization, "Bearer sk-upstream-secret");
    const upstreamBody = JSON.parse(String(init.body)) as Record<string, any>;
    assert.equal(upstreamBody.model, "deepseek-chat");
    assert.equal(upstreamBody.max_tokens, 64);
    assert.deepEqual(upstreamBody.messages, [{ role: "user", content: "hi" }]);

    const body = res.jsonBody as Record<string, any>;
    assert.equal(body.role, "assistant");
    assert.equal(body.model, "deepseek-chat");
    assert.deepEqual(body.content, [{ type: "text", text: "Hi from upstream" }]);
    assert.equal(body.usage.input_tokens, 4);
  });

  it("passes Anthropic-protocol providers through untouched", async () => {
    const db = createTestDb();
    const user = new UserRepository(db).create("route-passthrough@example.com", "hash");
    const repo = new ModelProviderRepository(db, user.id, masterKey);
    const provider = repo.createProviderProfile({
      name: "DeepSeek Anthropic",
      providerKey: "deepseek-anthropic",
      baseUrl: "https://api.deepseek.com/anthropic",
      authType: "api_key",
      apiFormat: "anthropic",
      supportedAdapters: ["claude"]
    });
    repo.createModelProfile({ providerProfileId: provider.id, name: "M", modelId: "m-1", isDefault: true });
    const credential = repo.createCredential({ providerProfileId: provider.id, label: "K", plaintextSecret: "sk-anthropic" });
    const routeRepo = new ClaudeRouteRepository(db, user.id, masterKey);
    const settings = routeRepo.setEnabled(true);
    routeRepo.upsertAssignment(provider.id, credential.id);

    const anthropicBody = {
      model: "m-1",
      messages: [{ role: "user", content: "hi" }],
      max_tokens: 16,
      stream: false
    };
    const { calls, fetchImpl } = stubFetch(() => new Response(
      JSON.stringify({ id: "msg_1", type: "message", role: "assistant", content: [] }),
      { status: 200, headers: { "content-type": "application/json" } }
    ));

    const res = fakeRes();
    await forwardClaudeMessages(
      { db, masterKey, resolveHost: publicResolver, fetchImpl },
      res,
      settings.token ?? "",
      anthropicBody,
      { "anthropic-version": "2023-06-01" }
    );

    assert.equal(calls[0]?.url, "https://api.deepseek.com/anthropic/v1/messages");
    const headers = (calls[0]?.init as RequestInit).headers as Record<string, string>;
    assert.equal(headers["x-api-key"], "sk-anthropic");
    assert.equal(headers["anthropic-version"], "2023-06-01");
    assert.deepEqual(JSON.parse(String((calls[0]?.init as RequestInit).body)), anthropicBody);
    assert.equal((res.jsonBody as Record<string, any>).id, "msg_1");
  });

  it("maps upstream failures to a 502 anthropic error", async () => {
    const fixture = await createRouteFixture();
    const { calls, fetchImpl } = stubFetch(() => new Response("bad gateway", { status: 502 }));
    const res = fakeRes();
    await forwardClaudeMessages(
      { db: fixture.db, masterKey, resolveHost: publicResolver, fetchImpl, sleepFn: async () => {} },
      res,
      fixture.token,
      { model: "deepseek-chat", messages: [] },
      {}
    );
    // 502 is retryable: the attempt budget is used up before the failure is
    // passed through with the upstream's own status code.
    assert.equal(calls.length, 3);
    assert.equal(res.statusCode, 502);
    assert.match(String((res.jsonBody as Record<string, any>).error.message), /Upstream HTTP 502: bad gateway/u);
  });

  it("retries a 429 and honors Retry-After, then succeeds on the second attempt", async () => {
    const fixture = await createRouteFixture();
    const delays: number[] = [];
    const { calls, fetchImpl } = stubFetch(() =>
      calls.length === 1
        ? new Response(
            JSON.stringify({ type: "error", error: { type: "rate_limit_error", message: "Rate limited" } }),
            { status: 429, headers: { "content-type": "application/json", "retry-after": "2" } }
          )
        : new Response(
            JSON.stringify({
              id: "cmpl-1",
              choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
              usage: { prompt_tokens: 1, completion_tokens: 1 }
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          )
    );

    const res = fakeRes();
    await forwardClaudeMessages(
      { db: fixture.db, masterKey, resolveHost: publicResolver, fetchImpl, sleepFn: async (ms) => { delays.push(ms); } },
      res,
      fixture.token,
      { model: "deepseek-chat", messages: [{ role: "user", content: "hi" }] },
      {}
    );

    assert.equal(calls.length, 2);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(delays, [2000]);
    assert.equal((res.jsonBody as Record<string, any>).role, "assistant");
  });

  it("passes a rate-limited 429 through with its status, body, and Retry-After when attempts run out", async () => {
    const fixture = await createRouteFixture();
    const upstreamError = { type: "error", error: { type: "rate_limit_error", message: "Too many tokens" } };
    const { calls, fetchImpl } = stubFetch(() =>
      new Response(JSON.stringify(upstreamError), {
        status: 429,
        headers: { "content-type": "application/json", "retry-after": "7" }
      })
    );

    const res = fakeRes();
    await forwardClaudeMessages(
      { db: fixture.db, masterKey, resolveHost: publicResolver, fetchImpl, sleepFn: async () => {} },
      res,
      fixture.token,
      { model: "deepseek-chat", messages: [] },
      {}
    );

    assert.equal(calls.length, 3);
    assert.equal(res.statusCode, 429);
    assert.equal(res.headers["retry-after"], "7");
    // The relay's own well-formed error body is forwarded verbatim.
    assert.deepEqual(res.jsonBody, upstreamError);
  });

  it("retries an early connection failure and then succeeds", async () => {
    const fixture = await createRouteFixture();
    const { calls, fetchImpl } = stubFetch(() => {
      if (calls.length === 1) throw new Error("socket hang up");
      return new Response(
        JSON.stringify({
          id: "cmpl-1",
          choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 1, completion_tokens: 1 }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });

    const res = fakeRes();
    await forwardClaudeMessages(
      { db: fixture.db, masterKey, resolveHost: publicResolver, fetchImpl, sleepFn: async () => {} },
      res,
      fixture.token,
      { model: "deepseek-chat", messages: [{ role: "user", content: "hi" }] },
      {}
    );

    assert.equal(calls.length, 2);
    assert.equal(res.statusCode, 200);
    assert.equal((res.jsonBody as Record<string, any>).role, "assistant");
  });

  it("does not retry a connection failure that happens late in the request window", async () => {
    const fixture = await createRouteFixture();
    const { calls, fetchImpl } = stubFetch(() => {
      throw new Error("aborted after long run");
    });
    const realNow = Date.now;
    let now = realNow();
    const originalDateNow = Date.now;
    // The first failure already happened 40s into the window: past the
    // quick-failure retry boundary.
    Date.now = () => (now += 40_000);
    const res = fakeRes();
    try {
      await forwardClaudeMessages(
        { db: fixture.db, masterKey, resolveHost: publicResolver, fetchImpl, sleepFn: async () => {} },
        res,
        fixture.token,
        { model: "deepseek-chat", messages: [] },
        {}
      );
    } finally {
      Date.now = originalDateNow;
    }
    assert.equal(calls.length, 1);
    assert.equal(res.statusCode, 502);
    assert.match(String((res.jsonBody as Record<string, any>).error.message), /Upstream request failed/u);
  });

  it("retries a stalled streaming start (headers, then no data) and succeeds", async () => {
    const fixture = await createRouteFixture();
    const sse = sseStream([
      `data: ${JSON.stringify({ choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] })}`,
      "data: [DONE]"
    ]);
    const { calls, fetchImpl } = stubFetch(() =>
      calls.length === 1
        ? new Response(delayedSseStream(200, []), { status: 200, headers: { "content-type": "text/event-stream" } })
        : new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } })
    );

    const res = fakeRes();
    await forwardClaudeMessages(
      { db: fixture.db, masterKey, resolveHost: publicResolver, fetchImpl, streamFirstByteTimeoutMs: 50, sleepFn: async () => {} },
      res,
      fixture.token,
      { model: "deepseek-chat", messages: [{ role: "user", content: "hi" }], stream: true },
      {}
    );

    assert.equal(calls.length, 2);
    assert.equal(res.statusCode, 200);
    assert.match(res.written.join(""), /"text_delta","text":"ok"/u);
  });

  it("streams an OpenAI provider SSE response as Anthropic SSE", async () => {
    const fixture = await createRouteFixture();
    const { fetchImpl } = stubFetch(() => new Response(
      sseStream([
        `data: ${JSON.stringify({ choices: [{ delta: { content: "Hel" } }] })}`,
        `data: ${JSON.stringify({ choices: [{ delta: { content: "lo" }, finish_reason: "stop" }] })}`,
        `data: ${JSON.stringify({ usage: { prompt_tokens: 2, completion_tokens: 1 } })}`,
        "data: [DONE]"
      ]),
      { status: 200, headers: { "content-type": "text/event-stream" } }
    ));

    const res = fakeRes();
    await forwardClaudeMessages(
      { db: fixture.db, masterKey, resolveHost: publicResolver, fetchImpl },
      res,
      fixture.token,
      { model: "deepseek-chat", messages: [{ role: "user", content: "hi" }], stream: true },
      {}
    );

    assert.equal(res.statusCode, 200);
    assert.equal(res.headers["content-type"], "text/event-stream; charset=utf-8");
    const stream = res.written.join("");
    assert.match(stream, /event: message_start/u);
    assert.match(stream, /"text_delta","text":"Hel"/u);
    assert.match(stream, /"text_delta","text":"lo"/u);
    assert.match(stream, /event: message_delta/u);
    assert.match(stream, /event: message_stop/u);
    assert.ok(stream.indexOf("message_start") < stream.indexOf("message_stop"));
  });

  it("answers a stuck upstream (headers but no data) with a 502 before committing the stream", async () => {
    const fixture = await createRouteFixture();
    const { calls, fetchImpl } = stubFetch(() => new Response(
      delayedSseStream(300, [
        `data: ${JSON.stringify({ choices: [{ delta: { content: "never" } }] })}`
      ]),
      { status: 200, headers: { "content-type": "text/event-stream" } }
    ));

    const res = fakeRes();
    await forwardClaudeMessages(
      { db: fixture.db, masterKey, resolveHost: publicResolver, fetchImpl, streamFirstByteTimeoutMs: 60, sleepFn: async () => {} },
      res,
      fixture.token,
      { model: "deepseek-chat", messages: [{ role: "user", content: "hi" }], stream: true },
      {}
    );

    // Not 200, nothing was written to the (never-committed) SSE stream, and
    // the stall burned through the attempt budget before the 502.
    assert.equal(calls.length, 3);
    assert.equal(res.statusCode, 502);
    assert.equal(res.written.length, 0);
    assert.match(String((res.jsonBody as Record<string, any>).error.message), /no data within/u);
  });

  it("estimates count_tokens locally for OpenAI providers and serves the model catalog", async () => {
    const fixture = await createRouteFixture();
    const deps = { db: fixture.db, masterKey, resolveHost: publicResolver };

    const res = fakeRes();
    await forwardClaudeCountTokens(deps, res, fixture.token, {
      model: "deepseek-chat",
      messages: [{ role: "user", content: "x".repeat(400) }]
    }, {});
    assert.ok((res.jsonBody as Record<string, any>).input_tokens >= 100);

    const models = listClaudeRouteModels(fixture.db, masterKey, fixture.token);
    assert.equal((models.data as Array<Record<string, unknown>>).length, 1);
    assert.equal((models.data as Array<Record<string, unknown>>)[0]?.id, "deepseek-chat");
  });
});

describe("claude route forwarder: anthropic rectifiers and error pass-through", () => {
  interface AnthropicFixture {
    db: Database.Database;
    token: string;
  }

  async function createAnthropicFixture(): Promise<AnthropicFixture> {
    const db = createTestDb();
    const user = new UserRepository(db).create("rectify@example.com", "hash");
    const repo = new ModelProviderRepository(db, user.id, masterKey);
    const provider = repo.createProviderProfile({
      name: "Relay",
      providerKey: "relay",
      baseUrl: "https://relay.example.com/anthropic",
      authType: "api_key",
      apiFormat: "anthropic",
      supportedAdapters: ["claude"]
    });
    repo.createModelProfile({ providerProfileId: provider.id, name: "M", modelId: "relay-model", isDefault: true });
    const credential = repo.createCredential({ providerProfileId: provider.id, label: "K", plaintextSecret: "sk-relay" });
    const routeRepo = new ClaudeRouteRepository(db, user.id, masterKey);
    const settings = routeRepo.setEnabled(true);
    routeRepo.upsertAssignment(provider.id, credential.id);
    return { db, token: settings.token ?? "" };
  }

  function thinkingBody() {
    return {
      model: "relay-model",
      max_tokens: 8000,
      thinking: { type: "enabled", budget_tokens: 4096 },
      messages: [
        { role: "user", content: "hi" },
        {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "hmm", signature: "sig_1" },
            { type: "text", text: "answer", signature: "sig_2" },
            { type: "tool_use", id: "toolu_1", name: "bash", input: { cmd: "ls" } }
          ]
        },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "ok" }] }
      ],
      stream: false
    };
  }

  const okAnthropicResponse = () => new Response(
    JSON.stringify({ id: "msg_1", type: "message", role: "assistant", content: [] }),
    { status: 200, headers: { "content-type": "application/json" } }
  );

  it("repairs a thinking-signature 400 in place and succeeds on the resubmit", async () => {
    const fixture = await createAnthropicFixture();
    const { calls, fetchImpl } = stubFetch(() =>
      calls.length === 1
        ? new Response(
            JSON.stringify({
              type: "error",
              error: {
                type: "invalid_request_error",
                message: "messages.1.content.0: Invalid `signature` in `thinking` block"
              }
            }),
            { status: 400, headers: { "content-type": "application/json" } }
          )
        : okAnthropicResponse()
    );

    const res = fakeRes();
    await forwardClaudeMessages(
      { db: fixture.db, masterKey, resolveHost: publicResolver, fetchImpl, sleepFn: async () => {} },
      res,
      fixture.token,
      thinkingBody(),
      {}
    );

    assert.equal(calls.length, 2);
    assert.equal(res.statusCode, 200);
    const resent = JSON.parse(String(calls[1]?.init?.body)) as {
      messages: Array<{ role: string; content: Array<Record<string, unknown>> }>;
      thinking?: Record<string, unknown>;
    };
    const assistant = resent.messages.find((message) => message.role === "assistant");
    assert.ok(assistant);
    assert.ok(
      !assistant!.content.some((block) => block.type === "thinking" || block.type === "redacted_thinking"),
      "thinking blocks must be stripped from the resubmission"
    );
    assert.ok(
      !assistant!.content.some((block) => block.signature !== undefined),
      "stray signature fields must be stripped from the resubmission"
    );
    // thinking was enabled and the repaired assistant message no longer
    // starts with a thinking block, so the top-level parameter is dropped too.
    assert.equal(resent.thinking, undefined);
  });

  it("repairs a thinking-budget 400 in place and succeeds on the resubmit", async () => {
    const fixture = await createAnthropicFixture();
    const { calls, fetchImpl } = stubFetch(() =>
      calls.length === 1
        ? new Response(
            JSON.stringify({
              type: "error",
              error: {
                type: "invalid_request_error",
                message: "thinking.budget_tokens: Input should be greater than or equal to 1024"
              }
            }),
            { status: 400, headers: { "content-type": "application/json" } }
          )
        : okAnthropicResponse()
    );

    const res = fakeRes();
    await forwardClaudeMessages(
      { db: fixture.db, masterKey, resolveHost: publicResolver, fetchImpl, sleepFn: async () => {} },
      res,
      fixture.token,
      {
        model: "relay-model",
        max_tokens: 1024,
        thinking: { type: "enabled", budget_tokens: 512 },
        messages: [{ role: "user", content: "hi" }],
        stream: false
      },
      {}
    );

    assert.equal(calls.length, 2);
    assert.equal(res.statusCode, 200);
    const resent = JSON.parse(String(calls[1]?.init?.body)) as Record<string, any>;
    assert.deepEqual(resent.thinking, { type: "enabled", budget_tokens: 32000 });
    assert.equal(resent.max_tokens, 64000);
  });

  it("passes a 400 that matches no rectifier straight through, unmodified", async () => {
    const fixture = await createAnthropicFixture();
    const upstreamError = {
      type: "error",
      error: { type: "invalid_request_error", message: "model 'relay-model' not found" }
    };
    const { calls, fetchImpl } = stubFetch(() =>
      new Response(JSON.stringify(upstreamError), { status: 400, headers: { "content-type": "application/json" } })
    );

    const res = fakeRes();
    await forwardClaudeMessages(
      { db: fixture.db, masterKey, resolveHost: publicResolver, fetchImpl, sleepFn: async () => {} },
      res,
      fixture.token,
      thinkingBody(),
      {}
    );

    assert.equal(calls.length, 1);
    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.jsonBody, upstreamError);
    // The body was sent untouched (rectifier never applied).
    const sent = JSON.parse(String(calls[0]?.init?.body)) as Record<string, any>;
    assert.deepEqual(sent.thinking, { type: "enabled", budget_tokens: 4096 });
  });

  it("does not rectify on the OpenAI transform path (thinking is dropped by the transform)", async () => {
    const fixture = await createRouteFixture();
    const upstreamError = {
      type: "error",
      error: { type: "invalid_request_error", message: "messages.1.content.0: Invalid `signature` in `thinking` block" }
    };
    const { calls, fetchImpl } = stubFetch(() =>
      new Response(JSON.stringify(upstreamError), { status: 400, headers: { "content-type": "application/json" } })
    );

    const res = fakeRes();
    await forwardClaudeMessages(
      { db: fixture.db, masterKey, resolveHost: publicResolver, fetchImpl, sleepFn: async () => {} },
      res,
      fixture.token,
      { ...thinkingBody(), model: "deepseek-chat" },
      {}
    );

    assert.equal(calls.length, 1);
    assert.equal(res.statusCode, 400);
    const sent = JSON.parse(String(calls[0]?.init?.body)) as Record<string, any>;
    // The transform itself drops thinking blocks; the rectifier is not involved.
    assert.ok(!JSON.stringify(sent).includes("thinking"));
  });

  it("forwards the client anthropic-beta and anthropic-version on the anthropic passthrough", async () => {
    const fixture = await createAnthropicFixture();
    const { calls, fetchImpl } = stubFetch(() => okAnthropicResponse());

    const res = fakeRes();
    await forwardClaudeMessages(
      { db: fixture.db, masterKey, resolveHost: publicResolver, fetchImpl, sleepFn: async () => {} },
      res,
      fixture.token,
      { model: "relay-model", messages: [{ role: "user", content: "hi" }], stream: false },
      {
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "claude-code-20250219,context-1m-2025-08-07"
      }
    );

    const headers = (calls[0]?.init as RequestInit).headers as Record<string, string>;
    assert.equal(headers["anthropic-version"], "2023-06-01");
    assert.equal(headers["anthropic-beta"], "claude-code-20250219,context-1m-2025-08-07");
    assert.equal(headers["x-api-key"], "sk-relay");
  });
});

describe("claude route forwarder: circuit breaker", () => {
  beforeEach(() => resetAllCircuitBreakers());

  const noopSleep = async () => {};

  it("opens after four provider failures and refuses further upstream calls with a 503", async () => {
    const fixture = await createRouteFixture();
    const { calls, fetchImpl } = stubFetch(() =>
      new Response(JSON.stringify({ type: "error", error: { type: "api_error", message: "boom" } }),
        { status: 500, headers: { "content-type": "application/json" } })
    );
    const deps = { db: fixture.db, masterKey, resolveHost: publicResolver, fetchImpl, maxAttempts: 1, sleepFn: noopSleep };
    const body = { model: "deepseek-chat", messages: [] };

    for (let i = 0; i < 4; i++) {
      const res = fakeRes();
      await forwardClaudeMessages(deps, res, fixture.token, body, {});
      assert.equal(res.statusCode, 500, `request ${i + 1} passes the 500 through`);
    }
    assert.equal(calls.length, 4);
    assert.equal(circuitBreakerFor(fixture.userId, fixture.providerId).getState(), "open");

    // The fifth request must not reach the upstream at all.
    const refused = fakeRes();
    await forwardClaudeMessages(deps, refused, fixture.token, body, {});
    assert.equal(calls.length, 4, "no upstream call while the breaker is open");
    assert.equal(refused.statusCode, 503);
    const refusedBody = refused.jsonBody as Record<string, any>;
    assert.equal(refusedBody.type, "error");
    assert.equal(refusedBody.error.type, "overloaded_error");
  });

  it("does not trip the breaker on client-side 4xx rejections (neutral outcomes)", async () => {
    const fixture = await createAnthropicRouteFixture();
    const upstreamError = {
      type: "error",
      error: { type: "invalid_request_error", message: "model 'nope' not found" }
    };
    const { calls, fetchImpl } = stubFetch(() =>
      new Response(JSON.stringify(upstreamError), { status: 400, headers: { "content-type": "application/json" } })
    );
    const deps = { db: fixture.db, masterKey, resolveHost: publicResolver, fetchImpl, maxAttempts: 1, sleepFn: noopSleep };
    const body = { model: "nope", messages: [{ role: "user", content: "hi" }], stream: false };

    for (let i = 0; i < 6; i++) {
      const res = fakeRes();
      await forwardClaudeMessages(deps, res, fixture.token, body, {});
      assert.equal(res.statusCode, 400);
    }
    const breaker = circuitBreakerFor(fixture.userId, fixture.providerId);
    assert.equal(breaker.getState(), "closed", "4xx rejections must not pollute provider health");
    assert.equal(breaker.getStats().failedRequests, 0);
    assert.equal(breaker.getStats().totalRequests, 0);
    // The next request still reaches the upstream.
    const next = fakeRes();
    await forwardClaudeMessages(deps, next, fixture.token, body, {});
    assert.equal(calls.length, 7);
    assert.equal(next.statusCode, 400);
  });

  it("re-closes after a successful half-open probe once the open window elapses", async () => {
    const fixture = await createRouteFixture();
    // Short real-time window so the test does not wait a minute.
    circuitBreakerFor(fixture.userId, fixture.providerId, {
      ...defaultCircuitBreakerConfig,
      openTimeoutMs: 50,
      successThreshold: 1
    });
    let upstreamCalls = 0;
    const { calls, fetchImpl } = stubFetch(() => {
      upstreamCalls += 1;
      return upstreamCalls <= 4
        ? new Response(JSON.stringify({ type: "error", error: { type: "api_error", message: "down" } }),
            { status: 500, headers: { "content-type": "application/json" } })
        : new Response(
            JSON.stringify({
              id: "cmpl-1",
              choices: [{ message: { role: "assistant", content: "up" }, finish_reason: "stop" }],
              usage: { prompt_tokens: 1, completion_tokens: 1 }
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
    });
    const deps = { db: fixture.db, masterKey, resolveHost: publicResolver, fetchImpl, maxAttempts: 1, sleepFn: noopSleep };
    const body = { model: "deepseek-chat", messages: [{ role: "user", content: "hi" }] };

    for (let i = 0; i < 4; i++) {
      await forwardClaudeMessages(deps, fakeRes(), fixture.token, body, {});
    }
    const breaker = circuitBreakerFor(fixture.userId, fixture.providerId);
    assert.equal(breaker.getState(), "open");

    // Immediately: refused without an upstream call.
    const refused = fakeRes();
    await forwardClaudeMessages(deps, refused, fixture.token, body, {});
    assert.equal(refused.statusCode, 503);
    assert.equal(upstreamCalls, 4);

    // After the open window: the probe reaches the upstream, succeeds, and
    // closes the breaker (successThreshold 1).
    await new Promise((resolve) => setTimeout(resolve, 60));
    const probe = fakeRes();
    await forwardClaudeMessages(deps, probe, fixture.token, body, {});
    assert.equal(probe.statusCode, 200);
    assert.equal(upstreamCalls, 5);
    assert.equal(breaker.getState(), "closed");

    // Traffic flows normally again.
    const normal = fakeRes();
    await forwardClaudeMessages(deps, normal, fixture.token, body, {});
    assert.equal(normal.statusCode, 200);
    assert.equal(upstreamCalls, 6);
  });

  it("records an internally-retried success as a success, not a failure", async () => {
    const fixture = await createRouteFixture();
    const { calls, fetchImpl } = stubFetch(() =>
      calls.length % 2 === 1
        ? new Response(JSON.stringify({ type: "error", error: { type: "rate_limit_error", message: "slow down" } }),
            { status: 429, headers: { "content-type": "application/json", "retry-after": "0" } })
        : new Response(
            JSON.stringify({
              id: "cmpl-1",
              choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
              usage: { prompt_tokens: 1, completion_tokens: 1 }
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          )
    );
    const deps = { db: fixture.db, masterKey, resolveHost: publicResolver, fetchImpl, sleepFn: noopSleep };
    const body = { model: "deepseek-chat", messages: [{ role: "user", content: "hi" }] };

    for (let i = 0; i < 5; i++) {
      const res = fakeRes();
      await forwardClaudeMessages(deps, res, fixture.token, body, {});
      assert.equal(res.statusCode, 200);
    }
    const stats = circuitBreakerFor(fixture.userId, fixture.providerId).getStats();
    assert.equal(stats.state, "closed");
    assert.equal(stats.totalRequests, 5);
    assert.equal(stats.failedRequests, 0, "internal retries are not provider failures");
    assert.equal(calls.length, 10);
  });
});

describe("claude route data-plane routes", () => {
  async function makeDataPlaneApp(fixture: RouteFixture, fetchImpl: typeof fetch): Promise<express.Express> {
    const app = express();
    app.use(express.json({ limit: "64mb" }));
    app.use("/v1", createClaudeRouteRoutes(fixture.db, masterKey, {
      resolveHost: publicResolver,
      fetchImpl
    }));
    return app;
  }

  async function request(
    app: express.Express,
    method: string,
    pathName: string,
    body?: unknown,
    headers: Record<string, string> = {}
  ): Promise<{ status: number; text: string }> {
    const server = http.createServer(app);
    const baseUrl = await new Promise<string>((resolve, reject) => {
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (!address || typeof address === "string") {
          reject(new Error("No TCP address"));
          return;
        }
        resolve(`http://127.0.0.1:${address.port}`);
      });
    });
    try {
      const res = await fetch(`${baseUrl}${pathName}`, {
        method,
        headers: body === undefined ? headers : { "content-type": "application/json", ...headers },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
      const text = await res.text();
      return { status: res.status, text };
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }

  it("serves /v1/messages with Bearer and x-api-key token auth", async () => {
    const fixture = await createRouteFixture();
    const { fetchImpl } = stubFetch(() => new Response(
      JSON.stringify({ id: "c1", choices: [{ message: { content: "ok" }, finish_reason: "stop" }] }),
      { status: 200, headers: { "content-type": "application/json" } }
    ));

    const messageBody = { model: "deepseek-chat", messages: [{ role: "user", content: "hi" }], max_tokens: 8 };

    const app = await makeDataPlaneApp(fixture, fetchImpl);
    const bearer = await request(app, "POST", "/v1/messages", messageBody, {
      authorization: `Bearer ${fixture.token}`
    });
    assert.equal(bearer.status, 200);
    assert.equal(JSON.parse(bearer.text).role, "assistant");

    const apiKey = await request(app, "POST", "/v1/messages", messageBody, {
      "x-api-key": fixture.token
    });
    assert.equal(apiKey.status, 200);

    const unauthenticated = await request(app, "POST", "/v1/messages", messageBody);
    assert.equal(unauthenticated.status, 401);
    assert.equal(JSON.parse(unauthenticated.text).error.type, "CLAUDE_ROUTE_UNAUTHORIZED");

    const models = await request(app, "GET", "/v1/models", undefined, {
      authorization: `Bearer ${fixture.token}`
    });
    assert.equal(models.status, 200);
    assert.ok(Array.isArray(JSON.parse(models.text).data));
  });
});

describe("claude route forwarder: failover", () => {
  beforeEach(() => resetAllCircuitBreakers());

  interface FailoverFixture {
    db: Database.Database;
    userId: string;
    token: string;
    primary: { providerId: string; credentialId: string };
    backup: { providerId: string; credentialId: string };
  }

  /**
   * Two providers hosting "shared-model" by default; primary is position 1,
   * backup position 2. Anthropic mode switches both to the Anthropic protocol.
   */
  async function createFailoverFixture(options: {
    primaryModels?: string[];
    backupModels?: string[];
    apiFormat?: "openai-compatible" | "anthropic";
  } = {}): Promise<FailoverFixture> {
    const db = createTestDb();
    const user = new UserRepository(db).create("failover@example.com", "hash");
    const repo = new ModelProviderRepository(db, user.id, masterKey);
    const apiFormat = options.apiFormat ?? "openai-compatible";
    const mk = (name: string, key: string, host: string, models: string[]) => {
      const provider = repo.createProviderProfile({
        name,
        providerKey: key,
        baseUrl: apiFormat === "anthropic" ? `https://${host}` : `https://${host}/v1`,
        authType: "api_key",
        apiFormat,
        supportedAdapters: ["claude"]
      });
      models.forEach((modelId, index) => {
        repo.createModelProfile({ providerProfileId: provider.id, name: modelId, modelId, isDefault: index === 0 });
      });
      const credential = repo.createCredential({ providerProfileId: provider.id, label: "K", plaintextSecret: `sk-${key}` });
      return { providerId: provider.id, credentialId: credential.id };
    };
    const primary = mk("Primary", "primary", "primary.example.com", options.primaryModels ?? ["shared-model"]);
    const backup = mk("Backup", "backup", "backup.example.com", options.backupModels ?? ["shared-model"]);
    const routeRepo = new ClaudeRouteRepository(db, user.id, masterKey);
    const settings = routeRepo.setEnabled(true);
    routeRepo.setOrderedAssignments([
      { providerProfileId: primary.providerId, credentialId: primary.credentialId },
      { providerProfileId: backup.providerId, credentialId: backup.credentialId }
    ]);
    return { db, userId: user.id, token: settings.token ?? "", primary, backup };
  }

  const okOpenAi = () => new Response(
    JSON.stringify({ id: "cmpl-1", choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 } }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
  const okAnthropic = () => new Response(
    JSON.stringify({
      id: "msg_1", type: "message", role: "assistant", model: "shared-model",
      content: [{ type: "text", text: "ok" }],
      stop_reason: "end_turn", stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 }
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
  const upstreamError = (status: number, message: string, type = "api_error") => new Response(
    JSON.stringify({ type: "error", error: { type, message } }),
    { status, headers: { "content-type": "application/json" } }
  );

  it("fails over to the backup when the primary exhausts its attempts", async () => {
    const fixture = await createFailoverFixture();
    const { calls, fetchImpl } = stubFetch((call) =>
      call.url.includes("primary.example.com") ? upstreamError(500, "primary down") : okOpenAi()
    );
    const deps = { db: fixture.db, masterKey, resolveHost: publicResolver, fetchImpl, maxAttempts: 1, sleepFn: async () => {} };
    const res = fakeRes();
    await forwardClaudeMessages(deps, res, fixture.token, { model: "shared-model", messages: [{ role: "user", content: "hi" }] }, {});

    assert.equal(res.statusCode, 200);
    assert.equal(calls.length, 2);
    assert.ok(calls[0]?.url.includes("primary.example.com"), "primary tried first");
    assert.ok(calls[1]?.url.includes("backup.example.com"), "backup served the request");
    // Per-candidate circuit accounting: the primary failure is recorded, the
    // backup success is recorded.
    assert.equal(circuitBreakerFor(fixture.userId, fixture.primary.providerId).getStats().failedRequests, 1);
    assert.equal(circuitBreakerFor(fixture.userId, fixture.backup.providerId).getStats().totalRequests, 1);
    assert.equal(circuitBreakerFor(fixture.userId, fixture.backup.providerId).getStats().failedRequests, 0);
  });

  it("passes the last candidate's own error through when every candidate fails", async () => {
    const fixture = await createFailoverFixture();
    const { calls, fetchImpl } = stubFetch(() => upstreamError(503, "backup overloaded", "overloaded_error"));
    const deps = { db: fixture.db, masterKey, resolveHost: publicResolver, fetchImpl, maxAttempts: 1, sleepFn: async () => {} };
    const res = fakeRes();
    await forwardClaudeMessages(deps, res, fixture.token, { model: "shared-model", messages: [{ role: "user", content: "hi" }] }, {});

    assert.equal(calls.length, 2, "both candidates were tried");
    assert.equal(res.statusCode, 503);
    // The LAST candidate's well-formed error body is what the client sees.
    assert.equal((res.jsonBody as Record<string, any>).error.message, "backup overloaded");
  });

  it("stops the failover on a client-side 400 and passes it through", async () => {
    const fixture = await createFailoverFixture();
    const { calls, fetchImpl } = stubFetch((call) =>
      call.url.includes("primary.example.com")
        ? upstreamError(400, "model 'shared-model' not found", "invalid_request_error")
        : okOpenAi()
    );
    const deps = { db: fixture.db, masterKey, resolveHost: publicResolver, fetchImpl, maxAttempts: 3, sleepFn: async () => {} };
    const res = fakeRes();
    await forwardClaudeMessages(deps, res, fixture.token, { model: "shared-model", messages: [{ role: "user", content: "hi" }] }, {});

    assert.equal(calls.length, 1, "the backup must not be called for a client-side rejection");
    assert.equal(res.statusCode, 400);
    assert.equal((res.jsonBody as Record<string, any>).error.message, "model 'shared-model' not found");
    // Neutral: the primary's health was not affected.
    assert.equal(circuitBreakerFor(fixture.userId, fixture.primary.providerId).getStats().totalRequests, 0);
  });

  it("skips a circuit-open primary without calling it", async () => {
    const fixture = await createFailoverFixture();
    circuitBreakerFor(fixture.userId, fixture.primary.providerId, {
      ...defaultCircuitBreakerConfig,
      failureThreshold: 1
    }).recordFailure(false);
    const { calls, fetchImpl } = stubFetch((call) =>
      call.url.includes("primary.example.com") ? upstreamError(500, "primary down") : okOpenAi()
    );
    const deps = { db: fixture.db, masterKey, resolveHost: publicResolver, fetchImpl, sleepFn: async () => {} };
    const res = fakeRes();
    await forwardClaudeMessages(deps, res, fixture.token, { model: "shared-model", messages: [{ role: "user", content: "hi" }] }, {});

    assert.equal(res.statusCode, 200);
    assert.equal(calls.length, 1);
    assert.ok(calls[0]?.url.includes("backup.example.com"), "the open primary is not called");
  });

  it("answers 503 without upstream calls when every candidate's breaker is open", async () => {
    const fixture = await createFailoverFixture();
    const { calls, fetchImpl } = stubFetch(() => upstreamError(500, "down"));
    const deps = { db: fixture.db, masterKey, resolveHost: publicResolver, fetchImpl, maxAttempts: 1, sleepFn: async () => {} };
    const body = { model: "shared-model", messages: [{ role: "user", content: "hi" }] };

    for (let i = 0; i < 4; i++) {
      const res = fakeRes();
      await forwardClaudeMessages(deps, res, fixture.token, body, {});
      assert.equal(res.statusCode, 500);
    }
    assert.equal(calls.length, 8, "each request tried both candidates once");
    assert.equal(circuitBreakerFor(fixture.userId, fixture.primary.providerId).getState(), "open");
    assert.equal(circuitBreakerFor(fixture.userId, fixture.backup.providerId).getState(), "open");

    const refused = fakeRes();
    await forwardClaudeMessages(deps, refused, fixture.token, body, {});
    assert.equal(calls.length, 8, "no upstream call while every breaker is open");
    assert.equal(refused.statusCode, 503);
    assert.equal((refused.jsonBody as Record<string, any>).error.type, "overloaded_error");
  });

  it("tries only candidates that host the requested model", async () => {
    const fixture = await createFailoverFixture({
      primaryModels: ["only-primary"],
      backupModels: ["shared-model"]
    });
    const { calls, fetchImpl } = stubFetch((call) =>
      call.url.includes("primary.example.com") ? okOpenAi() : okOpenAi()
    );
    const deps = { db: fixture.db, masterKey, resolveHost: publicResolver, fetchImpl, sleepFn: async () => {} };

    // The primary does not host "shared-model": it must be skipped even though
    // it is healthy and first in the order.
    const res = fakeRes();
    await forwardClaudeMessages(deps, res, fixture.token, { model: "shared-model", messages: [{ role: "user", content: "hi" }] }, {});
    assert.equal(res.statusCode, 200);
    assert.equal(calls.length, 1);
    assert.ok(calls[0]?.url.includes("backup.example.com"));

    // And "only-primary" goes to the primary.
    const second = fakeRes();
    await forwardClaudeMessages(deps, second, fixture.token, { model: "only-primary", messages: [{ role: "user", content: "hi" }] }, {});
    assert.equal(second.statusCode, 200);
    assert.ok(calls[1]?.url.includes("primary.example.com"));
  });

  it("falls back to priority order when no candidate hosts the model", async () => {
    const fixture = await createFailoverFixture();
    const { calls, fetchImpl } = stubFetch((call) =>
      call.url.includes("primary.example.com") ? upstreamError(500, "primary down") : okOpenAi()
    );
    const deps = { db: fixture.db, masterKey, resolveHost: publicResolver, fetchImpl, maxAttempts: 1, sleepFn: async () => {} };
    const res = fakeRes();
    // Neither provider lists "alias-model": the request goes through as-is in
    // priority order (legacy single-assignment behavior).
    await forwardClaudeMessages(deps, res, fixture.token, { model: "alias-model", messages: [{ role: "user", content: "hi" }] }, {});
    assert.equal(res.statusCode, 200);
    assert.equal(calls.length, 2);
    assert.ok(calls[0]?.url.includes("primary.example.com"), "the primary is still tried first");
  });

  it("passes the sanitized (rectified) body to the next candidate", async () => {
    const fixture = await createFailoverFixture({ apiFormat: "anthropic" });
    const { calls, fetchImpl } = stubFetch((call) => {
      if (!call.url.includes("primary.example.com")) return okAnthropic();
      return calls.length === 1
        ? upstreamError(400, "messages.1.content.0: Invalid `signature` in `thinking` block", "invalid_request_error")
        : upstreamError(400, "custom relay field rejected", "invalid_request_error");
    });
    const deps = { db: fixture.db, masterKey, resolveHost: publicResolver, fetchImpl, sleepFn: async () => {} };
    const body = {
      model: "shared-model",
      max_tokens: 2048,
      thinking: { type: "enabled", budget_tokens: 4096 },
      messages: [
        { role: "user", content: "hi" },
        {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "hmm", signature: "sig-abc" },
            { type: "text", text: "hello" }
          ]
        },
        { role: "user", content: "more" }
      ],
      stream: false
    };
    const res = fakeRes();
    await forwardClaudeMessages(deps, res, fixture.token, body, {});

    assert.equal(res.statusCode, 200);
    assert.equal(calls.length, 3, "primary: original + rectified resubmit, then backup");
    assert.ok(calls[2]?.url.includes("backup.example.com"));
    const backupBody = JSON.parse(String(calls[2]?.init?.body)) as {
      messages: Array<{ role: string; content: Array<Record<string, unknown>> }>
    };
    const assistant = backupBody.messages.find((message) => message.role === "assistant");
    assert.ok(assistant);
    assert.ok(
      !assistant!.content.some((block) => block.type === "thinking" || block.type === "redacted_thinking"),
      "the backup must receive the sanitized body"
    );
  });
});

describe("claude route management API", () => {
  function makeApp(db: Database.Database, jwt: string): express.Express {
    const app = express();
    app.locals.jwtSecret = jwt;
    app.use(express.json());
    app.use("/api/v1/cli-config", createCliConfigRoutes(db, masterKey));
    return app;
  }

  async function request(
    app: express.Express,
    method: string,
    pathName: string,
    body?: unknown,
    headers: Record<string, string> = {}
  ): Promise<{ status: number; json: any }> {
    const server = http.createServer(app);
    const baseUrl = await new Promise<string>((resolve, reject) => {
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (!address || typeof address === "string") {
          reject(new Error("No TCP address"));
          return;
        }
        resolve(`http://127.0.0.1:${address.port}`);
      });
    });
    try {
      const res = await fetch(`${baseUrl}${pathName}`, {
        method,
        headers: body === undefined ? headers : { "content-type": "application/json", ...headers },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
      const json = await res.json().catch(() => ({}));
      return { status: res.status, json };
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }

  it("reads and toggles the route switch without exposing the token", async () => {
    const db = createTestDb();
    const user = new UserRepository(db).create("route-admin@example.com", "hash", { role: "admin" });
    const app = makeApp(db, jwtSecret);
    const auth = { authorization: `Bearer ${signJwt({ userId: user.id, email: user.email }, jwtSecret)}` };

    const initial = await request(app, "GET", "/api/v1/cli-config/routing/claude", undefined, auth);
    assert.equal(initial.status, 200);
    assert.equal(initial.json.code, 0);
    assert.deepEqual(initial.json.data.routing, {
      enabled: false,
      hasToken: false,
      gatewayUrl: gatewayLoopbackUrl(),
      assignments: [],
      assignment: null
    });

    const enabled = await request(app, "PUT", "/api/v1/cli-config/routing/claude", { enabled: true }, auth);
    assert.equal(enabled.status, 200);
    assert.equal(enabled.json.data.routing.enabled, true);
    assert.equal(enabled.json.data.routing.hasToken, true);
    assert.ok(!JSON.stringify(enabled.json).includes("deadbeef"));

    const disabled = await request(app, "PUT", "/api/v1/cli-config/routing/claude", { enabled: false }, auth);
    assert.equal(disabled.json.data.routing.enabled, false);
    assert.equal(disabled.json.data.routing.hasToken, true);

    const invalid = await request(app, "PUT", "/api/v1/cli-config/routing/claude", { enabled: "yes" }, auth);
    assert.equal(invalid.status, 400);
  });

  it("requires instance admin and reports the routed provider", async () => {
    const db = createTestDb();
    const admin = new UserRepository(db).create("route-admin-2@example.com", "hash", { role: "admin" });
    const viewer = new UserRepository(db).create("route-viewer@example.com", "hash");
    const app = makeApp(db, jwtSecret);
    const viewerAuth = { authorization: `Bearer ${signJwt({ userId: viewer.id, email: viewer.email }, jwtSecret)}` };

    const forbidden = await request(app, "GET", "/api/v1/cli-config/routing/claude", undefined, viewerAuth);
    assert.equal(forbidden.status, 403);
    assert.equal(forbidden.json.details.code, "INSTANCE_ADMIN_REQUIRED");

    const repo = new ModelProviderRepository(db, admin.id, masterKey);
    const provider = repo.createProviderProfile({
      name: "Admin Routed",
      providerKey: "admin-routed",
      baseUrl: "https://api.deepseek.com/v1",
      authType: "api_key",
      apiFormat: "openai-compatible",
      supportedAdapters: ["claude"]
    });
    repo.createModelProfile({ providerProfileId: provider.id, name: "M", modelId: "m-1", isDefault: true });
    const credential = repo.createCredential({ providerProfileId: provider.id, label: "K", plaintextSecret: "sk-admin" });
    const routeRepo = new ClaudeRouteRepository(db, admin.id, masterKey);
    routeRepo.setEnabled(true);
    routeRepo.upsertAssignment(provider.id, credential.id);

    const adminAuth = { authorization: `Bearer ${signJwt({ userId: admin.id, email: admin.email }, jwtSecret)}` };
    const state = await request(app, "GET", "/api/v1/cli-config/routing/claude", undefined, adminAuth);
    assert.equal(state.status, 200);
    assert.equal(state.json.data.routing.assignment.providerProfileId, provider.id);
    assert.equal(state.json.data.routing.assignment.providerName, "Admin Routed");
    const list = state.json.data.routing.assignments;
    assert.equal(list.length, 1);
    assert.equal(list[0].position, 1);
    assert.equal(list[0].providerProfileId, provider.id);
    assert.deepEqual(list[0].modelIds, ["m-1"]);
  });

  it("replaces the ordered failover list and validates entries", async () => {
    const db = createTestDb();
    const admin = new UserRepository(db).create("route-admin-3@example.com", "hash", { role: "admin" });
    const app = makeApp(db, jwtSecret);
    const adminAuth = { authorization: `Bearer ${signJwt({ userId: admin.id, email: admin.email }, jwtSecret)}` };
    const repo = new ModelProviderRepository(db, admin.id, masterKey);
    const mkProvider = (name: string, key: string, host: string, modelId: string) => {
      const provider = repo.createProviderProfile({
        name,
        providerKey: key,
        baseUrl: `https://${host}/v1`,
        authType: "api_key",
        apiFormat: "openai-compatible",
        supportedAdapters: ["claude"]
      });
      repo.createModelProfile({ providerProfileId: provider.id, name: modelId, modelId, isDefault: true });
      return { provider, credential: repo.createCredential({ providerProfileId: provider.id, label: "K", plaintextSecret: `sk-${key}` }) };
    };
    const first = mkProvider("Primary", "primary", "primary.example.com", "m-1");
    const second = mkProvider("Backup", "backup", "backup.example.com", "m-2");

    const empty = await request(app, "PUT", "/api/v1/cli-config/routing/claude/assignments", { assignments: [] }, adminAuth);
    assert.equal(empty.status, 400);

    const unknown = await request(app, "PUT", "/api/v1/cli-config/routing/claude/assignments", { assignments: [{ providerProfileId: "nope" }] }, adminAuth);
    assert.equal(unknown.status, 404);

    const duplicate = await request(app, "PUT", "/api/v1/cli-config/routing/claude/assignments", {
      assignments: [{ providerProfileId: first.provider.id }, { providerProfileId: first.provider.id }]
    }, adminAuth);
    assert.equal(duplicate.status, 400);

    const ok = await request(app, "PUT", "/api/v1/cli-config/routing/claude/assignments", {
      assignments: [
        { providerProfileId: second.provider.id },
        { providerProfileId: first.provider.id, credentialId: first.credential.id }
      ]
    }, adminAuth);
    assert.equal(ok.status, 200);
    const list = ok.json.data.routing.assignments;
    assert.equal(list.length, 2);
    assert.equal(list[0].position, 1);
    assert.equal(list[0].providerProfileId, second.provider.id);
    assert.equal(list[0].credentialId, second.credential.id, "credential defaults to the oldest active one");
    assert.equal(list[1].position, 2);
    assert.equal(list[1].providerProfileId, first.provider.id);
    // The legacy single-assignment view is the primary entry.
    assert.equal(ok.json.data.routing.assignment.providerProfileId, second.provider.id);

    // A later apply (upsert) pins that provider back to the top, shifting the
    // previous primary down instead of dropping it.
    new ClaudeRouteRepository(db, admin.id, masterKey).upsertAssignment(first.provider.id, first.credential.id);
    const after = await request(app, "GET", "/api/v1/cli-config/routing/claude", undefined, adminAuth);
    const afterList = after.json.data.routing.assignments;
    assert.equal(afterList.length, 2);
    assert.equal(afterList[0].providerProfileId, first.provider.id);
    assert.equal(afterList[0].position, 1);
    assert.equal(afterList[1].providerProfileId, second.provider.id);
    assert.equal(afterList[1].position, 2);
  });
});

describe("cli-config apply: claude route branches", () => {
  const publicResolverFn = publicResolver;

  /** Point the Claude global config at a throwaway dir. */
  async function useClaudeConfigRoot(prefix: string): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), prefix));
    process.env.CLAUDE_CONFIG_DIR = dir;
    return dir;
  }

  async function withClaudeConfigRoot<T>(prefix: string, action: (root: string) => Promise<T>): Promise<T> {
    const previous = process.env.CLAUDE_CONFIG_DIR;
    const root = await useClaudeConfigRoot(prefix);
    try {
      return await action(root);
    } finally {
      if (previous === undefined) delete process.env.CLAUDE_CONFIG_DIR;
      else process.env.CLAUDE_CONFIG_DIR = previous;
    }
  }

  async function createOpenAiClaudeFixture() {
    const db = createTestDb();
    const user = new UserRepository(db).create("apply-route@example.com", "hash");
    const repo = new ModelProviderRepository(db, user.id, masterKey);
    const provider = repo.createProviderProfile({
      name: "DeepSeek",
      providerKey: "deepseek",
      baseUrl: "https://api.deepseek.com/v1",
      authType: "api_key",
      apiFormat: "openai-compatible",
      supportedAdapters: ["claude"]
    });
    const model = repo.createModelProfile({
      providerProfileId: provider.id,
      name: "DeepSeek Chat",
      modelId: "deepseek-chat",
      isDefault: true
    });
    const credential = repo.createCredential({
      providerProfileId: provider.id,
      label: "Primary",
      plaintextSecret: "sk-route-secret"
    });
    return { db, user, repo, providerId: provider.id, modelId: model.id, credentialId: credential.id };
  }

  it("requires the route for OpenAI-protocol providers: preview warns, apply errors", async () => {
    const fixture = await createOpenAiClaudeFixture();
    const input = {
      db: fixture.db,
      userId: fixture.user.id,
      masterKey,
      adapter: "claude" as const,
      providerProfileId: fixture.providerId,
      resolveHost: publicResolverFn
    };

    const preview = await previewCliConfigApply(input);
    assert.ok(preview.warnings.includes("OPENAI_PROTOCOL_REQUIRES_ROUTE"));
    // The preview shows the routed document (gateway URL), not the provider endpoint.
    assert.ok(preview.files[0]?.proposed.includes(`"ANTHROPIC_BASE_URL": "${gatewayLoopbackUrl()}"`));

    await assert.rejects(
      applyCliConfigToAdapter(input),
      (error: unknown) => {
        assert.ok(error instanceof CliConfigApplyError);
        return error.code === "CLI_CONFIG_APPLY_ROUTE_REQUIRED";
      }
    );
  });

  it("rejects routeThroughGateway while the route is disabled", async () => {
    const fixture = await createOpenAiClaudeFixture();
    await assert.rejects(
      applyCliConfigToAdapter({
        db: fixture.db,
        userId: fixture.user.id,
        masterKey,
        adapter: "claude",
        providerProfileId: fixture.providerId,
        routeThroughGateway: true,
        resolveHost: publicResolverFn
      }),
      (error: unknown) => {
        assert.ok(error instanceof CliConfigApplyError);
        return error.code === "CLI_CONFIG_APPLY_ROUTE_DISABLED";
      }
    );
  });

  for (const openaiBaseUrl of [null, "https://api.deepseek.com/v1"]) {
    for (const routeThroughGateway of [false, true]) {
      it(`applies an explicit Anthropic endpoint with OpenAI metadata (openai=${openaiBaseUrl !== null}, route=${routeThroughGateway})`, async () => {
        await withClaudeConfigRoot("forgebadger-claude-explicit-anthropic-", async (root) => {
          const fixture = await createOpenAiClaudeFixture();
          fixture.repo.updateProviderProfile(fixture.providerId, {
            baseUrl: null,
            openaiBaseUrl,
            anthropicBaseUrl: "https://api.deepseek.com/anthropic"
          });
          const routeRepo = new ClaudeRouteRepository(fixture.db, fixture.user.id, masterKey);
          const routeSettings = routeThroughGateway ? routeRepo.setEnabled(true) : null;
          const input = {
            db: fixture.db, userId: fixture.user.id, masterKey,
            adapter: "claude" as const, providerProfileId: fixture.providerId,
            routeThroughGateway, resolveHost: publicResolverFn
          };
          const preview = await previewCliConfigApply(input);
          assert.ok(!preview.warnings.includes("OPENAI_PROTOCOL_REQUIRES_ROUTE"));
          assert.ok(preview.files[0]?.proposed.includes(routeThroughGateway
            ? `"ANTHROPIC_BASE_URL": "${gatewayLoopbackUrl()}"`
            : "https://api.deepseek.com/anthropic"));
          await applyCliConfigToAdapter(input);
          const written = JSON.parse(await readFile(path.join(root, "settings.json"), "utf8"));
          if (routeThroughGateway) {
            // The explicit flag routes even a provider with an Anthropic endpoint.
            assert.equal(written.env.ANTHROPIC_BASE_URL, gatewayLoopbackUrl());
            assert.equal(written.env.ANTHROPIC_AUTH_TOKEN, routeSettings?.token);
            assert.equal(routeRepo.getAssignment()?.providerProfileId, fixture.providerId);
          } else {
            assert.equal(written.env.ANTHROPIC_BASE_URL, "https://api.deepseek.com/anthropic");
            assert.equal(written.env.ANTHROPIC_AUTH_TOKEN, "sk-route-secret");
            assert.equal(routeRepo.getAssignment(), undefined);
            assert.equal(routeRepo.getSettings().enabled, false);
          }
        });
      });
    }
  }

  it("routes an Anthropic-protocol relay through the Gateway when explicitly requested", async () => {
    await withClaudeConfigRoot("forgebadger-claude-anthropic-relay-route-", async (root) => {
      const db = createTestDb();
      const user = new UserRepository(db).create("relay-route@example.com", "hash");
      const repo = new ModelProviderRepository(db, user.id, masterKey);
      const provider = repo.createProviderProfile({
        name: "Kimi Relay",
        providerKey: "kimi-relay",
        baseUrl: "https://api.kimi.com/coding",
        authType: "api_key",
        apiFormat: "anthropic",
        supportedAdapters: ["claude"]
      });
      const model = repo.createModelProfile({ providerProfileId: provider.id, name: "K2", modelId: "k2", isDefault: true });
      const credential = repo.createCredential({ providerProfileId: provider.id, label: "K", plaintextSecret: "sk-relay-key" });
      const routeRepo = new ClaudeRouteRepository(db, user.id, masterKey);
      const settings = routeRepo.setEnabled(true);

      // Without the flag the relay applies directly (default behavior).
      await applyCliConfigToAdapter({
        db, userId: user.id, masterKey, adapter: "claude",
        providerProfileId: provider.id, resolveHost: publicResolverFn
      });
      let written = JSON.parse(await readFile(path.join(root, "settings.json"), "utf8"));
      assert.equal(written.env.ANTHROPIC_BASE_URL, "https://api.kimi.com/coding");
      assert.equal(written.env.ANTHROPIC_AUTH_TOKEN, "sk-relay-key");
      assert.equal(routeRepo.getAssignment(), undefined);

      // With the flag the same relay is routed: gateway URL + loopback token,
      // the provider key stays in the vault, and the assignment is recorded.
      const result = await applyCliConfigToAdapter({
        db, userId: user.id, masterKey, adapter: "claude",
        providerProfileId: provider.id,
        modelProfileId: model.id,
        credentialId: credential.id,
        routeThroughGateway: true,
        resolveHost: publicResolverFn
      });
      written = JSON.parse(await readFile(path.join(root, "settings.json"), "utf8"));
      assert.equal(result.changed, true);
      assert.equal(written.env.ANTHROPIC_BASE_URL, gatewayLoopbackUrl());
      assert.equal(written.env.ANTHROPIC_AUTH_TOKEN, settings.token);
      assert.notEqual(written.env.ANTHROPIC_AUTH_TOKEN, "sk-relay-key");
      assert.equal(routeRepo.getAssignment()?.providerProfileId, provider.id);
      assert.equal(routeRepo.getAssignment()?.credentialId, credential.id);
    });
  });

  it("requires routing when only an explicit OpenAI endpoint is configured", async () => {
    await withClaudeConfigRoot("forgebadger-claude-openai-only-", async () => {
      const fixture = await createOpenAiClaudeFixture();
      fixture.repo.updateProviderProfile(fixture.providerId, {
        baseUrl: null, openaiBaseUrl: "https://api.deepseek.com/v1"
      });
      const input = {
        db: fixture.db, userId: fixture.user.id, masterKey,
        adapter: "claude" as const, providerProfileId: fixture.providerId,
        resolveHost: publicResolverFn
      };
      assert.ok((await previewCliConfigApply(input)).warnings.includes("OPENAI_PROTOCOL_REQUIRES_ROUTE"));
      await assert.rejects(applyCliConfigToAdapter(input), { code: "CLI_CONFIG_APPLY_ROUTE_REQUIRED" });
      new ClaudeRouteRepository(fixture.db, fixture.user.id, masterKey).setEnabled(true);
      await applyCliConfigToAdapter({ ...input, routeThroughGateway: true });
    });
  });

  it("applies the gateway endpoint + route token and records the assignment", async () => {
    await withClaudeConfigRoot("forgebadger-claude-route-apply-", async (root) => {
      const fixture = await createOpenAiClaudeFixture();
      const routeRepo = new ClaudeRouteRepository(fixture.db, fixture.user.id, masterKey);
      const settings = routeRepo.setEnabled(true);

      const result = await applyCliConfigToAdapter({
        db: fixture.db,
        userId: fixture.user.id,
        masterKey,
        adapter: "claude",
        providerProfileId: fixture.providerId,
        modelProfileId: fixture.modelId,
        credentialId: fixture.credentialId,
        routeThroughGateway: true,
        resolveHost: publicResolverFn
      });
      assert.equal(result.changed, true);

      const written = JSON.parse(
        await readFile(path.join(root, "settings.json"), "utf8")
      ) as { env: Record<string, string> };
      assert.equal(written.env.ANTHROPIC_BASE_URL, gatewayLoopbackUrl());
      assert.equal(written.env.ANTHROPIC_AUTH_TOKEN, settings.token);
      assert.equal(written.env.ANTHROPIC_MODEL, "deepseek-chat");
      // The provider key must not leak into the CLI config.
      assert.notEqual(written.env.ANTHROPIC_AUTH_TOKEN, "sk-route-secret");

      const assignment = routeRepo.getAssignment();
      assert.equal(assignment?.providerProfileId, fixture.providerId);
      assert.equal(assignment?.credentialId, fixture.credentialId);
    });
  });

  it("clears the route assignment when a direct Anthropic provider is applied", async () => {
    await withClaudeConfigRoot("forgebadger-claude-route-direct-", async (root) => {
      const db = createTestDb();
      const user = new UserRepository(db).create("apply-direct@example.com", "hash");
      const repo = new ModelProviderRepository(db, user.id, masterKey);
      const routeProvider = repo.createProviderProfile({
        name: "Routed",
        providerKey: "routed",
        baseUrl: "https://api.deepseek.com/v1",
        authType: "api_key",
        apiFormat: "openai-compatible",
        supportedAdapters: ["claude"]
      });
      const routedModel = repo.createModelProfile({ providerProfileId: routeProvider.id, name: "M1", modelId: "m-1", isDefault: true });
      const routeCredential = repo.createCredential({ providerProfileId: routeProvider.id, label: "K", plaintextSecret: "sk-r" });
      const routeRepo = new ClaudeRouteRepository(db, user.id, masterKey);
      routeRepo.setEnabled(true);

      await applyCliConfigToAdapter({
        db, userId: user.id, masterKey, adapter: "claude",
        providerProfileId: routeProvider.id,
        modelProfileId: routedModel.id,
        credentialId: routeCredential.id,
        routeThroughGateway: true,
        resolveHost: publicResolverFn
      });
      assert.equal(routeRepo.getAssignment()?.providerProfileId, routeProvider.id);

      const directProvider = repo.createProviderProfile({
        name: "Direct",
        providerKey: "direct",
        baseUrl: "https://api.deepseek.com/anthropic",
        anthropicBaseUrl: "https://api.deepseek.com/anthropic",
        authType: "api_key",
        apiFormat: "openai-compatible",
        supportedAdapters: ["claude"]
      });
      const directModel = repo.createModelProfile({ providerProfileId: directProvider.id, name: "M2", modelId: "m-2", isDefault: true });
      const directCredential = repo.createCredential({ providerProfileId: directProvider.id, label: "K", plaintextSecret: "sk-d" });

      await applyCliConfigToAdapter({
        db, userId: user.id, masterKey, adapter: "claude",
        providerProfileId: directProvider.id,
        modelProfileId: directModel.id,
        credentialId: directCredential.id,
        resolveHost: publicResolverFn
      });
      assert.equal(routeRepo.getAssignment(), undefined);
      const written = JSON.parse(await readFile(path.join(root, "settings.json"), "utf8"));
      assert.equal(written.env.ANTHROPIC_BASE_URL, "https://api.deepseek.com/anthropic");
      assert.equal(written.env.ANTHROPIC_AUTH_TOKEN, "sk-d");
      assert.equal(routeRepo.getSettings().enabled, true);
    });
  });

  it("rejects routeThroughGateway for non-Claude adapters", async () => {
    const db = createTestDb();
    const user = new UserRepository(db).create("apply-route-adapter@example.com", "hash");
    const repo = new ModelProviderRepository(db, user.id, masterKey);
    const provider = repo.createProviderProfile({
      name: "OpenCode Routed",
      providerKey: "oc-routed",
      baseUrl: "https://api.deepseek.com/v1",
      authType: "api_key",
      apiFormat: "openai-compatible",
      supportedAdapters: ["opencode"]
    });
    repo.createModelProfile({ providerProfileId: provider.id, name: "M", modelId: "m-1", isDefault: true });
    repo.createCredential({ providerProfileId: provider.id, label: "K", plaintextSecret: "sk-oc" });

    await assert.rejects(
      applyCliConfigToAdapter({
        db, userId: user.id, masterKey, adapter: "opencode",
        providerProfileId: provider.id,
        routeThroughGateway: true,
        resolveHost: publicResolverFn
      }),
      (error: unknown) => {
        assert.ok(error instanceof CliConfigApplyError);
        return error.code === "CLI_CONFIG_APPLY_FIELD_UNSUPPORTED";
      }
    );
  });
});
