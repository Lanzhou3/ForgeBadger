#!/usr/bin/env node
/**
 * Fake dsh runtime for gateway M2/M3 tests: speaks the dsh SDK newline-delimited
 * JSON-RPC protocol on stdio without any harness dependencies.
 *
 * Behavior is scenario-driven via env (passed through the process manager's
 * extraEnv test hook):
 * - DSH_FAKE_SCENARIO: simple | tool | title | error | hang | crash-once |
 *   operate | operate-hang | operate-crash
 * - DSH_FAKE_LOG: JSONL file recording boot/prompt/shutdown/crash/approval/
 *   inject records (pid included, so tests can tell respawns apart)
 * - DSH_FAKE_OPERATE_TOOL / DSH_FAKE_OPERATE_ARGS: operate tool name and JSON
 *   arguments used by the operate* scenarios
 *
 * Scenarios:
 * - simple: two text deltas + assistant/message + turn/end completed
 * - tool: tool/call + tool/result + text + turn/end completed
 * - title: session/title then the simple flow
 * - error: partial text + turn/end with reason error
 * - hang: turn/start + one chunk, never ends (cancel test)
 * - crash-once: partial text then process.exit(1), but only for the first
 *   prompt ever (tracked via the log file) so the recovery message succeeds
 * - operate: tool/call for an operate tool, then a server->client
 *   `approval/decide` REQUEST; the turn continues only after the Gateway
 *   answers: allowed-once -> tool/result success, anything else -> tool/result
 *   error, then text + turn/end completed
 * - operate-hang: like operate but the turn never ends (cancel-during-pending)
 * - operate-crash: like operate but the process exits mid-approval on the
 *   first prompt (crash-during-pending); later boots behave like `simple`
 *
 * Inbound `session/inject` requests are recorded and acknowledged.
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";

// `node --test` executes every file under test/ — including helpers. When this
// script is picked up as a test child, exit immediately instead of serving.
if (process.env.NODE_TEST_CONTEXT !== undefined) {
  process.exit(0);
}

const SCENARIO = process.env.DSH_FAKE_SCENARIO ?? "simple";
const LOG = process.env.DSH_FAKE_LOG;
const OPERATE_TOOL = process.env.DSH_FAKE_OPERATE_TOOL ?? "dispatch_task_to_session";
const OPERATE_ARGS = process.env.DSH_FAKE_OPERATE_ARGS ?? '{"sessionId":"sess-1","message":"修复登录页"}';

if (SCENARIO === "stubborn") {
  process.on("SIGTERM", () => {
    record({ kind: "ignored-sigterm" });
  });
}

function record(entry) {
  if (LOG) appendFileSync(LOG, JSON.stringify({ pid: process.pid, ...entry }) + "\n");
}

function send(frame) {
  process.stdout.write(JSON.stringify(frame) + "\n");
}

function notify(sessionId, event) {
  send({ jsonrpc: "2.0", method: "session.event", params: { sessionId, event } });
}

let reqSeq = 0;
const pendingRequests = new Map();
/** Send a server->client request (M3 approval bridge) and await the answer. */
function request(method, params) {
  const id = `fake-req-${++reqSeq}`;
  return new Promise((resolve) => {
    pendingRequests.set(id, resolve);
    send({ jsonrpc: "2.0", id, method, params });
  });
}

function hasCrashedBefore() {
  if (!LOG || !existsSync(LOG)) return false;
  return readFileSync(LOG, "utf8").includes("\"kind\":\"crashed\"");
}

let seq = 0;
function ev(type, data) {
  seq += 1;
  return { type, seq, time: Date.now(), data };
}

function emitTextAndEnd(sessionId, promptCount, text) {
  notify(sessionId, ev("assistant/chunk", { turn: promptCount, step: 2, chunk: { type: "text-delta", index: 0, text } }));
  notify(sessionId, ev("assistant/message", { turn: promptCount, step: 2, message: { role: "assistant", content: [{ type: "text", text }] } }));
  notify(sessionId, ev("turn/end", { turn: promptCount, reason: { kind: "completed" } }));
}

/** Operate-tool turn: tool/call, approval question, then outcome-dependent end. */
async function emitOperateTurn(sessionId, promptCount) {
  const callId = "call-op-1";
  const args = JSON.parse(OPERATE_ARGS);
  notify(sessionId, ev("tool/call", { turn: promptCount, step: 1, callId, name: OPERATE_TOOL, arguments: OPERATE_ARGS }));
  record({ kind: "approval", toolName: OPERATE_TOOL, args });
  const answer = request("approval/decide", {
    sessionId,
    toolName: OPERATE_TOOL,
    callId,
    args,
    reason: `OpenForge operate action "${OPERATE_TOOL}" requires owner approval`
  });
  if (SCENARIO === "operate-hang") return; // Never ends: the cancel test kills us.
  if (SCENARIO === "operate-crash" && !hasCrashedBefore()) {
    record({ kind: "crashed" });
    setTimeout(() => process.exit(1), 20);
    return;
  }
  const response = await answer;
  const granted = response?.result?.outcome === "allowed-once";
  const reason = response?.result?.reason;
  record({ kind: "approval-response", outcome: response?.result?.outcome ?? null });
  notify(sessionId, ev("tool/result", {
    turn: promptCount,
    step: 1,
    message: {
      role: "user",
      content: [{
        type: "tool-result",
        toolCallId: callId,
        content: [{ type: "text", text: granted ? '{"dispatched":true,"sessionId":"sess-1"}' : `Denied: ${reason ?? "rejected"}` }],
        isError: !granted
      }]
    }
  }));
  emitTextAndEnd(sessionId, promptCount, granted ? "已执行操作" : "操作未获批准");
}

function emitTurn(sessionId, promptCount) {
  notify(sessionId, ev("turn/start", { turn: promptCount }));
  if (SCENARIO === "hang") {
    notify(sessionId, ev("assistant/chunk", { turn: promptCount, step: 1, chunk: { type: "text-delta", index: 0, text: "working..." } }));
    return; // No turn/end: the cancel test kills the process.
  }
  if (SCENARIO === "crash-once" && !hasCrashedBefore()) {
    notify(sessionId, ev("assistant/chunk", { turn: promptCount, step: 1, chunk: { type: "text-delta", index: 0, text: "partial" } }));
    record({ kind: "crashed" });
    setTimeout(() => process.exit(1), 20);
    return;
  }
  if (SCENARIO.startsWith("operate")) {
    void emitOperateTurn(sessionId, promptCount);
    return;
  }
  if (SCENARIO === "title") {
    notify(sessionId, ev("session/title", { title: "假运行时标题", messageSeqs: [1], source: { kind: "fallback" } }));
  }
  if (SCENARIO === "tool") {
    notify(sessionId, ev("tool/call", { turn: promptCount, step: 1, callId: "call-1", name: "list_work_items", arguments: "{}" }));
    notify(sessionId, ev("tool/result", {
      turn: promptCount,
      step: 1,
      message: { role: "user", content: [{ type: "tool-result", toolCallId: "call-1", content: [{ type: "text", text: "[]" }], isError: false }] }
    }));
  }
  notify(sessionId, ev("assistant/chunk", { turn: promptCount, step: 1, chunk: { type: "reasoning-delta", index: 0, text: "想一下" } }));
  notify(sessionId, ev("assistant/chunk", { turn: promptCount, step: 1, chunk: { type: "text-delta", index: 1, text: "你好" } }));
  notify(sessionId, ev("assistant/chunk", { turn: promptCount, step: 1, chunk: { type: "text-delta", index: 1, text: "，世界" } }));
  notify(sessionId, ev("assistant/message", { turn: promptCount, step: 1, message: { role: "assistant", content: [{ type: "text", text: "你好，世界" }] } }));
  if (SCENARIO === "error") {
    notify(sessionId, ev("turn/end", { turn: promptCount, reason: { kind: "error", error: { message: "boom" } } }));
    return;
  }
  notify(sessionId, ev("turn/end", { turn: promptCount, reason: { kind: "completed" } }));
}

record({
  kind: "boot",
  env: {
    operate: process.env.OPENFORGE_BRIDGE_ENABLE_OPERATE ?? null,
    hasLlmKey: (process.env.DSH_LLM_API_KEY ?? "") !== "",
    llmApi: process.env.DSH_LLM_API ?? null,
    llmBaseUrl: process.env.DSH_LLM_BASE_URL ?? null,
    llmModel: process.env.DSH_LLM_MODEL_ID ?? null,
    userId: process.env.OPENFORGE_USER_ID ?? null,
    hasBridgeToken: (process.env.OPENFORGE_COPILOT_BRIDGE_TOKEN ?? "") !== "",
    hasMasterKey: process.env.OPENFORGE_MASTER_KEY !== undefined,
    hasJwtSecret: process.env.OPENFORGE_JWT_SECRET !== undefined,
    sessionRoot: process.env.DSH_SESSION_ROOT ?? null,
    bridgeConfig: process.env.DSH_BRIDGE_CONFIG ?? null
  }
});

let buffer = "";
let promptCount = 0;
process.stdin.on("data", (chunk) => {
  buffer += chunk.toString("utf8");
  let nl = buffer.indexOf("\n");
  while (nl >= 0) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (line !== "") handle(JSON.parse(line));
    nl = buffer.indexOf("\n");
  }
});

function handle(frame) {
  // Response to one of OUR outbound requests (approval/decide).
  if (typeof frame.id === "string" && frame.id.startsWith("fake-req-") && (("result" in frame) || ("error" in frame))) {
    const pending = pendingRequests.get(frame.id);
    if (pending) {
      pendingRequests.delete(frame.id);
      pending(frame);
    }
    return;
  }
  if (frame.method === "initialize") {
    record({ kind: "initialize", params: { provider: frame.params?.provider, model: frame.params?.model } });
    send({ jsonrpc: "2.0", id: frame.id, result: { serverInfo: { name: "fake-dsh-runtime", version: "0.0.1" } } });
    return;
  }
  if (frame.method === "session/prompt") {
    promptCount += 1;
    const sessionId = frame.params?.sessionId;
    record({ kind: "prompt", sessionId, promptCount });
    send({ jsonrpc: "2.0", id: frame.id, result: { messageId: `m-${promptCount}` } });
    setImmediate(() => emitTurn(sessionId, promptCount));
    return;
  }
  if (frame.method === "session/inject") {
    record({ kind: "inject", sessionId: frame.params?.sessionId, text: frame.params?.text });
    send({ jsonrpc: "2.0", id: frame.id, result: { injected: true } });
    return;
  }
  if (frame.method === "shutdown") {
    record({ kind: "shutdown" });
    send({ jsonrpc: "2.0", id: frame.id, result: {} });
    setTimeout(() => process.exit(0), 10);
    return;
  }
  if (frame.id !== undefined) {
    send({ jsonrpc: "2.0", id: frame.id, error: { code: -32601, message: `unknown method ${frame.method}` } });
  }
}
