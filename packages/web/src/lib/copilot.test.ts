import { describe, expect, it } from "vitest";

import {
  getCopilotStatusTone,
  getCopilotEventLabel,
  getCopilotEventLabelKey,
  getCopilotPendingActionLabel,
  getCopilotPendingActionLabelKey,
  getCopilotPendingActionSummary,
  getCopilotStartBlocker,
  findLiveCopilotRun,
  findCurrentLiveCopilotRun,
  buildCopilotLaunchHref,
  resolveCopilotLaunchContext,
  getCopilotLaunchPromptKey,
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
    expect(getCopilotEventLabelKey("memory_recalled")).toBe("copilot.event.memoryRecalled");
    expect(getCopilotEventLabelKey("tool_call_requested")).toBe("copilot.event.toolRequested");
    expect(getCopilotEventLabelKey("pending_action_approved")).toBe("copilot.event.pendingActionApproved");
    expect(getCopilotEventLabelKey("pending_action_rejected")).toBe("copilot.event.pendingActionRejected");
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

  it("summarizes memory write pending actions without requiring raw JSON", () => {
    expect(
      getCopilotPendingActionSummary({
        type: "openforge.propose_memory_write",
        input: {
          kind: "decision",
          scope: "global",
          text: "Remember that provider-backed profiles are the source of truth.",
        },
      })
    ).toEqual({
      detail: "decision / global",
      preview: "Remember that provider-backed profiles are the source of truth.",
    });
  });

  it("summarizes session creation and diagnostics pending actions", () => {
    expect(
      getCopilotPendingActionSummary({
        type: "openforge.propose_session_create",
        input: { aiTool: "codex", projectId: "project-123", name: "Release smoke" },
      })
    ).toEqual({
      detail: "codex / project-123",
      preview: "Release smoke",
    });
    expect(
      getCopilotPendingActionSummary({
        type: "openforge.propose_diagnostics_export",
        input: { reason: "Collect final release gate evidence." },
      })
    ).toEqual({
      detail: "Diagnostics export",
      preview: "Collect final release gate evidence.",
    });
  });

  it("summarizes troubleshooting steps and ignores unknown pending action payloads", () => {
    expect(
      getCopilotPendingActionSummary({
        type: "openforge.propose_troubleshooting_steps",
        input: {
          summary: "Gateway login fails",
          steps: ["Check provider config", "Retry login"],
        },
      })
    ).toEqual({
      detail: "Gateway login fails",
      preview: "Check provider config / Retry login",
    });
    expect(
      getCopilotPendingActionSummary({
        type: "custom.pending_action",
        input: { text: "Unrecognized payload" },
      })
    ).toBeNull();
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

  it("finds a live Copilot run even when a completed run is selected first", () => {
    expect(
      findLiveCopilotRun([
        { id: "run-completed", status: "completed" },
        { id: "run-running", status: "running" },
      ])
    ).toEqual({ id: "run-running", status: "running" });
    expect(findLiveCopilotRun([{ id: "run-completed", status: "completed" }])).toBeNull();
  });

  it("prefers live Copilot detail state over stale completed list state", () => {
    expect(
      findCurrentLiveCopilotRun({
        activeRun: null,
        selectedRun: { id: "run-1", status: "running" },
        runs: [{ id: "run-1", status: "completed" }],
      })
    ).toEqual({ id: "run-1", status: "running" });
  });

  it("ignores stale active Copilot state when refreshed detail is terminal", () => {
    expect(
      findCurrentLiveCopilotRun({
        activeRun: { id: "run-1", status: "running" },
        selectedRun: { id: "run-1", status: "cancelled" },
        runs: [{ id: "run-1", status: "cancelled" }],
      })
    ).toBeNull();
  });

  it("blocks starting another Copilot run while a live run exists", () => {
    expect(
      getCopilotStartBlocker({
        promptReady: true,
        providerConfigured: true,
        modelSelectionReady: true,
        modelProvidersLoading: false,
        modelProvidersLoadFailed: false,
        createPending: false,
        liveRunStatus: "running",
      })
    ).toBe("live_run");
    expect(
      getCopilotStartBlocker({
        promptReady: true,
        providerConfigured: true,
        modelSelectionReady: true,
        modelProvidersLoading: false,
        modelProvidersLoadFailed: false,
        createPending: false,
        liveRunStatus: "completed",
      })
    ).toBeNull();
  });

  it("builds Copilot launch hrefs with bounded source context", () => {
    expect(
      buildCopilotLaunchHref({
        source: "project",
        sourceRefId: "project 1",
        intent: "project_readiness",
      })
    ).toBe("/copilot?source=project&sourceRefId=project+1&intent=project_readiness");
    expect(buildCopilotLaunchHref({ source: "dashboard" })).toBe("/copilot?source=dashboard");
  });

  it("resolves Copilot launch context from URL parameters", () => {
    const params = new URLSearchParams("source=session&sourceRefId=session-1&intent=session_readiness");
    expect(resolveCopilotLaunchContext(params)).toEqual({
      source: "session",
      sourceRefId: "session-1",
      intent: "session_readiness",
    });
    expect(resolveCopilotLaunchContext(new URLSearchParams("source=terminal&sourceRefId=x"))).toEqual({
      source: "copilot",
    });
  });

  it("maps Copilot launch intents to starter prompt keys", () => {
    expect(getCopilotLaunchPromptKey("project_readiness")).toBe("copilot.contextPrompt.projectReadiness");
    expect(getCopilotLaunchPromptKey("session_readiness")).toBe("copilot.contextPrompt.sessionReadiness");
    expect(getCopilotLaunchPromptKey("unknown")).toBeNull();
  });
});
