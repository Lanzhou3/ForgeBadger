import { beforeEach, expect, it, vi } from "vitest";
import { fetchJson } from "./api";
import { approveDevelopmentAction, executeDevelopmentAction, getDevelopmentTask, listDevelopmentTasks, previewDevelopmentAction, type DevelopmentTask } from "./development-api";
import type { PlatformIntent } from "./platform-actions-api";
vi.mock("./api", () => ({ fetchJson: vi.fn() }));
beforeEach(() => vi.clearAllMocks());
it("encodes both project scope and task identifier", () => {
  listDevelopmentTasks("p&other=1");
  getDevelopmentTask("p&other=1", "task/other");
  expect(fetchJson).toHaveBeenNthCalledWith(1, "/api/v1/copilot/development/tasks?projectId=p%26other%3D1");
  expect(fetchJson).toHaveBeenNthCalledWith(2, "/api/v1/copilot/development/tasks/task%2Fother?projectId=p%26other%3D1");
});
it("binds acceptance to exact artifact and request identity without delegated authority", () => {
  previewDevelopmentAction({ id: "t", projectId: "p", artifactDigest: "artifact" } as DevelopmentTask, "accept", "same-key");
  expect(fetchJson).toHaveBeenCalledWith("/api/v1/platform-actions/preview", { method: "POST", body: JSON.stringify({ commandId: "development.task.accept", input: { projectId: "p", taskId: "t", artifactDigest: "artifact" }, idempotencyKey: "same-key" }) });
});
it("cancels without including unrelated artifact fields", () => {
  previewDevelopmentAction({ id: "t", projectId: "p", artifactDigest: "artifact" } as DevelopmentTask, "cancel", "same-key");
  expect(JSON.parse(vi.mocked(fetchJson).mock.calls[0]![1]!.body as string)).toEqual({ commandId: "development.task.cancel", input: { projectId: "p", taskId: "t" }, idempotencyKey: "same-key" });
});
it("uses the exact intent digest for approval and a separate execute request", () => {
  approveDevelopmentAction({ id: "i/1", digest: "digest" } as PlatformIntent);
  expect(fetchJson).toHaveBeenCalledTimes(1);
  expect(fetchJson).toHaveBeenLastCalledWith("/api/v1/platform-actions/i%2F1/decide", { method: "POST", body: JSON.stringify({ digest: "digest", approved: true }) });
  executeDevelopmentAction("i/1");
  expect(fetchJson).toHaveBeenLastCalledWith("/api/v1/platform-actions/i%2F1/execute", { method: "POST", body: "{}" });
});
