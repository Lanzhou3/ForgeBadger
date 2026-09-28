// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { collaborationApi, safeWorkspaceUrl } from "./collaboration-api";
import { GatewayApiError } from "./api";
const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  localStorage.setItem("forgebadger.token", "test-token");
});
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});
describe("collaboration HTTP contract", () => {
  it("uses the existing authenticated envelope and encoded project path", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ code: 0, data: { task: { id: "new-task" } } }),
        { status: 200 },
      ),
    );
    await collaborationApi.updateTask("project/one", "task/two", {
      title: "Task",
      description: "",
      acceptanceCriteria: ["Pass"],
      assigneeId: null,
      reviewerId: null,
      expectedRevision: 4,
    });
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(url).toContain(
      "/api/v1/collaboration/projects/project%2Fone/tasks/task%2Ftwo",
    );
    expect(options.method).toBe("PATCH");
    expect(options.headers.Authorization).toBe("Bearer test-token");
    expect(JSON.parse(options.body)).toMatchObject({
      expectedRevision: 4,
      acceptanceCriteria: ["Pass"],
    });
  });
  it("surfaces a revision conflict without retrying a mutation", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ code: 1, message: "STALE_TASK_REVISION" }),
        { status: 409 },
      ),
    );
    await expect(
      collaborationApi.review("p", "r", {
        expectedCommit: "head",
        verificationId: "receipt",
        decision: "accepted",
        note: "Looks good",
      }),
    ).rejects.toMatchObject({
      status: 409,
      message: "STALE_TASK_REVISION",
    } satisfies Partial<GatewayApiError>);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("sends the explicit recovery key", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ code: 0, data: {} }), { status: 200 }),
      ),
    );
    await collaborationApi.recover("p", "r", "stable-retry-token");
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({
      idempotencyKey: "stable-retry-token",
    });
  });
  it("never treats script or credential-bearing URLs as safe external links", () => {
    for (const url of [
      "javascript:alert(1)",
      "data:text/html,x",
      "https://user:secret@example.com",
      "//example.com",
      "not a url",
    ])
      expect(safeWorkspaceUrl(url)).toBeUndefined();
    expect(safeWorkspaceUrl("http://localhost:3000/preview")).toBe(
      "http://localhost:3000/preview",
    );
  });
});
