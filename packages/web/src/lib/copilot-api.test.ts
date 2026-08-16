import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  cancelRun,
  createConversation,
  decidePendingAction,
  deleteMemoryEntry,
  getCopilotCapabilities,
  getRun,
  listConversations,
  listMemoryEntries,
  listMessages,
  searchMemory,
  sendMessage,
  writeMemoryEntry,
} from "./copilot-api";

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
});
