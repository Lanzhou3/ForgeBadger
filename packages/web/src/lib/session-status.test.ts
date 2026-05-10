import { describe, expect, it } from "vitest";

import { normalizeSessionStatus, sessionMatchesStatusFilter } from "./session-status";

describe("session status helpers", () => {
  it("normalizes terminal end states to stopped for display", () => {
    expect(normalizeSessionStatus("stopped")).toBe("stopped");
    expect(normalizeSessionStatus("exited")).toBe("stopped");
    expect(normalizeSessionStatus("completed")).toBe("stopped");
    expect(normalizeSessionStatus(undefined)).toBe("stopped");
  });

  it("matches stopped filters against equivalent terminal end states", () => {
    expect(sessionMatchesStatusFilter("exited", "stopped")).toBe(true);
    expect(sessionMatchesStatusFilter("completed", "stopped")).toBe(true);
    expect(sessionMatchesStatusFilter("running", "stopped")).toBe(false);
  });
});
