/**
 * Core types for the Copilot agent harness.
 *
 * The harness is a self-hosted, conversation-centred runtime whose "tool
 * surface" is the entire OpenForge platform (projects, sessions, portfolio,
 * memory, ...). Design is inspired by deepseek-harness: the conversation log is
 * the single source of truth for model-visible history, and every platform
 * capability is exposed to the model as a registered tool.
 */

export type AgentRole = "user" | "assistant" | "tool";

export type AgentMessageKind =
  | "text"
  | "tool_call"
  | "tool_result"
  | "pending_action"
  | "error";

export type AgentToolRisk = "read" | "operate";

export type AgentRunStatus =
  | "pending"
  | "running"
  | "awaiting_approval"
  | "completed"
  | "cancelled"
  | "failed";

/** A single message appended to the conversation log. */
export interface AgentMessage {
  id: string;
  conversationId: string;
  userId: string;
  role: AgentRole;
  kind: AgentMessageKind;
  content: string;
  toolName?: string;
  toolInputJson?: string;
  sequence: number;
  createdAt: Date;
}

/** A tool call the model requested. */
export interface AgentToolCall {
  id: string;
  name: string;
  input: unknown;
}

/** Result of executing one tool call. */
export interface AgentToolResult {
  toolCallId: string;
  name: string;
  ok: boolean;
  output: unknown;
  error?: string;
  requiresApproval: boolean;
}

/** Streamed events emitted while a run executes (drives /ws/events + UI). */
export type AgentRunEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_call"; toolCall: AgentToolCall }
  | { type: "tool_result"; result: AgentToolResult }
  | { type: "pending_action"; pendingAction: { id: string; tool: string } }
  | { type: "run_completed"; runId: string; status: AgentRunStatus };

/** A run (one user turn and its tool steps). */
export interface AgentRun {
  id: string;
  conversationId: string;
  userId: string;
  status: AgentRunStatus;
  provider?: string;
  model?: string;
  steps: number;
  error?: string;
  startedAt?: Date;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

/** A pending (approval-gated) operate action. */
export interface AgentPendingAction {
  id: string;
  runId: string;
  userId: string;
  tool: string;
  inputJson: string;
  inputDigest: string;
  status: "pending" | "approved" | "rejected" | "expired";
  createdAt: Date;
  decidedAt?: Date;
  updatedAt: Date;
}

/** A scoped memory entry (global | project | session). */
export interface AgentMemoryEntry {
  id: string;
  userId: string;
  scope: "global" | "project" | "session";
  projectId?: string | null;
  kind: "fact" | "preference" | "decision" | "project_note";
  text: string;
  metadataJson: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Errors surfaced to callers; carries a stable machine code. */
export class AgentError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "AgentError";
    this.code = code;
  }
}
