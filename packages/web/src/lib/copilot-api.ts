import { fetchEnvelope, fetchJson } from "@/lib/api";

export type AgentMessageRole = "user" | "assistant" | "tool";
export type AgentMessageKind =
  | "text"
  | "tool_call"
  | "tool_result"
  | "pending_action"
  | "error";
export type CopilotRunStatus =
  | "pending"
  | "running"
  | "awaiting_approval"
  | "completed"
  | "cancelled"
  | "failed"
  | "stopped"
  | "indeterminate";

export interface CopilotConversation {
  id: string;
  title: string | null;
  status: string;
  created_at: number;
  updated_at: number;
}

export interface CopilotMessage {
  id: string;
  conversationId: string;
  userId: string;
  role: AgentMessageRole;
  kind: AgentMessageKind;
  content: string;
  toolName?: string;
  toolInputJson?: string;
  /** Provider-assigned tool call id; pairs tool_call with tool_result. */
  toolCallId?: string;
  sequence: number;
  createdAt: string;
}

export interface CopilotRun {
  phase?: string;
  phaseStartedAt?: string;
  usage?: { chargedTokens: number; reportedTokens: number; estimatedCalls: number; calls: number };
  revision?: number;
  stopReason?: string;
  id: string;
  conversationId: string;
  userId: string;
  status: CopilotRunStatus;
  provider?: string;
  model?: string;
  steps: number;
  error?: string;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CopilotPendingAction {
  platformIntentId?: string | null;
  platformIntent?: import("@/lib/platform-actions-api").PlatformIntent | null;
  id: string;
  runId: string;
  userId: string;
  tool: string;
  inputJson: string;
  inputDigest: string;
  status: "pending" | "approved" | "rejected" | "expired";
  createdAt: string;
  decidedAt?: string;
  updatedAt: string;
}

export interface CopilotMemoryEntry {
  id: string;
  userId: string;
  scope: "global" | "project" | "session";
  projectId?: string | null;
  kind: "fact" | "preference" | "decision" | "project_note";
  text: string;
  metadataJson: string;
  createdAt: string;
  updatedAt: string;
}

export interface CopilotToolInfo {
  name: string;
  description: string;
  risk: "read" | "operate";
  requiresApproval: boolean;
  /** Owner's per-tool switch; absent-row default is true (server always sends it). */
  enabled: boolean;
  available: boolean;
  unavailableReason: string | null;
  effectiveEnabled?: boolean;
  authorization?: "read" | "owner_action" | "unavailable";
}

export interface CopilotPlaybook {
  id: string;
  name: string;
  description: string;
  content: string;
  version: string;
  currentVersion: string;
  isEnabled: boolean;
  requiredTools: string[];
  available: boolean;
  unavailableReason: string | null;
  reviewRequired: boolean;
  editable: boolean;
}

export function listCopilotPlaybooks() {
  return fetchJson<{ playbooks: CopilotPlaybook[] }>("/api/v1/copilot/playbooks");
}

export function updateCopilotPlaybook(id: string, input: { content: string; version: string }) {
  return fetchJson<{ playbook: CopilotPlaybook }>(
    `/api/v1/copilot/playbooks/${encodeURIComponent(id)}`,
    { method: "PUT", body: JSON.stringify(input) }
  );
}

export function setCopilotPlaybookEnabled(id: string, enabled: boolean) {
  return fetchJson<{ playbook: CopilotPlaybook }>(
    `/api/v1/copilot/playbooks/${encodeURIComponent(id)}/enabled`,
    { method: "PUT", body: JSON.stringify({ enabled }) }
  );
}

export function listConversations() {
  return fetchJson<{ conversations: CopilotConversation[] }>("/api/v1/copilot/conversations");
}

export function createConversation(title?: string) {
  return fetchJson<{ conversation: CopilotConversation }>("/api/v1/copilot/conversations", {
    method: "POST",
    body: JSON.stringify(title ? { title } : {}),
  });
}

export function renameConversation(conversationId: string, title: string) {
  return fetchJson<{ conversation: CopilotConversation }>(
    `/api/v1/copilot/conversations/${encodeURIComponent(conversationId)}`,
    { method: "PATCH", body: JSON.stringify({ title }) }
  );
}

export function deleteConversation(conversationId: string) {
  return fetchJson<{ deleted: boolean }>(
    `/api/v1/copilot/conversations/${encodeURIComponent(conversationId)}`,
    { method: "DELETE" }
  );
}

export function listMessages(conversationId: string) {
  return fetchJson<{ messages: CopilotMessage[] }>(
    `/api/v1/copilot/conversations/${encodeURIComponent(conversationId)}/messages`
  );
}

/** Run a turn; returns the run id. Streaming deltas arrive via /ws/events. */
export interface CopilotMessageOptions {
  reviewTaskResults?: boolean;
  repairFailedChecks?: boolean;
  toolDiscovery?: boolean;
  projectId?: string;
  clientRequestId?: string;
}

export function sendMessage(conversationId: string, content: string, modelId?: string, options?: CopilotMessageOptions) {
  return fetchJson<{ runId: string }>(
    `/api/v1/copilot/conversations/${encodeURIComponent(conversationId)}/messages`,
    {
      method: "POST",
      body: JSON.stringify({ content, ...(modelId ? { modelId } : {}), ...options }),
    }
  );
}

export function listConversationRuns(conversationId: string) {
  return fetchJson<{ runs: CopilotRun[]; activeRun: CopilotRun | null }>(
    `/api/v1/copilot/conversations/${encodeURIComponent(conversationId)}/runs`
  );
}

/** Revoke the repair authorization chain of a run; later repair attempts are rejected. */
export function revokeRunRepairs(runId: string) {
  return fetchJson<{ revoked: boolean }>(`/api/v1/copilot/runs/${encodeURIComponent(runId)}/repairs`, { method: "DELETE" });
}

export function getRun(runId: string) {
  return fetchJson<{ run: CopilotRun; pendingActions: CopilotPendingAction[]; provisionalText?: import("@/lib/copilot-text-stream").CopilotProvisionalText }>(
    `/api/v1/copilot/runs/${encodeURIComponent(runId)}`
  );
}

export function cancelRun(runId: string) {
  return fetchJson<{ cancelled: boolean; runId: string }>(
    `/api/v1/copilot/runs/${encodeURIComponent(runId)}/cancel`,
    { method: "POST" }
  );
}

export function decidePendingAction(runId: string, actionId: string, approved: boolean) {
  return fetchJson<{ resumed: boolean; runId: string }>(
    `/api/v1/copilot/runs/${encodeURIComponent(runId)}/pending-actions/${encodeURIComponent(actionId)}/decide`,
    { method: "POST", body: JSON.stringify({ approved }) }
  );
}

export interface ListMemoryParams {
  scope?: "global" | "project" | "session";
  projectId?: string;
  limit?: number;
}

export function listMemoryEntries(params: ListMemoryParams = {}) {
  const search = new URLSearchParams();
  if (params.scope) search.set("scope", params.scope);
  if (params.projectId) search.set("projectId", params.projectId);
  if (params.limit) search.set("limit", String(params.limit));
  return fetchJson<{ entries: CopilotMemoryEntry[] }>(
    `/api/v1/copilot/memory/entries?${search.toString()}`
  );
}

export function writeMemoryEntry(input: {
  kind: CopilotMemoryEntry["kind"];
  scope: CopilotMemoryEntry["scope"];
  text: string;
  projectId?: string;
  metadata?: Record<string, unknown>;
}) {
  return fetchJson<{ entry: CopilotMemoryEntry }>("/api/v1/copilot/memory/entries", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function searchMemory(query: string, params: Omit<ListMemoryParams, "limit"> = {}) {
  const search = new URLSearchParams({ q: query });
  if (params.scope) search.set("scope", params.scope);
  if (params.projectId) search.set("projectId", params.projectId);
  return fetchJson<{ entries: CopilotMemoryEntry[] }>(
    `/api/v1/copilot/memory/search?${search.toString()}`
  );
}

export function deleteMemoryEntry(id: string) {
  return fetchJson<{ deleted: boolean }>(
    `/api/v1/copilot/memory/entries/${encodeURIComponent(id)}`,
    { method: "DELETE" }
  );
}

export function editMessage(conversationId: string, messageId: string, content: string, options?: CopilotMessageOptions & { modelId?: string; toolDiscovery?: boolean }) {
  return fetchJson<{ runId: string }>(
    `/api/v1/copilot/conversations/${encodeURIComponent(conversationId)}/edit-message`,
    { method: "POST", body: JSON.stringify({ messageId, content, ...options }) }
  );
}

export function getCopilotCapabilities() {
  return fetchJson<{ tools: CopilotToolInfo[] }>("/api/v1/copilot/capabilities");
}

export type CopilotThinkingEffort = "off" | "low" | "medium" | "high";

export interface CopilotPreferences {
  /** Preferred model profile id; null follows the platform default. */
  modelId: string | null;
  thinkingEffort: CopilotThinkingEffort;
}

export function getCopilotPreferences() {
  return fetchJson<CopilotPreferences>("/api/v1/copilot/preferences");
}

export function updateCopilotPreferences(patch: {
  modelId?: string | null;
  thinkingEffort?: CopilotThinkingEffort;
}) {
  return fetchJson<CopilotPreferences>("/api/v1/copilot/preferences", {
    method: "PUT",
    body: JSON.stringify(patch),
  });
}

/** Toggle one Copilot tool for the current user (owner switch). */
export function setCopilotToolEnabled(toolName: string, enabled: boolean) {
  return fetchJson<{ toolName: string; enabled: boolean }>(
    `/api/v1/copilot/capabilities/${encodeURIComponent(toolName)}/enabled`,
    { method: "PUT", body: JSON.stringify({ enabled }) }
  );
}

export async function ensureConversationExists(conversationId: string | undefined): Promise<string> {
  if (conversationId) return conversationId;
  const { conversation } = await createConversation();
  return conversation.id;
}

export type CopilotAutomationStatus = "draft" | "enabled" | "paused";
export type CopilotAutomationRunStatus = "pending" | "claimed" | "running" | "completed" | "failed" | "cancelled";

export interface CopilotAutomation {
  id: string;
  name: string;
  status: CopilotAutomationStatus;
  scopeType: "global" | "project";
  scopePolicy: string;
  prompt: string;
  scheduleKind: "cron" | "interval" | "once";
  scheduleExpression: string;
  timezone: string;
  deliveryPlan: string;
  authoritySnapshot: string;
  nextRunAt: string | null;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CopilotAutomationRun {
  id: string;
  automationId: string;
  triggerKind: "schedule" | "manual";
  status: CopilotAutomationRunStatus;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface CopilotAutomationSuggestion {
  id: string;
  source: string;
  /** Stable catalog key (e.g. catalog:daily-briefing); map via automations-copy. */
  dedupKey: string;
  status: "pending" | "accepted" | "dismissed";
  jobSpec: string;
}

export interface CreateAutomationInput {
  name: string;
  scopeType: "global" | "project";
  scopePolicy?: Record<string, unknown>;
  prompt: string;
  scheduleKind: "cron" | "interval" | "once";
  scheduleExpression: string;
  timezone?: string;
  delivery?: { notify: boolean; conversation: boolean };
}

export function listAutomations() {
  return fetchJson<{ automations: CopilotAutomation[] }>("/api/v1/copilot/automations");
}

export function createAutomation(input: CreateAutomationInput) {
  return fetchJson<{ automation: CopilotAutomation }>("/api/v1/copilot/automations", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function deleteAutomation(automationId: string) {
  return fetchJson<{ deleted: boolean }>(
    `/api/v1/copilot/automations/${encodeURIComponent(automationId)}`,
    { method: "DELETE" }
  );
}

export function pauseAutomation(automationId: string) {
  return fetchJson<{ automation: CopilotAutomation }>(
    `/api/v1/copilot/automations/${encodeURIComponent(automationId)}/pause`,
    { method: "POST" }
  );
}

export function enableAutomation(automationId: string) {
  return fetchJson<{ automation: CopilotAutomation }>(
    `/api/v1/copilot/automations/${encodeURIComponent(automationId)}/enable`,
    { method: "POST" }
  );
}

export function runAutomationNow(automationId: string) {
  return fetchJson<{ runId: string }>(
    `/api/v1/copilot/automations/${encodeURIComponent(automationId)}/run`,
    { method: "POST" }
  );
}

export function listAutomationRuns(automationId: string) {
  return fetchJson<{ runs: CopilotAutomationRun[] }>(
    `/api/v1/copilot/automations/${encodeURIComponent(automationId)}/runs`
  );
}

export function listAutomationSuggestions() {
  return fetchJson<{ suggestions: CopilotAutomationSuggestion[] }>("/api/v1/copilot/automations/suggestions");
}

export function acceptAutomationSuggestion(suggestionId: string) {
  return fetchJson<{ automation: CopilotAutomation }>(
    `/api/v1/copilot/automations/suggestions/${encodeURIComponent(suggestionId)}/accept`,
    { method: "POST" }
  );
}

export function dismissAutomationSuggestion(suggestionId: string) {
  return fetchJson<{ dismissed: boolean }>(
    `/api/v1/copilot/automations/suggestions/${encodeURIComponent(suggestionId)}/dismiss`,
    { method: "POST" }
  );
}

// Re-export the envelope helper for tests that assert on the HTTP envelope.
export { fetchEnvelope };

export interface CopilotFollowup { id: string; status: string; runId: string | null; content: string; error: string | null; createdAt: number; }
export function listFollowups(conversationId: string) {
  return fetchJson<{ followups: CopilotFollowup[] }>(`/api/v1/copilot/conversations/${encodeURIComponent(conversationId)}/followups`);
}
export function queueFollowup(conversationId: string, content: string, options: CopilotMessageOptions & { clientRequestId: string; modelId?: string }) {
  return fetchJson<{ followup: { id: string; status: string; runId: string | null } }>(`/api/v1/copilot/conversations/${encodeURIComponent(conversationId)}/followups`, {
    method: 'POST', body: JSON.stringify({ content, ...options }),
  });
}
export function cancelFollowup(id: string) {
  return fetchJson<{ cancelled: boolean }>(`/api/v1/copilot/followups/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

// ---------------------------------------------------------------------------
// Copilot Goal mode: long-running, budget-bounded objectives executed as a
// sequence of verifiable tasks. Contract: POST/GET /api/v1/copilot/goals*.
// ---------------------------------------------------------------------------

export type CopilotGoalStatus =
  | "active"
  | "paused"
  | "completed"
  | "blocked"
  | "cancelled";

export type CopilotGoalTaskStatus =
  | "pending"
  | "in_progress"
  | "passes"
  | "failed"
  /** Set only by the owner cancelling the linked board work item. */
  | "cancelled";

export interface CopilotGoalBudgets {
  tokenBudget?: number;
  maxDurationMs?: number;
  maxRuns?: number;
}

/** One-time authority grants a goal holds for its whole run; granted
 * categories skip per-action owner approval while the goal is active. */
export type CopilotGoalGrant = "operate_sessions" | "terminal_run" | "pm_dispatch" | "sandbox_checks";

export const COPILOT_GOAL_GRANTS: CopilotGoalGrant[] = [
  "operate_sessions",
  "terminal_run",
  "pm_dispatch",
  "sandbox_checks",
];

export interface CopilotGoal {
  id: string;
  conversationId: string;
  projectId?: string | null;
  title: string;
  spec: string;
  status: CopilotGoalStatus;
  tokenBudget?: number | null;
  maxDurationMs?: number | null;
  maxRuns?: number | null;
  blockedReason?: string | null;
  grants: CopilotGoalGrant[];
  /** Where goal edits live until the owner merges; null before the first write or dispatch. */
  workspace?: CopilotGoalWorkspace | null;
  /** Epoch milliseconds (Date.now() on the server), not an ISO string. */
  createdAt: number;
  updatedAt: number;
  completedAt?: number | null;
}

export interface CopilotGoalWorkspace {
  kind: "copy" | "worktree";
  /** Worktree only: the goal branch, its merge base, and the project branch it merges into. */
  branch?: string | null;
  baseCommit?: string | null;
  targetBranch?: string | null;
}

/** CLI turn state of a dispatched task; `running` holds the goal until the CLI reports. */
export type CopilotGoalDispatchStatus = "running" | "completed" | "failed" | "ended";

export interface CopilotGoalTask {
  id: string;
  goalId: string;
  seq: number;
  description: string;
  status: CopilotGoalTaskStatus;
  evidence?: string | null;
  /** Machine verification command; null when the task has no verify step. */
  verifyCommand?: string | null;
  /** Epoch ms of the last verification run; paired with verifyExitCode. */
  verifiedAt?: number | null;
  /** Exit code of the last verification run; 0 means machine-verified. */
  verifyExitCode?: number | null;
  /** CLI session this task was dispatched to, if any. */
  dispatchedSessionId?: string | null;
  dispatchStatus?: CopilotGoalDispatchStatus | null;
  /** Linked project board work item (personal projects) and its board status. */
  workItemId?: string | null;
  boardStatus?: string | null;
  /** Epoch milliseconds. */
  createdAt: number;
  /** Epoch milliseconds. */
  updatedAt: number;
}

export interface CopilotGoalJournalEntry {
  id: string;
  goalId: string;
  runId?: string | null;
  note: string;
  /** Epoch milliseconds. */
  createdAt: number;
}

export interface CopilotGoalUsage {
  chargedTokens: number;
  runCount: number;
  elapsedMs: number;
  /** Estimated cost in USD; null when no rate data is available. */
  costUsd?: number | null;
}

export interface CopilotGoalListItem {
  id: string;
  title: string;
  status: CopilotGoalStatus;
  projectId?: string | null;
  conversationId: string;
  grants: CopilotGoalGrant[];
  /** Epoch milliseconds. */
  createdAt: number;
  taskTotal: number;
  taskPasses: number;
}

export function createGoal(input: {
  conversationId: string;
  projectId?: string;
  title: string;
  spec: string;
  budgets?: CopilotGoalBudgets;
  grants?: CopilotGoalGrant[];
}) {
  return fetchJson<{ goalId: string; runId: string }>("/api/v1/copilot/goals", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function listGoals(conversationId?: string) {
  const search = conversationId
    ? `?conversationId=${encodeURIComponent(conversationId)}`
    : "";
  return fetchJson<{ goals: CopilotGoalListItem[] }>(
    `/api/v1/copilot/goals${search}`
  );
}

export function getGoal(id: string) {
  return fetchJson<{
    goal: CopilotGoal;
    tasks: CopilotGoalTask[];
    journal: CopilotGoalJournalEntry[];
    usage: CopilotGoalUsage;
    /** Agent question awaiting a user answer; non-null only while blockedReason === "awaiting_user". */
    pendingQuestion: string | null;
  }>(`/api/v1/copilot/goals/${encodeURIComponent(id)}`);
}

/** Answer a pending agent question; the server rejects (409) unless the goal awaits the user. */
export function answerGoal(id: string, answer: string) {
  return fetchJson<{ goal: CopilotGoal }>(
    `/api/v1/copilot/goals/${encodeURIComponent(id)}/answer`,
    { method: "POST", body: JSON.stringify({ answer }) }
  );
}

export interface CopilotGoalDiffFile {
  path: string;
  status: "added" | "modified" | "deleted";
  diff: string;
  truncated: boolean;
}

/** Sandbox diff for the goal's changes; files is empty when no sandbox exists.
 * Top-level truncated mirrors the 512 KiB server cap. */
export function getGoalDiff(id: string) {
  return fetchJson<{ files: CopilotGoalDiffFile[]; truncated: boolean }>(
    `/api/v1/copilot/goals/${encodeURIComponent(id)}/diff`
  );
}

/** Merge the goal's sandbox changes back into the project root. 409 while a
 * goal run is active or without a sandbox. */
export function mergeGoal(id: string) {
  return fetchJson<{ merged: string[]; deleted: string[]; kept: string[]; commit?: string }>(
    `/api/v1/copilot/goals/${encodeURIComponent(id)}/merge`,
    { method: "POST" }
  );
}

export function pauseGoal(id: string) {
  return fetchJson<{ goal: CopilotGoal }>(
    `/api/v1/copilot/goals/${encodeURIComponent(id)}/pause`,
    { method: "POST" }
  );
}

export function resumeGoal(id: string) {
  return fetchJson<{ goal: CopilotGoal }>(
    `/api/v1/copilot/goals/${encodeURIComponent(id)}/resume`,
    { method: "POST" }
  );
}

export function cancelGoal(id: string) {
  return fetchJson<{ goal: CopilotGoal }>(
    `/api/v1/copilot/goals/${encodeURIComponent(id)}/cancel`,
    { method: "POST" }
  );
}

// ---------------------------------------------------------------------------
// Copilot slash commands: the palette above the chat composer. Names carry no
// leading slash; the server list is the source of truth (never hardcode).
// ---------------------------------------------------------------------------

export type CopilotCommandCategory = "goal" | "session" | "model" | "info";

export interface CopilotCommandInfo {
  /** Command name without the leading slash (e.g. "goal"). */
  name: string;
  /** Usage line with the slash and placeholders (e.g. "/goal <描述>"). */
  usage: string;
  /** English fallback description; the UI overrides it with localized copy. */
  description: string;
  category: CopilotCommandCategory;
}

export function listCopilotCommands() {
  return fetchJson<{ commands: CopilotCommandInfo[] }>("/api/v1/copilot/commands");
}
