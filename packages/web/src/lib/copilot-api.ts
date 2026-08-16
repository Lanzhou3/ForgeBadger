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
  | "failed";

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
  sequence: number;
  createdAt: string;
}

export interface CopilotRun {
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

export function listMessages(conversationId: string) {
  return fetchJson<{ messages: CopilotMessage[] }>(
    `/api/v1/copilot/conversations/${encodeURIComponent(conversationId)}/messages`
  );
}

/** Run a turn; returns the run id. Streaming deltas arrive via /ws/events. */
export function sendMessage(conversationId: string, content: string, modelId?: string) {
  return fetchJson<{ runId: string }>(
    `/api/v1/copilot/conversations/${encodeURIComponent(conversationId)}/messages`,
    {
      method: "POST",
      body: JSON.stringify(modelId ? { content, modelId } : { content }),
    }
  );
}

export function getRun(runId: string) {
  return fetchJson<{ run: CopilotRun; pendingActions: CopilotPendingAction[] }>(
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

export function getCopilotCapabilities() {
  return fetchJson<{ tools: CopilotToolInfo[] }>("/api/v1/copilot/capabilities");
}

export async function ensureConversationExists(conversationId: string | undefined): Promise<string> {
  if (conversationId) return conversationId;
  const { conversation } = await createConversation();
  return conversation.id;
}

// Re-export the envelope helper for tests that assert on the HTTP envelope.
export { fetchEnvelope };
