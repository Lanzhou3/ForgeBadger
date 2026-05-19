import { describe, expect, it } from "vitest";

import {
  getCopilotStatusTone,
  getCopilotEventLabel,
  getCopilotEventLabelKey,
  getCopilotPendingActionLabel,
  getCopilotPendingActionLabelKey,
  getCopilotPendingActionSummary,
  getCopilotEventResultSummary,
  getCopilotErrorMessageKey,
  resolveCopilotRunFailureMessage,
  getCopilotStartBlocker,
  getCopilotProviderReadiness,
  readCopilotRunErrorDetails,
  getSelectableCopilotProviders,
  filterCopilotProviderChoices,
  filterCopilotModelChoices,
  findLiveCopilotRun,
  findCurrentLiveCopilotRun,
  shouldRefreshCopilotRunList,
  buildCopilotLaunchHref,
  resolveCopilotLaunchContext,
  getCopilotLaunchPromptKey,
  resolveCopilotRunSelection,
  isCopilotRunLive,
  isCopilotRunCancelledError,
  readCopilotMessageRunActivity,
  getCopilotRunPollDelayMs,
  shouldKeepCopilotActiveRunState,
  shouldRefreshCopilotRuns,
  shouldRefreshCopilotPanelForGatewayEvent,
  stripCopilotThinkingBlocks,
  readCopilotTerminalSnapshotText,
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
    expect(getCopilotEventLabel("memory_recall_skipped")).toBe("Memory recall skipped");
    expect(getCopilotEventLabel("openforge.custom_event")).toBe("Openforge custom event");
  });

  it("maps known event types to localized label keys", () => {
    expect(getCopilotEventLabelKey("assistant_message")).toBe("copilot.event.assistantMessage");
    expect(getCopilotEventLabelKey("memory_recalled")).toBe("copilot.event.memoryRecalled");
    expect(getCopilotEventLabelKey("memory_recall_skipped")).toBe("copilot.event.memoryRecallSkipped");
    expect(getCopilotEventLabelKey("tool_call_requested")).toBe("copilot.event.toolRequested");
    expect(getCopilotEventLabelKey("pending_action_approved")).toBe("copilot.event.pendingActionApproved");
    expect(getCopilotEventLabelKey("pending_action_rejected")).toBe("copilot.event.pendingActionRejected");
    expect(getCopilotEventLabelKey("openforge.custom_event")).toBeNull();
  });

  it("falls back to readable labels for unknown pending action types", () => {
    expect(getCopilotPendingActionLabel("openforge.propose_setting_update")).toBe("Openforge propose setting update");
    expect(getCopilotPendingActionLabel("openforge.propose_memory_write")).toBe("Memory write");
    expect(getCopilotPendingActionLabel("openforge.propose_memory_delete")).toBe("Memory delete");
    expect(getCopilotPendingActionLabel("openforge.propose_project_create")).toBe("Project create");
    expect(getCopilotPendingActionLabel("openforge.propose_project_import")).toBe("Project import");
    expect(getCopilotPendingActionLabel("openforge.propose_project_delete")).toBe("Project delete");
    expect(getCopilotPendingActionLabel("openforge.propose_project_config_sync")).toBe("Project config sync");
    expect(getCopilotPendingActionLabel("openforge.propose_adapter_refresh")).toBe("Adapter refresh");
    expect(getCopilotPendingActionLabel("openforge.propose_session_input")).toBe("Session input");
    expect(getCopilotPendingActionLabel("openforge.propose_session_start")).toBe("Session start");
    expect(getCopilotPendingActionLabel("openforge.propose_session_stop")).toBe("Session stop");
    expect(getCopilotPendingActionLabel("openforge.propose_session_delete")).toBe("Session delete");
    expect(getCopilotPendingActionLabel("openforge.propose_agent_create")).toBe("Agent create");
    expect(getCopilotPendingActionLabel("openforge.propose_agent_update")).toBe("Agent update");
    expect(getCopilotPendingActionLabel("openforge.propose_agent_delete")).toBe("Agent delete");
    expect(getCopilotPendingActionLabel("openforge.propose_template_create")).toBe("Template create");
    expect(getCopilotPendingActionLabel("openforge.propose_template_update")).toBe("Template update");
    expect(getCopilotPendingActionLabel("openforge.propose_template_delete")).toBe("Template delete");
    expect(getCopilotPendingActionLabel("openforge.propose_skill_toggle")).toBe("Skill toggle");
    expect(getCopilotPendingActionLabel("openforge.propose_plugin_toggle")).toBe("Plugin toggle");
    expect(getCopilotPendingActionLabel("openforge.propose_project_skill_toggle")).toBe("Project skill toggle");
    expect(getCopilotPendingActionLabel("openforge.propose_copilot_model_selection")).toBe("Copilot model selection");
    expect(getCopilotPendingActionLabel("openforge.propose_model_provider_sync")).toBe("Model provider sync");
    expect(getCopilotPendingActionLabel("openforge.propose_model_provider_apply")).toBe("Model provider apply");
    expect(getCopilotPendingActionLabel("openforge.propose_feishu_message_send")).toBe("Feishu message send");
    expect(getCopilotPendingActionLabel("openforge.propose_feishu_doc_create")).toBe("Feishu doc create");
    expect(getCopilotPendingActionLabel("openforge.propose_feishu_doc_update")).toBe("Feishu doc update");
    expect(getCopilotPendingActionLabel("openforge.propose_feishu_task_create")).toBe("Feishu task create");
    expect(getCopilotPendingActionLabel("openforge.propose_feishu_task_update")).toBe("Feishu task update");
    expect(getCopilotPendingActionLabel("custom.pending_action")).toBe("Custom pending action");
  });

  it("maps known pending action types to localized label keys", () => {
    expect(getCopilotPendingActionLabelKey("openforge.propose_memory_write")).toBe("copilot.pendingAction.memoryWrite");
    expect(getCopilotPendingActionLabelKey("openforge.propose_memory_delete")).toBe("copilot.pendingAction.memoryDelete");
    expect(getCopilotPendingActionLabelKey("openforge.propose_project_create")).toBe("copilot.pendingAction.projectCreate");
    expect(getCopilotPendingActionLabelKey("openforge.propose_project_import")).toBe("copilot.pendingAction.projectImport");
    expect(getCopilotPendingActionLabelKey("openforge.propose_project_delete")).toBe("copilot.pendingAction.projectDelete");
    expect(getCopilotPendingActionLabelKey("openforge.propose_project_config_sync")).toBe(
      "copilot.pendingAction.projectConfigSync"
    );
    expect(getCopilotPendingActionLabelKey("openforge.propose_diagnostics_export")).toBe("copilot.pendingAction.diagnosticsExport");
    expect(getCopilotPendingActionLabelKey("openforge.propose_adapter_refresh")).toBe("copilot.pendingAction.adapterRefresh");
    expect(getCopilotPendingActionLabelKey("openforge.propose_session_input")).toBe("copilot.pendingAction.sessionInput");
    expect(getCopilotPendingActionLabelKey("openforge.propose_session_start")).toBe("copilot.pendingAction.sessionStart");
    expect(getCopilotPendingActionLabelKey("openforge.propose_session_stop")).toBe("copilot.pendingAction.sessionStop");
    expect(getCopilotPendingActionLabelKey("openforge.propose_session_delete")).toBe(
      "copilot.pendingAction.sessionDelete"
    );
    expect(getCopilotPendingActionLabelKey("openforge.propose_agent_create")).toBe("copilot.pendingAction.agentCreate");
    expect(getCopilotPendingActionLabelKey("openforge.propose_agent_update")).toBe("copilot.pendingAction.agentUpdate");
    expect(getCopilotPendingActionLabelKey("openforge.propose_agent_delete")).toBe("copilot.pendingAction.agentDelete");
    expect(getCopilotPendingActionLabelKey("openforge.propose_template_create")).toBe(
      "copilot.pendingAction.templateCreate"
    );
    expect(getCopilotPendingActionLabelKey("openforge.propose_template_update")).toBe(
      "copilot.pendingAction.templateUpdate"
    );
    expect(getCopilotPendingActionLabelKey("openforge.propose_template_delete")).toBe(
      "copilot.pendingAction.templateDelete"
    );
    expect(getCopilotPendingActionLabelKey("openforge.propose_skill_toggle")).toBe("copilot.pendingAction.skillToggle");
    expect(getCopilotPendingActionLabelKey("openforge.propose_plugin_toggle")).toBe(
      "copilot.pendingAction.pluginToggle"
    );
    expect(getCopilotPendingActionLabelKey("openforge.propose_project_skill_toggle")).toBe(
      "copilot.pendingAction.projectSkillToggle"
    );
    expect(getCopilotPendingActionLabelKey("openforge.propose_copilot_model_selection")).toBe(
      "copilot.pendingAction.copilotModelSelection"
    );
    expect(getCopilotPendingActionLabelKey("openforge.propose_model_provider_sync")).toBe(
      "copilot.pendingAction.modelProviderSync"
    );
    expect(getCopilotPendingActionLabelKey("openforge.propose_model_provider_apply")).toBe(
      "copilot.pendingAction.modelProviderApply"
    );
    expect(getCopilotPendingActionLabelKey("openforge.propose_feishu_message_send")).toBe(
      "copilot.pendingAction.feishuMessageSend"
    );
    expect(getCopilotPendingActionLabelKey("openforge.propose_feishu_doc_create")).toBe(
      "copilot.pendingAction.feishuDocCreate"
    );
    expect(getCopilotPendingActionLabelKey("openforge.propose_feishu_doc_update")).toBe(
      "copilot.pendingAction.feishuDocUpdate"
    );
    expect(getCopilotPendingActionLabelKey("openforge.propose_feishu_task_create")).toBe(
      "copilot.pendingAction.feishuTaskCreate"
    );
    expect(getCopilotPendingActionLabelKey("openforge.propose_feishu_task_update")).toBe(
      "copilot.pendingAction.feishuTaskUpdate"
    );
    expect(getCopilotPendingActionLabelKey("custom.pending_action")).toBeNull();
  });

  it("maps known Copilot error codes to localized message keys", () => {
    expect(getCopilotErrorMessageKey("copilot_provider_not_configured")).toBe("copilot.error.providerNotConfigured");
    expect(getCopilotErrorMessageKey("copilot_provider_unsupported")).toBe("copilot.error.providerUnsupported");
    expect(getCopilotErrorMessageKey("copilot_provider_auth_failed")).toBe("copilot.error.providerAuthFailed");
    expect(getCopilotErrorMessageKey("copilot_provider_rate_limited")).toBe("copilot.error.providerRateLimited");
    expect(getCopilotErrorMessageKey("copilot_provider_unavailable")).toBe("copilot.error.providerUnavailable");
    expect(getCopilotErrorMessageKey("copilot_provider_request_failed")).toBe("copilot.error.providerRequestFailed");
    expect(getCopilotErrorMessageKey("copilot_provider_network_failed")).toBe("copilot.error.providerNetworkFailed");
    expect(getCopilotErrorMessageKey("copilot_provider_stream_parse_failed")).toBe("copilot.error.providerStreamParseFailed");
    expect(getCopilotErrorMessageKey("copilot_model_request_failed")).toBe("copilot.error.modelRequestFailed");
    expect(getCopilotErrorMessageKey("copilot_model_request_timeout")).toBe("copilot.error.modelRequestTimeout");
    expect(getCopilotErrorMessageKey("copilot_redaction_blocked_output")).toBe("copilot.error.redactionBlockedOutput");
    expect(getCopilotErrorMessageKey("copilot_run_already_active")).toBe("copilot.error.runAlreadyActive");
    expect(getCopilotErrorMessageKey("copilot_empty_response")).toBe("copilot.error.emptyResponse");
    expect(getCopilotErrorMessageKey("copilot_max_steps_exceeded")).toBe("copilot.error.maxStepsExceeded");
    expect(getCopilotErrorMessageKey("copilot_unexpected_tool_call")).toBe("copilot.error.unexpectedToolCall");
    expect(getCopilotErrorMessageKey("copilot_tool_not_allowed")).toBe("copilot.error.toolNotAllowed");
    expect(getCopilotErrorMessageKey("copilot_tool_validation_failed")).toBe("copilot.error.toolValidationFailed");
    expect(getCopilotErrorMessageKey("copilot_tool_execution_failed")).toBe("copilot.error.toolExecutionFailed");
    expect(getCopilotErrorMessageKey("copilot_run_cancelled")).toBe("copilot.error.runCancelled");
    expect(getCopilotErrorMessageKey("copilot_run_not_cancellable")).toBe("copilot.error.runNotCancellable");
    expect(getCopilotErrorMessageKey("copilot_run_not_approvable")).toBe("copilot.error.runNotApprovable");
    expect(getCopilotErrorMessageKey("copilot_pending_action_not_pending")).toBe("copilot.error.pendingActionNotPending");
    expect(getCopilotErrorMessageKey("copilot_pending_action_unsupported")).toBe("copilot.error.pendingActionUnsupported");
    expect(getCopilotErrorMessageKey("copilot_memory_write_invalid")).toBe("copilot.error.memoryWriteInvalid");
    expect(getCopilotErrorMessageKey("copilot_memory_delete_invalid")).toBe("copilot.error.memoryDeleteInvalid");
    expect(getCopilotErrorMessageKey("copilot_memory_delete_not_found")).toBe("copilot.error.memoryDeleteNotFound");
    expect(getCopilotErrorMessageKey("copilot_project_create_invalid")).toBe("copilot.error.projectCreateInvalid");
    expect(getCopilotErrorMessageKey("copilot_project_create_failed")).toBe("copilot.error.projectCreateFailed");
    expect(getCopilotErrorMessageKey("copilot_project_import_invalid")).toBe("copilot.error.projectImportInvalid");
    expect(getCopilotErrorMessageKey("copilot_project_import_failed")).toBe("copilot.error.projectImportFailed");
    expect(getCopilotErrorMessageKey("copilot_project_delete_invalid")).toBe("copilot.error.projectDeleteInvalid");
    expect(getCopilotErrorMessageKey("copilot_project_delete_failed")).toBe("copilot.error.projectDeleteFailed");
    expect(getCopilotErrorMessageKey("copilot_project_config_sync_invalid")).toBe(
      "copilot.error.projectConfigSyncInvalid"
    );
    expect(getCopilotErrorMessageKey("copilot_project_config_sync_conflict")).toBe(
      "copilot.error.projectConfigSyncConflict"
    );
    expect(getCopilotErrorMessageKey("copilot_project_config_sync_failed")).toBe(
      "copilot.error.projectConfigSyncFailed"
    );
    expect(getCopilotErrorMessageKey("copilot_session_draft_invalid")).toBe("copilot.error.sessionDraftInvalid");
    expect(getCopilotErrorMessageKey("copilot_session_create_unavailable")).toBe("copilot.error.sessionCreateUnavailable");
    expect(getCopilotErrorMessageKey("copilot_session_create_failed")).toBe("copilot.error.sessionCreateFailed");
    expect(getCopilotErrorMessageKey("copilot_session_input_invalid")).toBe("copilot.error.sessionInputInvalid");
    expect(getCopilotErrorMessageKey("copilot_session_input_unavailable")).toBe("copilot.error.sessionInputUnavailable");
    expect(getCopilotErrorMessageKey("copilot_session_start_invalid")).toBe("copilot.error.sessionStartInvalid");
    expect(getCopilotErrorMessageKey("copilot_session_start_unavailable")).toBe("copilot.error.sessionStartUnavailable");
    expect(getCopilotErrorMessageKey("copilot_session_start_failed")).toBe("copilot.error.sessionStartFailed");
    expect(getCopilotErrorMessageKey("copilot_session_stop_invalid")).toBe("copilot.error.sessionStopInvalid");
    expect(getCopilotErrorMessageKey("copilot_session_stop_unavailable")).toBe("copilot.error.sessionStopUnavailable");
    expect(getCopilotErrorMessageKey("copilot_session_stop_failed")).toBe("copilot.error.sessionStopFailed");
    expect(getCopilotErrorMessageKey("copilot_session_delete_invalid")).toBe("copilot.error.sessionDeleteInvalid");
    expect(getCopilotErrorMessageKey("copilot_session_delete_failed")).toBe("copilot.error.sessionDeleteFailed");
    expect(getCopilotErrorMessageKey("copilot_agent_create_invalid")).toBe("copilot.error.agentCreateInvalid");
    expect(getCopilotErrorMessageKey("copilot_agent_create_failed")).toBe("copilot.error.agentCreateFailed");
    expect(getCopilotErrorMessageKey("copilot_agent_update_invalid")).toBe("copilot.error.agentUpdateInvalid");
    expect(getCopilotErrorMessageKey("copilot_agent_update_failed")).toBe("copilot.error.agentUpdateFailed");
    expect(getCopilotErrorMessageKey("copilot_agent_delete_invalid")).toBe("copilot.error.agentDeleteInvalid");
    expect(getCopilotErrorMessageKey("copilot_agent_delete_failed")).toBe("copilot.error.agentDeleteFailed");
    expect(getCopilotErrorMessageKey("copilot_template_create_invalid")).toBe("copilot.error.templateCreateInvalid");
    expect(getCopilotErrorMessageKey("copilot_template_create_failed")).toBe("copilot.error.templateCreateFailed");
    expect(getCopilotErrorMessageKey("copilot_template_update_invalid")).toBe("copilot.error.templateUpdateInvalid");
    expect(getCopilotErrorMessageKey("copilot_template_update_failed")).toBe("copilot.error.templateUpdateFailed");
    expect(getCopilotErrorMessageKey("copilot_template_delete_invalid")).toBe("copilot.error.templateDeleteInvalid");
    expect(getCopilotErrorMessageKey("copilot_template_delete_failed")).toBe("copilot.error.templateDeleteFailed");
    expect(getCopilotErrorMessageKey("copilot_skill_toggle_invalid")).toBe("copilot.error.skillToggleInvalid");
    expect(getCopilotErrorMessageKey("copilot_skill_toggle_failed")).toBe("copilot.error.skillToggleFailed");
    expect(getCopilotErrorMessageKey("copilot_plugin_toggle_invalid")).toBe("copilot.error.pluginToggleInvalid");
    expect(getCopilotErrorMessageKey("copilot_plugin_toggle_failed")).toBe("copilot.error.pluginToggleFailed");
    expect(getCopilotErrorMessageKey("copilot_project_skill_toggle_invalid")).toBe(
      "copilot.error.projectSkillToggleInvalid"
    );
    expect(getCopilotErrorMessageKey("copilot_project_skill_toggle_failed")).toBe(
      "copilot.error.projectSkillToggleFailed"
    );
    expect(getCopilotErrorMessageKey("copilot_model_selection_invalid")).toBe("copilot.error.modelSelectionInvalid");
    expect(getCopilotErrorMessageKey("copilot_model_selection_unavailable")).toBe(
      "copilot.error.modelSelectionUnavailable"
    );
    expect(getCopilotErrorMessageKey("copilot_model_selection_failed")).toBe("copilot.error.modelSelectionFailed");
    expect(getCopilotErrorMessageKey("copilot_model_provider_sync_invalid")).toBe(
      "copilot.error.modelProviderSyncInvalid"
    );
    expect(getCopilotErrorMessageKey("copilot_model_provider_sync_unavailable")).toBe(
      "copilot.error.modelProviderSyncUnavailable"
    );
    expect(getCopilotErrorMessageKey("copilot_model_provider_sync_failed")).toBe(
      "copilot.error.modelProviderSyncFailed"
    );
    expect(getCopilotErrorMessageKey("copilot_model_provider_apply_invalid")).toBe(
      "copilot.error.modelProviderApplyInvalid"
    );
    expect(getCopilotErrorMessageKey("copilot_model_provider_apply_unavailable")).toBe(
      "copilot.error.modelProviderApplyUnavailable"
    );
    expect(getCopilotErrorMessageKey("copilot_model_provider_apply_failed")).toBe(
      "copilot.error.modelProviderApplyFailed"
    );
    expect(getCopilotErrorMessageKey("copilot_troubleshooting_steps_invalid")).toBe("copilot.error.troubleshootingStepsInvalid");
    expect(getCopilotErrorMessageKey("unknown_error")).toBeNull();
  });

  it("identifies user-cancelled Copilot run errors", () => {
    expect(isCopilotRunCancelledError("copilot_run_cancelled")).toBe(true);
    expect(isCopilotRunCancelledError("copilot_model_request_timeout")).toBe(false);
    expect(isCopilotRunCancelledError(null)).toBe(false);
  });

  it("reads persisted run activity from Copilot message payloads", () => {
    const activity = readCopilotMessageRunActivity({
      payload: {
        runActivity: {
          events: [{ id: "event-1", type: "tool_result" }],
          pendingActions: [{ id: "action-1", type: "openforge.propose_session_create" }],
        },
      },
    });

    expect(activity.events).toEqual([{ id: "event-1", type: "tool_result" }]);
    expect(activity.pendingActions).toEqual([{ id: "action-1", type: "openforge.propose_session_create" }]);
    expect(readCopilotMessageRunActivity({ payload: { runActivity: null } })).toEqual({
      events: [],
      pendingActions: [],
    });
  });

  it("prefers localized run failure messages when the backend returns a known error code", () => {
    expect(
      resolveCopilotRunFailureMessage({
        errorCode: "copilot_model_request_timeout",
        errorMessage: "Copilot model request timed out",
      })
    ).toEqual({
      messageKey: "copilot.error.modelRequestTimeout",
      fallbackMessage: "Copilot model request timed out",
    });
    expect(
      resolveCopilotRunFailureMessage({
        errorCode: "copilot_provider_not_configured",
      })
    ).toEqual({
      messageKey: "copilot.error.providerNotConfigured",
      fallbackMessage: null,
    });
    expect(
      resolveCopilotRunFailureMessage({
        errorCode: "unknown_error",
        errorMessage: "Backend fallback",
      })
    ).toEqual({
      messageKey: null,
      fallbackMessage: "Backend fallback",
    });
    expect(resolveCopilotRunFailureMessage({ errorCode: " ", errorMessage: "" })).toBeNull();
  });

  it("strips provider thinking blocks before rendering assistant messages", () => {
    expect(stripCopilotThinkingBlocks("<think>hidden reasoning</think>\n\n你好，我可以帮你。")).toBe("你好，我可以帮你。");
    expect(
      stripCopilotThinkingBlocks("前文\n<think>\nline 1\nline 2\n</think>\n后文")
    ).toBe("前文\n后文");
    expect(stripCopilotThinkingBlocks("<think>unfinished reasoning")).toBe("");
  });

  it("extracts failed run details from Gateway error envelopes", () => {
    const error = {
      details: {
        code: "copilot_provider_auth_failed",
        run: { id: "run-1", status: "failed" },
        events: [{ id: "event-1", runId: "run-1", type: "run_failed" }],
      },
    };

    expect(readCopilotRunErrorDetails(error)).toEqual({
      code: "copilot_provider_auth_failed",
      run: { id: "run-1", status: "failed" },
      events: [{ id: "event-1", runId: "run-1", type: "run_failed" }],
    });
    expect(readCopilotRunErrorDetails({ details: { code: 500, run: null } })).toBeNull();
  });

  it("filters Copilot provider and model choices without requiring long native dropdown scans", () => {
    const providers = [
      {
        id: "provider-openrouter",
        name: "OpenRouter",
        providerKey: "openrouter",
        baseUrl: "https://openrouter.ai/api/v1",
        apiFormat: "openai-compatible",
        authType: "api_key",
        status: "active",
        opencodeNpm: "@openrouter/ai-sdk-provider",
      },
      {
        id: "provider-minimax",
        name: "MiniMax",
        providerKey: "minimax",
        baseUrl: "https://api.minimax.chat/v1",
        apiFormat: "openai-compatible",
        authType: "api_key",
        status: "active",
      },
    ];
    const models = [
      {
        id: "model-sonnet",
        name: "Claude Sonnet",
        modelId: "claude-sonnet-4-5",
        providerProfileId: "provider-openrouter",
        status: "active",
      },
      {
        id: "model-abab",
        name: "MiniMax Abab",
        modelId: "abab6.5s-chat",
        providerProfileId: "provider-minimax",
        status: "active",
      },
    ];

    expect(filterCopilotProviderChoices(providers, "router sdk").map((provider) => provider.id)).toEqual([
      "provider-openrouter",
    ]);
    expect(filterCopilotProviderChoices(providers, "MINIMAX").map((provider) => provider.id)).toEqual([
      "provider-minimax",
    ]);
    expect(filterCopilotProviderChoices(providers, "   ")).toEqual(providers);
    expect(filterCopilotModelChoices(models, "sonnet").map((model) => model.id)).toEqual(["model-sonnet"]);
    expect(filterCopilotModelChoices(models, "abab6").map((model) => model.id)).toEqual(["model-abab"]);
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
        type: "openforge.propose_project_create",
        input: { aiTool: "claude", path: "/tmp/openforge-new", name: "OpenForge New" },
      })
    ).toEqual({
      detail: "claude / /tmp/openforge-new",
      preview: "OpenForge New",
    });
    expect(
      getCopilotPendingActionSummary({
        type: "openforge.propose_project_config_sync",
        input: {
          projectId: "project-123",
          credentialMode: "stored_encrypted_key",
          templateId: "template-claude",
          decisions: { ".claude/settings.json": "overwrite" },
        },
      })
    ).toEqual({
      detail: "project-123 / stored_encrypted_key",
      preview: "template-claude / 1 file decision",
    });
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
        type: "openforge.propose_session_input",
        input: { sessionId: "session-123", input: "pwd", submit: true },
      })
    ).toEqual({
      detail: "session-123 / submit",
      preview: "pwd",
    });
    expect(
      getCopilotPendingActionSummary({
        type: "openforge.propose_session_stop",
        input: { sessionId: "session-123", reason: "User asked to stop it." },
      })
    ).toEqual({
      detail: "session-123",
      preview: "User asked to stop it.",
    });
    expect(
      getCopilotPendingActionSummary({
        type: "openforge.propose_session_delete",
        input: { sessionId: "session-123", reason: "Clean up stale session." },
      })
    ).toEqual({
      detail: "session-123",
      preview: "Clean up stale session.",
    });
    expect(
      getCopilotPendingActionSummary({
        type: "openforge.propose_agent_create",
        input: {
          projectId: "project-123",
          name: "Debugger",
          tools: "read,search",
          reason: "Create a debugging agent.",
        },
      })
    ).toEqual({
      detail: "Debugger / project-123",
      preview: "read,search / Create a debugging agent.",
    });
    expect(
      getCopilotPendingActionSummary({
        type: "openforge.propose_agent_update",
        input: {
          agentId: "agent-123",
          name: "Code Reviewer",
          status: "disabled",
          reason: "Pause the agent.",
        },
      })
    ).toEqual({
      detail: "agent-123 / Code Reviewer / disabled",
      preview: "Pause the agent.",
    });
    expect(
      getCopilotPendingActionSummary({
        type: "openforge.propose_agent_delete",
        input: { agentId: "agent-123", reason: "Remove unused agent." },
      })
    ).toEqual({
      detail: "agent-123",
      preview: "Remove unused agent.",
    });
    expect(
      getCopilotPendingActionSummary({
        type: "openforge.propose_template_create",
        input: {
          name: "OpenCode Starter",
          version: "1.2.0",
          files: [{ filePath: "AGENTS.md", content: "# Agents" }],
          reason: "Create template.",
        },
      })
    ).toEqual({
      detail: "OpenCode Starter / 1.2.0",
      preview: "1 file / Create template.",
    });
    expect(
      getCopilotPendingActionSummary({
        type: "openforge.propose_template_update",
        input: { templateId: "template-123", name: "Starter v2", status: "disabled" },
      })
    ).toEqual({
      detail: "template-123 / Starter v2 / disabled",
      preview: undefined,
    });
    expect(
      getCopilotPendingActionSummary({
        type: "openforge.propose_template_delete",
        input: { templateId: "template-123", reason: "Remove template." },
      })
    ).toEqual({
      detail: "template-123",
      preview: "Remove template.",
    });
    expect(
      getCopilotPendingActionSummary({
        type: "openforge.propose_skill_toggle",
        input: { skillId: "skill-debugging", enabled: true, reason: "Enable debugging skill." },
      })
    ).toEqual({
      detail: "skill-debugging / enable",
      preview: "Enable debugging skill.",
    });
    expect(
      getCopilotPendingActionSummary({
        type: "openforge.propose_plugin_toggle",
        input: { pluginId: "claude-safe-edits", enabled: true, reason: "Enable safe edits." },
      })
    ).toEqual({
      detail: "claude-safe-edits / enable",
      preview: "Enable safe edits.",
    });
    expect(
      getCopilotPendingActionSummary({
        type: "openforge.propose_project_skill_toggle",
        input: {
          projectId: "project-123",
          skillId: "skill-debugging",
          enabled: false,
          reason: "Disable for this project.",
        },
      })
    ).toEqual({
      detail: "project-123 / skill-debugging / disable",
      preview: "Disable for this project.",
    });
    expect(
      getCopilotPendingActionSummary({
        type: "openforge.propose_copilot_model_selection",
        input: {
          providerProfileId: "provider-anthropic",
          modelProfileId: "model-sonnet",
          reason: "Use Anthropic for Copilot.",
        },
      })
    ).toEqual({
      detail: "provider-anthropic / model-sonnet",
      preview: "Use Anthropic for Copilot.",
    });
    expect(
      getCopilotPendingActionSummary({
        type: "openforge.propose_model_provider_sync",
        input: {
          providerProfileId: "provider-minimax",
          credentialId: "credential-default",
          timeoutMs: 5000,
          reason: "Sync MiniMax models.",
        },
      })
    ).toEqual({
      detail: "provider-minimax / credential-default / 5000ms",
      preview: "Sync MiniMax models.",
    });
    expect(
      getCopilotPendingActionSummary({
        type: "openforge.propose_model_provider_apply",
        input: {
          adapter: "claude",
          projectId: "project-123",
          providerProfileId: "provider-minimax",
          modelProfileId: "model-m2",
          credentialId: "credential-mainland",
          reason: "Use MiniMax China for Claude Code.",
        },
      })
    ).toEqual({
      detail: "claude / project-123 / provider-minimax / model-m2",
      preview: "credential-mainland / Use MiniMax China for Claude Code.",
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
    expect(
      getCopilotPendingActionSummary({
        type: "openforge.propose_adapter_refresh",
        input: { reason: "Recheck CLI availability after installing Codex." },
      })
    ).toEqual({
      detail: "Adapter refresh",
      preview: "Recheck CLI availability after installing Codex.",
    });
    expect(
      getCopilotPendingActionSummary({
        type: "openforge.propose_feishu_message_send",
        input: { chatId: "oc_openforge", text: "Build is green and ready to review." },
      })
    ).toEqual({
      detail: "chat oc_openforge",
      preview: "Build is green and ready to review.",
    });
    expect(
      getCopilotPendingActionSummary({
        type: "openforge.propose_feishu_doc_create",
        input: { title: "Sprint Plan", content: "# Plan", folderId: "fld_openforge" },
      })
    ).toEqual({
      detail: "Sprint Plan / folder fld_openforge",
      preview: "# Plan",
    });
    expect(
      getCopilotPendingActionSummary({
        type: "openforge.propose_feishu_doc_update",
        input: { documentId: "doc_openforge", content: "# Updated Plan" },
      })
    ).toEqual({
      detail: "document doc_openforge",
      preview: "# Updated Plan",
    });
    expect(
      getCopilotPendingActionSummary({
        type: "openforge.propose_feishu_task_create",
        input: { summary: "Verify Copilot", tasklistId: "tasklist_openforge", description: "Run targeted tests." },
      })
    ).toEqual({
      detail: "Verify Copilot / tasklist tasklist_openforge",
      preview: "Run targeted tests.",
    });
    expect(
      getCopilotPendingActionSummary({
        type: "openforge.propose_feishu_task_update",
        input: { taskId: "task_openforge", status: "done", summary: "Verify Copilot" },
      })
    ).toEqual({
      detail: "task task_openforge / done",
      preview: "Verify Copilot",
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

  it("summarizes approved action results without exposing raw JSON", () => {
    expect(
      getCopilotEventResultSummary({
        type: "pending_action_approved",
        payload: {
          actionType: "openforge.propose_memory_write",
          result: {
            entry: { id: "memory-123", kind: "decision", scope: "project" },
            executed: true,
          },
        },
      })
    ).toEqual({
      detail: "decision / project / saved",
      preview: "memory-123",
    });
    expect(
      getCopilotEventResultSummary({
        type: "pending_action_approved",
        payload: {
          actionType: "openforge.propose_memory_delete",
          result: {
            deleted: { id: "memory-123", type: "entry", scope: "global" },
            executed: true,
          },
        },
      })
    ).toEqual({
      detail: "entry / global / deleted",
      preview: "memory-123",
    });
    expect(
      getCopilotEventResultSummary({
        type: "pending_action_approved",
        payload: {
          actionType: "openforge.propose_feishu_message_send",
          result: {
            feishu: {
              operation: "message_send",
              result: { id: "message-123" },
            },
          },
        },
      })
    ).toEqual({
      detail: "message_send / completed",
      preview: "message-123",
    });
    expect(
      getCopilotEventResultSummary({
        type: "pending_action_approved",
        payload: {
          actionType: "openforge.propose_project_create",
          result: {
            project: { id: "project-123", name: "Aether Glass", path: "/data/aether-glass", aiTool: "claude" },
            executed: true,
          },
        },
      })
    ).toEqual({
      detail: "Aether Glass / claude / created",
      preview: "/data/aether-glass",
    });
    expect(
      getCopilotEventResultSummary({
        type: "pending_action_approved",
        payload: {
          actionType: "openforge.propose_project_config_sync",
          result: {
            project: { id: "project-123", name: "Aether Glass" },
            plan: { changedFiles: [{ relativePath: ".claude/CLAUDE.md", operation: "update" }] },
            backupPath: "/data/aether-glass/.openforge/backups/config-sync/2026-05-16",
            executed: true,
          },
        },
      })
    ).toEqual({
      detail: "Aether Glass / synced",
      preview: ".claude/CLAUDE.md update / backup created",
    });
    expect(
      getCopilotEventResultSummary({
        type: "pending_action_approved",
        payload: {
          actionType: "openforge.propose_session_create",
          result: {
            session: { id: "session-123", name: "Claude Code", status: "running", aiTool: "claude" },
            tmuxName: "of-user-session",
            executed: true,
          },
        },
      })
    ).toEqual({
      detail: "Claude Code / claude / running / created",
      preview: "of-user-session",
    });
    expect(
      getCopilotEventResultSummary({
        type: "pending_action_approved",
        payload: {
          actionType: "openforge.propose_session_stop",
          result: {
            session: { id: "session-123", name: "Claude Code" },
            executed: true,
          },
        },
      })
    ).toEqual({
      detail: "Claude Code / stopped",
      preview: "Session stopped",
    });
    expect(
      getCopilotEventResultSummary({
        type: "pending_action_approved",
        payload: {
          actionType: "openforge.propose_model_provider_apply",
          result: {
            adapter: "claude",
            projectId: "project-123",
            changedFiles: [{ relativePath: ".claude/settings.local.json", operation: "create" }],
            backupPath: "/tmp/openforge/.openforge/backups/model-provider-apply/2026-05-16",
            secretEnvNames: ["ANTHROPIC_AUTH_TOKEN"],
            executed: true,
          },
        },
      })
    ).toEqual({
      detail: "claude / project-123 / executed",
      preview: ".claude/settings.local.json create / backup created / secrets: ANTHROPIC_AUTH_TOKEN",
    });
    expect(
      getCopilotEventResultSummary({
        type: "pending_action_approved",
        payload: {
          actionType: "openforge.propose_session_input",
          result: {
            sessionId: "session-123",
            submitted: true,
            bytes: 4,
          },
        },
      })
    ).toEqual({
      detail: "session-123 / submitted",
      preview: "4 bytes sent",
    });
    expect(
      getCopilotEventResultSummary({
        type: "pending_action_approved",
        payload: {
          actionType: "openforge.propose_session_input",
          result: {
            sessionId: "session-123",
            submitted: true,
            bytes: 4,
            terminal: {
              available: true,
              text: "pwd\n/data/OpenForge",
            },
          },
        },
      })
    ).toEqual({
      detail: "session-123 / submitted",
      preview: "pwd /data/OpenForge",
    });
    expect(
      getCopilotEventResultSummary({
        type: "pending_action_approved",
        payload: {
          actionType: "openforge.propose_session_delete",
          result: {
            session: { id: "session-123", name: "Claude Code" },
            stopped: true,
            executed: true,
          },
        },
      })
    ).toEqual({
      detail: "Claude Code / deleted",
      preview: "Running session stopped",
    });
    expect(
      getCopilotEventResultSummary({
        type: "pending_action_approved",
        payload: {
          actionType: "openforge.propose_agent_create",
          result: {
            agent: { id: "agent-123", name: "Debugger", status: "active" },
            executed: true,
          },
        },
      })
    ).toEqual({
      detail: "Debugger / active / created",
      preview: "Agent updated",
    });
    expect(
      getCopilotEventResultSummary({
        type: "pending_action_approved",
        payload: {
          actionType: "openforge.propose_agent_delete",
          result: {
            agent: { id: "agent-123", name: "Debugger" },
            executed: true,
          },
        },
      })
    ).toEqual({
      detail: "Debugger / deleted",
      preview: "Agent deleted",
    });
    expect(
      getCopilotEventResultSummary({
        type: "pending_action_approved",
        payload: {
          actionType: "openforge.propose_template_create",
          result: {
            template: { id: "template-123", name: "OpenCode Starter", status: "active", fileCount: 1 },
            executed: true,
          },
        },
      })
    ).toEqual({
      detail: "OpenCode Starter / active / created",
      preview: "1 file",
    });
    expect(
      getCopilotEventResultSummary({
        type: "pending_action_approved",
        payload: {
          actionType: "openforge.propose_template_delete",
          result: {
            template: { id: "template-123", name: "OpenCode Starter", fileCount: 1 },
            executed: true,
          },
        },
      })
    ).toEqual({
      detail: "OpenCode Starter / deleted",
      preview: "Template deleted",
    });
    expect(
      getCopilotEventResultSummary({
        type: "pending_action_approved",
        payload: {
          actionType: "openforge.propose_skill_toggle",
          result: {
            skill: { id: "skill-debugging", name: "debugging", isEnabled: true },
            executed: true,
          },
        },
      })
    ).toEqual({
      detail: "debugging / enabled",
      preview: "Skill state updated",
    });
    expect(
      getCopilotEventResultSummary({
        type: "pending_action_approved",
        payload: {
          actionType: "openforge.propose_plugin_toggle",
          result: {
            plugin: { id: "claude-safe-edits", name: "Safe edits", status: "enabled" },
            executed: true,
          },
        },
      })
    ).toEqual({
      detail: "Safe edits / enabled",
      preview: "Plugin state updated",
    });
    expect(
      getCopilotEventResultSummary({
        type: "pending_action_approved",
        payload: {
          actionType: "openforge.propose_model_provider_sync",
          result: {
            provider: { id: "provider-minimax", name: "MiniMax China" },
            fetchedCount: 2,
            createdCount: 1,
            executed: true,
          },
        },
      })
    ).toEqual({
      detail: "MiniMax China / fetched 2 / created 1",
      preview: "Provider models synced",
    });
    expect(
      getCopilotEventResultSummary({
        type: "pending_action_approved",
        payload: {
          actionType: "openforge.propose_copilot_model_selection",
          result: {
            provider: { id: "provider-minimax", name: "MiniMax China" },
            model: { id: "model-1", modelId: "MiniMax-M2" },
            executed: true,
          },
        },
      })
    ).toEqual({
      detail: "MiniMax China / MiniMax-M2 / selected",
      preview: "Default Copilot model updated",
    });
    expect(
      getCopilotEventResultSummary({
        type: "pending_action_approved",
        payload: {
          actionType: "openforge.propose_diagnostics_export",
          result: {
            bundlePath: "/tmp/openforge-diagnostics.zip",
            executed: true,
          },
        },
      })
    ).toEqual({
      detail: "Diagnostics export / executed",
      preview: "/tmp/openforge-diagnostics.zip",
    });
    expect(
      getCopilotEventResultSummary({
        type: "pending_action_approved",
        payload: {
          actionType: "openforge.propose_adapter_refresh",
          result: {
            adapters: [{ id: "claude", available: true }, { id: "opencode", available: false }],
            executed: true,
          },
        },
      })
    ).toEqual({
      detail: "Adapter refresh / executed",
      preview: "claude available / opencode unavailable",
    });
    expect(
      getCopilotEventResultSummary({
        type: "pending_action_approved",
        payload: {
          actionType: "openforge.propose_troubleshooting_steps",
          result: {
            steps: ["Check provider credential", "Retry model sync"],
            executed: false,
          },
        },
      })
    ).toEqual({
      detail: "Troubleshooting steps",
      preview: "Check provider credential / Retry model sync",
    });
    expect(
      getCopilotEventResultSummary({
        type: "pending_action_approved",
        payload: {
          actionType: "openforge.propose_project_skill_toggle",
          result: {
            project: { id: "project-123", name: "OpenForge" },
            skill: { id: "skill-debugging", name: "debugging" },
            projectSkill: { projectId: "project-123", skillId: "skill-debugging", isEnabled: false },
            executed: true,
          },
        },
      })
    ).toEqual({
      detail: "OpenForge / debugging / disabled",
      preview: "Project skill override updated",
    });
    expect(
      getCopilotEventResultSummary({
        type: "tool_result",
        payload: { result: { ignored: true } },
      })
    ).toBeNull();
  });

  it("reads terminal snapshots from tool result payloads", () => {
    expect(
      readCopilotTerminalSnapshotText({
        toolCallId: "tool-call-terminal",
        output: {
          terminal: {
            available: true,
            text: "pwd\n/data/OpenForge\n",
          },
        },
      })
    ).toBe("pwd\n/data/OpenForge");
    expect(
      readCopilotTerminalSnapshotText({
        output: {
          terminal: {
            available: false,
            text: "hidden",
          },
        },
      })
    ).toBe("");
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

  it("prefers a live Copilot run over older completed history when no run is selected", () => {
    expect(
      resolveCopilotRunSelection({
        runs: [
          { id: "run-completed", status: "completed" },
          { id: "run-running", status: "running" },
        ],
      })
    ).toBe("run-running");
  });

  it("identifies Copilot run states that should keep refreshing", () => {
    expect(isCopilotRunLive("queued")).toBe(true);
    expect(isCopilotRunLive("running")).toBe(true);
    expect(isCopilotRunLive("waiting_for_approval")).toBe(true);
    expect(isCopilotRunLive("completed")).toBe(false);
    expect(isCopilotRunLive("failed")).toBe(false);
  });

  it("keeps Copilot run history refreshing while a run is being created", () => {
    expect(shouldRefreshCopilotRuns({ createPending: true })).toBe(true);
    expect(shouldRefreshCopilotRuns({ createPending: false, liveRunStatus: "running" })).toBe(true);
    expect(shouldRefreshCopilotRuns({ createPending: false, liveRunStatus: "completed" })).toBe(false);
  });

  it("keeps the Copilot run list refreshing while history contains a live run", () => {
    expect(
      shouldRefreshCopilotRunList({
        createPending: false,
        runs: [
          { status: "completed" },
          { status: "running" },
        ],
      })
    ).toBe(true);
    expect(
      shouldRefreshCopilotRunList({
        createPending: false,
        runs: [{ status: "completed" }],
      })
    ).toBe(false);
  });

  it("refreshes the active Copilot panel for matching Gateway run events", () => {
    expect(
      shouldRefreshCopilotPanelForGatewayEvent({
        event: {
          type: "copilot_run_updated",
          payload: {
            run_id: "run-1",
            conversation_id: "conversation-1",
          },
        },
        activeRunId: "run-1",
        selectedConversationId: "conversation-2",
      })
    ).toBe(true);
    expect(
      shouldRefreshCopilotPanelForGatewayEvent({
        event: {
          type: "copilot_run_updated",
          payload: {
            run_id: "run-2",
            conversation_id: "conversation-1",
          },
        },
        activeRunId: "run-1",
        selectedConversationId: "conversation-1",
      })
    ).toBe(true);
    expect(
      shouldRefreshCopilotPanelForGatewayEvent({
        event: {
          type: "copilot_run_updated",
          payload: {
            run_id: "run-2",
            conversation_id: "conversation-2",
          },
        },
        activeRunId: "run-1",
        selectedConversationId: "conversation-1",
      })
    ).toBe(false);
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

  it("keeps a newer active run state over stale poll data", () => {
    expect(
      shouldKeepCopilotActiveRunState(
        {
          run: { id: "run-1", status: "running", updatedAt: 200 },
          events: [{ sequence: 1 }, { sequence: 2 }],
          pendingActions: []
        },
        {
          run: { id: "run-1", status: "running", updatedAt: 200 },
          events: [{ sequence: 1 }],
          pendingActions: []
        }
      )
    ).toBe(true);
    expect(
      shouldKeepCopilotActiveRunState(
        {
          run: { id: "run-1", status: "running", updatedAt: 200 },
          events: [{ sequence: 1 }],
          pendingActions: []
        },
        {
          run: { id: "run-1", status: "completed", updatedAt: 201 },
          events: [{ sequence: 1 }, { sequence: 2 }],
          pendingActions: []
        }
      )
    ).toBe(false);
  });

  it("backs off Copilot run polling delays", () => {
    expect([0, 1, 2, 3, 4, 8].map(getCopilotRunPollDelayMs)).toEqual([
      500,
      1000,
      2000,
      4000,
      5000,
      5000
    ]);
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

  it("keeps Copilot provider choices credential-ready with active models", () => {
    const providers = [
      {
        id: "provider-without-key",
        status: "active",
        apiFormat: "openai",
        authType: "api_key",
      },
      {
        id: "provider-with-key",
        status: "active",
        apiFormat: "anthropic",
        authType: "api_key",
      },
      {
        id: "local-provider",
        status: "active",
        apiFormat: "openai-compatible",
        authType: "none",
      },
      {
        id: "provider-without-active-model",
        status: "active",
        apiFormat: "openai",
        authType: "api_key",
      },
      {
        id: "disabled-provider",
        status: "disabled",
        apiFormat: "openai",
        authType: "api_key",
      },
    ];

    expect(
      getSelectableCopilotProviders({
        providers,
        credentials: [
          { providerProfileId: "provider-without-key", status: "disabled" },
          { providerProfileId: "provider-with-key", status: "active" },
          { providerProfileId: "provider-without-active-model", status: "active" },
        ],
        models: [
          { providerProfileId: "provider-without-key", status: "active" },
          { providerProfileId: "provider-with-key", status: "active" },
          { providerProfileId: "local-provider", status: "active" },
          { providerProfileId: "provider-without-active-model", status: "disabled" },
          { providerProfileId: "disabled-provider", status: "active" },
        ],
        supportedProviderFormats: ["openai", "openai-compatible", "anthropic"],
      }).map((provider) => provider.id)
    ).toEqual(["provider-with-key", "local-provider"]);
  });

  it("explains why Copilot provider setup is not ready", () => {
    const providers = [
      {
        id: "provider-missing-key",
        status: "active",
        apiFormat: "openai",
        authType: "api_key",
      },
      {
        id: "provider-missing-model",
        status: "active",
        apiFormat: "anthropic",
        authType: "api_key",
      },
      {
        id: "disabled-provider",
        status: "disabled",
        apiFormat: "openai",
        authType: "api_key",
      },
    ];

    expect(
      getCopilotProviderReadiness({
        providers: [],
        credentials: [],
        models: [],
        supportedProviderFormats: ["openai", "openai-compatible", "anthropic"],
      }).code
    ).toBe("no_compatible_provider");
    expect(
      getCopilotProviderReadiness({
        providers,
        credentials: [],
        models: [
          { providerProfileId: "provider-missing-key", status: "active" },
          { providerProfileId: "provider-missing-model", status: "active" },
        ],
        supportedProviderFormats: ["openai", "openai-compatible", "anthropic"],
      }).code
    ).toBe("missing_active_credential");
    expect(
      getCopilotProviderReadiness({
        providers,
        credentials: [
          { providerProfileId: "provider-missing-model", status: "active" },
        ],
        models: [
          { providerProfileId: "provider-missing-model", status: "disabled" },
        ],
        supportedProviderFormats: ["openai", "openai-compatible", "anthropic"],
      }).code
    ).toBe("missing_active_model");
    expect(
      getCopilotProviderReadiness({
        providers,
        credentials: [
          { providerProfileId: "provider-missing-model", status: "active" },
        ],
        models: [
          { providerProfileId: "provider-missing-model", status: "active" },
        ],
        supportedProviderFormats: ["openai", "openai-compatible", "anthropic"],
      })
    ).toMatchObject({
      code: "ready",
      readyProviderCount: 1,
    });
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
    expect(buildCopilotLaunchHref({ source: "models" })).toBe("/copilot?source=models");
  });

  it("resolves Copilot launch context from URL parameters", () => {
    const params = new URLSearchParams("source=session&sourceRefId=session-1&intent=session_readiness");
    expect(resolveCopilotLaunchContext(params)).toEqual({
      source: "session",
      sourceRefId: "session-1",
      intent: "session_readiness",
    });
    expect(resolveCopilotLaunchContext(new URLSearchParams("source=models"))).toEqual({
      source: "models",
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
