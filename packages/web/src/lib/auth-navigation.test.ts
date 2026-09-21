// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  safeRedirectTarget,
  captureTeamInvitation,
  clearTeamInvitation,
} from "./auth-navigation";
describe("authentication return context", () => {
  beforeEach(() => {
    sessionStorage.clear();
    history.replaceState(null, "", "/join");
  });
  it("rejects cross-origin, backslash and control-character destinations", () => {
    for (const next of [
      "https://evil.invalid",
      "//evil.invalid",
      "/\\evil.invalid",
      "/%5cevil.invalid",
      "/\nevil.invalid",
    ])
      expect(safeRedirectTarget(next)).toBe("/");
    expect(safeRedirectTarget("/teams/a?view=members")).toBe(
      "/teams/a?view=members",
    );
  });
  it("removes an invitation from the address and preserves it only for this tab", () => {
    history.replaceState(null, "", "/join#token=one-use-invitation");
    expect(captureTeamInvitation()).toBe("one-use-invitation");
    expect(location.hash).toBe("");
    expect(captureTeamInvitation()).toBe("one-use-invitation");
    clearTeamInvitation();
    expect(captureTeamInvitation()).toBe("");
  });
});
