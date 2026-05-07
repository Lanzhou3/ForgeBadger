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
  createdAt: string;
  updatedAt: string;
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
}

export const gatewayBaseUrl = getGatewayBaseUrl();

export function apiUrl(path: string): string {
  const baseUrl = getGatewayBaseUrl().replace(/\/+$/, "");
  return `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

export async function fetchJson<T = unknown>(path: string, options: RequestInit = {}) {
  const token = getToken();
  const res = await fetch(apiUrl(path), {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "Unknown error");
    throw new Error(text);
  }
  const envelope = (await res.json()) as ApiEnvelope<T>;
  if (envelope.code !== 0) {
    throw new Error(envelope.message || "API request failed");
  }
  return envelope.data as T;
}

export async function fetchEnvelope<T = unknown>(path: string, options: RequestInit = {}) {
  const token = getToken();
  const res = await fetch(apiUrl(path), {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "Unknown error");
    throw new Error(text);
  }
  const envelope = (await res.json()) as ApiEnvelope<T>;
  if (envelope.code !== 0) {
    throw new Error(envelope.message || "API request failed");
  }
  return envelope;
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

export async function getDependencies(): Promise<unknown> {
  const response = await fetch(apiUrl("/api/v1/gate-a/dependencies"), {
    cache: "no-store"
  });
  return response.json();
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

export async function listActivities(params: {
  sessionId?: string;
  projectId?: string;
  agentId?: string;
  limit?: number;
} = {}): Promise<{ activities: SessionActivity[] }> {
  const searchParams = new URLSearchParams();
  if (params.sessionId) searchParams.set("sessionId", params.sessionId);
  if (params.projectId) searchParams.set("projectId", params.projectId);
  if (params.agentId) searchParams.set("agentId", params.agentId);
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
export async function listSessions(): Promise<{ sessions: Session[] }> {
  return fetchJson("/api/v1/sessions") as Promise<{ sessions: Session[] }>;
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

export async function startCodexAppServer(input: {
  projectId: string;
  runtimeMode: "app-server-stdio" | "app-server-websocket";
  credentialMode?: CredentialMode;
  modelId?: string;
  apiKeyId?: string;
}): Promise<{ session: CodexAppServerSession }> {
  return fetchJson("/api/v1/codex/app-server", {
    method: "POST",
    body: JSON.stringify({
      projectId: input.projectId,
      runtimeMode: input.runtimeMode,
      ...(input.credentialMode ? { credentialMode: input.credentialMode } : {}),
      ...(input.modelId ? { modelId: input.modelId } : {}),
      ...(input.apiKeyId ? { apiKeyId: input.apiKeyId } : {}),
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
  configStatus: "applied" | "failed" | "skipped";
  configError?: string;
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
  return { project, configStatus: "skipped" };
}

export async function createProjectWithConfig(
  input: {
    path: string;
    name: string;
    aiTool?: RuntimeAdapterId;
    description?: string;
    templateId?: string;
  }
): Promise<ProjectWithConfigResult> {
  const { project } = await createProject(input);
  return { project, configStatus: "skipped" };
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
