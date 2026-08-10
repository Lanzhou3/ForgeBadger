import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { after, before, describe, it } from "node:test";

import { OPENFORGE_OPENCODE_PLUGIN_TEMPLATE } from "../src/services/opencode-notification-settings.js";

interface CapturedRequest {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

interface PluginHandler {
  event: (input: { event?: Record<string, unknown> | undefined }) => Promise<void>;
}

const ENV_KEYS = [
  "OPENFORGE_GATEWAY_URL",
  "OPENFORGE_SESSION_ID",
  "OPENFORGE_ATTACH_TOKEN"
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
  adapter: "opencode"
};

describe("OpenCode plugin event extraction (realistic fixture)", () => {
  let pluginDir: string;
  let loadCounter: number;
  let captured: CapturedRequest | null;
  let originalFetch: typeof fetch;

  before(async () => {
    pluginDir = await mkdtemp(path.join(tmpdir(), "openforge-opencode-extract-"));
    loadCounter = 0;
    captured = null;
    originalFetch = globalThis.fetch;
  });

  after(() => {
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
    const file = path.join(pluginDir, `openforge-permission-notify-${loadCounter}.js`);
    await writeFile(file, OPENFORGE_OPENCODE_PLUGIN_TEMPLATE, "utf8");
    const mod = (await import(pathToFileURL(file).href)) as {
      OpenForgePermissionNotify: () => Promise<PluginHandler>;
    };
    return mod.OpenForgePermissionNotify();
  }

  it("POSTs the expected body for a realistic permission.asked event", async () => {
    setEnv({
      OPENFORGE_GATEWAY_URL: "http://127.0.0.1:48731/",
      OPENFORGE_SESSION_ID: "sess-opencode-1",
      OPENFORGE_ATTACH_TOKEN: "attach-token-123"
    });
    mockFetch();
    const handler = await loadHandler();

    await handler.event(REALISTIC_PERMISSION_ASKED);

    assert.ok(captured, "expected a fetch call");
    assert.equal(
      captured?.url,
      "http://127.0.0.1:48731/api/v1/session-hooks/claude-notification/sess-opencode-1"
    );
    assert.equal(captured?.headers["content-type"], "application/json");
    assert.equal(captured?.headers["x-openforge-session-id"], "sess-opencode-1");
    assert.equal(captured?.headers["x-openforge-session-token"], "attach-token-123");
    assert.deepEqual(captured?.body, EXPECTED_PERMISSION_BODY);
  });

  it("falls back to a plain permission label when permission is not a string", async () => {
    setEnv({
      OPENFORGE_GATEWAY_URL: "http://127.0.0.1:48731",
      OPENFORGE_SESSION_ID: "sess-opencode-1",
      OPENFORGE_ATTACH_TOKEN: "attach-token-123"
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

  it("falls back to a generic message when properties are missing", async () => {
    setEnv({
      OPENFORGE_GATEWAY_URL: "http://127.0.0.1:48731",
      OPENFORGE_SESSION_ID: "sess-opencode-1",
      OPENFORGE_ATTACH_TOKEN: "attach-token-123"
    });
    mockFetch();
    const handler = await loadHandler();

    await handler.event({ event: { id: "evt-3", type: "permission.asked" } });

    assert.ok(captured);
    assert.equal(captured?.body.message, "OpenCode permission request");
    assert.equal(captured?.body.tool_name, "OpenCode");
  });

  it("derives tool_name from metadata.tool when tool is a reference object", async () => {
    setEnv({
      OPENFORGE_GATEWAY_URL: "http://127.0.0.1:48731",
      OPENFORGE_SESSION_ID: "sess-opencode-1",
      OPENFORGE_ATTACH_TOKEN: "attach-token-123"
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
      OPENFORGE_GATEWAY_URL: "http://127.0.0.1:48731",
      OPENFORGE_SESSION_ID: "sess-opencode-1",
      OPENFORGE_ATTACH_TOKEN: "attach-token-123"
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
      OPENFORGE_GATEWAY_URL: "http://127.0.0.1:48731",
      OPENFORGE_SESSION_ID: "sess-opencode-1",
      OPENFORGE_ATTACH_TOKEN: "attach-token-123"
    });
    mockFetch();
    const handler = await loadHandler();

    await handler.event({ event: { id: "evt-6", type: "text.delta", properties: {} } });

    assert.equal(captured, null);
  });

  it("no-ops without fetching when GATEWAY_URL is missing", async () => {
    setEnv({
      OPENFORGE_SESSION_ID: "sess-opencode-1",
      OPENFORGE_ATTACH_TOKEN: "attach-token-123"
    });
    mockFetch();
    const handler = await loadHandler();

    await handler.event(REALISTIC_PERMISSION_ASKED);

    assert.equal(captured, null);
  });

  it("no-ops without fetching when SESSION_ID is missing", async () => {
    setEnv({
      OPENFORGE_GATEWAY_URL: "http://127.0.0.1:48731",
      OPENFORGE_ATTACH_TOKEN: "attach-token-123"
    });
    mockFetch();
    const handler = await loadHandler();

    await handler.event(REALISTIC_PERMISSION_ASKED);

    assert.equal(captured, null);
  });

  it("no-ops without fetching when ATTACH_TOKEN is missing", async () => {
    setEnv({
      OPENFORGE_GATEWAY_URL: "http://127.0.0.1:48731",
      OPENFORGE_SESSION_ID: "sess-opencode-1"
    });
    mockFetch();
    const handler = await loadHandler();

    await handler.event(REALISTIC_PERMISSION_ASKED);

    assert.equal(captured, null);
  });
});
