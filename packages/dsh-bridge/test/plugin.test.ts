import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, it } from "node:test";

import type { ToolRunContext } from "@deepseek-ai/dsh-tools";

import { BridgeClient } from "../src/bridge-client.js";
import { createBridgeTools } from "../src/plugin.js";

const servers: Server[] = [];

/** Minimal exec stub: the tool bodies read only `signal`. */
function stubExec(): ToolRunContext {
  return { signal: new AbortController().signal } as unknown as ToolRunContext;
}

/** Start a capture-all stub; the route table maps `${method} ${pathname}` to a data payload. */
async function startStub(routes: Readonly<Record<string, unknown>>): Promise<{ url: string; calls: string[] }> {
  const calls: string[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const url = new URL(req.url ?? "", "http://stub");
      const routeKey = `${req.method} ${url.pathname}`;
      calls.push(`${routeKey} ${Buffer.concat(chunks).toString("utf8")} query=${url.search}`);
      const hit = routes[routeKey];
      const envelope = hit === undefined
        ? { code: 1, message: `stub: no route for ${routeKey}`, details: {} }
        : { code: 0, data: hit, message: "" };
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(envelope));
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, calls };
}

afterEach(() => {
  while (servers.length > 0) servers.pop()?.close();
});

describe("createBridgeTools", () => {
  it("registers only the read-only tools by default (operate-gated)", async () => {
    const stub = await startStub({});
    const tools = createBridgeTools(new BridgeClient({
      gatewayUrl: stub.url, token: "t", userId: "u", timeoutMs: 2000,
    }));
    assert.deepEqual(
      tools.map((t) => t.name).sort(),
      ["list_sessions", "list_work_items"],
    );
  });

  it("registers exactly the four bridge tools when operate is enabled", async () => {
    const stub = await startStub({});
    const tools = createBridgeTools(new BridgeClient({
      gatewayUrl: stub.url, token: "t", userId: "u", timeoutMs: 2000,
    }), { enableOperate: true });
    assert.deepEqual(
      tools.map((t) => t.name).sort(),
      ["advance_work_item", "dispatch_task_to_session", "list_sessions", "list_work_items"],
    );
  });

  it("maps list_work_items args to the work-items query", async () => {
    const stub = await startStub({ "GET /api/internal/v1/copilot-bridge/work-items": { workItems: [{ id: "WI-1" }], count: 1 } });
    const tools = createBridgeTools(new BridgeClient({
      gatewayUrl: stub.url, token: "t", userId: "u", timeoutMs: 2000,
    }));
    const tool = tools.find((t) => t.name === "list_work_items");
    assert.ok(tool);
    const value = await tool.execute({ status: "pending" }, stubExec());
    assert.deepEqual(value, [{ id: "WI-1" }]);
    assert.match(stub.calls[0] ?? "", /query=\?status=pending/);
  });

  it("maps advance_work_item args to the advance endpoint", async () => {
    const stub = await startStub({ "POST /api/internal/v1/copilot-bridge/work-items/WI-1/advance": { status: "in_progress" } });
    const tools = createBridgeTools(new BridgeClient({
      gatewayUrl: stub.url, token: "t", userId: "u", timeoutMs: 2000,
    }), { enableOperate: true });
    const tool = tools.find((t) => t.name === "advance_work_item");
    assert.ok(tool);
    const value = await tool.execute({ id: "WI-1", note: "开工" }, stubExec());
    assert.deepEqual(value, { status: "in_progress" });
    assert.match(stub.calls[0] ?? "", /"note":"开工"/);
  });

  it("maps dispatch_task_to_session args to the dispatch endpoint", async () => {
    const stub = await startStub({ "POST /api/internal/v1/copilot-bridge/sessions/sess-9/dispatch": { ok: true } });
    const tools = createBridgeTools(new BridgeClient({
      gatewayUrl: stub.url, token: "t", userId: "u", timeoutMs: 2000,
    }), { enableOperate: true });
    const tool = tools.find((t) => t.name === "dispatch_task_to_session");
    assert.ok(tool);
    const value = await tool.execute({ sessionId: "sess-9", message: "处理 WI-1" }, stubExec());
    assert.deepEqual(value, { ok: true });
    assert.match(stub.calls[0] ?? "", /"message":"处理 WI-1"/);
  });

  it("surfaces Gateway envelope errors as tool failures", async () => {
    const stub = await startStub({}); // no routes -> error envelope
    const tools = createBridgeTools(new BridgeClient({
      gatewayUrl: stub.url, token: "t", userId: "u", timeoutMs: 2000,
    }));
    const tool = tools.find((t) => t.name === "list_sessions");
    assert.ok(tool);
    await assert.rejects(tool.execute({}, stubExec()), /no route/);
  });
});
