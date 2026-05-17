import { describe, expect, it } from "vitest";

import { resolveCopilotRouteContext } from "./copilot-route-context";

describe("resolveCopilotRouteContext", () => {
  it("uses the project id as Copilot context on project detail pages", () => {
    expect(resolveCopilotRouteContext("/projects/project-123")).toEqual({
      source: "project",
      sourceRefId: "project-123",
    });
  });

  it("uses the session id as Copilot context on session detail pages", () => {
    expect(resolveCopilotRouteContext("/sessions/session-456")).toEqual({
      source: "session",
      sourceRefId: "session-456",
    });
  });

  it("maps top-level management pages to stable Copilot sources", () => {
    expect(resolveCopilotRouteContext("/")).toEqual({ source: "dashboard" });
    expect(resolveCopilotRouteContext("/models")).toEqual({ source: "models" });
    expect(resolveCopilotRouteContext("/settings")).toEqual({ source: "settings" });
  });

  it("falls back to Copilot source for unsupported paths", () => {
    expect(resolveCopilotRouteContext(null)).toEqual({ source: "copilot" });
    expect(resolveCopilotRouteContext("/agents")).toEqual({ source: "copilot" });
  });
});
