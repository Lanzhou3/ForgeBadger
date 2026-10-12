import { describe, expect, it } from "vitest";

import { normalizeSessionStatus, sessionMatchesStatusFilter } from "./session-status";

describe("session status helpers", () => {
  it("normalizes terminal end states to stopped for display", () => {
    expect(normalizeSessionStatus("stopped")).toBe("stopped");
    expect(normalizeSessionStatus("exited")).toBe("stopped");
    expect(normalizeSessionStatus("completed")).toBe("stopped");
    expect(normalizeSessionStatus(undefined)).toBe("stopped");
  });

  it("keeps lost as its own failure state instead of collapsing to stopped", () => {
    expect(normalizeSessionStatus("lost")).toBe("lost");
  });

  it("matches stopped filters against equivalent terminal end states", () => {
    expect(sessionMatchesStatusFilter("exited", "stopped")).toBe(true);
    expect(sessionMatchesStatusFilter("completed", "stopped")).toBe(true);
    expect(sessionMatchesStatusFilter("running", "stopped")).toBe(false);
  });

  it("matches lost only against the lost filter", () => {
    expect(sessionMatchesStatusFilter("lost", "lost")).toBe(true);
    expect(sessionMatchesStatusFilter("lost", "stopped")).toBe(false);
    expect(sessionMatchesStatusFilter("lost", "all")).toBe(true);
    expect(sessionMatchesStatusFilter("stopped", "lost")).toBe(false);
  });
});
