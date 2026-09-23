import assert from "node:assert/strict";
import { it, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { ModelProviderRepository, type ProviderApiFormat } from "../src/db/repositories/model-provider-repository.js";
import { UserRepository } from "../src/db/repositories/user-repository.js";
import { createAgentLlmClient, type AgentLlmStreamEvent } from "../src/services/agent/llm-client.js";
import { buildCompressedContext, MAX_CONTEXT_CHARS } from "../src/services/agent/context.js";
import { CopilotConversationLog } from "../src/services/agent/conversation-log.js";

function setup(t: TestContext, format: ProviderApiFormat, response: Response, timeoutMs?: number) {
  const db = new Database(":memory:");
  t.after(() => db.close());
  migrate(drizzle(db), { migrationsFolder: fileURLToPath(new URL("../src/db/migrations", import.meta.url)) });
  const user = new UserRepository(db).create("response@example.com", "hash");
  const repo = new ModelProviderRepository(db, user.id, "abcdef0123456789abcdef0123456789");
  const provider = repo.createProviderProfile({ name: "test", providerKey: "test", baseUrl: "https://api.example.com", authType: "api_key", apiFormat: format, supportedAdapters: ["opencode"] });
  repo.createModelProfile({ providerProfileId: provider.id, name: "test", modelId: "test", isDefault: true, capabilities: ["chat"] });
  repo.createCredential({ providerProfileId: provider.id, label: "test", plaintextSecret: "secret" });
  const requests: RequestInit[] = [];
  const events: AgentLlmStreamEvent[] = [];
  const client = createAgentLlmClient({ modelProviderRepository: repo,
    resolveHost: async () => [{ address: "8.8.8.8", family: 4 }],
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    fetchImpl: async (_url, init) => { requests.push(init!); return response; }
  });
  const run = (signal?: AbortSignal) => client.stream({ messages: [{ role: "user", content: "hello" }], tools: [], ...(signal ? { signal } : {}), onEvent: e => events.push(e) });
  return { run, requests, events, client, db, user };
}

function json(value: unknown) { return Response.json(value); }
function frame(value: unknown, event?: string) { return `${event ? `event: ${event}\n` : ""}data: ${typeof value === "string" ? value : JSON.stringify(value)}\n\n`; }
function sse(text: string) { return new Response(text, { headers: { "content-type": "text/event-stream" } }); }
function choice(delta: unknown, finish_reason: string | null = null) { return { choices: [{ index: 0, delta, finish_reason }] }; }
const openaiTool = (id = "call_a", args = "{}") => ({ id, type: "function", function: { name: "do_work", arguments: args } });
const anthropicTool = (id = "call_a", input: unknown = {}) => ({ type: "tool_use", id, name: "do_work", input });

for (const format of ["openai", "anthropic"] as const) {
  for (const response of [undefined, {}, { error: { message: "provider failed" } },
    format === "openai" ? { choices: [{ message: { content: "", refusal: "no" }, finish_reason: "stop" }] } : { content: [{ type: "thinking", thinking: "hmm" }], stop_reason: "end_turn" },
    format === "openai" ? { choices: [{ message: { content: "partial", tool_calls: [openaiTool()] }, finish_reason: "length" }] } : { content: [anthropicTool()], stop_reason: "max_tokens" }
  ]) {
    it(`${format} rejects invalid or incomplete JSON ${JSON.stringify(response)}`, async t => {
      const { run, events } = setup(t, format, response === undefined ? new Response("not JSON") : json(response));
      await assert.rejects(run(), { code: "AGENT_LLM_INVALID_RESPONSE" });
      assert.equal(events.some(e => e.type === "tool_call" || e.type === "done"), false);
    });
  }
  it(`${format} validates the whole JSON tool batch before emitting any calls`, async t => {
    const response = format === "openai"
      ? { choices: [{ message: { tool_calls: [openaiTool(), openaiTool("call_b", "{")] }, finish_reason: "tool_calls" }] }
      : { content: [anthropicTool(), anthropicTool("call_b", [])], stop_reason: "tool_use" };
    const { run, events } = setup(t, format, json(response));
    await assert.rejects(run(), { code: "AGENT_LLM_INVALID_RESPONSE" });
    assert.equal(events.length, 0);
  });
  it(`${format} rejects duplicate tool ids`, async t => {
    const response = format === "openai"
      ? { choices: [{ message: { tool_calls: [openaiTool(), openaiTool()] }, finish_reason: "tool_calls" }] }
      : { content: [anthropicTool(), anthropicTool()], stop_reason: "tool_use" };
    const { run, events } = setup(t, format, json(response));
    await assert.rejects(run(), { code: "AGENT_LLM_INVALID_RESPONSE" });
    assert.equal(events.length, 0);
  });
  it(`${format} preserves valid legacy JSON without an explicit reason`, async t => {
    const response = format === "openai" ? { choices: [{ message: { content: "okay" } }] } : { content: [{ type: "text", text: "okay" }] };
    const { run, requests } = setup(t, format, { ok: true, json: async () => response } as Response);
    assert.equal((await run()).message, "okay");
    assert.equal(JSON.parse(requests[0]!.body as string).stream, true);
    assert.equal(requests[0]!.redirect, "error");
  });
}

it("OpenAI emits split UTF-8 text before response completion and assembles tools atomically", async t => {
  let source!: ReadableStreamDefaultController<Uint8Array>;
  const response = new Response(new ReadableStream<Uint8Array>({ start(c) { source = c; } }), { headers: { "content-type": "text/event-stream" } });
  const { run, events } = setup(t, "openai", response);
  const pending = run();
  const bytes = new TextEncoder().encode(frame(choice({ content: "你好" })));
  const split = bytes.findIndex(x => x >= 128) + 1;
  source.enqueue(bytes.slice(0, split)); source.enqueue(bytes.slice(split));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(events.find(e => e.type === "text_delta")?.text, "你好");
  source.enqueue(new TextEncoder().encode(frame(choice({ tool_calls: [{ index: 0, ...openaiTool("call_a", '{"path":') }] }))));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(events.some(e => e.type === "tool_call"), false);
  source.enqueue(new TextEncoder().encode(frame(choice({ tool_calls: [{ index: 0, function: { arguments: '"a"}' } }] })) + frame(choice({}, "tool_calls")) + frame("[DONE]")));
  source.close();
  const result = await pending;
  assert.equal(result.message, "你好");
  assert.equal(events.filter(e => e.type === "tool_call").length, 1);
  assert.deepEqual(events.find(e => e.type === "tool_call")?.toolCall, { id: "call_a", name: "do_work", arguments: '{"path":"a"}' });
});

function anthropicFrames(end = true) {
  return frame({ type: "message_start", message: { type: "message", role: "assistant", content: [], usage: { input_tokens: 4, output_tokens: 0 } } })
    + frame({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } })
    + frame({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "answer" } })
    + frame({ type: "content_block_stop", index: 0 })
    + frame({ type: "content_block_start", index: 1, content_block: anthropicTool() })
    + frame({ type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"a":1}' } })
    + frame({ type: "content_block_stop", index: 1 })
    + (end ? frame({ type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 5 } }) + frame({ type: "message_stop" }) : "");
}

it("Anthropic assembles text, tool blocks and usage with complete lifecycle markers", async t => {
  const { run, events } = setup(t, "anthropic", sse(anthropicFrames()));
  const result = await run();
  assert.equal(result.message, "answer");
  assert.equal(result.finishReason, "tool_use");
  assert.deepEqual(result.usage, { inputTokens: 4, outputTokens: 5 });
  assert.deepEqual(events.find(e => e.type === "tool_call")?.toolCall, { id: "call_a", name: "do_work", arguments: '{"a":1}' });
});

for (const [name, format, text] of [
  ["OpenAI missing DONE", "openai", frame(choice({ tool_calls: [{ index: 0, ...openaiTool() }] })) + frame(choice({}, "tool_calls"))],
  ["OpenAI missing finish reason", "openai", frame(choice({ content: "answer" })) + frame("[DONE]")],
  ["OpenAI truncated tool call", "openai", frame(choice({ tool_calls: [{ index: 0, ...openaiTool() }] })) + frame(choice({}, "length")) + frame("[DONE]")],
  ["OpenAI provider error", "openai", frame(choice({ tool_calls: [{ index: 0, ...openaiTool() }] })) + frame({ error: { message: "secret" } })],
  ["OpenAI duplicate ids", "openai", frame(choice({ tool_calls: [{ index: 0, ...openaiTool() }, { index: 1, ...openaiTool() }] })) + frame(choice({}, "tool_calls")) + frame("[DONE]")],
  ["Anthropic interrupted", "anthropic", anthropicFrames(false)],
  ["Anthropic provider error", "anthropic", anthropicFrames(false) + frame({ type: "error", error: { message: "secret" } })],
  ["Anthropic truncated", "anthropic", anthropicFrames().replace('"tool_use"},"usage"', '"max_tokens"},"usage"')]
] as const) {
  it(`${name} never emits a tool batch`, async t => {
    const { run, events } = setup(t, format, sse(text));
    await assert.rejects(run(), { code: "AGENT_LLM_INVALID_RESPONSE" });
    assert.equal(events.some(e => e.type === "tool_call" || e.type === "done"), false);
  });
}

it("cancels stalled body reads and releases the stream", async t => {
  let cancelled = false;
  const response = new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { "content-type": "text/event-stream" } });
  const { run, events } = setup(t, "openai", response);
  const controller = new AbortController();
  const pending = run(controller.signal);
  await new Promise(resolve => setImmediate(resolve));
  controller.abort();
  await assert.rejects(pending);
  assert.equal(cancelled, true);
  assert.equal(events.length, 0);
});

it("bounds tool argument bytes", async t => {
  const { run, events } = setup(t, "openai", json({ choices: [{ message: { tool_calls: [openaiTool("call_a", JSON.stringify({ data: "x".repeat(300_000) }))] }, finish_reason: "tool_calls" }] }));
  await assert.rejects(run(), { code: "AGENT_LLM_INVALID_RESPONSE" });
  assert.equal(events.length, 0);
});

it("bounds the entire response before JSON parsing", async t => {
  const { run, events } = setup(t, "openai", json({ choices: [{ message: { content: "x".repeat(2 * 1024 * 1024) } }] }));
  await assert.rejects(run(), { code: "AGENT_LLM_INVALID_RESPONSE" });
  assert.equal(events.length, 0);
});

it("enforces the deadline through a stalled SSE body and cleans up", async t => {
  let cancelled = false;
  const response = new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { "content-type": "text/event-stream" } });
  const { run, events } = setup(t, "openai", response, 10);
  await assert.rejects(run(), { code: "AGENT_LLM_FAILED" });
  assert.equal(cancelled, true);
  assert.equal(events.length, 0);
});

it("does not expose provider error bodies", async t => {
  const { run, events } = setup(t, "openai", new Response("plaintext credential from upstream", { status: 401 }));
  await assert.rejects(run(), error => {
    assert.equal((error as Error).message, "Provider returned HTTP 401");
    return true;
  });
  assert.equal(events.length, 0);
});

it("reads CRLF frames with multiline data and usage-only terminal chunks", async t => {
  const text = 'data: {"choices": [\r\ndata: {"index":0,"delta":{"content":"okay"},"finish_reason":"stop"}]}\r\n\r\n'
    + frame({ choices: [], usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } }) + frame("[DONE]");
  const { run } = setup(t, "openai", sse(text));
  const result = await run();
  assert.equal(result.message, "okay");
  assert.equal(result.finishReason, "stop");
  assert.deepEqual(result.usage, { inputTokens: 3, outputTokens: 2, totalTokens: 5 });
});

for (const [name, text] of [
  ["malformed data", frame("{bad json}")],
  ["refusal-only stream", frame(choice({ refusal: "cannot comply" }, "stop")) + frame("[DONE]")],
  ["malformed tool input", frame(choice({ tool_calls: [{ index: 0, ...openaiTool("a", "{") }] }, "tool_calls")) + frame("[DONE]")],
  ["tool input too large", frame(choice({ tool_calls: [{ index: 0, ...openaiTool("a", JSON.stringify({ text: "x".repeat(300_000) })) }] }, "tool_calls")) + frame("[DONE]")],
  ["excessive response", ":" + "x".repeat(2 * 1024 * 1024) + "\n\n"],
  ["content after termination", frame(choice({ content: "okay" }, "stop")) + frame(choice({ content: "later" })) + frame("[DONE]")]
] as const) {
  it(`rejects ${name} before tool commitment`, async t => {
    const { run, events } = setup(t, "openai", sse(text));
    await assert.rejects(run(), { code: "AGENT_LLM_INVALID_RESPONSE" });
    assert.equal(events.some(e => e.type === "tool_call" || e.type === "done"), false);
  });
}

it("rejects invalid UTF-8 in a stream", async t => {
  const response = new Response(Uint8Array.from([0xff, 0xfe]), { headers: { "content-type": "text/event-stream" } });
  const { run, events } = setup(t, "openai", response);
  await assert.rejects(run(), { code: "AGENT_LLM_INVALID_RESPONSE" });
  assert.equal(events.length, 0);
});

it("rejects the actual OpenAI wire expansion of complete historical tool batches without dropping the current goal", async t => {
  const { client, db, user, requests } = setup(t, "openai", json({ choices: [{ message: { content: "okay" } }] }));
  const log = new CopilotConversationLog(db, user.id);
  const conversation = log.createConversation();
  const goal = "x".repeat(32_000);
  log.appendMessage(conversation.id, { role: "user", kind: "text", content: goal });
  for (let batch = 0; batch < 15; batch++) {
    for (let offset = 0; offset < 32; offset++) log.appendMessage(conversation.id, {
      role: "assistant", kind: "tool_call", content: "", toolCallId: `tc${batch * 32 + offset}`, toolName: "list_projects", toolInputJson: "{}"
    });
    for (let offset = 0; offset < 32; offset++) log.appendMessage(conversation.id, {
      role: "tool", kind: "tool_result", content: "{}", toolCallId: `tc${batch * 32 + offset}`, toolName: "list_projects"
    });
  }
  const context = await buildCompressedContext(log, conversation.id, client, undefined, { tools: [], reservedChars: 8192 });
  assert.ok(JSON.stringify({ messages: context.messages, tools: [] }).length + 8192 < MAX_CONTEXT_CHARS,
    "the abstract projection admits this history, so the final serializer must still enforce the bound");
  const before = JSON.stringify(context.messages);
  await assert.rejects(client.stream({ messages: context.messages, tools: [], onEvent() {} }), { code: "COPILOT_CONTEXT_TOO_LARGE" });
  assert.equal(requests.length, 0);
  assert.equal(JSON.stringify(context.messages), before);
  assert.equal(log.listMessages(conversation.id)[0]!.content, goal);
});

for (const format of ["openai", "anthropic"] as const) {
  const validResponse = () => json(format === "openai" ? { choices: [{ message: { content: "okay" } }] } : { content: [{ type: "text", text: "okay" }] });
  it(`${format} rejects final wire overflow caused by JSON escaping`, async t => {
    const { client, requests } = setup(t, format, validResponse());
    const messages = [{ role: "user" as const, content: "\n".repeat(49_000) }];
    await assert.rejects(client.stream({ messages, tools: [], onEvent() {} }), { code: "COPILOT_CONTEXT_TOO_LARGE" });
    assert.equal(requests.length, 0);
    assert.equal(messages[0]!.content.length, 49_000);
  });
  it(`${format} applies the same final wire limit to system overrides and summarization`, async t => {
    const { client, requests } = setup(t, format, validResponse());
    await assert.rejects(client.stream({ messages: [{ role: "user", content: "keep this goal" }], system: "s".repeat(96_000), tools: [], onEvent() {} }), { code: "COPILOT_CONTEXT_TOO_LARGE" });
    await assert.rejects(client.summarize({ messages: [{ role: "user", content: "s".repeat(96_000) }] }), { code: "COPILOT_CONTEXT_TOO_LARGE" });
    assert.equal(requests.length, 0);
  });
  it(`${format} sends a request immediately below the final wire limit without truncating it`, async t => {
    const { client, requests } = setup(t, format, { ok: true, json: async () => format === "openai" ? { choices: [{ message: { content: "okay" } }] } : { content: [{ type: "text", text: "okay" }] } } as Response);
    await client.stream({ messages: [{ role: "user", content: "g" }], tools: [], onEvent() {} });
    const overhead = (requests[0]!.body as string).length - 1;
    const content = "g".repeat(MAX_CONTEXT_CHARS - overhead);
    await client.stream({ messages: [{ role: "user", content }], tools: [], onEvent() {} });
    assert.equal((requests[1]!.body as string).length, MAX_CONTEXT_CHARS);
    assert.ok((requests[1]!.body as string).includes(content));
    await assert.rejects(client.stream({ messages: [{ role: "user", content: content + "g" }], tools: [], onEvent() {} }), { code: "COPILOT_CONTEXT_TOO_LARGE" });
    assert.equal(requests.length, 2);
  });
}

it("openai tolerates a repeated identical finish_reason after stop", async (t) => {
  const { run } = setup(t, "openai", sse(
    frame(choice({ content: "okay" }, "stop")) + frame(choice({}, "stop")) + frame("[DONE]"),
  ));
  const result = await run();
  assert.equal(result.message, "okay");
});

it("openai tolerates a bare empty-delta frame after stop", async (t) => {
  const { run } = setup(t, "openai", sse(
    frame(choice({ content: "okay" }, "stop")) + frame(choice({})) + frame("[DONE]"),
  ));
  const result = await run();
  assert.equal(result.message, "okay");
});

const rejectedPostTerminationFrames: [string, string][] = [
  ["reasoning_content after stop", frame(choice({ reasoning_content: "more" }))],
  ["tool_calls after stop", frame(choice({ tool_calls: [{ index: 0, ...openaiTool() }] }))],
  ["a different finish_reason after stop", frame(choice({}, "length"))],
];

for (const [label, afterFrame] of rejectedPostTerminationFrames) {
  it(`openai rejects ${label}`, async (t) => {
    const { run, events } = setup(t, "openai", sse(
      frame(choice({ content: "okay" }, "stop")) + afterFrame + frame("[DONE]"),
    ));
    await assert.rejects(run(), { code: "AGENT_LLM_INVALID_RESPONSE" });
    assert.equal(events.some(e => e.type === "tool_call" || e.type === "done"), false);
  });
}
