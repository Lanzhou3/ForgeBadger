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
  "openforge.propose_session_create": "Session create",
  "openforge.propose_diagnostics_export": "Diagnostics export",
  "openforge.propose_troubleshooting_steps": "Troubleshooting steps",
};

const pendingActionLabelKeys: Record<string, TranslationKey> = {
  "openforge.propose_memory_write": "copilot.pendingAction.memoryWrite",
  "openforge.propose_session_create": "copilot.pendingAction.sessionCreate",
  "openforge.propose_diagnostics_export": "copilot.pendingAction.diagnosticsExport",
  "openforge.propose_troubleshooting_steps": "copilot.pendingAction.troubleshootingSteps",
};

const errorMessageKeys: Record<string, TranslationKey> = {
  copilot_provider_not_configured: "copilot.error.providerNotConfigured",
  copilot_provider_unsupported: "copilot.error.providerUnsupported",
  copilot_provider_auth_failed: "copilot.error.providerAuthFailed",
  copilot_provider_rate_limited: "copilot.error.providerRateLimited",
  copilot_provider_unavailable: "copilot.error.providerUnavailable",
  copilot_provider_request_failed: "copilot.error.providerRequestFailed",
  copilot_model_request_failed: "copilot.error.modelRequestFailed",
  copilot_model_request_timeout: "copilot.error.modelRequestTimeout",
  copilot_redaction_blocked_output: "copilot.error.redactionBlockedOutput",
  copilot_run_already_active: "copilot.error.runAlreadyActive",
};

export interface ResolveCopilotRunSelectionInput {
  selectedRunId?: string | null;
  activeRunId?: string | null;
  runs: Array<{ id: string }>;
}

export interface FindCurrentLiveCopilotRunInput<T extends { id?: string; status: string }> {
  activeRun?: T | null;
  selectedRun?: T | null;
  runs: T[];
}

export interface CopilotPendingActionSummaryInput {
  type: string;
  input?: Record<string, unknown>;
  result?: Record<string, unknown> | null;
}

export interface CopilotPendingActionSummary {
  detail: string;
  preview?: string;
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

export type CopilotStartBlocker =
  | "prompt"
  | "provider_setup"
  | "model_providers_loading"
  | "model_providers_failed"
  | "model_selection"
  | "live_run"
  | "creating";

export type CopilotLaunchSource = "dashboard" | "project" | "session" | "settings" | "copilot";
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
}

export interface CopilotProviderCredentialChoice {
  providerProfileId: string;
  status: string;
}

export interface CopilotModelChoice {
  providerProfileId: string;
  status: string;
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

const launchSources = new Set<CopilotLaunchSource>(["dashboard", "project", "session", "settings", "copilot"]);
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

export function getCopilotPendingActionSummary(
  action: CopilotPendingActionSummaryInput
): CopilotPendingActionSummary | null {
  const payload = action.input ?? action.result ?? {};
  switch (action.type) {
    case "openforge.propose_memory_write":
      return summarizeMemoryWrite(payload);
    case "openforge.propose_session_create":
      return summarizeSessionCreate(payload);
    case "openforge.propose_diagnostics_export":
      return {
        detail: "Diagnostics export",
        preview: previewText(readString(payload, "reason")),
      };
    case "openforge.propose_troubleshooting_steps":
      return summarizeTroubleshootingSteps(payload);
    default:
      return null;
  }
}

export function resolveCopilotRunSelection(input: ResolveCopilotRunSelectionInput): string | null {
  const runIds = new Set(input.runs.map((run) => run.id));
  if (input.selectedRunId && runIds.has(input.selectedRunId)) return input.selectedRunId;
  if (input.activeRunId) return input.activeRunId;
  return input.runs[0]?.id ?? null;
}

export function isCopilotRunLive(status: string): boolean {
  return status === "queued" || status === "running" || status === "waiting_for_approval";
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

export function getSelectableCopilotProviders<TProvider extends CopilotProviderChoice>(
  input: SelectableCopilotProvidersInput<TProvider>
): TProvider[] {
  return input.providers.filter((provider) =>
    isSelectableCopilotProvider(provider, input.supportedProviderFormats, input.credentials, input.models)
  );
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

function summarizeTroubleshootingSteps(payload: Record<string, unknown>): CopilotPendingActionSummary {
  const steps = readStringArray(payload, "steps");
  return {
    detail: readString(payload, "summary") ?? "Troubleshooting steps",
    preview: previewText(steps.join(" / ")),
  };
}

function readString(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function readStringArray(payload: Record<string, unknown>, key: string): string[] {
  const value = payload[key];
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
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
