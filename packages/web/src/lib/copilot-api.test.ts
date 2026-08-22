import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  cancelRun,
  createConversation,
  decidePendingAction,
  deleteMemoryEntry,
  getCopilotCapabilities,
  getDshConfig,
  getRun,
  listConversations,
  listMemoryEntries,
  listMessages,
  searchMemory,
  sendMessage,
  updateDshConfig,
  writeMemoryEntry,
} from "./copilot-api";
import { GatewayApiError } from "./api";

const BASE = "http://127.0.0.1:48731";

function mockEnvelope(data: unknown = {}) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ code: 0, data, message: "" }),
  } as Response);
}

describe("copilot api client", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.stubGlobal("fetch", vi.fn(() => mockEnvelope({})));
  });

  it("lists conversations through REST", async () => {
    await listConversations();
    expect(fetch).toHaveBeenCalledWith(
      `${BASE}/api/v1/copilot/conversations`,
      expect.anything()
    );
  });

  it("creates a conversation with a title", async () => {
    await createConversation("My plan");
    expect(fetch).toHaveBeenCalledWith(
      `${BASE}/api/v1/copilot/conversations`,
      expect.objectContaining({ method: "POST", body: JSON.stringify({ title: "My plan" }) })
    );
  });

  it("lists messages for a conversation", async () => {
    await listMessages("conv-1");
    expect(fetch).toHaveBeenCalledWith(
      `${BASE}/api/v1/copilot/conversations/conv-1/messages`,
      expect.anything()
    );
  });

  it("sends a message and returns the run id", async () => {
    vi.stubGlobal("fetch", vi.fn(() => mockEnvelope({ runId: "run-9" })));
    const result = await sendMessage("conv-1", "hello");
    expect(result.runId).toBe("run-9");
    expect(fetch).toHaveBeenCalledWith(
      `${BASE}/api/v1/copilot/conversations/conv-1/messages`,
      expect.objectContaining({ method: "POST", body: JSON.stringify({ content: "hello" }) })
    );
  });

  it("gets a run with its pending actions", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => mockEnvelope({ run: { id: "run-1" }, pendingActions: [] }))
    );
    const { run, pendingActions } = await getRun("run-1");
    expect(run.id).toBe("run-1");
    expect(pendingActions).toEqual([]);
  });

  it("cancels a run through POST", async () => {
    await cancelRun("run-1");
    expect(fetch).toHaveBeenCalledWith(
      `${BASE}/api/v1/copilot/runs/run-1/cancel`,
      expect.objectContaining({ method: "POST" })
    );
  });

  it("decides a pending action with an approve flag", async () => {
    await decidePendingAction("run-1", "action-1", true);
    expect(fetch).toHaveBeenCalledWith(
      `${BASE}/api/v1/copilot/runs/run-1/pending-actions/action-1/decide`,
      expect.objectContaining({ method: "POST", body: JSON.stringify({ approved: true }) })
    );
  });

  it("writes a scoped memory entry", async () => {
    await writeMemoryEntry({ kind: "fact", scope: "global", text: "user likes green" });
    expect(fetch).toHaveBeenCalledWith(
      `${BASE}/api/v1/copilot/memory/entries`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ kind: "fact", scope: "global", text: "user likes green" }),
      })
    );
  });

  it("lists memory entries with query params", async () => {
    await listMemoryEntries({ scope: "project", projectId: "p-1", limit: 5 });
    const url = `${BASE}/api/v1/copilot/memory/entries?scope=project&projectId=p-1&limit=5`;
    expect(fetch).toHaveBeenCalledWith(url, expect.anything());
  });

  it("searches memory by query", async () => {
    await searchMemory("green", { scope: "global" });
    expect(fetch).toHaveBeenCalledWith(
      `${BASE}/api/v1/copilot/memory/search?q=green&scope=global`,
      expect.anything()
    );
  });

  it("deletes a memory entry", async () => {
    await deleteMemoryEntry("mem-1");
    expect(fetch).toHaveBeenCalledWith(
      `${BASE}/api/v1/copilot/memory/entries/mem-1`,
      expect.objectContaining({ method: "DELETE" })
    );
  });

  it("fetches capabilities", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => mockEnvelope({ tools: [{ name: "list_projects", risk: "read", requiresApproval: false }] }))
    );
    const { tools } = await getCopilotCapabilities();
    expect(tools[0]?.name).toBe("list_projects");
  });

  const dshConfigPayload = {
    defaultModelId: "model-1",
    plugins: { "openforge-bridge": true, "mcp-client": false },
    availablePlugins: [
      { id: "openforge-bridge", label: "OpenForge Bridge", description: "平台工具" },
      { id: "mcp-client", label: "MCP Client", description: "外部工具接入" },
    ],
    runtime: { status: "running" },
  };

  it("gets the dsh config and validates the response shape", async () => {
    vi.stubGlobal("fetch", vi.fn(() => mockEnvelope(dshConfigPayload)));
    const config = await getDshConfig();
    expect(fetch).toHaveBeenCalledWith(
      `${BASE}/api/v1/copilot/dsh-config`,
      expect.anything()
    );
    expect(config.defaultModelId).toBe("model-1");
    expect(config.plugins["openforge-bridge"]).toBe(true);
    expect(config.availablePlugins).toHaveLength(2);
    expect(config.runtime.status).toBe("running");
  });

  it("rejects a malformed dsh config payload", async () => {
    vi.stubGlobal("fetch", vi.fn(() => mockEnvelope({ defaultModelId: 42 })));
    await expect(getDshConfig()).rejects.toThrow();
  });

  it("updates the dsh config through PUT and parses the envelope", async () => {
    vi.stubGlobal("fetch", vi.fn(() => mockEnvelope({ ...dshConfigPayload, defaultModelId: null })));
    const config = await updateDshConfig({ defaultModelId: null, plugins: { "openforge-bridge": false } });
    expect(fetch).toHaveBeenCalledWith(
      `${BASE}/api/v1/copilot/dsh-config`,
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ defaultModelId: null, plugins: { "openforge-bridge": false } }),
      })
    );
    expect(config.defaultModelId).toBeNull();
  });

  it("throws GatewayApiError on an envelope error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ code: 1, message: "unknown plugin", details: { plugin: "x" } }),
        } as Response)
      )
    );
    await expect(updateDshConfig({ plugins: { x: true } })).rejects.toMatchObject({
      name: "GatewayApiError",
      message: "unknown plugin",
    });
  });

  it("surfaces 404 as GatewayApiError so the UI can treat the feature as unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 404,
          json: () => Promise.resolve({ code: 1, message: "Not Found" }),
        } as Response)
      )
    );
    const error = await getDshConfig().catch((err: unknown) => err);
    expect(error).toBeInstanceOf(GatewayApiError);
    expect((error as GatewayApiError).status).toBe(404);
  });
});
