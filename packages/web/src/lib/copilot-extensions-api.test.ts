import { beforeEach, expect, it, vi } from "vitest";
import * as extensions from "./copilot-extensions-api";
const fetchJson = vi.hoisted(() => vi.fn().mockResolvedValue({}));
vi.mock("@/lib/api", () => ({ fetchJson }));
beforeEach(() => vi.clearAllMocks());
it("pins skill updates and rollback to exact revisions while retaining all files", async () => {
  const files = [{ path: "SKILL.md", content: "guide" }, { path: "references/a.md", content: "reference" }];
  await extensions.importCopilotSkill({ source: { kind: "upload" }, files });
  expect(fetchJson).toHaveBeenLastCalledWith("/api/v1/copilot/skills/imports", { method: "POST", body: JSON.stringify({ source: { kind: "upload" }, files }) });
  await extensions.updateCopilotSkill("owner/id", { expectedRevisionId: "r1", files, reviewedVersion: "2.0.0" });
  expect(fetchJson).toHaveBeenLastCalledWith("/api/v1/copilot/skills/owner%2Fid", { method: "PUT", body: JSON.stringify({ expectedRevisionId: "r1", files, reviewedVersion: "2.0.0" }) });
  await extensions.rollbackCopilotSkill("owner/id", "r0", "r1");
  expect(fetchJson).toHaveBeenLastCalledWith("/api/v1/copilot/skills/owner%2Fid/rollback", { method: "POST", body: JSON.stringify({ revisionId: "r0", expectedRevisionId: "r1" }) });
});
it("uses revision-bound connection discovery, selection and deletion", async () => {
  await extensions.discoverCopilotConnection("c/1", 3);
  expect(fetchJson).toHaveBeenLastCalledWith("/api/v1/copilot/connections/c%2F1/discover", { method: "POST", body: JSON.stringify({ revision: 3 }) });
  await extensions.updateCopilotConnection("c/1", { revision: 4, enabledTools: ["search"] });
  expect(fetchJson).toHaveBeenLastCalledWith("/api/v1/copilot/connections/c%2F1", { method: "PUT", body: JSON.stringify({ revision: 4, enabledTools: ["search"] }) });
  await extensions.deleteCopilotConnection("c/1", 5);
  expect(fetchJson).toHaveBeenLastCalledWith("/api/v1/copilot/connections/c%2F1?revision=5", { method: "DELETE" });
});
