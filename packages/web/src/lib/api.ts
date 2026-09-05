import { clearToken, clearUser, getToken } from "@/lib/auth";
import type { StoredNotification } from "@/lib/notifications";
import { getGatewayBaseUrl } from "@/lib/runtime-config";

export interface GateASession {
  id: string;
  attachToken: string;
  tmuxName: string;
  status: string;
}

export interface User {
  id: string;
  email: string;
  role?: "admin" | "user" | string;
  status?: "active" | "disabled" | string;
}

export interface AuthPayload {
  token: string;
  user: User;
}

export interface Project {
  id: string;
  name: string;
  path: string;
  rootPath?: string;
  source?: string;
  aiTool?: string;
  templateId?: string | null;
  description?: string;
  status?: string;
}

export interface ProjectManagerEvidenceRef {
  kind?: string;
  label?: string;
  status?: string;
  ref?: string;
  path?: string;
  sessionId?: string;
  feishuChatId?: string;
  feishuMessageId?: string;
  createdAt?: string;
}

export interface ProjectManagerGoal {
  id: string;
  projectId: string;
  summary: string;
  constraints: string[];
  acceptanceCriteria: string[];
  status: string;
  createdAt: number;
  updatedAt: number;
}

export interface ProjectManagerGoalInput {
  summary: string;
  constraints?: string[];
  acceptanceCriteria?: string[];
  status?: string;
}

export type ProjectManagerWorkItemStatus =
  | "todo"
  | "in_progress"
  | "blocked"
  | "ready_for_review"
  | "done"
  | "cancelled";

export type ProjectManagerTaskPacketQueueStatus =
  | "planned"
  | "running"
  | "waiting_for_review"
  | "blocked"
  | "completed"
  | "cancelled";

export interface ProjectManagerWorkItem {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  status: ProjectManagerWorkItemStatus;
  priority: number;
  acceptanceCriteria: string[];
  evidenceRefCount: number;
  evidenceRefs: ProjectManagerEvidenceRef[];
  feishuRefCount: number;
  stageId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface ProjectManagerTaskPacket {
  id: string;
  projectId: string;
  workItemId: string;
  workItemStatus: ProjectManagerWorkItemStatus;
  queueStatus: ProjectManagerTaskPacketQueueStatus;
  title: string;
  updatedAt: number;
  prompt: string;
  acceptanceCriteria: string[];
  expectedVerification: string[];
  evidenceRequirements: string[];
  runtime: {
    adapter: string;
    templateId: string;
  };
  sessionLink: {
    sessionId: string;
    status: string;
    aiTool: string;
    href: string;
  } | null;
  blockedReason: "no_linked_session" | "linked_session_not_running" | null;
}

export interface ProjectManagerStarterPack {
  id: string;
  name: string;
  description: string;
  recommendedAdapter: "claude" | "opencode" | "codex" | "kimi";
  promptFrame: string;
  acceptanceChecklist: string[];
  verificationGuidance: string[];
  evidenceFields: string[];
}

export interface ProjectManagerWorkItemInput {
  title: string;
  description?: string | null;
  priority?: number;
  acceptanceCriteria?: string[];
  evidenceRefs?: ProjectManagerEvidenceRef[];
  feishuRefs?: ProjectManagerEvidenceRef[];
  stageId?: string | null;
}

export interface ProjectManagerWorkItemUpdateInput {
  title?: string;
  description?: string | null;
  priority?: number;
  acceptanceCriteria?: string[];
  stageId?: string | null;
}

export interface ProjectManagerWorkItemStatusInput {
  status: ProjectManagerWorkItemStatus;
  evidenceRefs?: ProjectManagerEvidenceRef[];
  manualCompletionReason?: string;
}

export interface ProjectManagerBatchStatusInput {
  updates: Array<{
    workItemId: string;
    status: ProjectManagerWorkItemStatus;
    evidenceRefs?: ProjectManagerEvidenceRef[];
    manualCompletionReason?: string;
  }>;
}

export interface ProjectManagerWorkItemDeleteInput {
  confirm: true;
}

export interface ProjectManagerEvidenceInput {
  evidenceRefs: ProjectManagerEvidenceRef[];
}

export type ProjectManagerLedgerEventType =
  | "goal_updated"
  | "work_item_created"
  | "work_item_updated"
  | "work_item_deleted"
  | "work_item_status_changed"
  | "evidence_attached"
  | "blocker_recorded"
  | "blocker_resolved"
  | "feishu_reference_linked"
  | "next_step_proposed"
  | "manual_completion_recorded"
  | "stage_created"
  | "stage_updated"
  | "stage_deleted"
  | "dependency_added"
  | "dependency_removed";

export interface ProjectManagerLedgerTrace {
  actionType?: "create_work_item" | "update_work_item_status" | "attach_evidence" | string;
  targetType?: "project" | "work_item" | string;
  targetId?: string;
  evidenceRefCount?: number;
  approvalStatus?: "approved" | "failed" | "rejected" | string;
  executionStatus?: "succeeded" | "failed" | string;
}

export interface ProjectManagerLedgerEvent {
  id: string;
  projectId: string;
  workItemId: string | null;
  eventType: ProjectManagerLedgerEventType;
  status: ProjectManagerWorkItemStatus | null;
  evidenceRefCount: number;
  feishuRefCount: number;
  trace?: ProjectManagerLedgerTrace;
  createdAt: number;
}

export interface Template {
  id: string;
  userId?: string | null;
  name: string;
  adapter?: string;
  description?: string | null;
  version?: string;
  visibility?: "private" | "shared" | "admin";
  builtin?: boolean;
  isBuiltin?: boolean;
  status?: string;
  files?: TemplateFile[];
  usageCount?: number;
}

export interface TemplateFile {
  id?: number;
  templateId?: string;
  filePath: string;
  content: string;
  fileType?: string;
  sizeBytes?: number;
}

export interface TemplateInput {
  name: string;
  description?: string;
  version?: string;
  visibility?: "private" | "shared" | "admin";
  files?: Array<{
    filePath: string;
    content: string;
    fileType?: string;
  }>;
}

export interface TemplateUpdateInput {
  name?: string;
  description?: string;
  version?: string;
  visibility?: "private" | "shared" | "admin";
  status?: string;
}

export interface TemplatePackage {
  name: string;
  description?: string | null;
  version: string;
  files: Array<{
    filePath: string;
    content: string;
    fileType: string;
  }>;
  exportedAt: string;
}

export interface TemplateVersion extends TemplatePackage {
  id: number;
  templateId: string;
  action: string;
  createdAt: string;
}

export interface Session {
  id: string;
  attachToken?: string;
  tmuxName?: string | null;
  tmuxSession?: string | null;
  status: string;
  name?: string;
  projectId?: string;
  projectName?: string;
  aiTool?: string;
}

export interface DependencyStatus {
  name: string;
  available: boolean;
  required?: boolean;
  version?: string;
  error?: string;
}

export interface TerminalRuntimeStatus {
  persistence: "tmux" | "psmux";
  mode:
    | "native_tmux"
    | "native_psmux"
    | "wsl_required"
    | "tmux_missing"
    | "psmux_missing"
    | "psmux_outdated"
    | string;
  supported: boolean;
  message: string;
}

export interface DependencyReport {
  dependencies: DependencyStatus[];
  terminalRuntime?: TerminalRuntimeStatus;
}

export type FeishuAuthState = "authenticated" | "unauthenticated" | "unknown";
export type FeishuIdentityMode = "user" | "bot" | "unknown";

export interface FeishuIntegrationStatus {
  available: boolean;
  version?: string;
  authState: FeishuAuthState;
  identityMode: FeishuIdentityMode;
  enabled: boolean;
  emergencyDisabled?: boolean;
  error?: string;
}

export interface FeishuAppAccount {
  appId: string;
  enabled: boolean;
  secretConfigured: boolean;
}

export interface FeishuChannelAccount extends FeishuAppAccount {
  id: string;
  connectionState: string;
  configRevision: number;
  updatedAt: string;
}

export interface FeishuConnectionHealth {
  state: "disabled" | "connecting" | "connected" | "reconnecting" | "unhealthy" | "stopped" | string;
  accountId: string | null;
  configRevision: number | null;
  reconnectAttempt: number;
  lastConnectedAt: string | null;
  lastErrorMessage: string | null;
}

export interface FeishuIntegrationConfig {
  enabled: boolean;
  emergencyDisabled: boolean;
  identityMode: FeishuIdentityMode;
  allowedChatIds: string[];
  commandPrefix: string;
}

export interface UpdateFeishuIntegrationConfigInput {
  enabled?: boolean;
  emergencyDisabled?: boolean;
  identityMode?: FeishuIdentityMode;
  allowedChatIds?: string[];
  commandPrefix?: string;
}

export interface FeishuUserMapping {
  id: string;
  feishuUserId: string;
  forgebadgerUserId: string;
  displayName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReplaceFeishuUserMappingInput {
  feishuUserId: string;
  forgebadgerUserId: string;
  displayName?: string | null;
}

export interface LocalDiagnosticsExport {
  generatedAt: string;
  app: {
    name: "ForgeBadger";
    version: string;
  };
  runtime: {
    node: string;
    platform: string;
    arch: string;
  };
  counts: Record<string, number>;
  dashboardHealth: unknown;
  adapters: Array<{
    id: string;
    command: string;
    runtimeModes: string[];
  }>;
  modelProviders: {
    counts: {
      providers: number;
      activeProviders: number;
      models: number;
      activeModels: number;
      credentials: number;
      activeCredentials: number;
      defaultModels: number;
    };
    apiFormats: Record<string, number>;
    providers: Array<{
      id: string;
      name: string;
      providerKey: string;
      apiFormat: string;
      authType: string;
      status: string;
      modelCount: number;
      activeModelCount: number;
      credentialCount: number;
      activeCredentialCount: number;
      hasDefaultModel: boolean;
      readyForUse: boolean;
    }>;
  };
  integrations?: {
    feishu?: FeishuIntegrationStatus;
  };
  environment: Record<string, unknown>;
}

export interface Skill {
  id: string;
  name: string;
  source: string;
  description?: string | null;
  content?: string;
  version?: string;
  visibility?: "private" | "shared" | "admin";
  isEnabled: boolean;
}

export interface SkillDiscovery {
  roots: string[];
  discoveredRoots?: string[];
  discoveredCount: number;
  createdCount: number;
  updatedCount: number;
  deletedCount: number;
  skippedCount: number;
}

export interface SkillTemplate {
  id: "plan" | "review" | "verify" | "debug" | "release" | string;
  name: string;
  title: string;
  description: string;
  source: string;
  version: string;
  content: string;
}

export interface AdminUser {
  id: string;
  email: string;
  role: "admin" | "user" | string;
  status: "active" | "disabled" | string;
  createdAt?: string;
  updatedAt?: string;
}

export interface AdminUserUpdateInput {
  role?: "admin" | "user";
  status?: "active" | "disabled";
}

export interface SkillSource {
  id: string;
  label: string;
  description: string;
  installMode: "manual" | "catalog" | "remote";
  starterContent: string;
  defaultVersion: string;
}

export interface CatalogSource {
  id: string;
  sourceId: string;
  type: "skill" | "template";
  label: string;
  url: string;
  status: string;
  lastRefreshedAt?: string | null;
}

export interface CatalogItem {
  id: string;
  sourceId: string;
  itemType: "skill" | "template";
  externalId: string;
  name: string;
  description?: string | null;
  version?: string | null;
  metadata?: unknown;
  fetchedAt: string;
}

export interface ProjectSkill {
  skillId: string;
  name: string;
  description?: string | null;
  source: string;
  content: string;
  version: string;
  isEnabled: boolean;
  selectionState?: "inherited_enabled" | "inherited_disabled" | "project_enabled" | "project_disabled";
}

export type ProviderAuthType = "api_key" | "bearer_token" | "oauth" | "none";
export type ProviderApiFormat = "anthropic" | "openai" | "openai-compatible" | "google" | "bedrock" | "local";
export type ProviderSupportedAdapter = "claude" | "opencode" | "codex" | "kimi";
export type ProviderProductType = "payg_api" | "coding_plan" | "token_plan" | "subscription" | "local";
export type ProviderReadinessAdapter = ProviderSupportedAdapter;
export type ProviderReadinessStatus = "ready" | "needs_attention" | "managed_elsewhere";
export type ProviderReadinessCode =
  | "ready"
  | "provider_disabled"
  | "unsupported_target"
  | "missing_model"
  | "missing_active_credential"
  | "remote_validation_unavailable"
  | "remote_model_missing"
  | "remote_validation_failed"
  | "native_auth_not_ready";
export type ProviderReadinessCheckStatus =
  | "ready"
  | "disabled"
  | "supported"
  | "unsupported"
  | "managed_elsewhere"
  | "selected"
  | "missing"
  | "not_required"
  | "passed"
  | "missing_model"
  | "unavailable"
  | "failed"
  | "skipped";

export interface ProviderProfile {
  id: string;
  providerKey: string;
  name: string;
  baseUrl: string | null;
  anthropicBaseUrl?: string | null;
  openaiBaseUrl?: string | null;
  region?: string | null;
  productType?: ProviderProductType | null;
  authType: ProviderAuthType;
  apiFormat: ProviderApiFormat;
  supportedAdapters: ProviderSupportedAdapter[];
  opencodeNpm?: string | null;
  allowPlaintextHttp?: boolean;
  status: string;
}

export interface ModelProfile {
  id: string;
  providerProfileId: string;
  providerKey: string;
  providerName: string;
  baseUrl: string | null;
  anthropicBaseUrl?: string | null;
  openaiBaseUrl?: string | null;
  name: string;
  modelId: string;
  capabilities: string[];
  contextWindow: number | null;
  status: string;
  isDefault: boolean;
}

export interface ProviderModelSyncResult {
  fetchedCount: number;
  createdCount: number;
  updatedCount?: number;
  models: ModelProfile[];
}

export interface ProviderBalanceEntry {
  label: string;
  remaining: number;
  unit: string;
  isAvailable?: boolean;
  limit?: number;
  resetsAt?: string;
}

export interface ProviderBalanceResult {
  supported: boolean;
  detectedProvider?: string;
  balances: ProviderBalanceEntry[];
  checkedAt: string;
  cached?: boolean;
}

export interface AppliedProviderInfo {
  providerProfileId: string;
  providerName: string;
  providerStatus: string;
  modelProfileId: string | null;
  appliedAt: string;
}

export interface ProviderCredentialSummary {
  id: string;
  providerProfileId: string;
  label: string | null;
  status: string;
  secretPreview: string;
}

export interface ModelProviderReadiness {
  status: ProviderReadinessStatus;
  code: ProviderReadinessCode;
  checkedAt: string;
  provider: {
    id: string;
    name: string;
    providerKey: string;
    apiFormat: string;
    authType: string;
  };
  selection: {
    adapter: ProviderReadinessAdapter;
    modelProfileId?: string;
    modelId?: string;
    credentialId?: string;
  };
  checks: {
    provider: ProviderReadinessCheckStatus;
    adapter: ProviderReadinessCheckStatus;
    model: ProviderReadinessCheckStatus;
    credential: ProviderReadinessCheckStatus;
    remoteModelList: ProviderReadinessCheckStatus;
  };
  remote?: {
    checked: boolean;
    modelCount?: number;
    matchedModelId?: string;
    errorCode?: string;
    error?: string;
  };
  nativeAuth?: CodexNativeAuthStatus;
  steps: string[];
}

export interface CodexNativeAuthStatus {
  state: "ready" | "not_authenticated" | "cli_missing" | "unknown";
  method: "chatgpt" | "api" | "unknown";
}

export interface SessionActivity {
  id: string;
  sessionId?: string | null;
  projectId?: string | null;
  type: string;
  status: "info" | "success" | "warning" | "error" | string;
  message: string;
  metadata?: unknown;
  createdAt: string;
}

export interface SessionSnapshot {
  id: string;
  sessionId?: string | null;
  projectId?: string | null;
  tmuxSession?: string | null;
  modelId?: string | null;
  configVersion?: string | null;
  metadata?: unknown;
  createdAt: string;
}

export interface AiConfigFile {
  relativePath: string;
  scope: "project" | "global";
  role: "instructions" | "settings" | "agent" | "command" | "skill" | "hook" | "other" | string;
  fileType: string;
  exists: boolean;
  editable: boolean;
  content: string;
  sizeBytes: number;
}

export interface AiConfigSnapshot {
  adapter: "claude" | "opencode" | "codex" | "kimi" | string;
  projectRoot: string;
  files: AiConfigFile[];
}

export interface WorkspaceTreeEntry {
  name: string;
  path: string;
  kind: "directory" | "file" | "symlink" | "other" | string;
  sizeBytes?: number;
  updatedAt?: string;
  children?: WorkspaceTreeEntry[];
}

export interface WorkspaceTreeSnapshot {
  projectId: string;
  rootPath: string;
  path: string;
  entries: WorkspaceTreeEntry[];
  truncated: boolean;
}

export interface WorkspaceFileSnapshot {
  projectId: string;
  rootPath: string;
  path: string;
  name: string;
  sizeBytes: number;
  updatedAt: string;
  encoding: "utf8" | string;
  content: string;
  truncated: boolean;
  binary: boolean;
}

export interface SnapshotRestoreResult {
  session: Session;
  mode: "attach_tmux" | "recreate_session";
}

export interface AuditLog {
  id: number;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  details: unknown;
  ipAddress?: string | null;
  createdAt: string;
}

export interface AuditLogListOptions {
  resourceType?: string;
  resourceId?: string;
  limit?: number;
  action?: string;
}

export interface UsageSummary {
  totalSessions: number;
  totalDurationMs: number;
  estimatedCostUsd: number;
  costLabel: "estimated";
  byAdapter: Array<{ key: string; adapter: string; sessions: number; durationMs: number; estimatedCostUsd: number }>;
  byProject: Array<{ key: string; sessions: number; durationMs: number; estimatedCostUsd: number }>;
  byModel: Array<{ key: string; sessions: number; durationMs: number; estimatedCostUsd: number }>;
}

export interface UsageRate {
  id: string;
  modelId: string;
  hourlyRateUsd: number;
}

export interface TokenUsageBucket {
  key: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  requestCount: number;
  cacheHitRate: number | null;
}

export interface TokenUsageSummary {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheWriteTokens: number;
  totalReasoningTokens: number;
  totalTokens: number;
  requestCount: number;
  cacheHitRate: number | null;
  byAdapter: TokenUsageBucket[];
  byProject: TokenUsageBucket[];
  byModel: TokenUsageBucket[];
}

export interface TokenDailyPoint {
  day: string;
  group: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface UsageSyncResultItem {
  adapter: "claude" | "opencode";
  scanned: number;
  inserted: number;
}

export interface UsageSyncResult {
  byAdapter: UsageSyncResultItem[];
  totalInserted: number;
}

export interface AdapterDiscovery {
  id: "claude" | "opencode" | "codex" | "kimi";
  label: string;
  command: string;
  supportLevel: "supported" | "prototype";
  launchEnabled: boolean;
  configDir: string;
  runtimeModes: Array<"terminal" | string>;
  available: boolean;
  status: "available" | "missing";
  version?: string;
  error?: string;
}

export type RuntimeAdapterId = AdapterDiscovery["id"];

export type CredentialMode = "host_environment" | "stored_encrypted_key";

export interface SkillInput {
  name: string;
  description?: string;
  source?: string;
  content: string;
  version?: string;
  visibility?: "private" | "shared" | "admin";
}

export interface SkillUpdateInput {
  name?: string;
  description?: string;
  source?: string;
  content?: string;
  version?: string;
  visibility?: "private" | "shared" | "admin";
}

export interface SkillInstallInput {
  sourceId: string;
  name: string;
  description?: string;
  content?: string;
  version?: string;
  url?: string;
  skillId?: string;
  enable?: boolean;
}

export interface RemoteSkillPreview {
  name: string;
  description?: string;
  version: string;
  content: string;
  sizeBytes: number;
  provenance: {
    sourceId: string;
    url: string;
    kind: "manifest" | "raw-skill";
    skillId?: string;
    fetchedAt: string;
  };
}

export interface SkillSourcePreviewInput {
  sourceId: string;
  url: string;
  skillId?: string;
  timeoutMs?: number;
}

export interface ApiKeySummary {
  id: string;
  userId?: string;
  provider: string;
  label?: string | null;
  status?: string;
  lastUsedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface ApiKeyInput {
  provider: string;
  name: string;
  plaintextKey: string;
}

export interface ConfigFilePreview {
  relativePath: string;
  sha256: string;
}

export interface ConfigConflict {
  relativePath: string;
  conflictType: string;
  allowedActions: string[];
  existingSha256?: string;
  incomingSha256?: string;
  diffPreview?: Array<{ line: number; existing: string; incoming: string }>;
}

export interface ConfigPreview {
  plan: {
    dryRun: boolean;
    files: ConfigFilePreview[];
  };
  conflicts: ConfigConflict[];
}

export interface ConfigSyncSummary {
  templateId: string;
  totalFiles: number;
  missingFiles: string[];
  identicalFiles: string[];
  modifiedFiles: string[];
  unsafeFiles: string[];
  requiresDecision: string[];
}

export interface ConfigComplianceSummary extends ConfigSyncSummary {
  status: "compliant" | "needs_attention";
  staleFiles: string[];
}

export interface ConfigSyncPreview extends ConfigPreview {
  summary: ConfigSyncSummary;
}

export interface ConfigComplianceReport {
  compliance: ConfigComplianceSummary;
  conflicts: ConfigConflict[];
  files: ConfigFilePreview[];
}

export interface ConfigWriteResult {
  result: {
    writtenFiles: string[];
    skippedFiles: string[];
    backupPath: string;
    conflicts: ConfigConflict[];
    rollbackAvailable: boolean;
  };
}

export interface ConfigSyncWriteResult extends ConfigWriteResult {
  summary: ConfigSyncSummary;
}

export type ConfigDecision = "skip" | "overwrite";

export interface DashboardStats {
  projects: number;
  sessions: number;
  runningSessions: number;
  skills: number;
  models: number;
  apiKeys: number;
  templates: number;
}

export interface DashboardHealthItem {
  healthy: boolean;
  count?: number;
  message: string;
}

export interface DashboardHealth {
  gateway: DashboardHealthItem;
  database: DashboardHealthItem;
  projectConfig: DashboardHealthItem;
  models: DashboardHealthItem;
  credentials: DashboardHealthItem;
  sessions: DashboardHealthItem;
  skills: DashboardHealthItem;
}

export interface DashboardSummary {
  stats: DashboardStats;
  health: DashboardHealth;
}

export interface NotificationList {
  notifications: StoredNotification[];
  unreadCount: number;
}

export function defaultConfigConflictDecisions(
  conflicts: ConfigConflict[]
): Record<string, ConfigDecision> {
  return Object.fromEntries(
    conflicts
      .filter((conflict) => conflict.allowedActions.includes("skip"))
      .map((conflict) => [conflict.relativePath, "skip" as const])
  );
}

interface ApiEnvelope<T> {
  code: number;
  data?: T;
  message: string;
  details?: Record<string, unknown>;
}

const DEFAULT_API_TIMEOUT_MS = 30_000;
interface ApiRequestOptions extends RequestInit {
  timeoutMs?: number;
}

export const gatewayBaseUrl = getGatewayBaseUrl();

export class GatewayApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "GatewayApiError";
  }
}

export function apiUrl(path: string): string {
  const baseUrl = getGatewayBaseUrl().replace(/\/+$/, "");
  return `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

export async function fetchJson<T = unknown>(path: string, options: ApiRequestOptions = {}) {
  const token = getToken();
  const { request, cleanup } = buildApiRequest(options, token);
  const res = await fetch(apiUrl(path), request).catch(normalizeFetchError).finally(cleanup);
  const envelope = await readApiEnvelope<T>(res);
  if (!res.ok) {
    handleUnauthorized(path, token !== null, res.status);
    throw errorFromResponse(res, envelope);
  }
  if (!envelope) {
    throw new GatewayApiError("API request failed", res.status);
  }
  if (envelope.code !== 0) {
    throw errorFromEnvelope(envelope, res.status);
  }
  return envelope.data as T;
}

export async function fetchEnvelope<T = unknown>(path: string, options: ApiRequestOptions = {}) {
  const token = getToken();
  const { request, cleanup } = buildApiRequest(options, token);
  const res = await fetch(apiUrl(path), request).catch(normalizeFetchError).finally(cleanup);
  const envelope = await readApiEnvelope<T>(res);
  if (!res.ok) {
    handleUnauthorized(path, token !== null, res.status);
    throw errorFromResponse(res, envelope);
  }
  if (!envelope) {
    throw new GatewayApiError("API request failed", res.status);
  }
  if (envelope.code !== 0) {
    throw errorFromEnvelope(envelope, res.status);
  }
  return envelope;
}

function buildApiRequest(options: ApiRequestOptions, token: string | null): {
  request: RequestInit;
  cleanup: () => void;
} {
  const { timeoutMs = DEFAULT_API_TIMEOUT_MS, ...requestOptions } = options;
  const controller = requestOptions.signal ? undefined : new AbortController();
  const timeout = controller
    ? setTimeout(() => controller.abort(), timeoutMs)
    : undefined;
  return {
    request: {
      ...requestOptions,
      signal: requestOptions.signal ?? controller?.signal,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...requestOptions.headers,
      },
    },
    cleanup: () => {
      if (timeout) {
        clearTimeout(timeout);
      }
    },
  };
}

function formatHttpError(res: Response): string {
  return `Gateway request failed with HTTP ${res.status}`;
}

/**
 * A 401 with a locally stored token means the token is expired or revoked.
 * Clear the stale session and bounce to the login page (with a return path)
 * instead of leaving the dashboard in a half-broken pseudo-logged-in state.
 * Auth endpoints manage their own credentials state and are exempt: a failed
 * login attempt must not trigger a redirect loop.
 */
/** Login/register/logout carry the credentials themselves; a 401 there is a
 * wrong password, not a stale session, and must not trigger a redirect.
 * change-password likewise answers 401 for a wrong current password. */
const AUTH_CREDENTIAL_PATHS = [
  "/api/v1/auth/login",
  "/api/v1/auth/register",
  "/api/v1/auth/logout",
  "/api/v1/auth/change-password",
  "/api/v1/auth/reset-password"
];

function handleUnauthorized(path: string, hadToken: boolean, status: number): void {
  if (status !== 401 || !hadToken) return;
  if (AUTH_CREDENTIAL_PATHS.some((authPath) => path.startsWith(authPath))) return;
  if (typeof window === "undefined") return;
  clearToken();
  clearUser();
  if (window.location.pathname.startsWith("/login")) return;
  const next = window.location.pathname + window.location.search;
  window.location.href = `/login?next=${encodeURIComponent(next)}`;
}

function normalizeFetchError(error: unknown): never {
  if (error instanceof DOMException && error.name === "AbortError") {
    throw new GatewayApiError("Gateway request timed out. Check that the Gateway service is running.");
  }
  throw error;
}

async function readApiEnvelope<T>(res: Response): Promise<ApiEnvelope<T> | null> {
  try {
    return (await res.json()) as ApiEnvelope<T>;
  } catch {
    return null;
  }
}

function errorFromResponse<T>(res: Response, envelope: ApiEnvelope<T> | null): GatewayApiError {
  if (envelope && isErrorEnvelope(envelope)) {
    return errorFromEnvelope(envelope, res.status);
  }
  return new GatewayApiError(formatHttpError(res), res.status);
}

function errorFromEnvelope<T>(envelope: ApiEnvelope<T>, status?: number): GatewayApiError {
  return new GatewayApiError(envelope.message || "API request failed", status, envelope.details);
}

function isErrorEnvelope<T>(envelope: ApiEnvelope<T>): boolean {
  return envelope.code !== 0 || Boolean(envelope.message) || Boolean(envelope.details);
}

export async function login(email: string, password: string) {
  return fetchEnvelope<AuthPayload>("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export async function register(email: string, password: string, recoveryKey: string) {
  return fetchEnvelope<AuthPayload>("/api/v1/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password, recoveryKey }),
  });
}

export async function getMe() {
  return fetchEnvelope<User>("/api/v1/auth/me", { method: "GET" });
}

export interface AuthSessionSummary {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  userAgent: string | null;
  current: boolean;
}

export async function listAuthSessions(): Promise<{ sessions: AuthSessionSummary[] }> {
  return fetchJson("/api/v1/auth/sessions") as Promise<{ sessions: AuthSessionSummary[] }>;
}

export async function revokeAuthSession(id: string): Promise<{ revoked: number }> {
  return fetchJson(`/api/v1/auth/sessions/${encodeURIComponent(id)}`, {
    method: "DELETE"
  }) as Promise<{ revoked: number }>;
}

export async function revokeOtherAuthSessions(): Promise<{ revoked: number }> {
  return fetchJson("/api/v1/auth/sessions", { method: "DELETE" }) as Promise<{ revoked: number }>;
}

export async function changePassword(
  currentPassword: string,
  newPassword: string
): Promise<{ revokedSessions: boolean }> {
  return fetchJson("/api/v1/auth/change-password", {
    method: "POST",
    body: JSON.stringify({ currentPassword, newPassword })
  }) as Promise<{ revokedSessions: boolean }>;
}

export async function resetPassword(input: {
  email: string;
  recoveryKey: string;
  newPassword: string;
}): Promise<{ revokedSessions: boolean; recoveryKeyRotated: boolean }> {
  return fetchJson("/api/v1/auth/reset-password", {
    method: "POST",
    body: JSON.stringify(input)
  }) as Promise<{ revokedSessions: boolean; recoveryKeyRotated: boolean }>;
}

export async function getDependencies(): Promise<DependencyReport> {
  return fetchJson("/api/v1/gate-a/dependencies", {
    cache: "no-store"
  }) as Promise<DependencyReport>;
}

export async function getFeishuIntegrationStatus(): Promise<FeishuIntegrationStatus> {
  const data = await fetchJson<{ status: FeishuIntegrationStatus }>("/api/v1/integrations/feishu/status", {
    cache: "no-store"
  });
  return data.status;
}

export async function getFeishuAppAccount(): Promise<FeishuAppAccount | null> {
  const data = await fetchJson<{ account: FeishuAppAccount | null }>("/api/v1/integrations/feishu/account", {
    cache: "no-store"
  });
  return data.account;
}

export async function saveFeishuAppAccount(input: {
  appId: string;
  appSecret?: string;
  enabled: boolean;
}): Promise<FeishuAppAccount> {
  const data = await fetchJson<{ account: FeishuAppAccount }>("/api/v1/integrations/feishu/account", {
    method: "PUT",
    body: JSON.stringify(input)
  });
  return data.account;
}

export async function getFeishuChannelAccount(): Promise<FeishuChannelAccount | null> {
  const data = await fetchJson<{ account: FeishuChannelAccount | null }>("/api/v1/integrations/feishu/account", {
    cache: "no-store"
  });
  return data.account;
}

export async function saveFeishuChannelAccount(input: {
  appId: string;
  appSecret?: string;
  enabled: boolean;
}): Promise<FeishuChannelAccount> {
  const data = await fetchJson<{ account: FeishuChannelAccount }>("/api/v1/integrations/feishu/account", {
    method: "PUT",
    body: JSON.stringify(input)
  });
  return data.account;
}

export async function getFeishuConnectionHealth(): Promise<FeishuConnectionHealth> {
  const data = await fetchJson<{ health: FeishuConnectionHealth }>("/api/v1/integrations/feishu/health", {
    cache: "no-store"
  });
  return data.health;
}

export async function emergencyStopFeishu(): Promise<void> {
  await fetchJson("/api/v1/integrations/feishu/emergency-stop", { method: "POST", body: "{}" });
}

export async function getFeishuIntegrationConfig(): Promise<FeishuIntegrationConfig> {
  const data = await fetchJson<{ config: FeishuIntegrationConfig }>("/api/v1/integrations/feishu/config", {
    cache: "no-store"
  });
  return data.config;
}

export async function updateFeishuIntegrationConfig(
  input: UpdateFeishuIntegrationConfigInput
): Promise<FeishuIntegrationConfig> {
  const data = await fetchJson<{ config: FeishuIntegrationConfig }>("/api/v1/integrations/feishu/config", {
    method: "PATCH",
    body: JSON.stringify(input)
  });
  return data.config;
}

export async function listFeishuUserMappings(): Promise<FeishuUserMapping[]> {
  const data = await fetchJson<{ mappings: FeishuUserMapping[] }>("/api/v1/integrations/feishu/user-mappings", {
    cache: "no-store"
  });
  return data.mappings;
}

export async function replaceFeishuUserMappings(
  mappings: ReplaceFeishuUserMappingInput[]
): Promise<FeishuUserMapping[]> {
  const data = await fetchJson<{ mappings: FeishuUserMapping[] }>("/api/v1/integrations/feishu/user-mappings", {
    method: "PUT",
    body: JSON.stringify({ mappings })
  });
  return data.mappings;
}

export async function getDashboardSummary(): Promise<DashboardSummary> {
  return fetchJson("/api/v1/dashboard/summary") as Promise<DashboardSummary>;
}

export async function listAdminUsers(): Promise<{ users: AdminUser[] }> {
  return fetchJson("/api/v1/admin/users") as Promise<{ users: AdminUser[] }>;
}

export async function updateAdminUser(
  id: string,
  data: AdminUserUpdateInput
): Promise<{ user: AdminUser }> {
  return fetchJson(`/api/v1/admin/users/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  }) as Promise<{ user: AdminUser }>;
}

export async function listNotifications(): Promise<NotificationList> {
  return fetchJson("/api/v1/notifications") as Promise<NotificationList>;
}

export async function listAuditLogs(
  options: AuditLogListOptions = {}
): Promise<{ auditLogs: AuditLog[] }> {
  const searchParams = new URLSearchParams();
  if (options.resourceType) searchParams.set("resourceType", options.resourceType);
  if (options.resourceId) searchParams.set("resourceId", options.resourceId);
  if (options.limit !== undefined) searchParams.set("limit", String(options.limit));
  if (options.action) searchParams.set("action", options.action);
  const query = searchParams.toString();
  return fetchJson(`/api/v1/audit-logs${query ? `?${query}` : ""}`) as Promise<{ auditLogs: AuditLog[] }>;
}

export async function exportDiagnostics(): Promise<{ report: LocalDiagnosticsExport }> {
  return fetchJson("/api/v1/diagnostics/export") as Promise<{ report: LocalDiagnosticsExport }>;
}

export async function listActivities(params: {
  sessionId?: string;
  projectId?: string;
  types?: string[];
  limit?: number;
} = {}): Promise<{ activities: SessionActivity[] }> {
  const searchParams = new URLSearchParams();
  if (params.sessionId) searchParams.set("sessionId", params.sessionId);
  if (params.projectId) searchParams.set("projectId", params.projectId);
  if (params.types && params.types.length > 0) searchParams.set("type", params.types.join(","));
  if (params.limit !== undefined) searchParams.set("limit", String(params.limit));
  const query = searchParams.toString();
  return fetchJson(`/api/v1/activities${query ? `?${query}` : ""}`) as Promise<{ activities: SessionActivity[] }>;
}

export async function listSnapshots(params: {
  sessionId?: string;
  projectId?: string;
} = {}): Promise<{ snapshots: SessionSnapshot[] }> {
  const searchParams = new URLSearchParams();
  if (params.sessionId) searchParams.set("sessionId", params.sessionId);
  if (params.projectId) searchParams.set("projectId", params.projectId);
  const query = searchParams.toString();
  return fetchJson(`/api/v1/snapshots${query ? `?${query}` : ""}`) as Promise<{ snapshots: SessionSnapshot[] }>;
}

export async function restoreSnapshot(id: string): Promise<SnapshotRestoreResult> {
  return fetchJson(`/api/v1/snapshots/${id}/restore`, {
    method: "POST",
  }) as Promise<SnapshotRestoreResult>;
}

export async function getUsageSummary(): Promise<{ summary: UsageSummary }> {
  return fetchJson("/api/v1/usage/summary") as Promise<{ summary: UsageSummary }>;
}

export async function getTokenUsageSummary(params: {
  from?: string;
  to?: string;
} = {}): Promise<{ summary: TokenUsageSummary }> {
  const searchParams = new URLSearchParams();
  if (params.from) searchParams.set("from", params.from);
  if (params.to) searchParams.set("to", params.to);
  const query = searchParams.toString();
  return fetchJson(`/api/v1/usage/token-summary${query ? `?${query}` : ""}`) as Promise<{
    summary: TokenUsageSummary;
  }>;
}

export async function getProjectActivity(params: {
  from?: string;
  to?: string;
} = {}): Promise<{ series: TokenDailyPoint[] }> {
  const searchParams = new URLSearchParams();
  if (params.from) searchParams.set("from", params.from);
  if (params.to) searchParams.set("to", params.to);
  const query = searchParams.toString();
  return fetchJson(`/api/v1/usage/project-activity${query ? `?${query}` : ""}`) as Promise<{
    series: TokenDailyPoint[];
  }>;
}

export async function syncUsageTokens(): Promise<{ result: UsageSyncResult }> {
  return fetchJson("/api/v1/usage/sync", { method: "POST" }) as Promise<{
    result: UsageSyncResult;
  }>;
}

export async function listUsageRates(): Promise<{ rates: UsageRate[] }> {
  return fetchJson("/api/v1/usage/rates") as Promise<{ rates: UsageRate[] }>;
}

export async function setUsageRate(modelId: string, hourlyRateUsd: number): Promise<{ rate: UsageRate }> {
  return fetchJson(`/api/v1/usage/rates/${modelId}`, {
    method: "PUT",
    body: JSON.stringify({ hourlyRateUsd }),
  }) as Promise<{ rate: UsageRate }>;
}

export async function markNotificationRead(id: string): Promise<{ notification: StoredNotification }> {
  return fetchJson(`/api/v1/notifications/${id}/read`, {
    method: "POST",
  }) as Promise<{ notification: StoredNotification }>;
}

export async function markAllNotificationsRead(): Promise<{ updated: number }> {
  return fetchJson("/api/v1/notifications/read-all", {
    method: "POST",
  }) as Promise<{ updated: number }>;
}

export async function clearServerNotifications(): Promise<{ deleted: number }> {
  return fetchJson("/api/v1/notifications", {
    method: "DELETE",
  }) as Promise<{ deleted: number }>;
}

export async function discoverAdapters(): Promise<{ adapters: AdapterDiscovery[] }> {
  return fetchJson("/api/v1/adapters/discovery") as Promise<{ adapters: AdapterDiscovery[] }>;
}

export async function createGateASession(cwd: string): Promise<GateASession> {
  const { session } = await fetchJson<{ session: GateASession }>("/api/v1/gate-a/sessions", {
    method: "POST",
    body: JSON.stringify({ cwd }),
  });
  return session;
}

// Projects
export function isAdapterLaunchable(adapter: Pick<AdapterDiscovery, "available" | "launchEnabled">): boolean {
  return adapter.available && adapter.launchEnabled;
}

export function chooseDefaultRuntimeAdapter(
  adapters: readonly AdapterDiscovery[],
  preferred?: RuntimeAdapterId | string | null
): RuntimeAdapterId | undefined {
  const preferredAdapter = adapters.find((adapter) => adapter.id === preferred);
  if (preferredAdapter && isAdapterLaunchable(preferredAdapter)) {
    return preferredAdapter.id;
  }
  return adapters.find(isAdapterLaunchable)?.id;
}

function projectManagerPath(projectId: string, suffix: string): string {
  return `/api/v1/projects/${encodeURIComponent(projectId)}/project-manager${suffix}`;
}

function projectWorkspacePath(projectId: string, suffix: string): string {
  return `/api/v1/projects/${encodeURIComponent(projectId)}/workspace${suffix}`;
}

export async function listProjects(): Promise<{ projects: Project[] }> {
  return fetchJson("/api/v1/projects") as Promise<{ projects: Project[] }>;
}

export async function createProject(data: {
  name: string;
  path: string;
  description?: string;
}): Promise<{ project: Project }> {
  return fetchJson("/api/v1/projects", {
    method: "POST",
    body: JSON.stringify(data),
  }) as Promise<{ project: Project }>;
}

export async function getProject(id: string): Promise<{ project: Project }> {
  return fetchJson(`/api/v1/projects/${id}`) as Promise<{ project: Project }>;
}

/**
 * 更新项目与模板的跟踪关系:传 `null` 解除跟踪;传模板 ID 切换/绑定;缺省(undefined)保持不变。
 */
export async function updateProjectTemplate(
  projectId: string,
  templateId: string | null | undefined
): Promise<{ project: Project }> {
  const body = templateId === undefined ? {} : { templateId };
  return fetchJson(`/api/v1/projects/${encodeURIComponent(projectId)}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  }) as Promise<{ project: Project }>;
}

/** 识别 Gateway 的"项目未跟踪任何模板"(404 + TEMPLATE_NOT_TRACKED)错误。 */
export function isTemplateNotTrackedError(error: unknown): boolean {
  return (
    error instanceof GatewayApiError &&
    error.status === 404 &&
    error.details?.code === "TEMPLATE_NOT_TRACKED"
  );
}


function aiConfigQuery(aiTool?: string): string {
  return aiTool ? `?aiTool=${encodeURIComponent(aiTool)}` : "";
}

export async function getProjectAiConfig(
  id: string,
  aiTool?: RuntimeAdapterId
): Promise<AiConfigSnapshot> {
  return fetchJson(
    `/api/v1/projects/${encodeURIComponent(id)}/ai-config${aiConfigQuery(aiTool)}`
  ) as Promise<AiConfigSnapshot>;
}

export async function getGlobalAiConfig(
  id: string,
  aiTool?: RuntimeAdapterId
): Promise<AiConfigSnapshot> {
  return fetchJson(
    `/api/v1/projects/${encodeURIComponent(id)}/ai-config/global${aiConfigQuery(aiTool)}`
  ) as Promise<AiConfigSnapshot>;
}

// CLI global config (per-CLI config files such as ~/.kimi-code/config.toml)
export interface CliConfigFileEntry {
  relativePath: string;
  fileType: string;
  exists: boolean;
  sizeBytes: number;
  content?: string;
}

export interface CliProviderEntry {
  id: string;
  name: string;
  protocol: string;
  baseUrl: string;
  hasApiKey: boolean;
  envKey?: string;
  isActive: boolean;
}

export interface CliModelEntry {
  alias: string;
  provider: string;
  modelId: string;
}

export interface CliConfigSnapshot {
  adapter: RuntimeAdapterId;
  configRoot: string;
  configFile: string;
  files: CliConfigFileEntry[];
  providers: CliProviderEntry[];
  models: CliModelEntry[];
  defaultModel: string;
}

export interface CliProviderInput {
  name?: string;
  protocol?: string;
  baseUrl?: string;
  envKey?: string;
}

function cliConfigPath(adapter: string, suffix = ""): string {
  return `/api/v1/cli-config/${encodeURIComponent(adapter)}${suffix}`;
}

export async function getCliConfig(adapter: RuntimeAdapterId): Promise<CliConfigSnapshot> {
  const { snapshot } = await fetchJson<{ snapshot: CliConfigSnapshot }>(cliConfigPath(adapter));
  return snapshot;
}

export async function getCliConfigFile(
  adapter: RuntimeAdapterId,
  path: string
): Promise<CliConfigFileEntry> {
  const searchParams = new URLSearchParams({ path });
  const { file } = await fetchJson<{ file: CliConfigFileEntry }>(
    `${cliConfigPath(adapter, "/file")}?${searchParams.toString()}`
  );
  return file;
}

export async function writeCliConfigFile(
  adapter: RuntimeAdapterId,
  path: string,
  content: string
): Promise<CliConfigSnapshot> {
  const { snapshot } = await fetchJson<{ snapshot: CliConfigSnapshot }>(cliConfigPath(adapter, "/file"), {
    method: "PUT",
    body: JSON.stringify({ path, content }),
  });
  return snapshot;
}

export async function upsertCliProvider(
  adapter: RuntimeAdapterId,
  providerId: string,
  input: CliProviderInput
): Promise<CliConfigSnapshot> {
  const { snapshot } = await fetchJson<{ snapshot: CliConfigSnapshot }>(
    cliConfigPath(adapter, `/providers/${encodeURIComponent(providerId)}`),
    { method: "PUT", body: JSON.stringify(input) }
  );
  return snapshot;
}

export async function removeCliProvider(
  adapter: RuntimeAdapterId,
  providerId: string
): Promise<CliConfigSnapshot> {
  const { snapshot } = await fetchJson<{ snapshot: CliConfigSnapshot }>(
    cliConfigPath(adapter, `/providers/${encodeURIComponent(providerId)}`),
    { method: "DELETE" }
  );
  return snapshot;
}

export async function upsertCliModel(
  adapter: RuntimeAdapterId,
  input: { alias: string; provider: string; modelId: string }
): Promise<CliConfigSnapshot> {
  const { snapshot } = await fetchJson<{ snapshot: CliConfigSnapshot }>(cliConfigPath(adapter, "/models"), {
    method: "PUT",
    body: JSON.stringify(input),
  });
  return snapshot;
}

export async function removeCliModel(
  adapter: RuntimeAdapterId,
  alias: string
): Promise<CliConfigSnapshot> {
  const { snapshot } = await fetchJson<{ snapshot: CliConfigSnapshot }>(cliConfigPath(adapter, "/models"), {
    method: "DELETE",
    body: JSON.stringify({ alias }),
  });
  return snapshot;
}

export async function setCliDefaultModel(
  adapter: RuntimeAdapterId,
  model: string,
  providerId?: string
): Promise<CliConfigSnapshot> {
  const { snapshot } = await fetchJson<{ snapshot: CliConfigSnapshot }>(
    cliConfigPath(adapter, "/default-model"),
    { method: "PUT", body: JSON.stringify(providerId ? { model, providerId } : { model }) }
  );
  return snapshot;
}


export interface CliConfigFieldSpec {
  key: string;
  path: string;
  label: string;
  type: "string" | "enum" | "secret" | "number" | "boolean";
  values?: string[];
  description?: string;
}

export interface CliConfigFieldsResult {
  fields: CliConfigFieldSpec[];
}

export async function getCliConfigFields(
  adapter: RuntimeAdapterId
): Promise<CliConfigFieldsResult> {
  return fetchJson(cliConfigPath(adapter, "/fields")) as Promise<CliConfigFieldsResult>;
}

export async function getCliConfigFieldValues(
  adapter: RuntimeAdapterId
): Promise<{ values: Record<string, unknown> }> {
  return fetchJson(cliConfigPath(adapter, "/field-values")) as Promise<{ values: Record<string, unknown> }>;
}

export async function patchCliConfigFields(
  adapter: RuntimeAdapterId,
  updates: Record<string, unknown>
): Promise<CliConfigSnapshot> {
  const { snapshot } = await fetchJson<{ snapshot: CliConfigSnapshot }>(
    cliConfigPath(adapter, "/fields"),
    { method: "PATCH", body: JSON.stringify({ updates }) }
  );
  return snapshot;
}

// ---- CLI config apply (cc-switch style provider application) ----

export type ClaudeModelSlot = "opus" | "sonnet" | "haiku" | "fable" | "subagent";
export type CodexReasoningEffort = "minimal" | "low" | "medium" | "high";

export interface CliConfigApplyInput {
  providerProfileId: string;
  modelProfileId?: string;
  credentialId?: string;
  /** Claude only: per-role model mapping; values are model profile ids. */
  modelMapping?: Partial<Record<ClaudeModelSlot, string>>;
  /** Codex only: model_reasoning_effort. */
  reasoningEffort?: CodexReasoningEffort;
}

export interface CliConfigApplyFilePreview {
  targetPath: string;
  fileType: string;
  operation: "create" | "update" | "none" | string;
  /** Observed content with credential values masked; null when the file does not exist. */
  current: string | null;
  /** Proposed content with credential values masked. */
  proposed: string;
  changedFields?: string[];
}

export interface CliConfigApplyPreview {
  adapter: string;
  providerProfileId?: string;
  modelProfileId?: string;
  credentialId?: string;
  files: CliConfigApplyFilePreview[];
  warnings?: string[];
}

export interface CliConfigApplyResult {
  adapter?: string;
  backupId: string;
  changed: boolean;
  files?: Array<{ targetPath: string; operation: string }>;
}

export interface CliConfigRollbackResult {
  adapter?: string;
  backupId?: string;
  restoredFiles?: string[];
}

export async function previewCliConfigApply(
  adapter: RuntimeAdapterId,
  input: CliConfigApplyInput
): Promise<CliConfigApplyPreview> {
  const { preview } = await fetchJson<{ preview: CliConfigApplyPreview }>(cliConfigPath(adapter, "/apply-provider/preview"), {
    method: "POST",
    body: JSON.stringify(input),
  });
  return preview;
}

export async function applyCliConfigToAdapter(
  adapter: RuntimeAdapterId,
  input: CliConfigApplyInput
): Promise<CliConfigApplyResult> {
  const { result } = await fetchJson<{ result: CliConfigApplyResult }>(cliConfigPath(adapter, "/apply-provider"), {
    method: "POST",
    body: JSON.stringify(input),
  });
  return result;
}

export async function rollbackCliConfigApply(
  adapter: RuntimeAdapterId,
  backupId?: string
): Promise<CliConfigRollbackResult> {
  const { result } = await fetchJson<{ result: CliConfigRollbackResult }>(cliConfigPath(adapter, "/rollback"), {
    method: "POST",
    body: JSON.stringify(backupId ? { backupId } : {}),
  });
  return result;
}


export async function getProjectWorkspaceTree(
  id: string,
  params: { path?: string; depth?: number; limit?: number } = {}
): Promise<WorkspaceTreeSnapshot> {
  const searchParams = new URLSearchParams();
  if (params.path) searchParams.set("path", params.path);
  if (params.depth !== undefined) searchParams.set("depth", String(params.depth));
  if (params.limit !== undefined) searchParams.set("limit", String(params.limit));
  const query = searchParams.toString();
  return fetchJson(projectWorkspacePath(id, `/tree${query ? `?${query}` : ""}`)) as Promise<WorkspaceTreeSnapshot>;
}

export async function getProjectWorkspaceFile(
  id: string,
  filePath: string
): Promise<WorkspaceFileSnapshot> {
  const searchParams = new URLSearchParams({ path: filePath });
  return fetchJson(projectWorkspacePath(id, `/file?${searchParams.toString()}`)) as Promise<WorkspaceFileSnapshot>;
}

// ---- Project graph (read-only CodeGraph index) ----

export interface GraphDistributionEntry {
  key: string;
  count: number;
}

export interface GraphSymbolRef {
  id: string;
  name: string;
  qualifiedName: string;
  kind: string;
  filePath: string;
  startLine: number;
  signature?: string | null;
}

export type GraphUnavailableReason =
  | "not_initialized"
  | "schema_unsupported"
  | "not_found"
  | "error";

export interface ProjectGraphOverview {
  available: true;
  indexState: string | null;
  indexedAt: number | null;
  files: { total: number; byLanguage: GraphDistributionEntry[] };
  nodes: { total: number; byKind: GraphDistributionEntry[] };
  edges: { total: number; byKind: GraphDistributionEntry[] };
}

export interface ProjectGraphSearchResult {
  available: true;
  symbols: GraphSymbolRef[];
}

export interface GraphNeighborRef extends GraphSymbolRef {
  edgeKind: string;
}

export interface ProjectGraphSymbolDetail {
  available: true;
  symbol: GraphSymbolRef;
  callers: GraphNeighborRef[];
  callees: GraphNeighborRef[];
}

export interface ProjectGraphImpact {
  available: true;
  rootId: string;
  depth: number;
  nodes: Array<GraphSymbolRef & { depth: number }>;
  edges: Array<{ source: string; target: string; kind: string }>;
  truncated: boolean;
}

export interface ProjectGraphFileGraph {
  available: true;
  nodes: Array<{ path: string; language?: string | null }>;
  edges: Array<{
    source: string;
    target: string;
    weight: number;
    kinds: Record<string, number>;
  }>;
  truncated: boolean;
}

export interface ProjectGraphAffected {
  available: true;
  seededFiles: number;
  seededSymbols: number;
  depth: number;
  nodes: Array<GraphSymbolRef & { depth: number }>;
  edges: Array<{ source: string; target: string; kind: string }>;
  truncated: boolean;
}

export type GraphUnavailable = {
  available: false;
  reason: GraphUnavailableReason;
};

function projectGraphPath(id: string, suffix: string): string {
  return `/api/v1/projects/${encodeURIComponent(id)}/graph${suffix}`;
}

export async function getProjectGraphOverview(
  id: string
): Promise<ProjectGraphOverview | GraphUnavailable> {
  return fetchJson(projectGraphPath(id, "/overview")) as Promise<
    ProjectGraphOverview | GraphUnavailable
  >;
}

export async function searchProjectGraphSymbols(
  id: string,
  params: { q: string; kind?: string; limit?: number }
): Promise<ProjectGraphSearchResult | GraphUnavailable> {
  const searchParams = new URLSearchParams({ q: params.q });
  if (params.kind) searchParams.set("kind", params.kind);
  if (params.limit !== undefined) searchParams.set("limit", String(params.limit));
  return fetchJson(projectGraphPath(id, `/search?${searchParams.toString()}`)) as Promise<
    ProjectGraphSearchResult | GraphUnavailable
  >;
}

export async function getProjectGraphSymbolDetail(
  id: string,
  symbolId: string
): Promise<ProjectGraphSymbolDetail | GraphUnavailable> {
  return fetchJson(
    projectGraphPath(id, `/symbols/${encodeURIComponent(symbolId)}`)
  ) as Promise<ProjectGraphSymbolDetail | GraphUnavailable>;
}

export async function getProjectGraphImpact(
  id: string,
  symbolId: string,
  depth?: number
): Promise<ProjectGraphImpact | GraphUnavailable> {
  const query = depth !== undefined ? `?depth=${depth}` : "";
  return fetchJson(
    projectGraphPath(id, `/symbols/${encodeURIComponent(symbolId)}/impact${query}`)
  ) as Promise<ProjectGraphImpact | GraphUnavailable>;
}

export async function getProjectGraphFileGraph(
  id: string,
  limit?: number
): Promise<ProjectGraphFileGraph | GraphUnavailable> {
  const query = limit !== undefined ? `?limit=${limit}` : "";
  return fetchJson(projectGraphPath(id, `/file-graph${query}`)) as Promise<
    ProjectGraphFileGraph | GraphUnavailable
  >;
}

export async function getProjectGraphAffected(
  id: string,
  paths: string[],
  depth?: number
): Promise<ProjectGraphAffected | GraphUnavailable> {
  return fetchJson(projectGraphPath(id, "/affected"), {
    method: "POST",
    body: JSON.stringify({
      paths,
      ...(depth !== undefined ? { depth } : {})
    })
  }) as Promise<ProjectGraphAffected | GraphUnavailable>;
}

export interface GitWorkingTreeEntry {
  path: string;
  status: string;
  staged: boolean;
}

export interface GitCommitEntry {
  hash: string;
  subject: string;
  author: string;
  relativeDate: string;
}

export interface ProjectGitChanges {
  isGitRepo: boolean;
  branch?: string;
  changed: GitWorkingTreeEntry[];
  commits: GitCommitEntry[];
}

export async function getProjectGitChanges(id: string): Promise<ProjectGitChanges> {
  const { git } = await fetchJson<{ git: ProjectGitChanges }>(
    `/api/v1/projects/${encodeURIComponent(id)}/git-changes`
  );
  return git;
}

export interface ProjectGitFileDiff {
  path: string;
  kind: "diff" | "untracked";
  diff?: string;
  content?: string;
  truncated: boolean;
}

export async function getProjectGitFileDiff(
  id: string,
  path: string,
  options: { untracked?: boolean } = {}
): Promise<ProjectGitFileDiff> {
  const searchParams = new URLSearchParams({ path });
  if (options.untracked) searchParams.set("untracked", "1");
  const { file } = await fetchJson<{ file: ProjectGitFileDiff }>(
    `/api/v1/projects/${encodeURIComponent(id)}/git-diff?${searchParams.toString()}`
  );
  return file;
}

export async function updateProjectAiConfigFile(
  id: string,
  relativePath: string,
  content: string,
  aiTool?: RuntimeAdapterId
): Promise<AiConfigSnapshot> {
  return fetchJson(`/api/v1/projects/${encodeURIComponent(id)}/ai-config/files`, {
    method: "PUT",
    body: JSON.stringify({ relativePath, content, ...(aiTool ? { aiTool } : {}) }),
  }) as Promise<AiConfigSnapshot>;
}


export async function getProjectManagerGoal(
  projectId: string
): Promise<{ goal: ProjectManagerGoal | null }> {
  return fetchJson(projectManagerPath(projectId, "/goal")) as Promise<{ goal: ProjectManagerGoal | null }>;
}

export async function updateProjectManagerGoal(
  projectId: string,
  input: ProjectManagerGoalInput
): Promise<{ goal: ProjectManagerGoal }> {
  return fetchJson(projectManagerPath(projectId, "/goal"), {
    method: "PUT",
    body: JSON.stringify(input),
  }) as Promise<{ goal: ProjectManagerGoal }>;
}

export async function listProjectManagerWorkItems(
  projectId: string,
  params: { status?: ProjectManagerWorkItemStatus; limit?: number } = {}
): Promise<{ workItems: ProjectManagerWorkItem[] }> {
  const searchParams = new URLSearchParams();
  if (params.status) searchParams.set("status", params.status);
  if (params.limit !== undefined) searchParams.set("limit", String(params.limit));
  const query = searchParams.toString();
  return fetchJson(projectManagerPath(projectId, `/work-items${query ? `?${query}` : ""}`)) as Promise<{
    workItems: ProjectManagerWorkItem[];
  }>;
}

export async function createProjectManagerWorkItem(
  projectId: string,
  input: ProjectManagerWorkItemInput
): Promise<{ workItem: ProjectManagerWorkItem }> {
  return fetchJson(projectManagerPath(projectId, "/work-items"), {
    method: "POST",
    body: JSON.stringify(input),
  }) as Promise<{ workItem: ProjectManagerWorkItem }>;
}

export async function getProjectManagerWorkItem(
  projectId: string,
  workItemId: string
): Promise<{ workItem: ProjectManagerWorkItem }> {
  return fetchJson(projectManagerPath(projectId, `/work-items/${encodeURIComponent(workItemId)}`)) as Promise<{
    workItem: ProjectManagerWorkItem;
  }>;
}

export async function updateProjectManagerWorkItem(
  projectId: string,
  workItemId: string,
  input: ProjectManagerWorkItemUpdateInput
): Promise<{ workItem: ProjectManagerWorkItem }> {
  return fetchJson(projectManagerPath(projectId, `/work-items/${encodeURIComponent(workItemId)}`), {
    method: "PATCH",
    body: JSON.stringify(input),
  }) as Promise<{ workItem: ProjectManagerWorkItem }>;
}

export async function updateProjectManagerWorkItemStatus(
  projectId: string,
  workItemId: string,
  input: ProjectManagerWorkItemStatusInput
): Promise<{ workItem: ProjectManagerWorkItem }> {
  return fetchJson(projectManagerPath(projectId, `/work-items/${encodeURIComponent(workItemId)}/status`), {
    method: "PATCH",
    body: JSON.stringify(input),
  }) as Promise<{ workItem: ProjectManagerWorkItem }>;
}

export async function batchUpdateProjectManagerWorkItemStatuses(
  projectId: string,
  input: ProjectManagerBatchStatusInput
): Promise<{ workItems: ProjectManagerWorkItem[] }> {
  return fetchJson(projectManagerPath(projectId, "/work-items/batch/status"), {
    method: "POST",
    body: JSON.stringify(input),
  }) as Promise<{ workItems: ProjectManagerWorkItem[] }>;
}

export async function attachProjectManagerWorkItemEvidence(
  projectId: string,
  workItemId: string,
  input: ProjectManagerEvidenceInput
): Promise<{ workItem: ProjectManagerWorkItem }> {
  return fetchJson(projectManagerPath(projectId, `/work-items/${encodeURIComponent(workItemId)}/evidence`), {
    method: "POST",
    body: JSON.stringify(input),
  }) as Promise<{ workItem: ProjectManagerWorkItem }>;
}

export async function deleteProjectManagerWorkItem(
  projectId: string,
  workItemId: string,
  input: ProjectManagerWorkItemDeleteInput
): Promise<{ workItem: ProjectManagerWorkItem }> {
  return fetchJson(projectManagerPath(projectId, `/work-items/${encodeURIComponent(workItemId)}`), {
    method: "DELETE",
    body: JSON.stringify(input),
  }) as Promise<{ workItem: ProjectManagerWorkItem }>;
}

export async function listProjectManagerTaskPackets(
  projectId: string,
  params: { limit?: number } = {}
): Promise<{ taskPackets: ProjectManagerTaskPacket[] }> {
  const searchParams = new URLSearchParams();
  if (params.limit !== undefined) searchParams.set("limit", String(params.limit));
  const query = searchParams.toString();
  return fetchJson(projectManagerPath(projectId, `/task-packets${query ? `?${query}` : ""}`)) as Promise<{
    taskPackets: ProjectManagerTaskPacket[];
  }>;
}

export async function getProjectManagerTaskPacket(
  projectId: string,
  workItemId: string
): Promise<{ taskPacket: ProjectManagerTaskPacket }> {
  return fetchJson(projectManagerPath(
    projectId,
    `/work-items/${encodeURIComponent(workItemId)}/task-packet`
  )) as Promise<{ taskPacket: ProjectManagerTaskPacket }>;
}

export async function listProjectManagerStarterPacks(
  projectId: string
): Promise<{ starterPacks: ProjectManagerStarterPack[] }> {
  return fetchJson(projectManagerPath(projectId, "/starter-packs")) as Promise<{
    starterPacks: ProjectManagerStarterPack[];
  }>;
}

export async function createProjectManagerStarterPackTaskPacket(
  projectId: string,
  packId: string
): Promise<{
  pack: ProjectManagerStarterPack;
  workItem: ProjectManagerWorkItem;
  taskPacket: ProjectManagerTaskPacket;
}> {
  return fetchJson(projectManagerPath(
    projectId,
    `/starter-packs/${encodeURIComponent(packId)}/task-packet`
  ), {
    method: "POST",
  }) as Promise<{
    pack: ProjectManagerStarterPack;
    workItem: ProjectManagerWorkItem;
    taskPacket: ProjectManagerTaskPacket;
  }>;
}

export async function linkProjectManagerTaskPacketSession(
  projectId: string,
  workItemId: string,
  input: { sessionId: string }
): Promise<{ taskPacket: ProjectManagerTaskPacket }> {
  return fetchJson(projectManagerPath(
    projectId,
    `/work-items/${encodeURIComponent(workItemId)}/task-packet/session-link`
  ), {
    method: "POST",
    body: JSON.stringify(input),
  }) as Promise<{ taskPacket: ProjectManagerTaskPacket }>;
}

export async function startProjectManagerTaskPacket(
  projectId: string,
  workItemId: string,
  data: { aiTool?: RuntimeAdapterId } = {}
): Promise<{ taskPacket: ProjectManagerTaskPacket; session: Session }> {
  return fetchJson(projectManagerPath(
    projectId,
    `/work-items/${encodeURIComponent(workItemId)}/task-packet/start`
  ), {
    method: "POST",
    body: JSON.stringify(data),
  }) as Promise<{ taskPacket: ProjectManagerTaskPacket; session: Session }>;
}

export async function listProjectManagerLedger(
  projectId: string,
  params: { eventType?: ProjectManagerLedgerEventType; limit?: number } = {}
): Promise<{ events: ProjectManagerLedgerEvent[] }> {
  const searchParams = new URLSearchParams();
  if (params.eventType) searchParams.set("eventType", params.eventType);
  if (params.limit !== undefined) searchParams.set("limit", String(params.limit));
  const query = searchParams.toString();
  return fetchJson(projectManagerPath(projectId, `/ledger${query ? `?${query}` : ""}`)) as Promise<{
    events: ProjectManagerLedgerEvent[];
  }>;
}

export type ProjectManagerStageStatus = "active" | "completed" | "archived";

export interface ProjectManagerStage {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  position: number;
  status: ProjectManagerStageStatus;
  createdAt: number;
  updatedAt: number;
}

export interface ProjectManagerStageInput {
  name: string;
  description?: string | null;
}

export interface ProjectManagerStageUpdateInput {
  name?: string;
  description?: string | null;
  status?: ProjectManagerStageStatus;
}

export interface ProjectManagerWorkItemLink {
  id: string;
  projectId: string;
  blockerWorkItemId: string;
  blockedWorkItemId: string;
  createdAt: number;
}

export async function listProjectManagerStages(
  projectId: string
): Promise<{ stages: ProjectManagerStage[] }> {
  return fetchJson(projectManagerPath(projectId, "/stages")) as Promise<{ stages: ProjectManagerStage[] }>;
}

export async function createProjectManagerStage(
  projectId: string,
  input: ProjectManagerStageInput
): Promise<{ stage: ProjectManagerStage }> {
  return fetchJson(projectManagerPath(projectId, "/stages"), {
    method: "POST",
    body: JSON.stringify(input),
  }) as Promise<{ stage: ProjectManagerStage }>;
}

export async function seedProjectManagerStageTemplate(
  projectId: string
): Promise<{ stages: ProjectManagerStage[] }> {
  return fetchJson(projectManagerPath(projectId, "/stages/seed-template"), {
    method: "POST",
  }) as Promise<{ stages: ProjectManagerStage[] }>;
}

export async function reorderProjectManagerStages(
  projectId: string,
  stageIds: string[]
): Promise<{ stages: ProjectManagerStage[] }> {
  return fetchJson(projectManagerPath(projectId, "/stages/reorder"), {
    method: "POST",
    body: JSON.stringify({ stageIds }),
  }) as Promise<{ stages: ProjectManagerStage[] }>;
}

export async function updateProjectManagerStage(
  projectId: string,
  stageId: string,
  input: ProjectManagerStageUpdateInput
): Promise<{ stage: ProjectManagerStage }> {
  return fetchJson(projectManagerPath(projectId, `/stages/${encodeURIComponent(stageId)}`), {
    method: "PATCH",
    body: JSON.stringify(input),
  }) as Promise<{ stage: ProjectManagerStage }>;
}

export async function deleteProjectManagerStage(
  projectId: string,
  stageId: string
): Promise<{ stage: ProjectManagerStage }> {
  return fetchJson(projectManagerPath(projectId, `/stages/${encodeURIComponent(stageId)}`), {
    method: "DELETE",
  }) as Promise<{ stage: ProjectManagerStage }>;
}

export async function listProjectManagerWorkItemLinks(
  projectId: string
): Promise<{ links: ProjectManagerWorkItemLink[] }> {
  return fetchJson(projectManagerPath(projectId, "/work-item-links")) as Promise<{
    links: ProjectManagerWorkItemLink[];
  }>;
}

export async function addProjectManagerWorkItemDependency(
  projectId: string,
  workItemId: string,
  blockerWorkItemId: string
): Promise<{ link: ProjectManagerWorkItemLink }> {
  return fetchJson(projectManagerPath(
    projectId,
    `/work-items/${encodeURIComponent(workItemId)}/dependencies`
  ), {
    method: "POST",
    body: JSON.stringify({ blockerWorkItemId }),
  }) as Promise<{ link: ProjectManagerWorkItemLink }>;
}

export async function removeProjectManagerWorkItemDependency(
  projectId: string,
  workItemId: string,
  blockerWorkItemId: string
): Promise<Record<string, never>> {
  return fetchJson(projectManagerPath(
    projectId,
    `/work-items/${encodeURIComponent(workItemId)}/dependencies/${encodeURIComponent(blockerWorkItemId)}`
  ), {
    method: "DELETE",
  }) as Promise<Record<string, never>>;
}

export async function deleteProject(id: string): Promise<unknown> {
  return fetchJson(`/api/v1/projects/${id}`, { method: "DELETE" });
}

export async function generateConfig(
  id: string,
  templateId = "builtin-claude-code",
  decisions?: Record<string, "skip" | "overwrite">
): Promise<unknown> {
  return fetchJson(`/api/v1/projects/${id}/generate-config`, {
    method: "POST",
    body: JSON.stringify({
      templateId,
      credentialMode: "host_environment",
      ...(decisions ? { decisions } : {})
    })
  });
}

// Sessions
export function listSessions(): Promise<{ sessions: Session[] }>;
export function listSessions(params: { projectId?: string }): Promise<{ sessions: Session[] }>;
export async function listSessions(params: { projectId?: string } = {}): Promise<{ sessions: Session[] }> {
  const searchParams = new URLSearchParams();
  if (params.projectId) searchParams.set("projectId", params.projectId);
  const query = searchParams.toString();
  return fetchJson(`/api/v1/sessions${query ? `?${query}` : ""}`) as Promise<{ sessions: Session[] }>;
}

export async function createSession(data: {
  projectId: string;
  aiTool?: RuntimeAdapterId;
}): Promise<{ session: Session }> {
  return fetchJson("/api/v1/sessions", { method: "POST", body: JSON.stringify(data) }) as Promise<{ session: Session }>;
}

export async function getSession(id: string): Promise<{ session: Session }> {
  return fetchJson(`/api/v1/sessions/${id}`) as Promise<{ session: Session }>;
}

export async function startSession(id: string): Promise<unknown> {
  return fetchJson(`/api/v1/sessions/${id}/start`, { method: "POST" });
}

export async function stopSession(id: string): Promise<unknown> {
  return fetchJson(`/api/v1/sessions/${id}/stop`, { method: "POST" });
}

export async function deleteSession(id: string): Promise<unknown> {
  return fetchJson(`/api/v1/sessions/${id}`, { method: "DELETE" });
}

export async function connectSession(id: string): Promise<{ session: Session }> {
  return fetchJson(`/api/v1/sessions/${id}/connect`, { method: "POST" }) as Promise<{ session: Session }>;
}

// Skills
export async function listSkills(): Promise<{ skills: Skill[]; discovery?: SkillDiscovery }> {
  return fetchJson("/api/v1/skills") as Promise<{ skills: Skill[]; discovery?: SkillDiscovery }>;
}

export async function syncLocalSkills(): Promise<{ skills: Skill[]; discovery: SkillDiscovery }> {
  return fetchJson("/api/v1/skills/local-sync", {
    method: "POST",
  }) as Promise<{ skills: Skill[]; discovery: SkillDiscovery }>;
}

export async function listSkillSources(): Promise<{ sources: SkillSource[] }> {
  return fetchJson("/api/v1/skills/sources") as Promise<{ sources: SkillSource[] }>;
}

export async function listSkillTemplates(): Promise<{ templates: SkillTemplate[] }> {
  return fetchJson("/api/v1/skills/templates") as Promise<{ templates: SkillTemplate[] }>;
}

export async function listCatalogSources(): Promise<{ sources: CatalogSource[] }> {
  return fetchJson("/api/v1/catalog/sources") as Promise<{ sources: CatalogSource[] }>;
}

export async function listCatalogItems(): Promise<{ items: CatalogItem[] }> {
  return fetchJson("/api/v1/catalog/items") as Promise<{ items: CatalogItem[] }>;
}

export async function refreshCatalog(data: {
  type: "skill" | "template";
  sourceId: string;
  label: string;
  url: string;
  timeoutMs?: number;
}): Promise<{ source: CatalogSource; items: CatalogItem[] }> {
  return fetchJson("/api/v1/catalog/refresh", {
    method: "POST",
    body: JSON.stringify(data),
  }) as Promise<{ source: CatalogSource; items: CatalogItem[] }>;
}

export async function installCatalogTemplate(
  itemId: string
): Promise<{ template: Template; catalogItem: Pick<CatalogItem, "id" | "externalId" | "sourceId"> }> {
  return fetchJson(`/api/v1/catalog/items/${encodeURIComponent(itemId)}/install`, {
    method: "POST",
  }) as Promise<{ template: Template; catalogItem: Pick<CatalogItem, "id" | "externalId" | "sourceId"> }>;
}

export async function installCatalogSkill(
  itemId: string
): Promise<{ skill: Skill; catalogItem: Pick<CatalogItem, "id" | "externalId" | "sourceId"> }> {
  return fetchJson(`/api/v1/catalog/items/${encodeURIComponent(itemId)}/install`, {
    method: "POST",
  }) as Promise<{ skill: Skill; catalogItem: Pick<CatalogItem, "id" | "externalId" | "sourceId"> }>;
}

export async function createSkill(data: SkillInput): Promise<{ skill: Skill }> {
  return fetchJson("/api/v1/skills", {
    method: "POST",
    body: JSON.stringify(data),
  }) as Promise<{ skill: Skill }>;
}

export async function installSkill(data: SkillInstallInput): Promise<{ skill: Skill; source: SkillSource }> {
  return fetchJson("/api/v1/skills/install", {
    method: "POST",
    body: JSON.stringify(data),
  }) as Promise<{ skill: Skill; source: SkillSource }>;
}

export async function previewSkillSource(
  data: SkillSourcePreviewInput
): Promise<{ preview: RemoteSkillPreview }> {
  return fetchJson("/api/v1/skills/install/preview", {
    method: "POST",
    body: JSON.stringify(data),
  }) as Promise<{ preview: RemoteSkillPreview }>;
}

export async function updateSkill(id: string, data: SkillUpdateInput): Promise<{ skill: Skill }> {
  return fetchJson(`/api/v1/skills/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  }) as Promise<{ skill: Skill }>;
}

export async function deleteSkill(id: string): Promise<unknown> {
  return fetchJson(`/api/v1/skills/${id}`, { method: "DELETE" });
}

export async function toggleSkill(id: string, enabled: boolean): Promise<{ skill: Skill }> {
  return fetchJson(`/api/v1/skills/${id}/toggle`, {
    method: "POST",
    body: JSON.stringify({ enabled }),
  }) as Promise<{ skill: Skill }>;
}

export async function listProjectSkills(projectId: string): Promise<{ skills: ProjectSkill[] }> {
  return fetchJson(`/api/v1/projects/${projectId}/skills`) as Promise<{ skills: ProjectSkill[] }>;
}

export async function setProjectSkill(
  projectId: string,
  skillId: string,
  enabled: boolean
): Promise<{ projectSkill: { projectId: string; skillId: string; isEnabled: boolean } }> {
  return fetchJson(`/api/v1/projects/${projectId}/skills/${skillId}`, {
    method: "POST",
    body: JSON.stringify({ enabled }),
  }) as Promise<{ projectSkill: { projectId: string; skillId: string; isEnabled: boolean } }>;
}


// Project import
export interface ScanResult {
  path: string;
  exists: boolean;
  isDirectory: boolean;
  instructionFiles?: string[];
}

export async function scanProject(path: string): Promise<ScanResult> {
  return fetchJson("/api/v1/projects/scan", {
    method: "POST",
    body: JSON.stringify({ path }),
  }) as Promise<ScanResult>;
}

export interface ImportProjectInput {
  path: string;
  name: string;
}

export async function importProject(input: ImportProjectInput): Promise<{ project: Project }> {
  return fetchJson("/api/v1/projects/import", {
    method: "POST",
    body: JSON.stringify({
      path: input.path,
      name: input.name,
    }),
  }) as Promise<{ project: Project }>;
}

// Native directory picking (host-side dialog driven by the Gateway)
export interface DesktopCapabilities {
  platform: string;
  directoryPickerSupported: boolean;
}

export async function getDesktopCapabilities(): Promise<DesktopCapabilities> {
  return fetchJson("/api/v1/system/desktop") as Promise<DesktopCapabilities>;
}

export interface DirectoryPickerResult {
  supported: boolean;
  path?: string;
  cancelled?: boolean;
  reason?: string;
}

export async function selectNativeDirectory(): Promise<DirectoryPickerResult> {
  return fetchJson("/api/v1/system/select-directory", {
    method: "POST",
  }) as Promise<DirectoryPickerResult>;
}

// Templates
export async function listTemplates(): Promise<{ templates: Template[] }> {
  return fetchJson("/api/v1/templates") as Promise<{ templates: Template[] }>;
}

export async function getTemplate(id: string): Promise<{ template: Template }> {
  return fetchJson(`/api/v1/templates/${id}`) as Promise<{ template: Template }>;
}

export async function createTemplate(data: TemplateInput): Promise<{ template: Template }> {
  return fetchJson("/api/v1/templates", {
    method: "POST",
    body: JSON.stringify(data),
  }) as Promise<{ template: Template }>;
}

export async function cloneTemplate(id: string, name: string): Promise<{ template: Template }> {
  return fetchJson(`/api/v1/templates/${id}/clone`, {
    method: "POST",
    body: JSON.stringify({ name }),
  }) as Promise<{ template: Template }>;
}

export async function exportTemplate(id: string): Promise<{ templatePackage: TemplatePackage }> {
  return fetchJson(`/api/v1/templates/${id}/export`) as Promise<{ templatePackage: TemplatePackage }>;
}

export async function importTemplate(templatePackage: TemplatePackage): Promise<{ template: Template }> {
  return fetchJson("/api/v1/templates/import", {
    method: "POST",
    body: JSON.stringify({ templatePackage }),
  }) as Promise<{ template: Template }>;
}

export async function listTemplateVersions(id: string): Promise<{ versions: TemplateVersion[] }> {
  return fetchJson(`/api/v1/templates/${id}/versions`) as Promise<{ versions: TemplateVersion[] }>;
}

export async function restoreTemplateVersion(id: string, versionId: number): Promise<{ template: Template }> {
  return fetchJson(`/api/v1/templates/${id}/versions/${versionId}/restore`, {
    method: "POST",
  }) as Promise<{ template: Template }>;
}

export async function updateTemplate(id: string, data: TemplateUpdateInput): Promise<{ template: Template }> {
  return fetchJson(`/api/v1/templates/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  }) as Promise<{ template: Template }>;
}

export async function updateTemplateFile(
  id: string,
  filePath: string,
  content: string
): Promise<{ file: TemplateFile }> {
  return fetchJson(`/api/v1/templates/${id}/files/${filePath}`, {
    method: "PUT",
    body: JSON.stringify({ content }),
  }) as Promise<{ file: TemplateFile }>;
}

export async function deleteTemplate(id: string): Promise<unknown> {
  return fetchJson(`/api/v1/templates/${id}`, { method: "DELETE" });
}

export async function listModelProviders(): Promise<{
  providers: ProviderProfile[];
  models: ModelProfile[];
  credentials: ProviderCredentialSummary[];
}> {
  return fetchJson("/api/v1/model-providers") as Promise<{
    providers: ProviderProfile[];
    models: ModelProfile[];
    credentials: ProviderCredentialSummary[];
  }>;
}

export async function createModelProvider(data: {
  name: string;
  providerKey: string;
  authType: ProviderAuthType;
  apiFormat: ProviderApiFormat;
  baseUrl?: string;
  anthropicBaseUrl?: string;
  openaiBaseUrl?: string;
  region?: string;
  productType?: ProviderProductType;
  supportedAdapters?: ProviderSupportedAdapter[];
  allowPlaintextHttp?: boolean;
}): Promise<{ provider: ProviderProfile }> {
  return fetchJson("/api/v1/model-providers", {
    method: "POST",
    body: JSON.stringify(data),
  }) as Promise<{ provider: ProviderProfile }>;
}

export async function deleteModelProvider(providerId: string): Promise<unknown> {
  return fetchJson(`/api/v1/model-providers/${providerId}`, {
    method: "DELETE",
  });
}

export async function createProviderCredential(
  providerId: string,
  data: { label?: string; plaintextSecret: string }
): Promise<{ credential: ProviderCredentialSummary }> {
  return fetchJson(`/api/v1/model-providers/${providerId}/credentials`, {
    method: "POST",
    body: JSON.stringify(data),
  }) as Promise<{ credential: ProviderCredentialSummary }>;
}

export async function rotateProviderCredential(
  providerId: string,
  credentialId: string,
  data: { label?: string; plaintextSecret: string }
): Promise<{ credential: ProviderCredentialSummary }> {
  return fetchJson(`/api/v1/model-providers/${providerId}/credentials/${credentialId}/rotate`, {
    method: "POST",
    body: JSON.stringify(data),
  }) as Promise<{ credential: ProviderCredentialSummary }>;
}

export async function deleteProviderCredential(providerId: string, credentialId: string): Promise<{ disposition: "deleted" | "revoked" }> {
  return fetchJson(`/api/v1/model-providers/${providerId}/credentials/${credentialId}`, {
    method: "DELETE",
  }) as Promise<{ disposition: "deleted" | "revoked" }>;
}

export async function createProviderModel(
  providerId: string,
  data: { name: string; modelId: string; capabilities?: string[]; contextWindow?: number | null; isDefault?: boolean }
): Promise<{ model: ModelProfile }> {
  return fetchJson(`/api/v1/model-providers/${providerId}/models`, {
    method: "POST",
    body: JSON.stringify(data),
  }) as Promise<{ model: ModelProfile }>;
}

export async function updateProviderModel(
  providerId: string,
  modelId: string,
  data: { name?: string; modelId?: string; capabilities?: string[]; contextWindow?: number | null; isDefault?: boolean }
): Promise<{ model: ModelProfile }> {
  return fetchJson(`/api/v1/model-providers/${providerId}/models/${modelId}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  }) as Promise<{ model: ModelProfile }>;
}

export async function setDefaultProviderModel(providerId: string, modelId: string): Promise<{ model: ModelProfile }> {
  return fetchJson(`/api/v1/model-providers/${providerId}/models/${modelId}/set-default`, {
    method: "POST",
  }) as Promise<{ model: ModelProfile }>;
}

export async function deleteProviderModel(providerId: string, modelId: string): Promise<unknown> {
  return fetchJson(`/api/v1/model-providers/${providerId}/models/${modelId}`, {
    method: "DELETE",
  });
}

export async function syncProviderModels(
  providerId: string,
  data: { credentialId?: string; timeoutMs?: number } = {}
): Promise<ProviderModelSyncResult> {
  return fetchJson(`/api/v1/model-providers/${providerId}/models/sync`, {
    method: "POST",
    body: JSON.stringify(data),
  }) as Promise<ProviderModelSyncResult>;
}

export async function checkProviderBalance(
  providerId: string,
  data: { credentialId?: string; timeoutMs?: number } = {}
): Promise<ProviderBalanceResult> {
  return fetchJson(`/api/v1/model-providers/${providerId}/balance`, {
    method: "POST",
    body: JSON.stringify(data),
  }) as Promise<ProviderBalanceResult>;
}

export async function getAppliedProviderForAdapter(
  adapter: string
): Promise<{ appliedProvider: AppliedProviderInfo | null }> {
  return fetchJson(
    `/api/v1/model-providers/applied/${encodeURIComponent(adapter)}`
  ) as Promise<{ appliedProvider: AppliedProviderInfo | null }>;
}

export async function getProviderBalance(providerId: string): Promise<ProviderBalanceResult> {
  return fetchJson(
    `/api/v1/model-providers/${providerId}/balance`
  ) as Promise<ProviderBalanceResult>;
}

export async function checkModelProviderReadiness(
  providerId: string,
  data: {
    adapter: ProviderReadinessAdapter;
    modelProfileId?: string;
    credentialId?: string;
    timeoutMs?: number;
    includeRemoteCheck?: boolean;
  }
): Promise<{ readiness: ModelProviderReadiness }> {
  return fetchJson(`/api/v1/model-providers/${providerId}/readiness`, {
    method: "POST",
    body: JSON.stringify(data),
  }) as Promise<{ readiness: ModelProviderReadiness }>;
}

export async function listApiKeys(): Promise<{ apiKeys: ApiKeySummary[] }> {
  return fetchJson("/api/v1/api-keys") as Promise<{ apiKeys: ApiKeySummary[] }>;
}

export async function createApiKey(data: ApiKeyInput): Promise<{ apiKey: ApiKeySummary }> {
  return fetchJson("/api/v1/api-keys", {
    method: "POST",
    body: JSON.stringify(data),
  }) as Promise<{ apiKey: ApiKeySummary }>;
}

export async function rotateApiKey(id: string, plaintextKey: string): Promise<{ apiKey: ApiKeySummary }> {
  return fetchJson(`/api/v1/api-keys/${id}/rotate`, {
    method: "POST",
    body: JSON.stringify({ plaintextKey }),
  }) as Promise<{ apiKey: ApiKeySummary }>;
}

export async function deleteApiKey(id: string): Promise<unknown> {
  return fetchJson(`/api/v1/api-keys/${id}`, { method: "DELETE" });
}

// Legacy helpers (kept for compatibility)
export async function previewConfig(
  projectId: string,
  templateId = "builtin-claude-code"
): Promise<ConfigPreview> {
  return fetchJson(`/api/v1/projects/${encodeURIComponent(projectId)}/config/preview`, {
    method: "POST",
    body: JSON.stringify({
      templateId,
      credentialMode: "host_environment"
    })
  }) as Promise<ConfigPreview>;
}

export async function previewConfigSync(
  projectId: string,
  templateId?: string,
  credentialMode: CredentialMode = "host_environment"
): Promise<ConfigSyncPreview> {
  return fetchJson(`/api/v1/projects/${encodeURIComponent(projectId)}/config/sync/preview`, {
    method: "POST",
    body: JSON.stringify({
      credentialMode,
      ...(templateId ? { templateId } : {})
    })
  }) as Promise<ConfigSyncPreview>;
}

export async function getConfigCompliance(
  projectId: string,
  options: { templateId?: string; credentialMode?: CredentialMode } = {}
): Promise<ConfigComplianceReport> {
  const searchParams = new URLSearchParams();
  if (options.templateId) searchParams.set("templateId", options.templateId);
  if (options.credentialMode) searchParams.set("credentialMode", options.credentialMode);
  const query = searchParams.toString();
  return fetchJson(
    `/api/v1/projects/${encodeURIComponent(projectId)}/config/compliance${query ? `?${query}` : ""}`
  ) as Promise<ConfigComplianceReport>;
}

export async function writeConfig(
  projectId: string,
  templateId = "builtin-claude-code",
  decisions: Record<string, "skip" | "overwrite"> = { "CLAUDE.md": "overwrite" }
): Promise<ConfigWriteResult> {
  return fetchJson(`/api/v1/projects/${encodeURIComponent(projectId)}/config/write`, {
    method: "POST",
    body: JSON.stringify({
      templateId,
      credentialMode: "host_environment",
      decisions
    })
  }) as Promise<ConfigWriteResult>;
}

export async function applyConfigSync(
  projectId: string,
  decisions: Record<string, "skip" | "overwrite"> = {},
  templateId?: string,
  credentialMode: CredentialMode = "host_environment"
): Promise<ConfigSyncWriteResult> {
  return fetchJson(`/api/v1/projects/${encodeURIComponent(projectId)}/config/sync/apply`, {
    method: "POST",
    body: JSON.stringify({
      credentialMode,
      ...(templateId ? { templateId } : {}),
      ...(Object.keys(decisions).length > 0 ? { decisions } : {})
    })
  }) as Promise<ConfigSyncWriteResult>;
}

// Template usage and batch config sync (template-centric)
export type TemplateProjectConfigStatus = "compliant" | "stale" | "missing";

export interface TemplateUsageProject {
  id: string;
  name: string;
  path: string;
  aiTool: string | null;
  isImported: boolean;
  configStatus: TemplateProjectConfigStatus;
}

export interface TemplateUsage {
  templateId: string;
  usageCount: number;
  projects: TemplateUsageProject[];
}

export interface TemplateSyncProjectPreview {
  projectId: string;
  projectName: string;
  conflicts: ConfigConflict[];
  summary: ConfigSyncSummary;
}

export interface TemplateSyncPreview {
  templateId: string;
  projects: TemplateSyncProjectPreview[];
}

export interface TemplateSyncWriteOutcome {
  outcome: "applied" | "rolled_back" | "rollback_failed";
  writtenFiles: string[];
  skippedFiles: string[];
  failedFiles: string[];
  conflicts: ConfigConflict[];
}

export interface TemplateSyncProjectResult {
  projectId: string;
  projectName: string;
  result?: TemplateSyncWriteOutcome;
  summary?: ConfigSyncSummary;
  error?: string;
}

export interface TemplateSyncApplyResult {
  templateId: string;
  projects: TemplateSyncProjectResult[];
}

export async function getTemplateUsage(
  templateId: string,
  options: { projectIds?: string[] } = {}
): Promise<TemplateUsage> {
  const searchParams = new URLSearchParams();
  if (options.projectIds && options.projectIds.length > 0) {
    searchParams.set("projectIds", options.projectIds.join(","));
  }
  const query = searchParams.toString();
  return fetchJson(
    `/api/v1/templates/${encodeURIComponent(templateId)}/usage${query ? `?${query}` : ""}`
  ) as Promise<TemplateUsage>;
}

export async function previewTemplateSync(
  templateId: string,
  options: { projectIds?: string[]; credentialMode?: CredentialMode } = {}
): Promise<TemplateSyncPreview> {
  return fetchJson(`/api/v1/templates/${encodeURIComponent(templateId)}/sync/preview`, {
    method: "POST",
    body: JSON.stringify({
      ...(options.projectIds ? { projectIds: options.projectIds } : {}),
      ...(options.credentialMode ? { credentialMode: options.credentialMode } : {})
    })
  }) as Promise<TemplateSyncPreview>;
}

export async function applyTemplateSync(
  templateId: string,
  options: {
    projectIds?: string[];
    decisions?: Record<string, Record<string, "skip" | "overwrite">>;
    credentialMode?: CredentialMode;
  } = {}
): Promise<TemplateSyncApplyResult> {
  return fetchJson(`/api/v1/templates/${encodeURIComponent(templateId)}/sync/apply`, {
    method: "POST",
    body: JSON.stringify({
      ...(options.projectIds ? { projectIds: options.projectIds } : {}),
      ...(options.decisions && Object.keys(options.decisions).length > 0 ? { decisions: options.decisions } : {}),
      ...(options.credentialMode ? { credentialMode: options.credentialMode } : {})
    })
  }) as Promise<TemplateSyncApplyResult>;
}
