import { describe, expect, it } from "vitest";

import {
  getCopilotStatusTone,
  getCopilotEventLabel,
  getCopilotEventLabelKey,
  getCopilotPendingActionLabel,
  getCopilotPendingActionLabelKey,
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

  it("maps known event types to localized label keys", () => {
    expect(getCopilotEventLabelKey("assistant_message")).toBe("copilot.event.assistantMessage");
    expect(getCopilotEventLabelKey("tool_call_requested")).toBe("copilot.event.toolRequested");
    expect(getCopilotEventLabelKey("openforge.custom_event")).toBeNull();
  });

  it("falls back to readable labels for unknown pending action types", () => {
    expect(getCopilotPendingActionLabel("openforge.propose_setting_update")).toBe("Setting update");
    expect(getCopilotPendingActionLabel("openforge.propose_memory_write")).toBe("Memory write");
    expect(getCopilotPendingActionLabel("custom.pending_action")).toBe("Custom pending action");
  });

  it("maps known pending action types to localized label keys", () => {
    expect(getCopilotPendingActionLabelKey("openforge.propose_memory_write")).toBe("copilot.pendingAction.memoryWrite");
    expect(getCopilotPendingActionLabelKey("openforge.propose_diagnostics_export")).toBe("copilot.pendingAction.diagnosticsExport");
    expect(getCopilotPendingActionLabelKey("custom.pending_action")).toBeNull();
  });

  it("resolves selected Copilot run id from user selection, active run, or latest history", () => {
    expect(
      resolveCopilotRunSelection({
        selectedRunId: "run-selected",
        activeRunId: "run-active",
        runs: [{ id: "run-selected" }, { id: "run-latest" }],
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

  it("ignores stale Copilot run selections that are no longer in history", () => {
    expect(
      resolveCopilotRunSelection({
        selectedRunId: "run-stale",
        activeRunId: "run-active",
        runs: [{ id: "run-active" }, { id: "run-latest" }],
      })
    ).toBe("run-active");
    expect(
      resolveCopilotRunSelection({
        selectedRunId: "run-stale",
        runs: [{ id: "run-latest" }],
      })
    ).toBe("run-latest");
  });

  it("identifies Copilot run states that should keep refreshing", () => {
    expect(isCopilotRunLive("queued")).toBe(true);
    expect(isCopilotRunLive("running")).toBe(true);
    expect(isCopilotRunLive("waiting_for_approval")).toBe(true);
    expect(isCopilotRunLive("completed")).toBe(false);
    expect(isCopilotRunLive("failed")).toBe(false);
  });
});
