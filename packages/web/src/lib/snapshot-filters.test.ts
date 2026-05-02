import { describe, expect, it } from "vitest";

import {
  activityFiltersForProject,
  canRestoreSnapshot,
  snapshotFiltersFromSearchParams
} from "./snapshot-filters";

describe("snapshot filters", () => {
  it("reads project and session filters from search params", () => {
    const filters = snapshotFiltersFromSearchParams(
      new URLSearchParams("projectId=project-1&sessionId=session-1")
    );

    expect(filters).toEqual({
      projectId: "project-1",
      sessionId: "session-1"
    });
  });

  it("ignores empty filter values", () => {
    const filters = snapshotFiltersFromSearchParams(
      new URLSearchParams("projectId=&sessionId=session-1")
    );

    expect(filters).toEqual({ sessionId: "session-1" });
  });

  it("enables snapshot restore only when project metadata is available", () => {
    expect(canRestoreSnapshot({ projectId: "project-1" })).toBe(true);
    expect(canRestoreSnapshot({ projectId: null })).toBe(false);
    expect(canRestoreSnapshot({})).toBe(false);
  });

  it("builds project activity filters with optional agent scope", () => {
    expect(activityFiltersForProject("project-1", "")).toEqual({
      projectId: "project-1"
    });
    expect(activityFiltersForProject("project-1", "agent-1")).toEqual({
      projectId: "project-1",
      agentId: "agent-1"
    });
  });
});
