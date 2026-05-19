import { describe, expect, it } from "vitest";

import {
  shouldAutoConnectSession,
  shouldLoadSessionActivities,
  shouldShowSessionPreparing,
} from "./session-connect-state";

describe("session connection state helpers", () => {
  it("does not auto-connect again after a connect error", () => {
    expect(
      shouldAutoConnectSession({
        sessionId: "missing-session",
        hasAuthToken: true,
        hasAttachTokenOverride: false,
        isConnecting: false,
        hasConnectedSession: false,
        hasConnectError: true,
      })
    ).toBe(false);
  });

  it("shows the error state instead of preparing after a connect error", () => {
    expect(
      shouldShowSessionPreparing({
        hasAuthToken: true,
        hasAttachTokenOverride: false,
        connectStatus: "idle",
        hasConnectError: true,
      })
    ).toBe(false);
  });

  it("does not load activity for a session that failed to resolve", () => {
    expect(shouldLoadSessionActivities({ sessionId: "missing-session", hasSession: false })).toBe(false);
    expect(shouldLoadSessionActivities({ sessionId: "live-session", hasSession: true })).toBe(true);
  });
});
