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
  const READ_TOOLS = [
    "get_project", "get_project_dossier", "get_session_output", "get_usage_summary",
    "get_work_item", "list_memory", "list_portfolio_requests", "list_projects",
    "list_sessions", "list_skills", "list_work_items", "load_skill",
    "pm_get_task_packet", "pm_list_task_packets", "portfolio_overview",
    "project_graph_affected_paths", "project_graph_impact", "project_graph_search",
    "project_graph_symbol_detail", "search_memory",
  ];
  const ALL_TOOLS = [...READ_TOOLS, "advance_work_item", "create_project",
    "dispatch_task_to_session", "pm_start_task_packet", "write_memory"].sort();

  it("registers only the read-only tools by default (operate-gated)", async () => {
    const stub = await startStub({});
    const tools = createBridgeTools(new BridgeClient({
      gatewayUrl: stub.url, token: "t", userId: "u", timeoutMs: 2000,
    }));
    assert.deepEqual(tools.map((t) => t.name).sort(), READ_TOOLS);
  });

  it("registers exactly the twenty-one bridge tools when operate is enabled", async () => {
    const stub = await startStub({});
    const tools = createBridgeTools(new BridgeClient({
      gatewayUrl: stub.url, token: "t", userId: "u", timeoutMs: 2000,
    }), { enableOperate: true });
    assert.deepEqual(tools.map((t) => t.name).sort(), ALL_TOOLS);
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

  /** Find one tool on an operate-enabled surface. */
  async function toolOn(stubRoutes: Readonly<Record<string, unknown>>, name: string) {
    const stub = await startStub(stubRoutes);
    const tools = createBridgeTools(new BridgeClient({
      gatewayUrl: stub.url, token: "t", userId: "u", timeoutMs: 2000,
    }), { enableOperate: true });
    const tool = tools.find((t) => t.name === name);
    assert.ok(tool, `${name} registered`);
    return { tool, calls: stub.calls };
  }

  it("maps list_projects args to the projects query", async () => {
    const { tool, calls } = await toolOn({ "GET /api/internal/v1/copilot-bridge/projects": { projects: [{ id: "P-1" }], count: 1 } }, "list_projects");
    const value = await tool.execute({ limit: 5 }, stubExec());
    assert.deepEqual(value, [{ id: "P-1" }]);
    assert.match(calls[0] ?? "", /query=\?limit=5/);
  });

  it("maps get_project args to the project detail endpoint", async () => {
    const { tool, calls } = await toolOn({ "GET /api/internal/v1/copilot-bridge/projects/P-1": { found: true, project: { id: "P-1" } } }, "get_project");
    const value = await tool.execute({ projectId: "P-1" }, stubExec());
    assert.deepEqual(value, { found: true, project: { id: "P-1" } });
    assert.match(calls[0] ?? "", /^GET \/api\/internal\/v1\/copilot-bridge\/projects\/P-1 /);
  });

  it("maps create_project args to the create endpoint", async () => {
    const { tool, calls } = await toolOn({ "POST /api/internal/v1/copilot-bridge/projects": { created: true, projectId: "P-9", name: "demo" } }, "create_project");
    const value = await tool.execute({ name: "demo", path: "/tmp/demo", description: "d" }, stubExec());
    assert.deepEqual(value, { created: true, projectId: "P-9", name: "demo" });
    assert.match(calls[0] ?? "", /"name":"demo","path":"\/tmp\/demo","description":"d"/);
  });

  it("maps project graph tools to their endpoints", async () => {
    const search = await toolOn(
      { "GET /api/internal/v1/copilot-bridge/projects/P-1/graph/search": { result: { available: true, symbols: [{ id: "fn:greet" }] } } },
      "project_graph_search",
    );
    const searchValue = await search.tool.execute({ projectId: "P-1", q: "greet", limit: 5 }, stubExec());
    assert.deepEqual(searchValue, { result: { available: true, symbols: [{ id: "fn:greet" }] } });
    assert.match(search.calls[0] ?? "", /query=\?q=greet&limit=5/);

    const detail = await toolOn(
      { "GET /api/internal/v1/copilot-bridge/projects/P-1/graph/symbols/fn%3Agreet": { result: { available: true, symbol: { id: "fn:greet" }, callers: [], callees: [] } } },
      "project_graph_symbol_detail",
    );
    const detailValue = await detail.tool.execute({ projectId: "P-1", symbolId: "fn:greet" }, stubExec());
    assert.equal((detailValue as { result: { symbol: { id: string } } }).result.symbol.id, "fn:greet");

    const impact = await toolOn(
      { "GET /api/internal/v1/copilot-bridge/projects/P-1/graph/symbols/fn%3Agreet/impact": { result: { available: true, nodes: [] } } },
      "project_graph_impact",
    );
    await impact.tool.execute({ projectId: "P-1", symbolId: "fn:greet", depth: 3 }, stubExec());
    assert.match(impact.calls[0] ?? "", /query=\?depth=3/);

    const affected = await toolOn(
      { "POST /api/internal/v1/copilot-bridge/projects/P-1/graph/affected": { result: { available: true, nodes: [] } } },
      "project_graph_affected_paths",
    );
    await affected.tool.execute({ projectId: "P-1", paths: ["src/b.ts"], depth: 2 }, stubExec());
    assert.match(affected.calls[0] ?? "", /"paths":\["src\/b.ts"\],"depth":2/);
  });

  it("maps portfolio read tools to their endpoints", async () => {
    const { tool: overview } = await toolOn({ "GET /api/internal/v1/copilot-bridge/portfolio/overview": { overview: { dossiers: [] } } }, "portfolio_overview");
    assert.deepEqual(await overview.execute({}, stubExec()), { dossiers: [] });

    const { tool: requests, calls } = await toolOn({ "GET /api/internal/v1/copilot-bridge/portfolio/requests": { requests: [{ id: "R-1" }], count: 1 } }, "list_portfolio_requests");
    assert.deepEqual(await requests.execute({ projectId: "P-1", limit: 3 }, stubExec()), [{ id: "R-1" }]);
    assert.match(calls[0] ?? "", /query=\?projectId=P-1&limit=3/);

    const { tool: dossier, calls: dossierCalls } = await toolOn({ "GET /api/internal/v1/copilot-bridge/portfolio/projects/P-1/dossier": { dossier: { objective: "o" } } }, "get_project_dossier");
    assert.deepEqual(await dossier.execute({ projectId: "P-1" }, stubExec()), { objective: "o" });
    assert.match(dossierCalls[0] ?? "", /portfolio\/projects\/P-1\/dossier/);

    const { tool: workItem } = await toolOn({ "GET /api/internal/v1/copilot-bridge/work-items/WI-7": { workItem: { id: "WI-7" } } }, "get_work_item");
    assert.deepEqual(await workItem.execute({ workItemId: "WI-7" }, stubExec()), { id: "WI-7" });
  });

  it("maps memory tools to their endpoints", async () => {
    const { tool: search, calls } = await toolOn({ "GET /api/internal/v1/copilot-bridge/memory/search": { entries: [{ id: "M-1" }] } }, "search_memory");
    assert.deepEqual(await search.execute({ query: "发布", scope: "project", projectId: "P-1" }, stubExec()), [{ id: "M-1" }]);
    assert.match(calls[0] ?? "", /memory\/search .*query=\?q=/);
    assert.match(calls[0] ?? "", /scope=project/);

    const { tool: list, calls: listCalls } = await toolOn({ "GET /api/internal/v1/copilot-bridge/memory/entries": { entries: [{ id: "M-2" }] } }, "list_memory");
    assert.deepEqual(await list.execute({ scope: "session" }, stubExec()), [{ id: "M-2" }]);
    assert.match(listCalls[0] ?? "", /memory\/entries .*scope=session/);

    const { tool: write, calls: writeCalls } = await toolOn({ "POST /api/internal/v1/copilot-bridge/memory/entries": { saved: true, id: "M-3" } }, "write_memory");
    assert.deepEqual(await write.execute({ kind: "decision", scope: "global", text: "选 A 方案" }, stubExec()), { saved: true, id: "M-3" });
    assert.match(writeCalls[0] ?? "", /"kind":"decision","scope":"global","text":"选 A 方案"/);
  });

  it("maps list_sessions filters to the sessions query", async () => {
    const { tool, calls } = await toolOn({ "GET /api/internal/v1/copilot-bridge/sessions": { sessions: [], count: 0 } }, "list_sessions");
    await tool.execute({ projectId: "P-1", limit: 10 }, stubExec());
    assert.match(calls[0] ?? "", /query=\?projectId=P-1&limit=10/);
  });
});
