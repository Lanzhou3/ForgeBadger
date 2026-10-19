import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { after, afterEach, before, describe, it, mock } from "node:test";

import { FORGEBADGER_OPENCODE_PLUGIN_TEMPLATE } from "../src/services/opencode-notification-settings.js";

interface CapturedRequest {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

interface PluginHandler {
  event: (input: { event?: Record<string, unknown> | undefined }) => Promise<void>;
}

const ENV_KEYS = [
  "FORGEBADGER_GATEWAY_URL",
  "FORGEBADGER_SESSION_ID",
  "FORGEBADGER_ATTACH_TOKEN"
] as const;

type PluginEnv = Partial<Record<(typeof ENV_KEYS)[number], string>>;

// Aligned to opencode 1.18.15 permission.asked event delivery shape:
// `{ event: { id, type, properties } }` with the payload under `properties`.
const REALISTIC_PERMISSION_ASKED = {
  event: {
    id: "evt-1",
    type: "permission.asked",
    properties: {
      id: "ask-1",
      sessionID: "sess-opencode-1",
      permission: "bash",
      patterns: ["/tmp/x.sh", "/tmp/y.sh"],
      metadata: { tool: "bash" },
      always: [],
      tool: { messageID: "m1", callID: "c1" }
    }
  }
};

const EXPECTED_PERMISSION_BODY = {
  hook_event_name: "PermissionRequest",
  notification_type: "permission_prompt",
  message: "bash /tmp/x.sh, /tmp/y.sh",
  tool_name: "bash",
  adapter: "opencode", session_id: "sess-opencode-1"
};

describe("OpenCode plugin event extraction (realistic fixture)", () => {
  let pluginDir: string;
  let loadCounter: number;
  let captured: CapturedRequest | null;
  let originalFetch: typeof fetch;

  before(async () => {
    pluginDir = await mkdtemp(path.join(tmpdir(), "forgebadger-opencode-extract-"));
    loadCounter = 0;
    mock.timers.enable({apis:["setTimeout"]});
    captured = null;
    originalFetch = globalThis.fetch;
  });

  after(() => {
    mock.timers.reset();
    globalThis.fetch = originalFetch;
    for (const key of ENV_KEYS) {
      delete process.env[key];
    }
  });

  function mockFetch(): void {
    captured = null;
    globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      captured = {
        url: String(url),
        headers: (init?.headers ?? {}) as Record<string, string>,
        body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>
      };
      return { ok: true, status: 200 } as Response;
    }) as typeof fetch;
  }

  function setEnv(values: PluginEnv): void {
    for (const key of ENV_KEYS) {
      if (values[key] !== undefined) {
        process.env[key] = values[key];
      } else {
        delete process.env[key];
      }
    }
  }

  // The template reads env at module load, so each invocation must import a
  // fresh module instance after the env has been prepared. Node caches ESM
  // modules by URL, and file: URLs are deduped across query strings, so a
  // unique file path per load is required to force re-evaluation.
  async function loadHandler(): Promise<PluginHandler> {
    loadCounter += 1;
    const file = path.join(pluginDir, `forgebadger-permission-notify-${loadCounter}.js`);
    await writeFile(file, FORGEBADGER_OPENCODE_PLUGIN_TEMPLATE, "utf8");
    const mod = (await import(pathToFileURL(file).href)) as {
      ForgeBadgerPermissionNotify: (input: unknown) => Promise<PluginHandler>;
    };
    let pending: Array<{id:string;sessionID:string}> = [];
    const plugin = await mod.ForgeBadgerPermissionNotify({client:{
      session:{get:async()=>({data:{id:"sess-opencode-1"}})},
      permission:{list:async()=>({data:pending})}
    }});
    return {event:async input=>{
      const props=input.event?.properties as {id?:string;sessionID?:string}|undefined;
      pending=props?.id && props.sessionID?[{id:props.id,sessionID:props.sessionID}]:[];
      await plugin.event(input);
      mock.timers.tick(1000);
      await new Promise(resolve=>setImmediate(resolve));
    }};
  }

  it("POSTs the expected body for a realistic permission.asked event", async () => {
    setEnv({
      FORGEBADGER_GATEWAY_URL: "http://127.0.0.1:18332/",
      FORGEBADGER_SESSION_ID: "sess-opencode-1",
      FORGEBADGER_ATTACH_TOKEN: "attach-token-123"
    });
    mockFetch();
    const handler = await loadHandler();

    await handler.event(REALISTIC_PERMISSION_ASKED);

    assert.ok(captured, "expected a fetch call");
    assert.equal(
      captured?.url,
      "http://127.0.0.1:18332/api/v1/session-hooks/cli-notification/sess-opencode-1"
    );
    assert.equal(captured?.headers["content-type"], "application/json");
    assert.equal(captured?.headers["x-forgebadger-session-id"], "sess-opencode-1");
    assert.equal(captured?.headers["x-forgebadger-session-token"], "attach-token-123");
    assert.deepEqual(captured?.body, EXPECTED_PERMISSION_BODY);
  });

  it("falls back to a plain permission label when permission is not a string", async () => {
    setEnv({
      FORGEBADGER_GATEWAY_URL: "http://127.0.0.1:18332",
      FORGEBADGER_SESSION_ID: "sess-opencode-1",
      FORGEBADGER_ATTACH_TOKEN: "attach-token-123"
    });
    mockFetch();
    const handler = await loadHandler();

    await handler.event({
      event: {
        id: "evt-2",
        type: "permission.asked",
        properties: {
          id: "ask-2",
          sessionID: "sess-opencode-1",
          permission: 42,
          patterns: "not-an-array",
          metadata: { tool: "bash" },
          always: [],
          tool: { messageID: "m2", callID: "c2" }
        }
      }
    });

    assert.ok(captured);
    assert.equal(captured?.body.message, "permission");
  });

  it("does not invent a pending permission when properties are missing", async () => {
    setEnv({
      FORGEBADGER_GATEWAY_URL: "http://127.0.0.1:18332",
      FORGEBADGER_SESSION_ID: "sess-opencode-1",
      FORGEBADGER_ATTACH_TOKEN: "attach-token-123"
    });
    mockFetch();
    const handler = await loadHandler();

    await handler.event({ event: { id: "evt-3", type: "permission.asked" } });

    assert.equal(captured, null);
  });

  it("derives tool_name from metadata.tool when tool is a reference object", async () => {
    setEnv({
      FORGEBADGER_GATEWAY_URL: "http://127.0.0.1:18332",
      FORGEBADGER_SESSION_ID: "sess-opencode-1",
      FORGEBADGER_ATTACH_TOKEN: "attach-token-123"
    });
    mockFetch();
    const handler = await loadHandler();

    await handler.event({
      event: {
        id: "evt-4",
        type: "permission.asked",
        properties: {
          id: "ask-4",
          sessionID: "sess-opencode-1",
          permission: "write",
          patterns: [],
          metadata: { tool: "edit" },
          always: [],
          tool: { messageID: "m4", callID: "c4" }
        }
      }
    });

    assert.ok(captured);
    assert.equal(captured?.body.tool_name, "edit");
  });

  it("falls back to OpenCode tool name when neither tool nor metadata.tool is present", async () => {
    setEnv({
      FORGEBADGER_GATEWAY_URL: "http://127.0.0.1:18332",
      FORGEBADGER_SESSION_ID: "sess-opencode-1",
      FORGEBADGER_ATTACH_TOKEN: "attach-token-123"
    });
    mockFetch();
    const handler = await loadHandler();

    await handler.event({
      event: {
        id: "evt-5",
        type: "permission.asked",
        properties: {
          id: "ask-5",
          sessionID: "sess-opencode-1",
          permission: "read",
          patterns: [],
          metadata: {},
          always: []
        }
      }
    });

    assert.ok(captured);
    assert.equal(captured?.body.tool_name, "OpenCode");
  });

  it("does not notify for non permission.asked events", async () => {
    setEnv({
      FORGEBADGER_GATEWAY_URL: "http://127.0.0.1:18332",
      FORGEBADGER_SESSION_ID: "sess-opencode-1",
      FORGEBADGER_ATTACH_TOKEN: "attach-token-123"
    });
    mockFetch();
    const handler = await loadHandler();

    await handler.event({ event: { id: "evt-6", type: "text.delta", properties: {} } });

    assert.equal(captured, null);
  });

  it("maps idle and error events to completion and failure notifications", async () => {
    setEnv({
      FORGEBADGER_GATEWAY_URL: "http://127.0.0.1:18332",
      FORGEBADGER_SESSION_ID: "sess-opencode-1",
      FORGEBADGER_ATTACH_TOKEN: "attach-token-123"
    });
    mockFetch();
    const handler = await loadHandler();

    await handler.event({event:{type:"session.status",properties:{sessionID:"sess-opencode-1",status:{type:"busy"}}}});
    await handler.event({ event: { id: "evt-idle", type: "session.idle", properties: {sessionID:"sess-opencode-1"} } });
    assert.deepEqual(captured?.body, {
      hook_event_name: "Stop",
      notification_type: "task_completed",
      message: "OpenCode task completed",
      adapter: "opencode", session_id: "sess-opencode-1"
    });

    await handler.event({event:{type:"session.status",properties:{sessionID:"sess-opencode-1",status:{type:"busy"}}}});
    await handler.event({ event: { id: "evt-error", type: "session.error", properties: {sessionID:"sess-opencode-1"} } });
    assert.deepEqual(captured?.body, {
      hook_event_name: "StopFailure",
      notification_type: "task_failed",
      message: "OpenCode task failed",
      adapter: "opencode", session_id: "sess-opencode-1"
    });
  });

  it("no-ops without fetching when GATEWAY_URL is missing", async () => {
    setEnv({
      FORGEBADGER_SESSION_ID: "sess-opencode-1",
      FORGEBADGER_ATTACH_TOKEN: "attach-token-123"
    });
    mockFetch();
    const handler = await loadHandler();

    await handler.event(REALISTIC_PERMISSION_ASKED);

    assert.equal(captured, null);
  });

  it("no-ops without fetching when SESSION_ID is missing", async () => {
    setEnv({
      FORGEBADGER_GATEWAY_URL: "http://127.0.0.1:18332",
      FORGEBADGER_ATTACH_TOKEN: "attach-token-123"
    });
    mockFetch();
    const handler = await loadHandler();

    await handler.event(REALISTIC_PERMISSION_ASKED);

    assert.equal(captured, null);
  });

  it("no-ops without fetching when ATTACH_TOKEN is missing", async () => {
    setEnv({
      FORGEBADGER_GATEWAY_URL: "http://127.0.0.1:18332",
      FORGEBADGER_SESSION_ID: "sess-opencode-1"
    });
    mockFetch();
    const handler = await loadHandler();

    await handler.event(REALISTIC_PERMISSION_ASKED);

    assert.equal(captured, null);
  });
});

interface V2PluginModule {
  default: {
    id: string;
    setup: (ctx: unknown) => Promise<(() => void) | void>;
    server: (input: unknown) => Promise<PluginHandler>;
  };
}

interface V2ContextHarness {
  ctx: Record<string, unknown>;
  push: (event: { type: string; data?: Record<string, unknown> }) => Promise<void>;
  firePrompt: (event: Record<string, unknown>) => void;
  setPending: (requests: Array<{ id: string; sessionID: string }>) => void;
}

describe("OpenCode plugin V2 entrypoint", () => {
  let pluginDir: string;
  let loadCounter: number;
  let capturedAll: CapturedRequest[];
  let originalFetch: typeof fetch;
  const cleanups: Array<() => void> = [];

  before(async () => {
    pluginDir = await mkdtemp(path.join(tmpdir(), "forgebadger-opencode-v2-"));
    loadCounter = 0;
    mock.timers.enable({ apis: ["setTimeout"] });
    capturedAll = [];
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    // Abort every subscription so the polling mock generators release the
    // event loop and the test process can exit.
    while (cleanups.length > 0) cleanups.pop()?.();
  });

  after(() => {
    mock.timers.reset();
    globalThis.fetch = originalFetch;
    for (const key of ENV_KEYS) {
      delete process.env[key];
    }
  });

  function mockFetchAll(): void {
    capturedAll = [];
    globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      capturedAll.push({
        url: String(url),
        headers: (init?.headers ?? {}) as Record<string, string>,
        body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>
      });
      return { ok: true, status: 200 } as Response;
    }) as typeof fetch;
  }

  function setEnv(values: PluginEnv): void {
    for (const key of ENV_KEYS) {
      if (values[key] !== undefined) {
        process.env[key] = values[key];
      } else {
        delete process.env[key];
      }
    }
  }

  async function flush(): Promise<void> {
    for (let index = 0; index < 25; index += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
  }

  // Mirrors the V2 plugin context: events arrive as { type, data } on
  // ctx.event.subscribe, permission.list takes { sessionID } and resolves to
  // the request array directly, and session.get resolves to SessionInfo.
  function createV2Context(): V2ContextHarness {
    const queue: Array<{ type: string; data?: Record<string, unknown> }> = [];
    let pending: Array<{ id: string; sessionID: string }> = [];
    let promptHook: ((event: Record<string, unknown>) => void) | null = null;
    let aborted = false;
    const ctx = {
      session: {
        hook: async (name: string, callback: (event: Record<string, unknown>) => void) => {
          if (name === "prompt") promptHook = callback;
          return { dispose: async () => {} };
        },
        // Only sess-opencode-1 is a root session; anything else is a child.
        get: async ({ sessionID }: { sessionID: string }) =>
          sessionID === "sess-opencode-1" ? { id: sessionID } : { id: sessionID, parentID: "sess-opencode-1" }
      },
      permission: {
        list: async ({ sessionID }: { sessionID: string }) =>
          sessionID === "sess-opencode-1" ? pending : []
      },
      event: {
        subscribe: ({ signal }: { signal?: AbortSignal } = {}) =>
          (async function* () {
            signal?.addEventListener("abort", () => {
              aborted = true;
            });
            while (!aborted) {
              const event = queue.shift();
              if (event) {
                yield event;
                continue;
              }
              await new Promise((resolve) => setImmediate(resolve));
            }
          })()
      }
    };
    return {
      ctx,
      firePrompt: (event) => promptHook?.(event),
      setPending: (requests) => {
        pending = requests;
      },
      push: async (event) => {
        queue.push(event);
        await flush();
      }
    };
  }

  async function loadV2(): Promise<{ plugin: V2PluginModule["default"]; harness: V2ContextHarness }> {
    loadCounter += 1;
    const file = path.join(pluginDir, `forgebadger-permission-notify-v2-${loadCounter}.js`);
    await writeFile(file, FORGEBADGER_OPENCODE_PLUGIN_TEMPLATE, "utf8");
    const mod = (await import(pathToFileURL(file).href)) as unknown as V2PluginModule;
    const harness = createV2Context();
    const cleanup = await mod.default.setup(harness.ctx);
    if (typeof cleanup === "function") cleanups.push(cleanup);
    await flush();
    return { plugin: mod.default, harness };
  }

  it("default-exports the V2 definition shape while keeping the V1 server entry", async () => {
    setEnv({
      FORGEBADGER_GATEWAY_URL: "http://127.0.0.1:18332",
      FORGEBADGER_SESSION_ID: "sess-opencode-1",
      FORGEBADGER_ATTACH_TOKEN: "attach-token-123"
    });
    loadCounter += 1;
    const file = path.join(pluginDir, `forgebadger-permission-notify-v2-${loadCounter}.js`);
    await writeFile(file, FORGEBADGER_OPENCODE_PLUGIN_TEMPLATE, "utf8");
    const mod = (await import(pathToFileURL(file).href)) as unknown as V2PluginModule;

    assert.equal(mod.default.id, "forgebadger-permission-notify");
    assert.equal(typeof mod.default.setup, "function");
    assert.equal(typeof mod.default.server, "function");
    const hooks = await mod.default.server({ client: {} });
    assert.equal(typeof hooks.event, "function");
  });

  it("POSTs the expected body for a V2 permission.asked event", async () => {
    setEnv({
      FORGEBADGER_GATEWAY_URL: "http://127.0.0.1:18332",
      FORGEBADGER_SESSION_ID: "sess-opencode-1",
      FORGEBADGER_ATTACH_TOKEN: "attach-token-123"
    });
    mockFetchAll();
    const { harness } = await loadV2();
    harness.setPending([{ id: "ask-v2-1", sessionID: "sess-opencode-1" }]);

    await harness.push({
      type: "permission.asked",
      data: {
        id: "ask-v2-1",
        sessionID: "sess-opencode-1",
        action: "shell",
        resources: ["/tmp/x.sh", "/tmp/y.sh"],
        metadata: { tool: "bash" }
      }
    });
    mock.timers.tick(1000);
    await flush();

    assert.equal(capturedAll.length, 1);
    assert.equal(
      capturedAll[0]?.url,
      "http://127.0.0.1:18332/api/v1/session-hooks/cli-notification/sess-opencode-1"
    );
    assert.equal(capturedAll[0]?.headers["x-forgebadger-session-token"], "attach-token-123");
    assert.deepEqual(capturedAll[0]?.body, {
      hook_event_name: "PermissionRequest",
      notification_type: "permission_prompt",
      message: "shell /tmp/x.sh, /tmp/y.sh",
      tool_name: "bash",
      adapter: "opencode",
      session_id: "sess-opencode-1"
    });
  });

  it("does not invent a pending permission when the server list no longer has it", async () => {
    setEnv({
      FORGEBADGER_GATEWAY_URL: "http://127.0.0.1:18332",
      FORGEBADGER_SESSION_ID: "sess-opencode-1",
      FORGEBADGER_ATTACH_TOKEN: "attach-token-123"
    });
    mockFetchAll();
    const { harness } = await loadV2();
    harness.setPending([]);

    await harness.push({
      type: "permission.asked",
      data: { id: "ask-v2-2", sessionID: "sess-opencode-1", action: "edit", resources: ["a.ts"] }
    });
    mock.timers.tick(1000);
    await flush();

    assert.equal(capturedAll.length, 0);
  });

  it("reports prompt, busy, and idle lifecycle with the last assistant message", async () => {
    setEnv({
      FORGEBADGER_GATEWAY_URL: "http://127.0.0.1:18332",
      FORGEBADGER_SESSION_ID: "sess-opencode-1",
      FORGEBADGER_ATTACH_TOKEN: "attach-token-123"
    });
    mockFetchAll();
    const { harness } = await loadV2();

    harness.firePrompt({
      sessionID: "sess-opencode-1",
      messageID: "msg-u-1",
      prompt: { text: "fix the bug" }
    });
    await harness.push({
      type: "session.status",
      data: { sessionID: "sess-opencode-1", status: { type: "busy" } }
    });
    await harness.push({
      type: "session.text.ended",
      data: { sessionID: "sess-opencode-1", assistantMessageID: "msg-a-1", ordinal: 0, text: "all done" }
    });
    await harness.push({ type: "session.idle", data: { sessionID: "sess-opencode-1" } });

    assert.deepEqual(
      capturedAll.map((request) => request.body),
      [
        {
          hook_event_name: "UserPromptSubmit",
          prompt: "fix the bug",
          adapter: "opencode",
          session_id: "sess-opencode-1",
          turn_id: "msg-u-1"
        },
        {
          hook_event_name: "TaskStarted",
          adapter: "opencode",
          session_id: "sess-opencode-1",
          turn_id: "msg-u-1"
        },
        {
          hook_event_name: "Stop",
          notification_type: "task_completed",
          message: "OpenCode task completed",
          adapter: "opencode",
          session_id: "sess-opencode-1",
          turn_id: "msg-u-1",
          last_assistant_message: "all done"
        }
      ]
    );
  });

  it("maps session.execution.failed to a failure notification", async () => {
    setEnv({
      FORGEBADGER_GATEWAY_URL: "http://127.0.0.1:18332",
      FORGEBADGER_SESSION_ID: "sess-opencode-1",
      FORGEBADGER_ATTACH_TOKEN: "attach-token-123"
    });
    mockFetchAll();
    const { harness } = await loadV2();

    await harness.push({
      type: "session.status",
      data: { sessionID: "sess-opencode-1", status: { type: "busy" } }
    });
    capturedAll.length = 0;
    await harness.push({
      type: "session.execution.failed",
      data: {
        sessionID: "sess-opencode-1",
        error: { type: "ProviderError", message: "boom" }
      }
    });

    assert.equal(capturedAll.length, 1);
    assert.deepEqual(capturedAll[0]?.body, {
      hook_event_name: "StopFailure",
      notification_type: "task_failed",
      message: "OpenCode task failed",
      error_type: "ProviderError",
      error_message: "boom",
      adapter: "opencode",
      session_id: "sess-opencode-1"
    });
  });

  it("ignores lifecycle events for child sessions", async () => {
    setEnv({
      FORGEBADGER_GATEWAY_URL: "http://127.0.0.1:18332",
      FORGEBADGER_SESSION_ID: "sess-opencode-1",
      FORGEBADGER_ATTACH_TOKEN: "attach-token-123"
    });
    mockFetchAll();
    const { harness } = await loadV2();

    await harness.push({
      type: "session.status",
      data: { sessionID: "child-session-1", status: { type: "busy" } }
    });

    assert.equal(capturedAll.length, 0);
  });

  it("stops notifying after the setup cleanup aborts the subscription", async () => {
    setEnv({
      FORGEBADGER_GATEWAY_URL: "http://127.0.0.1:18332",
      FORGEBADGER_SESSION_ID: "sess-opencode-1",
      FORGEBADGER_ATTACH_TOKEN: "attach-token-123"
    });
    mockFetchAll();
    loadCounter += 1;
    const file = path.join(pluginDir, `forgebadger-permission-notify-v2-${loadCounter}.js`);
    await writeFile(file, FORGEBADGER_OPENCODE_PLUGIN_TEMPLATE, "utf8");
    const mod = (await import(pathToFileURL(file).href)) as unknown as V2PluginModule;
    const harness = createV2Context();
    const cleanup = await mod.default.setup(harness.ctx);
    if (typeof cleanup === "function") cleanups.push(cleanup);
    await flush();
    cleanup?.();

    await harness.push({
      type: "session.status",
      data: { sessionID: "sess-opencode-1", status: { type: "busy" } }
    });

    assert.equal(capturedAll.length, 0);
  });

  it("cancels a scheduled permission notification during cleanup", async () => {
    setEnv({
      FORGEBADGER_GATEWAY_URL: "http://127.0.0.1:18332",
      FORGEBADGER_SESSION_ID: "sess-opencode-1",
      FORGEBADGER_ATTACH_TOKEN: "attach-token-123"
    });
    mockFetchAll();
    loadCounter += 1;
    const file = path.join(pluginDir, `forgebadger-permission-notify-v2-${loadCounter}.js`);
    await writeFile(file, FORGEBADGER_OPENCODE_PLUGIN_TEMPLATE, "utf8");
    const mod = (await import(pathToFileURL(file).href)) as unknown as V2PluginModule;
    const harness = createV2Context();
    const cleanup = await mod.default.setup(harness.ctx);
    if (typeof cleanup === "function") cleanups.push(cleanup);
    await flush();
    harness.setPending([{ id: "ask-cleanup", sessionID: "sess-opencode-1" }]);
    await harness.push({
      type: "permission.asked",
      data: { id: "ask-cleanup", sessionID: "sess-opencode-1", action: "shell", resources: ["/tmp/x.sh"] }
    });

    cleanup?.();
    mock.timers.tick(1000);
    await flush();

    assert.equal(capturedAll.length, 0);
  });
});
