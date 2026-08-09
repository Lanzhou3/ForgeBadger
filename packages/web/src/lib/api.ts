import { getToken } from "@/lib/auth";
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
  copilotRunId?: string;
  pendingActionId?: string;
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
  recommendedAdapter: "claude" | "opencode" | "codex";
  promptFrame: string;
  acceptanceChecklist: string[];
  verificationGuidance: string[];
  evidenceFields: string[];
}

export interface ProjectManagerWorkItemInput {
  title: string;
  description?: string | null;
  status?: ProjectManagerWorkItemStatus;
  priority?: number;
  acceptanceCriteria?: string[];
  evidenceRefs?: ProjectManagerEvidenceRef[];
  feishuRefs?: ProjectManagerEvidenceRef[];
}

export interface ProjectManagerWorkItemUpdateInput {
  title?: string;
  description?: string | null;
  priority?: number;
  acceptanceCriteria?: string[];
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
  | "copilot_observation_recorded"
  | "feishu_reference_linked"
  | "next_step_proposed"
  | "manual_completion_recorded";

export interface ProjectManagerLedgerTrace {
  copilotRunId?: string;
  pendingActionId?: string;
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

export interface TemplateFromProjectInput {
  projectId: string;
  name: string;
  description?: string;
  version?: string;
  visibility?: "private" | "shared" | "admin";
  filePaths?: string[];
}

export interface TemplateFromProjectPreview {
  project: Pick<Project, "id" | "name" | "path">;
  files: Array<TemplateFile & { sizeBytes: number }>;
  totalBytes: number;
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
  modelId?: string | null;
  credentialMode?: CredentialMode;
  apiKeyId?: string | null;
}

export interface CodexAppServerSession {
  id: string;
  userId: string;
  projectId: string;
  projectRoot: string;
  runtimeMode: "app-server-stdio" | "app-server-websocket";
  status: "running" | "stopped" | "error";
  command: string;
  args: string[];
  listen: string;
  pid?: number;
  errorMessage?: string;
  features?: {
    turnInputEnabled: boolean;
  };
  createdAt: string;
  updatedAt: string;
}

export interface CodexAppServerCapabilities {
  initializeEnabled: boolean;
  threadCreationEnabled: boolean;
  turnInputEnabled: boolean;
  promptInputExposed: boolean;
  transcriptPersistence: "disabled";
}

export interface CopilotCapabilities {
  supportedProviderFormats: Array<"openai" | "openai-compatible" | "anthropic" | string>;
  providerConfigured: boolean;
  toolExecutionEnabled: boolean;
  readTools?: string[];
  prepareTools?: string[];
  approvalRequiredForWrites?: boolean;
  pendingActionApprovalEnabled?: boolean;
}

export interface CopilotRun {
  id: string;
  status: "queued" | "running" | "waiting_for_approval" | "completed" | "failed" | "cancelled" | string;
  goal: string;
  source: string;
  sourceRefId?: string | null;
  providerProfileId?: string | null;
  providerProfileName?: string | null;
  modelProfileId?: string | null;
  modelProfileName?: string | null;
  stepCount?: number | null;
  maxSteps?: number | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  createdAt?: number | null;
  updatedAt?: number | null;
  completedAt?: number | null;
}

export interface CopilotRunEvent {
  id: string;
  runId: string;
  type: string;
  sequence: number;
  message?: string | null;
  payload?: Record<string, unknown>;
  createdAt?: number | null;
}

export interface CopilotPendingAction {
  id: string;
  runId: string;
  type: string;
  status: "pending" | "approved" | "rejected" | string;
  input?: Record<string, unknown>;
  result?: Record<string, unknown> | null;
  approvedBy?: string | null;
  approvedAt?: number | null;
  createdAt?: number | null;
  updatedAt?: number | null;
}

export interface CopilotConversation {
  id: string;
  title: string;
  source: string;
  sourceRefId?: string | null;
  status: "active" | "deleted" | string;
  createdAt?: number | null;
  updatedAt?: number | null;
  lastMessageAt?: number | null;
  deletedAt?: number | null;
}

export interface CopilotMessage {
  id: string;
  conversationId: string;
  runId?: string | null;
  role: "user" | "assistant" | "system" | string;
  content: string;
  payload?: Record<string, unknown>;
  createdAt?: number | null;
  deletedAt?: number | null;
}

export type CopilotMemoryItemType = "entry" | "note";
export type CopilotMemoryScope = "global" | "project" | "session";

export interface CopilotMemoryEntry {
  id: string;
  type?: "entry";
  userId: string;
  kind: string;
  scope: CopilotMemoryScope | string;
  projectId?: string | null;
  sourceRunId?: string | null;
  redactedText: string;
  metadata?: Record<string, unknown>;
  createdAt?: number | null;
  updatedAt?: number | null;
}

export interface CopilotMemoryNote {
  id: string;
  type?: "note";
  userId: string;
  projectId?: string | null;
  sessionId?: string | null;
  sourceRunId?: string | null;
  redactedText: string;
  metadata?: Record<string, unknown>;
  createdAt?: number | null;
}

export interface CopilotMemorySearchResult {
  id: string;
  type: CopilotMemoryItemType;
  scope: CopilotMemoryScope | string;
  projectId?: string | null;
  snippet: string;
  rank: number;
}

export interface CopilotPendingActionDecision {
  action: CopilotPendingAction;
  run?: CopilotRun;
  events?: CopilotRunEvent[];
  pendingActions?: CopilotPendingAction[];
}

export type CopilotSource = "dashboard" | "project" | "session" | "settings" | "copilot" | "models";

export interface CreateCopilotRunInput {
  prompt: string;
  providerProfileId?: string;
  modelProfileId?: string;
  source?: CopilotSource;
  sourceRefId?: string;
  async?: boolean;
}

export interface CreateCopilotConversationInput {
  title: string;
  source?: CopilotSource;
  sourceRefId?: string;
}

export interface UpdateCopilotConversationInput {
  title: string;
}

export interface CreateCopilotConversationMessageInput extends CreateCopilotRunInput {}

export interface ListCopilotMemoryEntriesInput {
  scope?: CopilotMemoryScope;
  projectId?: string;
  limit?: number;
}

export interface ListCopilotMemoryNotesInput {
  projectId?: string;
  sessionId?: string;
  limit?: number;
}

export interface SearchCopilotMemoryInput {
  query: string;
  scope?: CopilotMemoryScope;
  projectId?: string;
  includeNotes?: boolean;
  limit?: number;
}

export interface DependencyStatus {
  name: string;
  available: boolean;
  required?: boolean;
  version?: string;
  error?: string;
}

export interface TerminalRuntimeStatus {
  persistence: "tmux";
  mode: "native_tmux" | "wsl_required" | "tmux_missing" | string;
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
  openforgeUserId: string;
  displayName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReplaceFeishuUserMappingInput {
  feishuUserId: string;
  openforgeUserId: string;
  displayName?: string | null;
}

export interface LocalDiagnosticsExport {
  generatedAt: string;
  app: {
    name: "OpenForge";
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
  copilot: {
    capabilities: {
      enabled: boolean;
      toolExecutionEnabled: boolean;
      approvalRequiredForWrites: boolean;
      memoryEnabled: boolean;
      memoryWritesRequireApproval: boolean;
    };
  };
  integrations?: {
    feishu?: FeishuIntegrationStatus;
  };
  environment: Record<string, unknown>;
}

export interface Agent {
  id: string;
  name: string;
  projectId?: string;
  projectName?: string;
  description?: string | null;
  modelId?: string | null;
  model?: string;
  tools?: string | null;
  allowedDirs?: string | null;
  customPrompt?: string | null;
  status?: string;
}

export interface ProjectAgentSequenceItem {
  userId?: string;
  projectId: string;
  agentId: string;
  position: number;
  name: string;
  description?: string | null;
  modelId?: string | null;
  tools?: string | null;
  allowedDirs?: string | null;
  customPrompt?: string | null;
  status: string;
}

export interface DefaultAgentPackResult {
  agents: Agent[];
  created: Agent[];
  skipped: Agent[];
  sequence: ProjectAgentSequenceItem[];
}

export interface AgentTemplate {
  id: "planner" | "backend" | "frontend" | "reviewer" | "test-writer" | string;
  name: string;
  description: string;
  tools: string;
  allowedDirs: string;
  customPrompt: string;
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
  type: "skill" | "plugin" | "template";
  label: string;
  url: string;
  status: string;
  lastRefreshedAt?: string | null;
}

export interface CatalogItem {
  id: string;
  sourceId: string;
  itemType: "skill" | "plugin" | "template";
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

export interface Model {
  id: string;
  name: string;
  provider: string;
  modelId: string;
  endpoint?: string | null;
  status?: string;
  isDefault: boolean;
}

export interface ModelHealth {
  healthy: boolean;
  status: "ready" | "needs_attention";
  message: string;
  checkedAt: string;
  checks: {
    modelConfigured: boolean;
    endpointConfigured: boolean;
    defaultModel: boolean;
  };
}

export interface ModelEndpointHealth {
  healthy: boolean;
  endpoint: string;
  latencyMs: number;
  timeoutMs: number;
  statusCode?: number;
  checkedAt: string;
  error?: string;
}

export interface ModelPreset {
  id: string;
  label: string;
  provider: string;
  modelId: string;
  endpoint: string;
  tier: "performance" | "balanced" | "budget" | "local";
}

export interface ModelGroup {
  provider: string;
  count: number;
  models: Model[];
}

export type ProviderAuthType = "api_key" | "bearer_token" | "oauth" | "none";
export type ProviderApiFormat = "anthropic" | "openai" | "openai-compatible" | "google" | "bedrock" | "local";
export type ProviderApplyAdapter = "claude" | "opencode" | "openforge-copilot" | "codex";
export type ProviderSupportedAdapter = "claude" | "opencode";
export type ProviderProductType = "payg_api" | "coding_plan" | "token_plan" | "subscription" | "local";
export type ProviderReadinessAdapter = ProviderApplyAdapter;
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
  | "codex_subscription_managed";
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

export interface ProviderCatalogModel {
  id: string;
  name: string;
  modelId: string;
  capabilities: string[];
  contextWindow?: number;
}

export interface ProviderCatalogPreset {
  id: string;
  name: string;
  description: string;
  baseUrl: string;
  region: string;
  productType: ProviderProductType;
  authType: ProviderAuthType;
  apiFormat: ProviderApiFormat;
  supportedAdapters: ProviderSupportedAdapter[];
  modelSource: "static" | "dynamic" | "models.dev";
  endpoints: {
    anthropic?: { baseUrl: string };
    openai?: { baseUrl: string };
  };
  modelFetch?: {
    strategy: "openai-compatible";
    modelsUrl?: string;
  };
  defaultModels: ProviderCatalogModel[];
  source?: "verified" | "models.dev";
  claude?: {
    env: {
      baseUrl: string;
      authToken: string;
      model: string;
      smallFastModel: string;
      defaultSonnetModel: string;
      defaultHaikuModel: string;
      defaultOpusModel: string;
      apiTimeoutMs: string;
    };
    defaultSmallFastModel?: string;
  };
  opencode?: {
    npm: string;
    api?: string;
    env: string[];
  };
}

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
  status: string;
  isDefault: boolean;
}

export interface ProviderModelSyncResult {
  fetchedCount: number;
  createdCount: number;
  models: ModelProfile[];
}

export interface ProviderCredentialSummary {
  id: string;
  providerProfileId: string;
  label: string | null;
  status: string;
  secretPreview: string;
}

export interface ProviderApplyPreview {
  adapter: ProviderApplyAdapter;
  env: Record<string, string>;
  secretEnvNames: string[];
  changedFiles: Array<{ relativePath: string; operation: "create" | "update" }>;
  backupPath?: string;
  files?: Array<{ relativePath: string; content: string }>;
  internalDefault?: {
    scope: "user";
    providerProfileId: string;
    modelProfileId: string;
    providerName: string;
    modelName: string;
  };
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
  steps: string[];
}

export interface CodexSubscriptionStatus {
  providerApplyEnabled: boolean;
  identitySource: "chatgpt_subscription_sdk";
  connectionState: "connected" | "not_connected" | "pending_sdk_connection";
  accountLabel: string | null;
  canUseAppServerIdentity: boolean;
  sdk: {
    packageName: string;
    installed: boolean;
    docsUrl: string;
    appServerDocsUrl: string;
  };
}

export interface Plugin {
  id: string;
  name: string;
  description: string;
  version: string;
  adapter: "claude";
  category: "workflow" | "safety" | "integration";
  configPath: string;
  skills: Array<{
    name: string;
    description: string;
    content: string;
  }>;
  enabled: boolean;
  status: "enabled" | "disabled";
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
  agentId?: string | null;
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

export interface AiConfigFormField {
  key: string;
  label: string;
  inputType: "text" | "textarea" | "select" | "number" | "boolean" | "list" | string;
  path: string;
  options?: string[];
}

export interface AiConfigForm {
  filePath: string;
  title: string;
  fields: AiConfigFormField[];
}

export interface AiConfigSnapshot {
  adapter: "claude" | "opencode" | "codex" | string;
  projectRoot: string;
  files: AiConfigFile[];
  forms: AiConfigForm[];
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

export interface AdapterDiscovery {
  id: "claude" | "opencode" | "codex";
  label: string;
  command: string;
  supportLevel: "supported" | "prototype";
  launchEnabled: boolean;
  configDir: string;
  runtimeModes: Array<"terminal" | "app-server-stdio" | "app-server-websocket" | string>;
  available: boolean;
  status: "available" | "missing";
  version?: string;
  error?: string;
}

export type RuntimeAdapterId = AdapterDiscovery["id"];

export type CredentialMode = "host_environment" | "stored_encrypted_key";

export interface ModelInput {
  name: string;
  provider: string;
  modelId: string;
  endpoint?: string;
}

export interface ModelUpdateInput {
  name?: string;
  provider?: string;
  modelId?: string;
  endpoint?: string;
}

export interface AgentInput {
  projectId?: string;
  name: string;
  description?: string;
  modelId?: string;
  tools?: string;
  allowedDirs?: string;
  customPrompt?: string;
}

export interface AgentUpdateInput {
  projectId?: string;
  name?: string;
  description?: string;
  modelId?: string;
  tools?: string;
  allowedDirs?: string;
  customPrompt?: string;
  status?: string;
}

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
  agents: number;
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
  agents: DashboardHealthItem;
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
const COPILOT_RUN_API_TIMEOUT_MS = 65_000;

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

export async function register(email: string, password: string) {
  return fetchEnvelope<AuthPayload>("/api/v1/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export async function getMe() {
  return fetchEnvelope<User>("/api/v1/auth/me", { method: "GET" });
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
  agentId?: string;
  types?: string[];
  limit?: number;
} = {}): Promise<{ activities: SessionActivity[] }> {
  const searchParams = new URLSearchParams();
  if (params.sessionId) searchParams.set("sessionId", params.sessionId);
  if (params.projectId) searchParams.set("projectId", params.projectId);
  if (params.agentId) searchParams.set("agentId", params.agentId);
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
export function defaultTemplateForAiTool(aiTool?: string | null): string {
  if (aiTool === "opencode") return "builtin-opencode";
  if (aiTool === "codex") return "builtin-codex";
  return "builtin-claude-code";
}

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
  aiTool?: RuntimeAdapterId;
  description?: string;
  templateId?: string;
}): Promise<{ project: Project }> {
  return fetchJson("/api/v1/projects", {
    method: "POST",
    body: JSON.stringify(data),
  }) as Promise<{ project: Project }>;
}

export async function getProject(id: string): Promise<{ project: Project }> {
  return fetchJson(`/api/v1/projects/${id}`) as Promise<{ project: Project }>;
}

export async function getProjectAgentSequence(id: string): Promise<{ sequence: ProjectAgentSequenceItem[] }> {
  return fetchJson(`/api/v1/projects/${id}/agent-sequence`) as Promise<{ sequence: ProjectAgentSequenceItem[] }>;
}

export async function getProjectAiConfig(id: string): Promise<AiConfigSnapshot> {
  return fetchJson(`/api/v1/projects/${encodeURIComponent(id)}/ai-config`) as Promise<AiConfigSnapshot>;
}

export async function getGlobalAiConfig(id: string): Promise<AiConfigSnapshot> {
  return fetchJson(`/api/v1/projects/${encodeURIComponent(id)}/ai-config/global`) as Promise<AiConfigSnapshot>;
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

export async function updateProjectAiConfigFile(
  id: string,
  relativePath: string,
  content: string
): Promise<AiConfigSnapshot> {
  return fetchJson(`/api/v1/projects/${encodeURIComponent(id)}/ai-config/files`, {
    method: "PUT",
    body: JSON.stringify({ relativePath, content }),
  }) as Promise<AiConfigSnapshot>;
}

export async function updateProjectAgentSequence(
  id: string,
  agentIds: string[]
): Promise<{ sequence: ProjectAgentSequenceItem[] }> {
  return fetchJson(`/api/v1/projects/${id}/agent-sequence`, {
    method: "PUT",
    body: JSON.stringify({ agentIds }),
  }) as Promise<{ sequence: ProjectAgentSequenceItem[] }>;
}

export async function createDefaultAgentPack(id: string): Promise<DefaultAgentPackResult> {
  return fetchJson(`/api/v1/projects/${id}/agents/default-pack`, {
    method: "POST",
  }) as Promise<DefaultAgentPackResult>;
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
  workItemId: string
): Promise<{ taskPacket: ProjectManagerTaskPacket; session: Session }> {
  return fetchJson(projectManagerPath(
    projectId,
    `/work-items/${encodeURIComponent(workItemId)}/task-packet/start`
  ), {
    method: "POST",
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
  credentialMode: CredentialMode;
  aiTool?: RuntimeAdapterId;
  modelId?: string;
  apiKeyId?: string;
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

export async function listCodexAppServers(): Promise<{ sessions: CodexAppServerSession[] }> {
  return fetchJson("/api/v1/codex/app-server") as Promise<{ sessions: CodexAppServerSession[] }>;
}

export async function getCodexAppServerCapabilities(): Promise<{ capabilities: CodexAppServerCapabilities }> {
  return fetchJson("/api/v1/codex/app-server/capabilities") as Promise<{
    capabilities: CodexAppServerCapabilities;
  }>;
}

export async function startCodexAppServer(input: {
  projectId: string;
  runtimeMode: "app-server-stdio" | "app-server-websocket";
  credentialMode?: "host_environment";
}): Promise<{ session: CodexAppServerSession }> {
  return fetchJson("/api/v1/codex/app-server", {
    method: "POST",
    body: JSON.stringify({
      projectId: input.projectId,
      runtimeMode: input.runtimeMode,
      ...(input.credentialMode ? { credentialMode: input.credentialMode } : {}),
    }),
  }) as Promise<{ session: CodexAppServerSession }>;
}

export async function initializeCodexAppServer(id: string): Promise<{ result: unknown }> {
  return fetchJson(`/api/v1/codex/app-server/${id}/initialize`, { method: "POST" }) as Promise<{
    result: unknown;
  }>;
}

export async function startCodexAppServerThread(
  id: string,
  input: {
    cwd?: string;
    model?: string;
    approvalPolicy?: string;
    sandbox?: string;
  } = {}
): Promise<{ result: unknown }> {
  return fetchJson(`/api/v1/codex/app-server/${id}/thread`, {
    method: "POST",
    body: JSON.stringify(input),
  }) as Promise<{ result: unknown }>;
}

export async function startCodexAppServerTurn(
  id: string,
  input: { threadId: string; text: string }
): Promise<{ result: unknown }> {
  // Guarded prototype API only. The current Web surface intentionally does not
  // expose prompt/turn controls unless Gateway enables turn input explicitly.
  return fetchJson(`/api/v1/codex/app-server/${id}/turn`, {
    method: "POST",
    body: JSON.stringify(input),
  }) as Promise<{ result: unknown }>;
}

export async function stopCodexAppServer(id: string): Promise<{ session: CodexAppServerSession }> {
  return fetchJson(`/api/v1/codex/app-server/${id}/stop`, { method: "POST" }) as Promise<{
    session: CodexAppServerSession;
  }>;
}

// Copilot
export async function getCopilotCapabilities(): Promise<CopilotCapabilities> {
  return fetchJson("/api/v1/copilot/capabilities") as Promise<CopilotCapabilities>;
}

export async function createCopilotRun(
  input: CreateCopilotRunInput
): Promise<{ run: CopilotRun; events: CopilotRunEvent[]; pendingActions?: CopilotPendingAction[] }> {
  return fetchJson("/api/v1/copilot/runs", {
    method: "POST",
    body: JSON.stringify(input),
    timeoutMs: COPILOT_RUN_API_TIMEOUT_MS,
  }) as Promise<{ run: CopilotRun; events: CopilotRunEvent[]; pendingActions?: CopilotPendingAction[] }>;
}

export async function listCopilotRuns(limit?: number): Promise<{ runs: CopilotRun[] }> {
  const query = limit ? `?limit=${encodeURIComponent(String(limit))}` : "";
  return fetchJson(`/api/v1/copilot/runs${query}`) as Promise<{ runs: CopilotRun[] }>;
}

export async function listCopilotMemoryEntries(
  input: ListCopilotMemoryEntriesInput = {}
): Promise<{ entries: CopilotMemoryEntry[] }> {
  const query = buildCopilotMemoryQuery(input);
  return fetchJson(`/api/v1/copilot/memory/entries${query}`) as Promise<{ entries: CopilotMemoryEntry[] }>;
}

export async function listCopilotMemoryNotes(
  input: ListCopilotMemoryNotesInput = {}
): Promise<{ notes: CopilotMemoryNote[] }> {
  const query = buildCopilotMemoryQuery(input);
  return fetchJson(`/api/v1/copilot/memory/notes${query}`) as Promise<{ notes: CopilotMemoryNote[] }>;
}

export async function searchCopilotMemory(
  input: SearchCopilotMemoryInput
): Promise<{ results: CopilotMemorySearchResult[] }> {
  const query = buildCopilotMemoryQuery(input);
  return fetchJson(`/api/v1/copilot/memory/search${query}`) as Promise<{ results: CopilotMemorySearchResult[] }>;
}

export async function getCopilotMemoryItem(
  type: CopilotMemoryItemType,
  id: string
): Promise<{ item: CopilotMemoryEntry | CopilotMemoryNote }> {
  return fetchJson(`/api/v1/copilot/memory/${type}/${encodeURIComponent(id)}`) as Promise<{
    item: CopilotMemoryEntry | CopilotMemoryNote;
  }>;
}

export async function deleteCopilotMemoryItem(
  type: CopilotMemoryItemType,
  id: string
): Promise<{ item: CopilotMemoryEntry | CopilotMemoryNote }> {
  return fetchJson(`/api/v1/copilot/memory/${type}/${encodeURIComponent(id)}`, {
    method: "DELETE",
  }) as Promise<{ item: CopilotMemoryEntry | CopilotMemoryNote }>;
}

export async function listCopilotConversations(limit?: number): Promise<{ conversations: CopilotConversation[] }> {
  const query = limit ? `?limit=${encodeURIComponent(String(limit))}` : "";
  return fetchJson(`/api/v1/copilot/conversations${query}`) as Promise<{ conversations: CopilotConversation[] }>;
}

export async function createCopilotConversation(
  input: CreateCopilotConversationInput
): Promise<{ conversation: CopilotConversation }> {
  return fetchJson("/api/v1/copilot/conversations", {
    method: "POST",
    body: JSON.stringify(input),
  }) as Promise<{ conversation: CopilotConversation }>;
}

export async function updateCopilotConversation(
  id: string,
  input: UpdateCopilotConversationInput
): Promise<{ conversation: CopilotConversation }> {
  return fetchJson(`/api/v1/copilot/conversations/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  }) as Promise<{ conversation: CopilotConversation }>;
}

export async function deleteCopilotConversation(id: string): Promise<{ conversation: CopilotConversation }> {
  return fetchJson(`/api/v1/copilot/conversations/${encodeURIComponent(id)}`, {
    method: "DELETE",
  }) as Promise<{ conversation: CopilotConversation }>;
}

export async function listCopilotConversationMessages(
  conversationId: string
): Promise<{ messages: CopilotMessage[] }> {
  return fetchJson(`/api/v1/copilot/conversations/${encodeURIComponent(conversationId)}/messages`) as Promise<{
    messages: CopilotMessage[];
  }>;
}

export async function createCopilotConversationMessage(
  conversationId: string,
  input: CreateCopilotConversationMessageInput
): Promise<{
  messages: CopilotMessage[];
  run: CopilotRun;
  events: CopilotRunEvent[];
  pendingActions?: CopilotPendingAction[];
}> {
  return fetchJson(`/api/v1/copilot/conversations/${encodeURIComponent(conversationId)}/messages`, {
    method: "POST",
    body: JSON.stringify(input),
    timeoutMs: COPILOT_RUN_API_TIMEOUT_MS,
  }) as Promise<{
    messages: CopilotMessage[];
    run: CopilotRun;
    events: CopilotRunEvent[];
    pendingActions?: CopilotPendingAction[];
  }>;
}

export async function deleteCopilotMessage(id: string): Promise<{ message: CopilotMessage }> {
  return fetchJson(`/api/v1/copilot/messages/${encodeURIComponent(id)}`, {
    method: "DELETE",
  }) as Promise<{ message: CopilotMessage }>;
}

export async function getCopilotRun(
  id: string
): Promise<{ run: CopilotRun; events: CopilotRunEvent[]; pendingActions: CopilotPendingAction[] }> {
  return fetchJson(`/api/v1/copilot/runs/${id}`) as Promise<{
    run: CopilotRun;
    events: CopilotRunEvent[];
    pendingActions: CopilotPendingAction[];
  }>;
}

export async function cancelCopilotRun(
  id: string
): Promise<{ run: CopilotRun; events: CopilotRunEvent[]; pendingActions?: CopilotPendingAction[] }> {
  return fetchJson(`/api/v1/copilot/runs/${id}/cancel`, {
    method: "POST",
  }) as Promise<{ run: CopilotRun; events: CopilotRunEvent[]; pendingActions?: CopilotPendingAction[] }>;
}

export async function approveCopilotPendingAction(
  runId: string,
  actionId: string
): Promise<CopilotPendingActionDecision> {
  return fetchJson(`/api/v1/copilot/runs/${runId}/pending-actions/${actionId}/approve`, {
    method: "POST",
  }) as Promise<CopilotPendingActionDecision>;
}

export async function rejectCopilotPendingAction(
  runId: string,
  actionId: string
): Promise<CopilotPendingActionDecision> {
  return fetchJson(`/api/v1/copilot/runs/${runId}/pending-actions/${actionId}/reject`, {
    method: "POST",
  }) as Promise<CopilotPendingActionDecision>;
}

function buildCopilotMemoryQuery(
  input: ListCopilotMemoryEntriesInput | ListCopilotMemoryNotesInput | SearchCopilotMemoryInput
): string {
  const searchParams = new URLSearchParams();
  if ("query" in input) searchParams.set("query", input.query);
  if ("scope" in input && input.scope) searchParams.set("scope", input.scope);
  if ("projectId" in input && input.projectId) searchParams.set("projectId", input.projectId);
  if ("sessionId" in input && input.sessionId) searchParams.set("sessionId", input.sessionId);
  if ("includeNotes" in input && input.includeNotes !== undefined) {
    searchParams.set("includeNotes", String(input.includeNotes));
  }
  if (input.limit !== undefined) searchParams.set("limit", String(input.limit));
  const query = searchParams.toString();
  return query ? `?${query}` : "";
}

// Agents
export async function listAgents(): Promise<{ agents: Agent[] }> {
  return fetchJson("/api/v1/agents") as Promise<{ agents: Agent[] }>;
}

export async function listAgentTemplates(): Promise<{ templates: AgentTemplate[] }> {
  return fetchJson("/api/v1/agents/templates") as Promise<{ templates: AgentTemplate[] }>;
}

export async function createAgent(data: AgentInput): Promise<{ agent: Agent }> {
  return fetchJson("/api/v1/agents", {
    method: "POST",
    body: JSON.stringify(data),
  }) as Promise<{ agent: Agent }>;
}

export async function updateAgent(id: string, data: AgentUpdateInput): Promise<{ agent: Agent }> {
  return fetchJson(`/api/v1/agents/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  }) as Promise<{ agent: Agent }>;
}

export async function deleteAgent(id: string): Promise<unknown> {
  return fetchJson(`/api/v1/agents/${id}`, { method: "DELETE" });
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
  type: "skill" | "plugin" | "template";
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

export async function installCatalogPlugin(
  itemId: string
): Promise<{ plugin: Plugin; catalogItem: Pick<CatalogItem, "id" | "externalId" | "sourceId"> }> {
  return fetchJson(`/api/v1/catalog/items/${encodeURIComponent(itemId)}/install`, {
    method: "POST",
  }) as Promise<{ plugin: Plugin; catalogItem: Pick<CatalogItem, "id" | "externalId" | "sourceId"> }>;
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

// Plugins
export async function listPlugins(): Promise<{ plugins: Plugin[] }> {
  return fetchJson("/api/v1/plugins") as Promise<{ plugins: Plugin[] }>;
}

export async function togglePlugin(id: string, enabled: boolean): Promise<{ plugin: Plugin }> {
  return fetchJson(`/api/v1/plugins/${id}/toggle`, {
    method: "POST",
    body: JSON.stringify({ enabled }),
  }) as Promise<{ plugin: Plugin }>;
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
  aiTool?: RuntimeAdapterId;
  templateId?: string;
  skipConfigGeneration?: boolean;
}

export interface ProjectWithConfigResult {
  project: Project;
  configStatus: "applied" | "needs_review" | "failed" | "skipped";
  configError?: string;
  configSummary?: ConfigSyncSummary;
}

export type ImportProjectWithConfigResult = ProjectWithConfigResult;

export async function importProject(input: ImportProjectInput): Promise<{ project: Project }> {
  return fetchJson("/api/v1/projects/import", {
    method: "POST",
    body: JSON.stringify({
      path: input.path,
      name: input.name,
      ...(input.aiTool ? { aiTool: input.aiTool } : {}),
      ...(input.templateId ? { templateId: input.templateId } : {}),
    }),
  }) as Promise<{ project: Project }>;
}

export async function importProjectWithConfig(
  input: ImportProjectInput
): Promise<ImportProjectWithConfigResult> {
  const { project } = await importProject(input);
  return configureCreatedProject(project, input);
}

export async function createProjectWithConfig(
  input: {
    path: string;
    name: string;
    aiTool?: RuntimeAdapterId;
    description?: string;
    templateId?: string;
    skipConfigGeneration?: boolean;
  }
): Promise<ProjectWithConfigResult> {
  const { project } = await createProject(input);
  return configureCreatedProject(project, input);
}

async function configureCreatedProject(
  project: Project,
  input: Pick<ImportProjectInput, "aiTool" | "skipConfigGeneration" | "templateId">
): Promise<ProjectWithConfigResult> {
  if (input.skipConfigGeneration) return { project, configStatus: "skipped" };

  const templateId = input.templateId ?? project.templateId ?? defaultTemplateForAiTool(input.aiTool ?? project.aiTool);
  try {
    const preview = await previewConfigSync(project.id, templateId);
    if (configSyncRequiresReview(preview.summary)) {
      return {
        project,
        configStatus: "needs_review",
        configError: "Configuration has modified or unsafe files requiring an explicit decision.",
        configSummary: preview.summary,
      };
    }
    if (preview.summary.missingFiles.length === 0) {
      return { project, configStatus: "skipped", configSummary: preview.summary };
    }

    // Only a conflict-free, missing-file plan may write during creation/import.
    const applied = await applyConfigSync(project.id, {}, templateId);
    return {
      project,
      configStatus: applied.result.writtenFiles.length > 0 ? "applied" : "skipped",
      configSummary: applied.summary,
    };
  } catch (error) {
    return {
      project,
      configStatus: "failed",
      configError: error instanceof Error ? error.message : "Config generation failed",
    };
  }
}

function configSyncRequiresReview(summary: ConfigSyncSummary): boolean {
  return summary.modifiedFiles.length > 0
    || summary.unsafeFiles.length > 0
    || summary.requiresDecision.length > 0;
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

export async function previewTemplateFromProject(
  projectId: string,
  filePaths?: string[]
): Promise<TemplateFromProjectPreview> {
  return fetchJson("/api/v1/templates/from-project/preview", {
    method: "POST",
    body: JSON.stringify({
      projectId,
      ...(filePaths && filePaths.length > 0 ? { filePaths } : {}),
    }),
  }) as Promise<TemplateFromProjectPreview>;
}

export async function createTemplateFromProject(
  data: TemplateFromProjectInput
): Promise<{ template: Template }> {
  return fetchJson("/api/v1/templates/from-project", {
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

// Models
export async function listModels(): Promise<{ models: Model[] }> {
  return fetchJson("/api/v1/models") as Promise<{ models: Model[] }>;
}

export async function listModelPresets(): Promise<{ presets: ModelPreset[] }> {
  return fetchJson("/api/v1/models/presets") as Promise<{ presets: ModelPreset[] }>;
}

export async function listModelGroups(): Promise<{ groups: ModelGroup[] }> {
  return fetchJson("/api/v1/models/groups") as Promise<{ groups: ModelGroup[] }>;
}

export async function createModel(data: ModelInput): Promise<{ model: Model }> {
  return fetchJson("/api/v1/models", {
    method: "POST",
    body: JSON.stringify(data),
  }) as Promise<{ model: Model }>;
}

export async function updateModel(id: string, data: ModelUpdateInput): Promise<{ model: Model }> {
  return fetchJson(`/api/v1/models/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  }) as Promise<{ model: Model }>;
}

export async function deleteModel(id: string): Promise<unknown> {
  return fetchJson(`/api/v1/models/${id}`, { method: "DELETE" });
}

export async function setDefaultModel(id: string): Promise<{ model: Model }> {
  return fetchJson(`/api/v1/models/${id}/set-default`, {
    method: "POST",
  }) as Promise<{ model: Model }>;
}

export async function checkModelHealth(id: string): Promise<{ health: ModelHealth }> {
  return fetchJson(`/api/v1/models/${id}/check`, {
    method: "POST",
  }) as Promise<{ health: ModelHealth }>;
}

export async function checkModelEndpointHealth(
  id: string,
  timeoutMs = 3000
): Promise<{ health: ModelEndpointHealth }> {
  return fetchJson(`/api/v1/models/${id}/check-endpoint`, {
    method: "POST",
    body: JSON.stringify({ timeoutMs }),
  }) as Promise<{ health: ModelEndpointHealth }>;
}

export async function listProviderCatalog(): Promise<{ providers: ProviderCatalogPreset[] }> {
  return fetchJson("/api/v1/model-providers/catalog") as Promise<{ providers: ProviderCatalogPreset[] }>;
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
  catalogId?: string;
  name?: string;
  providerKey?: string;
  baseUrl?: string;
  anthropicBaseUrl?: string;
  openaiBaseUrl?: string;
  region?: string;
  productType?: ProviderProductType;
  authType?: ProviderAuthType;
  apiFormat?: ProviderApiFormat;
  supportedAdapters?: Array<"claude" | "opencode">;
}): Promise<{ provider: ProviderProfile; models: ModelProfile[] }> {
  return fetchJson("/api/v1/model-providers", {
    method: "POST",
    body: JSON.stringify(data),
  }) as Promise<{ provider: ProviderProfile; models: ModelProfile[] }>;
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

export async function deleteProviderCredential(providerId: string, credentialId: string): Promise<unknown> {
  return fetchJson(`/api/v1/model-providers/${providerId}/credentials/${credentialId}`, {
    method: "DELETE",
  });
}

export async function createProviderModel(
  providerId: string,
  data: { name: string; modelId: string; capabilities?: string[]; isDefault?: boolean }
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

export async function previewProviderApply(
  providerId: string,
  data: { adapter: ProviderApplyAdapter; projectRoot?: string; modelProfileId?: string; credentialId?: string }
): Promise<{ preview: ProviderApplyPreview }> {
  return fetchJson(`/api/v1/model-providers/${providerId}/preview-apply`, {
    method: "POST",
    body: JSON.stringify(data),
  }) as Promise<{ preview: ProviderApplyPreview }>;
}

export async function applyProviderConfig(
  providerId: string,
  data: { adapter: ProviderApplyAdapter; projectRoot?: string; modelProfileId?: string; credentialId?: string }
): Promise<{ result: ProviderApplyPreview }> {
  return fetchJson(`/api/v1/model-providers/${providerId}/apply`, {
    method: "POST",
    body: JSON.stringify(data),
  }) as Promise<{ result: ProviderApplyPreview }>;
}

export async function getCodexSubscriptionStatus(): Promise<{ status: CodexSubscriptionStatus }> {
  return fetchJson("/api/v1/codex/subscription/status") as Promise<{ status: CodexSubscriptionStatus }>;
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
