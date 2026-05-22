import type { TranslationKey } from "./i18n";

export type CopilotStatusTone = "success" | "danger" | "warning" | "info" | "muted";

const statusTones: Record<string, CopilotStatusTone> = {
  completed: "success",
  failed: "danger",
  cancelled: "muted",
  waiting_for_approval: "warning",
  running: "info",
  queued: "muted",
};

const eventLabels: Record<string, string> = {
  assistant_message: "Assistant message",
  memory_recalled: "Memory recalled",
  memory_recall_skipped: "Memory recall skipped",
  run_failed: "Run failed",
  tool_call_requested: "Tool requested",
  tool_result: "Tool result",
  pending_action_approved: "Action approved",
  pending_action_rejected: "Action rejected",
};

const eventLabelKeys: Record<string, TranslationKey> = {
  assistant_message: "copilot.event.assistantMessage",
  memory_recalled: "copilot.event.memoryRecalled",
  memory_recall_skipped: "copilot.event.memoryRecallSkipped",
  run_failed: "copilot.event.runFailed",
  tool_call_requested: "copilot.event.toolRequested",
  tool_result: "copilot.event.toolResult",
  pending_action_approved: "copilot.event.pendingActionApproved",
  pending_action_rejected: "copilot.event.pendingActionRejected",
};

const pendingActionLabels: Record<string, string> = {
  "openforge.propose_memory_write": "Memory write",
  "openforge.propose_memory_delete": "Memory delete",
  "openforge.propose_project_create": "Project create",
  "openforge.propose_project_import": "Project import",
  "openforge.propose_project_delete": "Project delete",
  "openforge.propose_project_config_sync": "Project config sync",
  "openforge.propose_session_create": "Session create",
  "openforge.propose_session_input": "Session input",
  "openforge.propose_session_start": "Session start",
  "openforge.propose_session_stop": "Session stop",
  "openforge.propose_session_delete": "Session delete",
  "openforge.propose_agent_create": "Agent create",
  "openforge.propose_agent_update": "Agent update",
  "openforge.propose_agent_delete": "Agent delete",
  "openforge.propose_template_create": "Template create",
  "openforge.propose_template_update": "Template update",
  "openforge.propose_template_delete": "Template delete",
  "openforge.propose_skill_toggle": "Skill toggle",
  "openforge.propose_plugin_toggle": "Plugin toggle",
  "openforge.propose_project_skill_toggle": "Project skill toggle",
  "openforge.propose_copilot_model_selection": "Copilot model selection",
  "openforge.propose_model_provider_sync": "Model provider sync",
  "openforge.propose_model_provider_apply": "Model provider apply",
  "openforge.propose_diagnostics_export": "Diagnostics export",
  "openforge.propose_adapter_refresh": "Adapter refresh",
  "openforge.propose_troubleshooting_steps": "Troubleshooting steps",
  "openforge.propose_feishu_message_send": "Feishu message send",
  "openforge.propose_feishu_doc_create": "Feishu doc create",
  "openforge.propose_feishu_doc_update": "Feishu doc update",
  "openforge.propose_feishu_task_create": "Feishu task create",
  "openforge.propose_feishu_task_update": "Feishu task update",
  "openforge.propose_project_manager_create_work_item": "Create work item",
  "openforge.propose_project_manager_update_work_item_status": "Update work item status",
  "openforge.propose_project_manager_attach_evidence": "Attach evidence",
};

const pendingActionLabelKeys: Record<string, TranslationKey> = {
  "openforge.propose_memory_write": "copilot.pendingAction.memoryWrite",
  "openforge.propose_memory_delete": "copilot.pendingAction.memoryDelete",
  "openforge.propose_project_create": "copilot.pendingAction.projectCreate",
  "openforge.propose_project_import": "copilot.pendingAction.projectImport",
  "openforge.propose_project_delete": "copilot.pendingAction.projectDelete",
  "openforge.propose_project_config_sync": "copilot.pendingAction.projectConfigSync",
  "openforge.propose_session_create": "copilot.pendingAction.sessionCreate",
  "openforge.propose_session_input": "copilot.pendingAction.sessionInput",
  "openforge.propose_session_start": "copilot.pendingAction.sessionStart",
  "openforge.propose_session_stop": "copilot.pendingAction.sessionStop",
  "openforge.propose_session_delete": "copilot.pendingAction.sessionDelete",
  "openforge.propose_agent_create": "copilot.pendingAction.agentCreate",
  "openforge.propose_agent_update": "copilot.pendingAction.agentUpdate",
  "openforge.propose_agent_delete": "copilot.pendingAction.agentDelete",
  "openforge.propose_template_create": "copilot.pendingAction.templateCreate",
  "openforge.propose_template_update": "copilot.pendingAction.templateUpdate",
  "openforge.propose_template_delete": "copilot.pendingAction.templateDelete",
  "openforge.propose_skill_toggle": "copilot.pendingAction.skillToggle",
  "openforge.propose_plugin_toggle": "copilot.pendingAction.pluginToggle",
  "openforge.propose_project_skill_toggle": "copilot.pendingAction.projectSkillToggle",
  "openforge.propose_copilot_model_selection": "copilot.pendingAction.copilotModelSelection",
  "openforge.propose_model_provider_sync": "copilot.pendingAction.modelProviderSync",
  "openforge.propose_model_provider_apply": "copilot.pendingAction.modelProviderApply",
  "openforge.propose_diagnostics_export": "copilot.pendingAction.diagnosticsExport",
  "openforge.propose_adapter_refresh": "copilot.pendingAction.adapterRefresh",
  "openforge.propose_troubleshooting_steps": "copilot.pendingAction.troubleshootingSteps",
  "openforge.propose_feishu_message_send": "copilot.pendingAction.feishuMessageSend",
  "openforge.propose_feishu_doc_create": "copilot.pendingAction.feishuDocCreate",
  "openforge.propose_feishu_doc_update": "copilot.pendingAction.feishuDocUpdate",
  "openforge.propose_feishu_task_create": "copilot.pendingAction.feishuTaskCreate",
  "openforge.propose_feishu_task_update": "copilot.pendingAction.feishuTaskUpdate",
  "openforge.propose_project_manager_create_work_item": "copilot.pendingAction.projectManagerCreateWorkItem",
  "openforge.propose_project_manager_update_work_item_status":
    "copilot.pendingAction.projectManagerUpdateWorkItemStatus",
  "openforge.propose_project_manager_attach_evidence": "copilot.pendingAction.projectManagerAttachEvidence",
};

const errorMessageKeys: Record<string, TranslationKey> = {
  copilot_provider_not_configured: "copilot.error.providerNotConfigured",
  copilot_provider_unsupported: "copilot.error.providerUnsupported",
  copilot_provider_auth_failed: "copilot.error.providerAuthFailed",
  copilot_provider_rate_limited: "copilot.error.providerRateLimited",
  copilot_provider_unavailable: "copilot.error.providerUnavailable",
  copilot_provider_request_failed: "copilot.error.providerRequestFailed",
  copilot_provider_network_failed: "copilot.error.providerNetworkFailed",
  copilot_provider_stream_parse_failed: "copilot.error.providerStreamParseFailed",
  copilot_model_request_failed: "copilot.error.modelRequestFailed",
  copilot_model_request_timeout: "copilot.error.modelRequestTimeout",
  copilot_redaction_blocked_output: "copilot.error.redactionBlockedOutput",
  copilot_run_already_active: "copilot.error.runAlreadyActive",
  copilot_empty_response: "copilot.error.emptyResponse",
  copilot_max_steps_exceeded: "copilot.error.maxStepsExceeded",
  copilot_unexpected_tool_call: "copilot.error.unexpectedToolCall",
  copilot_tool_not_allowed: "copilot.error.toolNotAllowed",
  copilot_tool_validation_failed: "copilot.error.toolValidationFailed",
  copilot_tool_execution_failed: "copilot.error.toolExecutionFailed",
  copilot_run_cancelled: "copilot.error.runCancelled",
  copilot_run_not_cancellable: "copilot.error.runNotCancellable",
  copilot_run_not_approvable: "copilot.error.runNotApprovable",
  copilot_pending_action_not_pending: "copilot.error.pendingActionNotPending",
  copilot_pending_action_unsupported: "copilot.error.pendingActionUnsupported",
  copilot_memory_write_invalid: "copilot.error.memoryWriteInvalid",
  copilot_memory_delete_invalid: "copilot.error.memoryDeleteInvalid",
  copilot_memory_delete_not_found: "copilot.error.memoryDeleteNotFound",
  copilot_project_create_invalid: "copilot.error.projectCreateInvalid",
  copilot_project_create_failed: "copilot.error.projectCreateFailed",
  copilot_project_import_invalid: "copilot.error.projectImportInvalid",
  copilot_project_import_failed: "copilot.error.projectImportFailed",
  copilot_project_delete_invalid: "copilot.error.projectDeleteInvalid",
  copilot_project_delete_failed: "copilot.error.projectDeleteFailed",
  copilot_project_config_sync_invalid: "copilot.error.projectConfigSyncInvalid",
  copilot_project_config_sync_conflict: "copilot.error.projectConfigSyncConflict",
  copilot_project_config_sync_failed: "copilot.error.projectConfigSyncFailed",
  copilot_session_draft_invalid: "copilot.error.sessionDraftInvalid",
  copilot_session_create_unavailable: "copilot.error.sessionCreateUnavailable",
  copilot_session_create_failed: "copilot.error.sessionCreateFailed",
  copilot_session_input_invalid: "copilot.error.sessionInputInvalid",
  copilot_session_input_unavailable: "copilot.error.sessionInputUnavailable",
  copilot_session_start_invalid: "copilot.error.sessionStartInvalid",
  copilot_session_start_unavailable: "copilot.error.sessionStartUnavailable",
  copilot_session_start_failed: "copilot.error.sessionStartFailed",
  copilot_session_stop_invalid: "copilot.error.sessionStopInvalid",
  copilot_session_stop_unavailable: "copilot.error.sessionStopUnavailable",
  copilot_session_stop_failed: "copilot.error.sessionStopFailed",
  copilot_session_delete_invalid: "copilot.error.sessionDeleteInvalid",
  copilot_session_delete_failed: "copilot.error.sessionDeleteFailed",
  copilot_agent_create_invalid: "copilot.error.agentCreateInvalid",
  copilot_agent_create_failed: "copilot.error.agentCreateFailed",
  copilot_agent_update_invalid: "copilot.error.agentUpdateInvalid",
  copilot_agent_update_failed: "copilot.error.agentUpdateFailed",
  copilot_agent_delete_invalid: "copilot.error.agentDeleteInvalid",
  copilot_agent_delete_failed: "copilot.error.agentDeleteFailed",
  copilot_template_create_invalid: "copilot.error.templateCreateInvalid",
  copilot_template_create_failed: "copilot.error.templateCreateFailed",
  copilot_template_update_invalid: "copilot.error.templateUpdateInvalid",
  copilot_template_update_failed: "copilot.error.templateUpdateFailed",
  copilot_template_delete_invalid: "copilot.error.templateDeleteInvalid",
  copilot_template_delete_failed: "copilot.error.templateDeleteFailed",
  copilot_skill_toggle_invalid: "copilot.error.skillToggleInvalid",
  copilot_skill_toggle_failed: "copilot.error.skillToggleFailed",
  copilot_plugin_toggle_invalid: "copilot.error.pluginToggleInvalid",
  copilot_plugin_toggle_failed: "copilot.error.pluginToggleFailed",
  copilot_project_skill_toggle_invalid: "copilot.error.projectSkillToggleInvalid",
  copilot_project_skill_toggle_failed: "copilot.error.projectSkillToggleFailed",
  copilot_model_selection_invalid: "copilot.error.modelSelectionInvalid",
  copilot_model_selection_unavailable: "copilot.error.modelSelectionUnavailable",
  copilot_model_selection_failed: "copilot.error.modelSelectionFailed",
  copilot_model_provider_sync_invalid: "copilot.error.modelProviderSyncInvalid",
  copilot_model_provider_sync_unavailable: "copilot.error.modelProviderSyncUnavailable",
  copilot_model_provider_sync_failed: "copilot.error.modelProviderSyncFailed",
  copilot_model_provider_apply_invalid: "copilot.error.modelProviderApplyInvalid",
  copilot_model_provider_apply_unavailable: "copilot.error.modelProviderApplyUnavailable",
  copilot_model_provider_apply_failed: "copilot.error.modelProviderApplyFailed",
  copilot_troubleshooting_steps_invalid: "copilot.error.troubleshootingStepsInvalid",
  project_manager_action_failed: "copilot.error.projectManagerActionFailed",
  project_manager_trusted_evidence_required: "copilot.error.projectManagerTrustedEvidenceRequired",
};

export interface ResolveCopilotRunSelectionInput {
  selectedRunId?: string | null;
  activeRunId?: string | null;
  runs: Array<{ id: string; status?: string }>;
}

export interface FindCurrentLiveCopilotRunInput<T extends { id?: string; status: string }> {
  activeRun?: T | null;
  selectedRun?: T | null;
  runs: T[];
}

export interface CopilotPendingActionSummaryInput {
  id?: string;
  runId?: string;
  type: string;
  input?: Record<string, unknown>;
  result?: Record<string, unknown> | null;
}

export interface CopilotProjectManagerAnchor {
  labelKey: TranslationKey;
  href: string;
  projectId: string;
  workItemId?: string;
}

export interface CopilotPendingActionSummary {
  detail: string;
  preview?: string;
  markers?: string[];
  riskCue?: string;
  riskCueKey?: TranslationKey;
  messageKey?: TranslationKey;
  anchor?: CopilotProjectManagerAnchor;
}

export interface CopilotEventResultSummaryInput {
  type: string;
  message?: string | null;
  payload?: Record<string, unknown> | null;
}

export interface CopilotStartBlockerInput {
  promptReady: boolean;
  providerConfigured: boolean;
  modelSelectionReady: boolean;
  modelProvidersLoading: boolean;
  modelProvidersLoadFailed: boolean;
  createPending: boolean;
  liveRunStatus?: string | null;
}

export interface CopilotRunsRefreshInput {
  createPending: boolean;
  liveRunStatus?: string | null;
}

export interface CopilotRunListRefreshInput {
  createPending: boolean;
  runs: Array<{ status?: string }>;
}

export interface CopilotGatewayEvent {
  type?: string;
  payload?: Record<string, unknown>;
}

export interface CopilotPanelGatewayEventRefreshInput {
  event: CopilotGatewayEvent;
  activeRunId?: string | null;
  selectedConversationId?: string | null;
}

export type CopilotStartBlocker =
  | "prompt"
  | "provider_setup"
  | "model_providers_loading"
  | "model_providers_failed"
  | "model_selection"
  | "live_run"
  | "creating";

export type CopilotLaunchSource = "dashboard" | "project" | "session" | "settings" | "copilot" | "models";
export type CopilotLaunchIntent =
  | "launch_readiness"
  | "project_readiness"
  | "session_readiness"
  | "provider_setup";

export interface CopilotLaunchHrefInput {
  source: CopilotLaunchSource;
  sourceRefId?: string | null;
  intent?: CopilotLaunchIntent | null;
}

export interface CopilotLaunchContext {
  source: CopilotLaunchSource;
  sourceRefId?: string;
  intent?: CopilotLaunchIntent;
}

export interface CopilotLaunchSearchParams {
  get(name: string): string | null;
}

export interface CopilotProviderChoice {
  id: string;
  status: string;
  apiFormat: string;
  authType: string;
  name?: string;
  providerKey?: string;
  baseUrl?: string | null;
  opencodeNpm?: string | null;
}

export interface CopilotProviderCredentialChoice {
  providerProfileId: string;
  status: string;
}

export interface CopilotModelChoice {
  providerProfileId: string;
  status: string;
  id?: string;
  name?: string;
  modelId?: string;
  capabilities?: string[];
}

export interface SelectableCopilotProvidersInput<TProvider extends CopilotProviderChoice> {
  providers: TProvider[];
  credentials: CopilotProviderCredentialChoice[];
  models: CopilotModelChoice[];
  supportedProviderFormats: string[];
}

export type CopilotProviderReadinessCode =
  | "ready"
  | "no_compatible_provider"
  | "missing_active_credential"
  | "missing_active_model";

export interface CopilotProviderReadiness {
  code: CopilotProviderReadinessCode;
  compatibleProviderCount: number;
  credentialReadyProviderCount: number;
  readyProviderCount: number;
}

export interface CopilotRunErrorDetails<TRun = unknown, TEvent = unknown, TPendingAction = unknown> {
  code: string;
  run?: TRun;
  events?: TEvent[];
  pendingActions?: TPendingAction[];
}

export interface CopilotRunFailureMessage {
  messageKey: TranslationKey | null;
  fallbackMessage: string | null;
}

export interface CopilotMessageRunActivity<TEvent = unknown, TPendingAction = unknown> {
  events: TEvent[];
  pendingActions: TPendingAction[];
}

const launchSources = new Set<CopilotLaunchSource>(["dashboard", "project", "session", "settings", "copilot", "models"]);
const launchIntents = new Set<CopilotLaunchIntent>([
  "launch_readiness",
  "project_readiness",
  "session_readiness",
  "provider_setup",
]);

const launchPromptKeys: Record<CopilotLaunchIntent, TranslationKey> = {
  launch_readiness: "copilot.starter.launchReadinessPrompt",
  project_readiness: "copilot.contextPrompt.projectReadiness",
  session_readiness: "copilot.contextPrompt.sessionReadiness",
  provider_setup: "copilot.starter.providerSetupPrompt",
};
const thinkingBlockPattern = /<think\b[^>]*>[\s\S]*?<\/think>/giu;
const unfinishedThinkingBlockPattern = /<think\b[^>]*>[\s\S]*$/iu;

export function getCopilotStatusTone(status: string): CopilotStatusTone {
  return statusTones[status] ?? "muted";
}

export function getCopilotEventLabel(type: string): string {
  return eventLabels[type] ?? humanizeToken(type);
}

export function getCopilotEventLabelKey(type: string): TranslationKey | null {
  return eventLabelKeys[type] ?? null;
}

export function getCopilotPendingActionLabel(type: string): string {
  return pendingActionLabels[type] ?? humanizeToken(type);
}

export function getCopilotPendingActionLabelKey(type: string): TranslationKey | null {
  return pendingActionLabelKeys[type] ?? null;
}

export function getCopilotErrorMessageKey(code: string | null | undefined): TranslationKey | null {
  return code ? errorMessageKeys[code] ?? null : null;
}

export function resolveCopilotRunFailureMessage(input: {
  errorCode?: string | null;
  errorMessage?: string | null;
}): CopilotRunFailureMessage | null {
  const code = normalizeOptionalText(input.errorCode);
  const fallbackMessage = normalizeOptionalText(input.errorMessage);
  const messageKey = getCopilotErrorMessageKey(code);
  if (!messageKey && !fallbackMessage) return null;
  return { messageKey, fallbackMessage };
}

export function stripCopilotThinkingBlocks(text: string): string {
  return text
    .replace(thinkingBlockPattern, "")
    .replace(unfinishedThinkingBlockPattern, "")
    .replace(/[ \t]*\n[ \t]*\n[ \t]*/gu, "\n")
    .trim();
}

export function isCopilotRunCancelledError(code: string | null | undefined): boolean {
  return code === "copilot_run_cancelled";
}

export function readCopilotRunErrorDetails<TRun = unknown, TEvent = unknown, TPendingAction = unknown>(
  error: unknown
): CopilotRunErrorDetails<TRun, TEvent, TPendingAction> | null {
  const details = readRecord(readRecord(error)?.details);
  const code = details ? readString(details, "code") : null;
  if (!details || !code) return null;
  const run = readRecord(details.run);
  if (!run) return null;
  const events = Array.isArray(details.events) ? details.events : undefined;
  const pendingActions = Array.isArray(details.pendingActions) ? details.pendingActions : undefined;
  return {
    code,
    run: run as TRun,
    ...(events ? { events: events as TEvent[] } : {}),
    ...(pendingActions ? { pendingActions: pendingActions as TPendingAction[] } : {}),
  };
}

export function readCopilotMessageRunActivity<TEvent = unknown, TPendingAction = unknown>(
  message: { payload?: Record<string, unknown> | null }
): CopilotMessageRunActivity<TEvent, TPendingAction> {
  const activity = readRecord(message.payload?.runActivity);
  if (!activity) return { events: [], pendingActions: [] };
  return {
    events: Array.isArray(activity.events) ? activity.events as TEvent[] : [],
    pendingActions: Array.isArray(activity.pendingActions) ? activity.pendingActions as TPendingAction[] : [],
  };
}

export function readCopilotTerminalSnapshotText(payload: Record<string, unknown> | undefined): string {
  const output = readRecord(payload?.output);
  const result = readRecord(payload?.result);
  const terminal = readRecord(output?.terminal) ?? readRecord(result?.terminal);
  if (!terminal || terminal.available !== true) return "";
  return readString(terminal, "text") ?? "";
}

export function getCopilotPendingActionSummary(
  action: CopilotPendingActionSummaryInput
): CopilotPendingActionSummary | null {
  if (isProjectManagerPendingActionType(action.type)) {
    const failureSummary = summarizeProjectManagerFailure(action, readRecord(action.result));
    if (failureSummary) return failureSummary;
  }
  const payload = action.input ?? action.result ?? {};
  switch (action.type) {
    case "openforge.propose_memory_write":
      return summarizeMemoryWrite(payload);
    case "openforge.propose_memory_delete":
      return summarizeMemoryDelete(payload);
    case "openforge.propose_project_create":
      return summarizeProjectCreate(payload);
    case "openforge.propose_project_import":
      return summarizeProjectImport(payload);
    case "openforge.propose_project_delete":
      return summarizeProjectDelete(payload);
    case "openforge.propose_project_config_sync":
      return summarizeProjectConfigSync(payload);
    case "openforge.propose_session_create":
      return summarizeSessionCreate(payload);
    case "openforge.propose_session_input":
      return summarizeSessionInput(payload);
    case "openforge.propose_session_start":
      return summarizeSessionStart(payload);
    case "openforge.propose_session_stop":
      return summarizeSessionStop(payload);
    case "openforge.propose_session_delete":
      return summarizeSessionDelete(payload);
    case "openforge.propose_agent_create":
      return summarizeAgentCreate(payload);
    case "openforge.propose_agent_update":
      return summarizeAgentUpdate(payload);
    case "openforge.propose_agent_delete":
      return summarizeAgentDelete(payload);
    case "openforge.propose_template_create":
      return summarizeTemplateCreate(payload);
    case "openforge.propose_template_update":
      return summarizeTemplateUpdate(payload);
    case "openforge.propose_template_delete":
      return summarizeTemplateDelete(payload);
    case "openforge.propose_skill_toggle":
      return summarizeSkillToggle(payload);
    case "openforge.propose_plugin_toggle":
      return summarizePluginToggle(payload);
    case "openforge.propose_project_skill_toggle":
      return summarizeProjectSkillToggle(payload);
    case "openforge.propose_copilot_model_selection":
      return summarizeCopilotModelSelection(payload);
    case "openforge.propose_model_provider_sync":
      return summarizeModelProviderSync(payload);
    case "openforge.propose_model_provider_apply":
      return summarizeModelProviderApply(payload);
    case "openforge.propose_diagnostics_export":
      return {
        detail: "Diagnostics export",
        preview: previewText(readString(payload, "reason")),
      };
    case "openforge.propose_adapter_refresh":
      return {
        detail: "Adapter refresh",
        preview: previewText(readString(payload, "reason")),
      };
    case "openforge.propose_feishu_message_send":
      return summarizeFeishuMessageSend(payload);
    case "openforge.propose_feishu_doc_create":
      return summarizeFeishuDocCreate(payload);
    case "openforge.propose_feishu_doc_update":
      return summarizeFeishuDocUpdate(payload);
    case "openforge.propose_feishu_task_create":
      return summarizeFeishuTaskCreate(payload);
    case "openforge.propose_feishu_task_update":
      return summarizeFeishuTaskUpdate(payload);
    case "openforge.propose_troubleshooting_steps":
      return summarizeTroubleshootingSteps(payload);
    case "openforge.propose_project_manager_create_work_item":
      return summarizeProjectManagerCreateWorkItem(action, payload);
    case "openforge.propose_project_manager_update_work_item_status":
      return summarizeProjectManagerUpdateWorkItemStatus(action, payload);
    case "openforge.propose_project_manager_attach_evidence":
      return summarizeProjectManagerAttachEvidence(action, payload);
    default:
      return null;
  }
}

export function getCopilotEventResultSummary(
  event: CopilotEventResultSummaryInput
): CopilotPendingActionSummary | null {
  if (event.type !== "pending_action_approved") return null;
  const payload = readRecord(event.payload);
  const result = readRecord(payload?.result);
  if (!payload || !result) return null;
  const actionType = readString(payload, "actionType") ?? normalizeOptionalText(event.message) ?? "";
  switch (actionType) {
    case "openforge.propose_memory_write":
      return summarizeMemoryWriteResult(result);
    case "openforge.propose_memory_delete":
      return summarizeMemoryDeleteResult(result);
    case "openforge.propose_project_create":
      return summarizeProjectCreateResult(result);
    case "openforge.propose_model_provider_sync":
      return summarizeModelProviderSyncResult(result);
    case "openforge.propose_model_provider_apply":
      return summarizeModelProviderApplyResult(result);
    case "openforge.propose_project_config_sync":
      return summarizeProjectConfigSyncResult(result);
    case "openforge.propose_project_import":
      return summarizeProjectImportResult(result);
    case "openforge.propose_project_delete":
      return summarizeProjectDeleteResult(result);
    case "openforge.propose_session_create":
      return summarizeSessionCreateResult(result);
    case "openforge.propose_session_input":
      return summarizeSessionInputResult(result);
    case "openforge.propose_session_start":
      return summarizeSessionStartResult(result);
    case "openforge.propose_session_stop":
      return summarizeSessionStopResult(result);
    case "openforge.propose_session_delete":
      return summarizeSessionDeleteResult(result);
    case "openforge.propose_agent_create":
      return summarizeAgentResult(result, "created");
    case "openforge.propose_agent_update":
      return summarizeAgentResult(result, "updated");
    case "openforge.propose_agent_delete":
      return summarizeAgentDeleteResult(result);
    case "openforge.propose_template_create":
      return summarizeTemplateResult(result, "created");
    case "openforge.propose_template_update":
      return summarizeTemplateResult(result, "updated");
    case "openforge.propose_template_delete":
      return summarizeTemplateDeleteResult(result);
    case "openforge.propose_skill_toggle":
      return summarizeSkillToggleResult(result);
    case "openforge.propose_plugin_toggle":
      return summarizePluginToggleResult(result);
    case "openforge.propose_project_skill_toggle":
      return summarizeProjectSkillToggleResult(result);
    case "openforge.propose_copilot_model_selection":
      return summarizeCopilotModelSelectionResult(result);
    case "openforge.propose_diagnostics_export":
      return summarizeDiagnosticsExportResult(result);
    case "openforge.propose_adapter_refresh":
      return summarizeAdapterRefreshResult(result);
    case "openforge.propose_feishu_message_send":
    case "openforge.propose_feishu_doc_create":
    case "openforge.propose_feishu_doc_update":
    case "openforge.propose_feishu_task_create":
    case "openforge.propose_feishu_task_update":
      return summarizeFeishuActionResult(result);
    case "openforge.propose_troubleshooting_steps":
      return summarizeTroubleshootingStepsResult(result);
    case "openforge.propose_project_manager_create_work_item":
    case "openforge.propose_project_manager_update_work_item_status":
    case "openforge.propose_project_manager_attach_evidence":
      return summarizeProjectManagerResult(result);
    default:
      return null;
  }
}

export function getCopilotProjectManagerAnchor(input: {
  projectId?: string | null;
  workItemId?: string | null;
}): CopilotProjectManagerAnchor | null {
  const projectId = normalizeOptionalText(input.projectId);
  if (!projectId) return null;
  const workItemId = normalizeOptionalText(input.workItemId);
  const query = workItemId
    ? `tab=project-manager&workItemId=${encodeURIComponent(workItemId)}`
    : "tab=project-manager";
  const anchor = {
    labelKey: "copilot.projectManager.view" as TranslationKey,
    href: `/projects/${encodeURIComponent(projectId)}?${query}`,
    projectId,
  };
  return workItemId ? { ...anchor, workItemId } : anchor;
}

export function resolveCopilotRunSelection(input: ResolveCopilotRunSelectionInput): string | null {
  const runIds = new Set(input.runs.map((run) => run.id));
  if (input.selectedRunId && runIds.has(input.selectedRunId)) return input.selectedRunId;
  if (input.activeRunId) return input.activeRunId;
  const liveRun = input.runs.find((run) => typeof run.status === "string" && isCopilotRunLive(run.status));
  if (liveRun) return liveRun.id;
  return input.runs[0]?.id ?? null;
}

export function isCopilotRunLive(status: string): boolean {
  return status === "queued" || status === "running" || status === "waiting_for_approval";
}

export interface CopilotActiveRunSnapshot {
  run: {
    id: string;
    status: string;
    createdAt?: number | null;
    updatedAt?: number | null;
  };
  events?: Array<{ sequence?: number | null }>;
  pendingActions?: Array<{ updatedAt?: number | null }>;
}

export function shouldKeepCopilotActiveRunState(
  current: CopilotActiveRunSnapshot | null,
  next: CopilotActiveRunSnapshot
): boolean {
  if (!current || current.run.id !== next.run.id) return false;
  const currentUpdatedAt = current.run.updatedAt ?? current.run.createdAt ?? 0;
  const nextUpdatedAt = next.run.updatedAt ?? next.run.createdAt ?? 0;
  if (currentUpdatedAt > nextUpdatedAt) return true;
  if (currentUpdatedAt < nextUpdatedAt) return false;
  if (maxSequence(current.events) > maxSequence(next.events)) return true;
  if (maxUpdatedAt(current.pendingActions) > maxUpdatedAt(next.pendingActions)) return true;
  return isTerminalCopilotRunStatus(current.run.status) && !isTerminalCopilotRunStatus(next.run.status);
}

export function getCopilotRunPollDelayMs(attempt: number): number {
  const normalizedAttempt = Math.max(0, Math.trunc(attempt));
  return Math.min(500 * (2 ** normalizedAttempt), 5000);
}

function maxSequence(events: CopilotActiveRunSnapshot["events"]): number {
  return Math.max(0, ...(events ?? []).map((event) => event.sequence ?? 0));
}

function maxUpdatedAt(items: CopilotActiveRunSnapshot["pendingActions"]): number {
  return Math.max(0, ...(items ?? []).map((item) => item.updatedAt ?? 0));
}

function isTerminalCopilotRunStatus(status: string): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

export function findLiveCopilotRun<T extends { status: string }>(runs: T[]): T | null {
  return runs.find((run) => isCopilotRunLive(run.status)) ?? null;
}

export function findCurrentLiveCopilotRun<T extends { id?: string; status: string }>(
  input: FindCurrentLiveCopilotRunInput<T>
): T | null {
  const seenIds = new Set<string>();
  const currentRuns: T[] = [];
  const addRun = (run?: T | null) => {
    if (!run) return;
    if (run.id) {
      if (seenIds.has(run.id)) return;
      seenIds.add(run.id);
    }
    currentRuns.push(run);
  };

  addRun(input.selectedRun);
  for (const run of input.runs) addRun(run);
  addRun(input.activeRun);

  return findLiveCopilotRun(currentRuns);
}

export function getCopilotStartBlocker(input: CopilotStartBlockerInput): CopilotStartBlocker | null {
  if (!input.promptReady) return "prompt";
  if (!input.providerConfigured) return "provider_setup";
  if (input.modelProvidersLoading) return "model_providers_loading";
  if (input.modelProvidersLoadFailed) return "model_providers_failed";
  if (!input.modelSelectionReady) return "model_selection";
  if (input.liveRunStatus && isCopilotRunLive(input.liveRunStatus)) return "live_run";
  if (input.createPending) return "creating";
  return null;
}

export function shouldRefreshCopilotRuns(input: CopilotRunsRefreshInput): boolean {
  return input.createPending || Boolean(input.liveRunStatus && isCopilotRunLive(input.liveRunStatus));
}

export function shouldRefreshCopilotRunList(input: CopilotRunListRefreshInput): boolean {
  return shouldRefreshCopilotRuns({
    createPending: input.createPending,
    liveRunStatus: input.runs.find((run) => typeof run.status === "string" && isCopilotRunLive(run.status))?.status,
  });
}

export function shouldRefreshCopilotPanelForGatewayEvent(input: CopilotPanelGatewayEventRefreshInput): boolean {
  if (input.event.type !== "copilot_run_updated") return false;
  const payload = input.event.payload ?? {};
  const runId = readString(payload, "run_id");
  const conversationId = readString(payload, "conversation_id");
  return Boolean(
    (input.activeRunId && runId === input.activeRunId) ||
    (input.selectedConversationId && conversationId === input.selectedConversationId)
  );
}

export function getSelectableCopilotProviders<TProvider extends CopilotProviderChoice>(
  input: SelectableCopilotProvidersInput<TProvider>
): TProvider[] {
  return input.providers.filter((provider) =>
    isSelectableCopilotProvider(provider, input.supportedProviderFormats, input.credentials, input.models)
  );
}

export function filterCopilotProviderChoices<TProvider extends CopilotProviderChoice>(
  providers: TProvider[],
  query: string
): TProvider[] {
  const tokens = normalizeSearchTokens(query);
  if (tokens.length === 0) return providers;
  return providers.filter((provider) => matchesSearchTokens(searchableCopilotProviderText(provider), tokens));
}

export function filterCopilotModelChoices<TModel extends CopilotModelChoice>(
  models: TModel[],
  query: string
): TModel[] {
  const tokens = normalizeSearchTokens(query);
  if (tokens.length === 0) return models;
  return models.filter((model) => matchesSearchTokens(searchableCopilotModelText(model), tokens));
}

export function getCopilotProviderReadiness(
  input: SelectableCopilotProvidersInput<CopilotProviderChoice>
): CopilotProviderReadiness {
  const compatibleProviders = input.providers.filter((provider) =>
    isCompatibleCopilotProvider(provider, input.supportedProviderFormats)
  );
  const credentialReadyProviders = compatibleProviders.filter((provider) =>
    hasCopilotProviderCredential(provider, input.credentials)
  );
  const readyProviders = credentialReadyProviders.filter((provider) =>
    hasSelectableCopilotModel(provider, input.models)
  );

  return {
    code: resolveCopilotProviderReadinessCode(
      compatibleProviders.length,
      credentialReadyProviders.length,
      readyProviders.length
    ),
    compatibleProviderCount: compatibleProviders.length,
    credentialReadyProviderCount: credentialReadyProviders.length,
    readyProviderCount: readyProviders.length,
  };
}

export function getCopilotProviderReadinessMessageKey(
  readiness: CopilotProviderReadiness | null | undefined
): TranslationKey {
  if (!readiness || readiness.code === "ready") return "copilot.providerSetupRequired";
  if (readiness.code === "no_compatible_provider") return "copilot.providerReadiness.noCompatibleProvider";
  if (readiness.code === "missing_active_credential") return "copilot.providerReadiness.missingActiveCredential";
  return "copilot.providerReadiness.missingActiveModel";
}

export function buildCopilotLaunchHref(input: CopilotLaunchHrefInput): string {
  const params = new URLSearchParams({ source: input.source });
  const sourceRefId = input.sourceRefId?.trim();
  if (sourceRefId) params.set("sourceRefId", sourceRefId);
  if (input.intent) params.set("intent", input.intent);
  return `/copilot?${params.toString()}`;
}

export function resolveCopilotLaunchContext(params: CopilotLaunchSearchParams): CopilotLaunchContext {
  const source = readLaunchSource(params.get("source"));
  if (!source) return { source: "copilot" };

  const sourceRefId = params.get("sourceRefId")?.trim();
  const intent = readLaunchIntent(params.get("intent"));
  return {
    source,
    ...(source !== "copilot" && sourceRefId ? { sourceRefId } : {}),
    ...(intent ? { intent } : {}),
  };
}

export function getCopilotLaunchPromptKey(intent: string | null | undefined): TranslationKey | null {
  const launchIntent = readLaunchIntent(intent);
  return launchIntent ? launchPromptKeys[launchIntent] : null;
}

function isSelectableCopilotProvider(
  provider: CopilotProviderChoice,
  supportedProviderFormats: string[],
  credentials: CopilotProviderCredentialChoice[],
  models: CopilotModelChoice[]
): boolean {
  return (
    isCompatibleCopilotProvider(provider, supportedProviderFormats) &&
    hasCopilotProviderCredential(provider, credentials) &&
    hasSelectableCopilotModel(provider, models)
  );
}

function isCompatibleCopilotProvider(provider: CopilotProviderChoice, supportedProviderFormats: string[]): boolean {
  return provider.status === "active" && supportedProviderFormats.includes(provider.apiFormat);
}

function resolveCopilotProviderReadinessCode(
  compatibleProviderCount: number,
  credentialReadyProviderCount: number,
  readyProviderCount: number
): CopilotProviderReadinessCode {
  if (compatibleProviderCount === 0) return "no_compatible_provider";
  if (credentialReadyProviderCount === 0) return "missing_active_credential";
  if (readyProviderCount === 0) return "missing_active_model";
  return "ready";
}

function hasCopilotProviderCredential(
  provider: CopilotProviderChoice,
  credentials: CopilotProviderCredentialChoice[]
): boolean {
  if (provider.authType === "none") return true;
  return credentials.some(
    (credential) => credential.providerProfileId === provider.id && credential.status === "active"
  );
}

function hasSelectableCopilotModel(provider: CopilotProviderChoice, models: CopilotModelChoice[]): boolean {
  return models.some((model) => model.providerProfileId === provider.id && model.status === "active");
}

function summarizeMemoryWrite(payload: Record<string, unknown>): CopilotPendingActionSummary {
  const detail = joinPresent([
    readString(payload, "kind") ?? "memory",
    readString(payload, "scope"),
  ]);
  return {
    detail,
    preview: previewText(readString(payload, "text")),
  };
}

function summarizeMemoryDelete(payload: Record<string, unknown>): CopilotPendingActionSummary {
  return {
    detail: joinPresent([
      readString(payload, "type") ?? "entry",
      readString(payload, "id") ?? "memory",
    ]),
    preview: previewText(readString(payload, "reason")),
  };
}

function summarizeSessionCreate(payload: Record<string, unknown>): CopilotPendingActionSummary {
  const detail = joinPresent([
    readString(payload, "aiTool") ?? "session",
    readString(payload, "projectId"),
  ]);
  return {
    detail,
    preview: previewText(readString(payload, "name")),
  };
}

function summarizeProjectCreate(payload: Record<string, unknown>): CopilotPendingActionSummary {
  const detail = joinPresent([
    readString(payload, "aiTool") ?? "project",
    readString(payload, "path"),
  ]);
  return {
    detail,
    preview: previewText(readString(payload, "name")),
  };
}

function summarizeProjectImport(payload: Record<string, unknown>): CopilotPendingActionSummary {
  const detail = joinPresent([
    readString(payload, "aiTool") ?? "project",
    readString(payload, "path"),
  ]);
  return {
    detail,
    preview: previewText(readString(payload, "name")),
  };
}

function summarizeProjectDelete(payload: Record<string, unknown>): CopilotPendingActionSummary {
  return {
    detail: readString(payload, "projectId") ?? "project",
    preview: previewText(readString(payload, "reason")),
  };
}

function summarizeProjectConfigSync(payload: Record<string, unknown>): CopilotPendingActionSummary {
  const decisions = readRecord(payload.decisions);
  const decisionCount = decisions ? Object.keys(decisions).length : 0;
  const previewParts = [
    readString(payload, "templateId"),
    decisionCount > 0 ? `${decisionCount} file decision${decisionCount === 1 ? "" : "s"}` : null,
  ];
  return {
    detail: joinPresent([
      readString(payload, "projectId") ?? "project",
      readString(payload, "credentialMode") ?? "host_environment",
    ]),
    preview: previewText(joinPresent(previewParts)),
  };
}

function summarizeSessionInput(payload: Record<string, unknown>): CopilotPendingActionSummary {
  const detail = joinPresent([
    readString(payload, "sessionId") ?? "session",
    payload.submit === true ? "submit" : "input",
  ]);
  return {
    detail,
    preview: previewText(readString(payload, "input")),
  };
}

function summarizeSessionStart(payload: Record<string, unknown>): CopilotPendingActionSummary {
  return {
    detail: readString(payload, "sessionId") ?? "session",
    preview: previewText(readString(payload, "reason")),
  };
}

function summarizeSessionStop(payload: Record<string, unknown>): CopilotPendingActionSummary {
  return {
    detail: readString(payload, "sessionId") ?? "session",
    preview: previewText(readString(payload, "reason")),
  };
}

function summarizeSessionDelete(payload: Record<string, unknown>): CopilotPendingActionSummary {
  return {
    detail: readString(payload, "sessionId") ?? "session",
    preview: previewText(readString(payload, "reason")),
  };
}

function summarizeAgentCreate(payload: Record<string, unknown>): CopilotPendingActionSummary {
  return {
    detail: joinPresent([
      readString(payload, "name") ?? "agent",
      readString(payload, "projectId"),
    ]),
    preview: previewText(joinPresent([
      readString(payload, "tools"),
      readString(payload, "reason"),
    ])),
  };
}

function summarizeAgentUpdate(payload: Record<string, unknown>): CopilotPendingActionSummary {
  return {
    detail: joinPresent([
      readString(payload, "agentId") ?? "agent",
      readString(payload, "name"),
      readString(payload, "status"),
    ]),
    preview: previewText(joinPresent([
      readString(payload, "tools"),
      readString(payload, "reason"),
    ])),
  };
}

function summarizeAgentDelete(payload: Record<string, unknown>): CopilotPendingActionSummary {
  return {
    detail: readString(payload, "agentId") ?? "agent",
    preview: previewText(readString(payload, "reason")),
  };
}

function summarizeTemplateCreate(payload: Record<string, unknown>): CopilotPendingActionSummary {
  const files = Array.isArray(payload.files) ? payload.files.length : 0;
  return {
    detail: joinPresent([
      readString(payload, "name") ?? "template",
      readString(payload, "version"),
    ]),
    preview: previewText(joinPresent([
      files > 0 ? `${files} file${files === 1 ? "" : "s"}` : null,
      readString(payload, "reason"),
    ])),
  };
}

function summarizeTemplateUpdate(payload: Record<string, unknown>): CopilotPendingActionSummary {
  return {
    detail: joinPresent([
      readString(payload, "templateId") ?? "template",
      readString(payload, "name"),
      readString(payload, "status"),
    ]),
    preview: previewText(readString(payload, "reason")),
  };
}

function summarizeTemplateDelete(payload: Record<string, unknown>): CopilotPendingActionSummary {
  return {
    detail: readString(payload, "templateId") ?? "template",
    preview: previewText(readString(payload, "reason")),
  };
}

function summarizeSkillToggle(payload: Record<string, unknown>): CopilotPendingActionSummary {
  return {
    detail: joinPresent([
      readString(payload, "skillId") ?? "skill",
      payload.enabled === true ? "enable" : "disable",
    ]),
    preview: previewText(readString(payload, "reason")),
  };
}

function summarizePluginToggle(payload: Record<string, unknown>): CopilotPendingActionSummary {
  return {
    detail: joinPresent([
      readString(payload, "pluginId") ?? "plugin",
      payload.enabled === true ? "enable" : "disable",
    ]),
    preview: previewText(readString(payload, "reason")),
  };
}

function summarizeProjectSkillToggle(payload: Record<string, unknown>): CopilotPendingActionSummary {
  return {
    detail: joinPresent([
      readString(payload, "projectId") ?? "project",
      readString(payload, "skillId") ?? "skill",
      payload.enabled === true ? "enable" : "disable",
    ]),
    preview: previewText(readString(payload, "reason")),
  };
}

function summarizeCopilotModelSelection(payload: Record<string, unknown>): CopilotPendingActionSummary {
  return {
    detail: joinPresent([
      readString(payload, "providerProfileId") ?? "provider",
      readString(payload, "modelProfileId") ?? "model",
    ]),
    preview: previewText(readString(payload, "reason")),
  };
}

function summarizeModelProviderSync(payload: Record<string, unknown>): CopilotPendingActionSummary {
  const timeoutMs = readNumber(payload, "timeoutMs");
  return {
    detail: joinPresent([
      readString(payload, "providerProfileId") ?? "provider",
      readString(payload, "credentialId"),
      timeoutMs > 0 ? `${timeoutMs}ms` : null,
    ]),
    preview: previewText(readString(payload, "reason")),
  };
}

function summarizeModelProviderApply(payload: Record<string, unknown>): CopilotPendingActionSummary {
  return {
    detail: joinPresent([
      readString(payload, "adapter") ?? "adapter",
      readString(payload, "projectId"),
      readString(payload, "providerProfileId") ?? "provider",
      readString(payload, "modelProfileId") ?? "model",
    ]),
    preview: previewText(joinPresent([
      readString(payload, "credentialId"),
      readString(payload, "reason"),
    ])),
  };
}

function summarizeFeishuMessageSend(payload: Record<string, unknown>): CopilotPendingActionSummary {
  return {
    detail: `chat ${readString(payload, "chatId") ?? "unknown"}`,
    preview: previewText(readString(payload, "text")),
  };
}

function summarizeFeishuDocCreate(payload: Record<string, unknown>): CopilotPendingActionSummary {
  const folderId = readString(payload, "folderId");
  return {
    detail: joinPresent([
      readString(payload, "title") ?? "Feishu document",
      folderId ? `folder ${folderId}` : null,
    ]),
    preview: previewText(readString(payload, "content")),
  };
}

function summarizeFeishuDocUpdate(payload: Record<string, unknown>): CopilotPendingActionSummary {
  return {
    detail: `document ${readString(payload, "documentId") ?? "unknown"}`,
    preview: previewText(readString(payload, "content")),
  };
}

function summarizeFeishuTaskCreate(payload: Record<string, unknown>): CopilotPendingActionSummary {
  const tasklistId = readString(payload, "tasklistId");
  return {
    detail: joinPresent([
      readString(payload, "summary") ?? "Feishu task",
      tasklistId ? `tasklist ${tasklistId}` : null,
    ]),
    preview: previewText(readString(payload, "description") ?? readString(payload, "reason")),
  };
}

function summarizeFeishuTaskUpdate(payload: Record<string, unknown>): CopilotPendingActionSummary {
  return {
    detail: joinPresent([
      `task ${readString(payload, "taskId") ?? "unknown"}`,
      readString(payload, "status"),
    ]),
    preview: previewText(readString(payload, "summary") ?? readString(payload, "description") ?? readString(payload, "reason")),
  };
}

function summarizeModelProviderApplyResult(payload: Record<string, unknown>): CopilotPendingActionSummary {
  const changedFiles = readChangedFiles(payload);
  const secretEnvNames = readStringArray(payload, "secretEnvNames");
  return {
    detail: joinPresent([
      readString(payload, "adapter") ?? "adapter",
      readString(payload, "projectId"),
      payload.executed === true ? "executed" : null,
    ]),
    preview: previewText(joinPresent([
      ...changedFiles,
      readString(payload, "backupPath") ? "backup created" : null,
      secretEnvNames.length > 0 ? `secrets: ${secretEnvNames.join(", ")}` : null,
    ]), 240),
  };
}

function summarizeModelProviderSyncResult(payload: Record<string, unknown>): CopilotPendingActionSummary {
  const provider = readRecord(payload.provider);
  const fetchedCount = readNumber(payload, "fetchedCount");
  const createdCount = readNumber(payload, "createdCount");
  return {
    detail: joinPresent([
      readString(provider ?? {}, "name") ?? readString(provider ?? {}, "id") ?? "provider",
      `fetched ${fetchedCount}`,
      `created ${createdCount}`,
    ]),
    preview: payload.executed === true ? "Provider models synced" : undefined,
  };
}

function summarizeMemoryWriteResult(payload: Record<string, unknown>): CopilotPendingActionSummary {
  const entry = readRecord(payload.entry);
  return {
    detail: joinPresent([
      readString(entry ?? {}, "kind") ?? "memory",
      readString(entry ?? {}, "scope"),
      payload.executed === true ? "saved" : null,
    ]),
    preview: previewText(readString(entry ?? {}, "id")),
  };
}

function summarizeMemoryDeleteResult(payload: Record<string, unknown>): CopilotPendingActionSummary {
  const deleted = readRecord(payload.deleted);
  return {
    detail: joinPresent([
      readString(deleted ?? {}, "type") ?? "memory",
      readString(deleted ?? {}, "scope"),
      payload.executed === true ? "deleted" : null,
    ]),
    preview: previewText(readString(deleted ?? {}, "id")),
  };
}

function summarizeProjectCreateResult(payload: Record<string, unknown>): CopilotPendingActionSummary {
  const project = readRecord(payload.project);
  return {
    detail: joinPresent([
      readString(project ?? {}, "name") ?? readString(project ?? {}, "id") ?? "project",
      readString(project ?? {}, "aiTool"),
      payload.executed === true ? "created" : null,
    ]),
    preview: previewText(readString(project ?? {}, "path")),
  };
}

function summarizeProjectImportResult(payload: Record<string, unknown>): CopilotPendingActionSummary {
  const project = readRecord(payload.project);
  return {
    detail: joinPresent([
      readString(project ?? {}, "name") ?? "project",
      readString(project ?? {}, "path"),
      payload.executed === true ? "imported" : null,
    ]),
    preview: previewText(readString(project ?? {}, "aiTool")),
  };
}

function summarizeProjectConfigSyncResult(payload: Record<string, unknown>): CopilotPendingActionSummary {
  const project = readRecord(payload.project);
  const plan = readRecord(payload.plan);
  const result = readRecord(payload.result);
  const summary = readRecord(payload.summary);
  const changedFiles = [
    ...readChangedFiles(payload),
    ...readChangedFiles(plan ?? {}),
    ...readStringArray(result ?? {}, "writtenFiles").map((file) => `${file} write`),
  ];
  const backupPath = readString(payload, "backupPath") ?? readString(result ?? {}, "backupPath");
  const skippedFiles = readStringArray(result ?? {}, "skippedFiles");
  const conflicts = readStringArray(result ?? {}, "conflicts");
  return {
    detail: joinPresent([
      readString(project ?? {}, "name") ?? readString(summary ?? {}, "projectName") ?? "project",
      payload.executed === true ? "synced" : null,
    ]),
    preview: previewText(joinPresent([
      ...changedFiles,
      backupPath ? "backup created" : null,
      skippedFiles.length > 0 ? `${skippedFiles.length} skipped` : null,
      conflicts.length > 0 ? `${conflicts.length} conflicts` : null,
    ]), 240),
  };
}

function summarizeProjectDeleteResult(payload: Record<string, unknown>): CopilotPendingActionSummary {
  const project = readRecord(payload.project);
  const stoppedSessionCount = readNumber(payload, "stoppedSessionCount");
  return {
    detail: joinPresent([
      readString(project ?? {}, "name") ?? readString(project ?? {}, "id") ?? "project",
      payload.executed === true ? "deleted" : null,
    ]),
    preview: stoppedSessionCount > 0
      ? `${stoppedSessionCount} running session${stoppedSessionCount === 1 ? "" : "s"} stopped`
      : "No running sessions stopped",
  };
}

function summarizeSessionCreateResult(payload: Record<string, unknown>): CopilotPendingActionSummary {
  const session = readRecord(payload.session);
  return {
    detail: joinPresent([
      readString(session ?? {}, "name") ?? readString(session ?? {}, "id") ?? "session",
      readString(session ?? {}, "aiTool"),
      readString(session ?? {}, "status"),
      payload.executed === true ? "created" : null,
    ]),
    preview: previewText(readString(payload, "tmuxName") ?? readString(session ?? {}, "tmuxName")),
  };
}

function summarizeSessionInputResult(payload: Record<string, unknown>): CopilotPendingActionSummary {
  const bytes = readNumber(payload, "bytes");
  const terminalPreview = readTerminalResultPreview(payload);
  return {
    detail: joinPresent([
      readString(payload, "sessionId") ?? "session",
      payload.submitted === true ? "submitted" : "input sent",
    ]),
    preview: terminalPreview ?? (bytes > 0 ? `${bytes} bytes sent` : undefined),
  };
}

function summarizeSessionStartResult(payload: Record<string, unknown>): CopilotPendingActionSummary {
  const session = readRecord(payload.session);
  return {
    detail: joinPresent([
      readString(session ?? {}, "id") ?? readString(payload, "sessionId") ?? "session",
      readString(session ?? {}, "status") ?? (payload.executed === true ? "running" : null),
      payload.executed === true ? "executed" : null,
    ]),
    preview: previewText(readString(session ?? {}, "tmuxName")),
  };
}

function summarizeSessionStopResult(payload: Record<string, unknown>): CopilotPendingActionSummary {
  const session = readRecord(payload.session);
  return {
    detail: joinPresent([
      readString(session ?? {}, "name") ?? readString(session ?? {}, "id") ?? "session",
      payload.executed === true ? "stopped" : null,
    ]),
    preview: payload.executed === true ? "Session stopped" : undefined,
  };
}

function summarizeSessionDeleteResult(payload: Record<string, unknown>): CopilotPendingActionSummary {
  const session = readRecord(payload.session);
  return {
    detail: joinPresent([
      readString(session ?? {}, "name") ?? readString(session ?? {}, "id") ?? "session",
      payload.executed === true ? "deleted" : null,
    ]),
    preview: payload.stopped === true ? "Running session stopped" : "Session record deleted",
  };
}

function summarizeCopilotModelSelectionResult(payload: Record<string, unknown>): CopilotPendingActionSummary {
  const provider = readRecord(payload.provider);
  const model = readRecord(payload.model);
  const selection = readRecord(payload.selection);
  return {
    detail: joinPresent([
      readString(provider ?? {}, "name") ?? readString(selection ?? {}, "providerName") ?? "provider",
      readString(model ?? {}, "modelId") ?? readString(model ?? {}, "name") ??
        readString(selection ?? {}, "modelName") ?? readString(selection ?? {}, "modelId") ?? "model",
      payload.executed === true ? "selected" : null,
    ]),
    preview: payload.executed === true ? "Default Copilot model updated" : undefined,
  };
}

function summarizeDiagnosticsExportResult(payload: Record<string, unknown>): CopilotPendingActionSummary {
  const report = readRecord(payload.report);
  return {
    detail: joinPresent([
      "Diagnostics export",
      payload.executed === true || report ? "executed" : null,
    ]),
    preview: previewText(
      readString(payload, "bundlePath") ??
      readString(report ?? {}, "bundlePath") ??
      readString(report ?? {}, "generatedAt")
    ),
  };
}

function summarizeAdapterRefreshResult(payload: Record<string, unknown>): CopilotPendingActionSummary {
  const adapters = payload.adapters;
  const preview = Array.isArray(adapters)
    ? adapters
        .map((item) => {
          const adapter = readRecord(item);
          if (!adapter) return null;
          const id = readString(adapter, "id") ?? readString(adapter, "name");
          if (!id) return null;
          return `${id} ${adapter.available === true ? "available" : "unavailable"}`;
        })
        .filter((item): item is string => Boolean(item))
        .join(" / ")
    : null;
  return {
    detail: joinPresent(["Adapter refresh", payload.executed === true || Array.isArray(adapters) ? "executed" : null]),
    preview: previewText(preview, 240),
  };
}

function summarizeFeishuActionResult(payload: Record<string, unknown>): CopilotPendingActionSummary | null {
  const feishu = readRecord(payload.feishu);
  if (!feishu) return null;
  const result = readRecord(feishu.result);
  const operation = readString(feishu, "operation") ?? "Feishu action";
  return {
    detail: `${operation} / completed`,
    preview: previewText(readString(result ?? {}, "id") ?? readString(result ?? {}, "url")),
  };
}

function summarizeTroubleshootingStepsResult(payload: Record<string, unknown>): CopilotPendingActionSummary {
  const nestedSteps = readRecord(payload.steps);
  const steps = readStringArray(nestedSteps ?? payload, "steps");
  return {
    detail: readString(nestedSteps ?? payload, "summary") ?? "Troubleshooting steps",
    preview: previewText(steps.join(" / "), 240),
  };
}

function summarizeAgentResult(payload: Record<string, unknown>, operation: "created" | "updated"): CopilotPendingActionSummary {
  const agent = readRecord(payload.agent);
  return {
    detail: joinPresent([
      readString(agent ?? {}, "name") ?? readString(agent ?? {}, "id") ?? "agent",
      readString(agent ?? {}, "status"),
      payload.executed === true ? operation : null,
    ]),
    preview: payload.executed === true ? "Agent updated" : undefined,
  };
}

function summarizeAgentDeleteResult(payload: Record<string, unknown>): CopilotPendingActionSummary {
  const agent = readRecord(payload.agent);
  return {
    detail: joinPresent([
      readString(agent ?? {}, "name") ?? readString(agent ?? {}, "id") ?? "agent",
      payload.executed === true ? "deleted" : null,
    ]),
    preview: payload.executed === true ? "Agent deleted" : undefined,
  };
}

function summarizeTemplateResult(
  payload: Record<string, unknown>,
  operation: "created" | "updated"
): CopilotPendingActionSummary {
  const template = readRecord(payload.template);
  const fileCount = readNumber(template ?? {}, "fileCount");
  return {
    detail: joinPresent([
      readString(template ?? {}, "name") ?? readString(template ?? {}, "id") ?? "template",
      readString(template ?? {}, "status"),
      payload.executed === true ? operation : null,
    ]),
    preview: fileCount > 0 ? `${fileCount} file${fileCount === 1 ? "" : "s"}` : undefined,
  };
}

function summarizeTemplateDeleteResult(payload: Record<string, unknown>): CopilotPendingActionSummary {
  const template = readRecord(payload.template);
  return {
    detail: joinPresent([
      readString(template ?? {}, "name") ?? readString(template ?? {}, "id") ?? "template",
      payload.executed === true ? "deleted" : null,
    ]),
    preview: payload.executed === true ? "Template deleted" : undefined,
  };
}

function summarizeSkillToggleResult(payload: Record<string, unknown>): CopilotPendingActionSummary {
  const skill = readRecord(payload.skill);
  return {
    detail: joinPresent([
      readString(skill ?? {}, "name") ?? readString(skill ?? {}, "id") ?? "skill",
      readBoolean(skill ?? {}, "isEnabled") ? "enabled" : "disabled",
    ]),
    preview: payload.executed === true ? "Skill state updated" : undefined,
  };
}

function summarizePluginToggleResult(payload: Record<string, unknown>): CopilotPendingActionSummary {
  const plugin = readRecord(payload.plugin);
  return {
    detail: joinPresent([
      readString(plugin ?? {}, "name") ?? readString(plugin ?? {}, "id") ?? "plugin",
      readString(plugin ?? {}, "status") === "enabled" ? "enabled" : "disabled",
    ]),
    preview: payload.executed === true ? "Plugin state updated" : undefined,
  };
}

function summarizeProjectSkillToggleResult(payload: Record<string, unknown>): CopilotPendingActionSummary {
  const project = readRecord(payload.project);
  const skill = readRecord(payload.skill);
  const projectSkill = readRecord(payload.projectSkill);
  return {
    detail: joinPresent([
      readString(project ?? {}, "name") ?? readString(projectSkill ?? {}, "projectId") ?? "project",
      readString(skill ?? {}, "name") ?? readString(projectSkill ?? {}, "skillId") ?? "skill",
      readBoolean(projectSkill ?? {}, "isEnabled") ? "enabled" : "disabled",
    ]),
    preview: payload.executed === true ? "Project skill override updated" : undefined,
  };
}

function summarizeTroubleshootingSteps(payload: Record<string, unknown>): CopilotPendingActionSummary {
  const steps = readStringArray(payload, "steps");
  return {
    detail: readString(payload, "summary") ?? "Troubleshooting steps",
    preview: previewText(steps.join(" / ")),
  };
}

const projectManagerRiskCue = "Approval writes Project Manager state through Gateway.";
const projectManagerRiskCueKey = "copilot.projectManager.riskGatewayWrite" as TranslationKey;

function summarizeProjectManagerCreateWorkItem(
  action: CopilotPendingActionSummaryInput,
  payload: Record<string, unknown>
): CopilotPendingActionSummary {
  const projectId = readString(payload, "projectId") ?? "project";
  const title = readString(payload, "title") ?? "work item";
  const evidenceCount = Array.isArray(payload.evidenceRefs) ? payload.evidenceRefs.length : 0;
  const fields = projectManagerFields([
    ["title", true],
    ["status", Boolean(readString(payload, "status"))],
    ["priority", typeof payload.priority === "number"],
    ["acceptance criteria", Array.isArray(payload.acceptanceCriteria) && payload.acceptanceCriteria.length > 0],
    ["evidence refs", evidenceCount > 0],
  ]);
  const anchor = getCopilotProjectManagerAnchor({ projectId });
  return withProjectManagerApprovalMetadata({
    detail: `Create work item / project ${projectId} / title ${title}`,
    preview: `Fields: ${fields} / Evidence refs: ${evidenceCount}`,
    markers: [
      "Action: create_work_item",
      `Project: ${projectId}`,
      `Fields: ${fields}`,
      `Evidence refs: ${evidenceCount}`,
      projectManagerTraceMarker(action, payload, `project ${projectId}`, evidenceCount),
    ],
    ...(anchor ? { anchor } : {}),
  });
}

function summarizeProjectManagerUpdateWorkItemStatus(
  action: CopilotPendingActionSummaryInput,
  payload: Record<string, unknown>
): CopilotPendingActionSummary {
  const projectId = readString(payload, "projectId") ?? "project";
  const workItemId = readString(payload, "workItemId") ?? "work item";
  const status = readString(payload, "status") ?? "status";
  const evidenceCount = readNumber(payload, "evidenceRefCount");
  const trustedRequired = status === "done";
  const anchor = getCopilotProjectManagerAnchor({ projectId, workItemId });
  const summary = withProjectManagerApprovalMetadata({
    detail: `Update work item status / work item ${workItemId} / status ${status}`,
    preview: joinPresent([
      "Fields: status",
      `Evidence refs: ${evidenceCount}`,
      trustedRequired ? "Trusted evidence required" : null,
    ]),
    markers: [
      "Action: update_work_item_status",
      `Project: ${projectId}`,
      `Work item: ${workItemId}`,
      "Fields: status",
      `Evidence refs: ${evidenceCount}`,
      projectManagerTraceMarker(action, payload, `work item ${workItemId}`, evidenceCount),
    ],
    ...(anchor ? { anchor } : {}),
  });
  return trustedRequired
    ? { ...summary, messageKey: "copilot.error.projectManagerTrustedEvidenceRequired" }
    : summary;
}

function summarizeProjectManagerAttachEvidence(
  action: CopilotPendingActionSummaryInput,
  payload: Record<string, unknown>
): CopilotPendingActionSummary {
  const projectId = readString(payload, "projectId") ?? "project";
  const workItemId = readString(payload, "workItemId") ?? "work item";
  const evidence = readRecord(payload.evidenceRef);
  const evidenceText = projectManagerEvidenceText(evidence);
  const evidenceTitle = [
    readString(evidence ?? {}, "kind") ?? "evidence",
    readString(evidence ?? {}, "label"),
  ].filter((item): item is string => Boolean(item)).join(" ");
  const anchor = getCopilotProjectManagerAnchor({ projectId, workItemId });
  return withProjectManagerApprovalMetadata({
    detail: `Attach evidence / work item ${workItemId} / ${evidenceTitle}`,
    preview: "Fields: evidence ref / Evidence refs: 1",
    markers: [
      "Action: attach_evidence",
      `Project: ${projectId}`,
      `Work item: ${workItemId}`,
      "Fields: evidence ref",
      "Evidence refs: 1",
      `Evidence: ${evidenceText}`,
      projectManagerTraceMarker(action, payload, `work item ${workItemId}`, 1),
    ],
    ...(anchor ? { anchor } : {}),
  });
}

function summarizeProjectManagerResult(payload: Record<string, unknown>): CopilotPendingActionSummary | null {
  const marker = readRecord(payload.projectManager);
  if (!marker) return null;
  const actionType = readString(marker, "actionType") ?? "project_manager_action";
  const projectId = readString(marker, "projectId");
  const workItemId = readString(marker, "workItemId") ?? readString(marker, "targetId") ?? "work item";
  const evidenceCount = readNumber(marker, "evidenceRefCount");
  const approvalStatus = readString(marker, "approvalStatus") ?? "approved";
  const executionStatus = readString(marker, "executionStatus") ?? (payload.executed === true ? "succeeded" : "unknown");
  const trustedEvidenceCount = readOptionalNumber(marker, "trustedEvidenceRefCount");
  const anchor = getCopilotProjectManagerAnchor({ projectId, workItemId });
  const summary: CopilotPendingActionSummary = {
    detail: `${actionType} / work item ${workItemId} / ${executionStatus}`,
    preview: joinPresent([
      readString(marker, "status") ? `Status: ${readString(marker, "status")}` : null,
      `Evidence refs: ${evidenceCount}`,
      typeof trustedEvidenceCount === "number" ? `Trusted evidence: ${trustedEvidenceCount}` : null,
    ]),
    markers: projectManagerResultMarkers({
      actionType,
      projectId,
      workItemId,
      evidenceCount,
      approvalStatus,
      executionStatus,
      trace: projectManagerTraceMarkerFromRecord(marker, `work item ${workItemId}`, evidenceCount),
      ...(typeof trustedEvidenceCount === "number" ? { trustedEvidenceCount } : {}),
    }),
  };
  return anchor ? { ...summary, anchor } : summary;
}

function summarizeProjectManagerFailure(
  action: CopilotPendingActionSummaryInput,
  result: Record<string, unknown> | null
): CopilotPendingActionSummary | null {
  const error = readRecord(result?.error);
  const marker = readRecord(result?.projectManager);
  const code = error ? readString(error, "code") : null;
  const messageKey = projectManagerFailureMessageKey(code);
  if (!messageKey || !marker) return null;
  const actionType = readString(marker, "actionType") ?? projectManagerSemanticActionType(action.type);
  const projectId = readString(marker, "projectId");
  const workItemId = readString(marker, "workItemId") ?? readString(marker, "targetId");
  const evidenceCount = readNumber(marker, "evidenceRefCount");
  const target = workItemId ? `work item ${workItemId}` : projectId ? `project ${projectId}` : "Project Manager";
  const markers = [
    actionType ? `Action: ${actionType}` : null,
    projectId ? `Project: ${projectId}` : null,
    workItemId ? `Work item: ${workItemId}` : null,
    `Approval: ${readString(marker, "approvalStatus") ?? "failed"}`,
    `Execution: ${readString(marker, "executionStatus") ?? "failed"}`,
    projectManagerTraceMarkerFromRecord(marker, target, evidenceCount),
  ].filter((item): item is string => Boolean(item));
  const anchor = getCopilotProjectManagerAnchor({ projectId, workItemId }) ?? undefined;
  return {
    detail: `${getCopilotPendingActionLabel(action.type)} / failed`,
    preview: projectManagerFailurePreview(messageKey),
    markers,
    messageKey,
    ...(anchor ? { anchor } : {}),
  };
}

function withProjectManagerApprovalMetadata(input: CopilotPendingActionSummary): CopilotPendingActionSummary {
  return {
    ...input,
    riskCue: projectManagerRiskCue,
    riskCueKey: projectManagerRiskCueKey,
  };
}

function projectManagerFields(fields: Array<[string, boolean]>): string {
  const present = fields.filter(([, enabled]) => enabled).map(([field]) => field);
  return present.length > 0 ? present.join(", ") : "none";
}

function projectManagerEvidenceText(evidence: Record<string, unknown> | null): string {
  return joinPresent([
    readString(evidence ?? {}, "kind") ?? "evidence",
    readString(evidence ?? {}, "label"),
    readString(evidence ?? {}, "status"),
    readString(evidence ?? {}, "ref"),
    readString(evidence ?? {}, "path"),
    readString(evidence ?? {}, "sessionId"),
  ]);
}

function projectManagerTraceMarker(
  action: CopilotPendingActionSummaryInput,
  payload: Record<string, unknown>,
  target: string,
  evidenceCount: number
): string {
  const runId = readString(payload, "copilotRunId") ?? action.runId ?? "unknown";
  const actionId = readString(payload, "pendingActionId") ?? action.id ?? "unknown";
  return `Trace: Copilot run ${runId} -> pending action ${actionId} -> target ${target} -> evidence refs ${evidenceCount}`;
}

function projectManagerTraceMarkerFromRecord(
  marker: Record<string, unknown>,
  target: string,
  evidenceCount: number
): string {
  const runId = readString(marker, "copilotRunId") ?? "unknown";
  const actionId = readString(marker, "pendingActionId") ?? "unknown";
  return `Trace: Copilot run ${runId} -> pending action ${actionId} -> target ${target} -> evidence refs ${evidenceCount}`;
}

function projectManagerResultMarkers(input: {
  actionType: string;
  projectId: string | null;
  workItemId: string;
  evidenceCount: number;
  trustedEvidenceCount?: number;
  approvalStatus: string;
  executionStatus: string;
  trace: string;
}): string[] {
  return [
    `Action: ${input.actionType}`,
    input.projectId ? `Project: ${input.projectId}` : null,
    `Work item: ${input.workItemId}`,
    `Evidence refs: ${input.evidenceCount}`,
    typeof input.trustedEvidenceCount === "number" ? `Trusted evidence: ${input.trustedEvidenceCount}` : null,
    `Approval: ${input.approvalStatus}`,
    `Execution: ${input.executionStatus}`,
    input.trace,
  ].filter((item): item is string => Boolean(item));
}

function projectManagerFailureMessageKey(code: string | null): TranslationKey | null {
  if (code === "project_manager_trusted_evidence_required") {
    return "copilot.error.projectManagerTrustedEvidenceRequired";
  }
  if (code === "project_manager_action_failed") return "copilot.error.projectManagerActionFailed";
  return null;
}

function projectManagerFailurePreview(key: TranslationKey): string {
  if (key === "copilot.error.projectManagerTrustedEvidenceRequired") {
    return "Trusted evidence is required before Copilot can mark this done.";
  }
  return "Project Manager action failed. Create a new proposal before retrying.";
}

function isProjectManagerPendingActionType(type: string): boolean {
  return type === "openforge.propose_project_manager_create_work_item" ||
    type === "openforge.propose_project_manager_update_work_item_status" ||
    type === "openforge.propose_project_manager_attach_evidence";
}

function projectManagerSemanticActionType(type: string): string | null {
  if (type === "openforge.propose_project_manager_create_work_item") return "create_work_item";
  if (type === "openforge.propose_project_manager_update_work_item_status") return "update_work_item_status";
  if (type === "openforge.propose_project_manager_attach_evidence") return "attach_evidence";
  return null;
}

function readString(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  if (typeof value !== "string") return null;
  return normalizeOptionalText(value);
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readStringArray(payload: Record<string, unknown>, key: string): string[] {
  const value = payload[key];
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function readNumber(payload: Record<string, unknown>, key: string): number {
  const value = payload[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function readOptionalNumber(payload: Record<string, unknown>, key: string): number | undefined {
  const value = payload[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readBoolean(payload: Record<string, unknown>, key: string): boolean {
  return payload[key] === true;
}

function readTerminalResultPreview(payload: Record<string, unknown>): string | undefined {
  const terminal = readRecord(payload.terminal);
  if (!terminal || terminal.available !== true) return undefined;
  return previewText(readString(terminal, "text"));
}

function readChangedFiles(payload: Record<string, unknown>): string[] {
  const changedFiles = payload.changedFiles;
  if (!Array.isArray(changedFiles)) return [];
  return changedFiles
    .map((item) => {
      if (typeof item === "string") return item;
      const record = readRecord(item);
      if (!record) return null;
      const relativePath = readString(record, "relativePath");
      const operation = readString(record, "operation");
      return joinPresent([relativePath, operation]).replace(" / ", " ");
    })
    .filter((item): item is string => Boolean(item));
}

function joinPresent(values: Array<string | null>): string {
  const present = values.filter((value): value is string => Boolean(value));
  return present.join(" / ");
}

function previewText(value: string | null, maxLength = 140): string | undefined {
  if (!value) return undefined;
  const normalized = value.replace(/\s+/gu, " ").trim();
  if (!normalized) return undefined;
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 3).trimEnd()}...`;
}

function searchableCopilotProviderText(provider: CopilotProviderChoice): string {
  return normalizeSearchText([
    provider.id,
    provider.name,
    provider.providerKey,
    provider.baseUrl,
    provider.apiFormat,
    provider.authType,
    provider.opencodeNpm,
  ].filter(Boolean).join(" "));
}

function searchableCopilotModelText(model: CopilotModelChoice): string {
  return normalizeSearchText([
    model.id,
    model.name,
    model.modelId,
    model.providerProfileId,
    model.status,
    ...(model.capabilities ?? []),
  ].filter(Boolean).join(" "));
}

function normalizeSearchTokens(value: string): string[] {
  return normalizeSearchText(value).split(/\s+/u).filter(Boolean);
}

function matchesSearchTokens(value: string, tokens: string[]): boolean {
  return tokens.every((token) => value.includes(token));
}

function normalizeSearchText(value: string): string {
  return value.trim().toLowerCase();
}

function humanizeToken(value: string): string {
  const normalized = value
    .replace(/^openforge\./u, "openforge_")
    .replace(/[._-]+/gu, " ")
    .trim()
    .toLowerCase();
  if (!normalized) return "Unknown";
  return `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}`;
}

function readLaunchSource(value: string | null): CopilotLaunchSource | null {
  return value && launchSources.has(value as CopilotLaunchSource) ? (value as CopilotLaunchSource) : null;
}

function readLaunchIntent(value: string | null | undefined): CopilotLaunchIntent | null {
  return value && launchIntents.has(value as CopilotLaunchIntent) ? (value as CopilotLaunchIntent) : null;
}
