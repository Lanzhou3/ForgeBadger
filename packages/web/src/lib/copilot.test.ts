import { describe, expect, it } from "vitest";

import {
  getCopilotStatusTone,
  getCopilotEventLabel,
  getCopilotPendingActionLabel,
  resolveCopilotRunSelection,
  isCopilotRunLive,
} from "./copilot";

describe("copilot display helpers", () => {
  it("maps run statuses to stable tones", () => {
    expect(getCopilotStatusTone("completed")).toBe("success");
    expect(getCopilotStatusTone("failed")).toBe("danger");
    expect(getCopilotStatusTone("waiting_for_approval")).toBe("warning");
    expect(getCopilotStatusTone("running")).toBe("info");
    expect(getCopilotStatusTone("queued")).toBe("muted");
  });

  it("falls back to readable labels for unknown event types", () => {
    expect(getCopilotEventLabel("assistant_message")).toBe("Assistant message");
    expect(getCopilotEventLabel("openforge.custom_event")).toBe("Openforge custom event");
  });

  it("falls back to readable labels for unknown pending action types", () => {
    expect(getCopilotPendingActionLabel("openforge.propose_setting_update")).toBe("Setting update");
    expect(getCopilotPendingActionLabel("openforge.propose_memory_write")).toBe("Memory write");
    expect(getCopilotPendingActionLabel("custom.pending_action")).toBe("Custom pending action");
  });

  it("resolves selected Copilot run id from user selection, active run, or latest history", () => {
    expect(
      resolveCopilotRunSelection({
        selectedRunId: "run-selected",
        activeRunId: "run-active",
        runs: [{ id: "run-latest" }],
      })
    ).toBe("run-selected");
    expect(
      resolveCopilotRunSelection({
        activeRunId: "run-active",
        runs: [{ id: "run-latest" }],
      })
    ).toBe("run-active");
    expect(
      resolveCopilotRunSelection({
        runs: [{ id: "run-latest" }],
      })
    ).toBe("run-latest");
    expect(resolveCopilotRunSelection({ runs: [] })).toBeNull();
  });

  it("identifies Copilot run states that should keep refreshing", () => {
    expect(isCopilotRunLive("queued")).toBe(true);
    expect(isCopilotRunLive("running")).toBe(true);
    expect(isCopilotRunLive("waiting_for_approval")).toBe(true);
    expect(isCopilotRunLive("completed")).toBe(false);
    expect(isCopilotRunLive("failed")).toBe(false);
  });
});
