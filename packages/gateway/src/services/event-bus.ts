import { EventEmitter } from "node:events";

export interface SessionStatusChangedEvent {
  type: "session_status_changed";
  userId: string;
  sessionId: string;
  oldStatus: string;
  newStatus: string;
  notificationId?: string | undefined;
  notificationCreatedAt?: Date | undefined;
}

export interface SessionCreatedEvent {
  type: "session_created";
  userId: string;
  sessionId: string;
  projectId: string;
  name: string;
  notificationId?: string | undefined;
  notificationCreatedAt?: Date | undefined;
}

export interface SessionDeletedEvent {
  type: "session_deleted";
  userId: string;
  sessionId: string;
  notificationId?: string | undefined;
  notificationCreatedAt?: Date | undefined;
}

export interface ClaudeNotificationEvent {
  type: "claude_notification";
  userId: string;
  sessionId: string;
  projectId?: string | undefined;
  projectName?: string | undefined;
  sessionName?: string | undefined;
  hookEventName: string;
  notificationType: string;
  message: string;
  adapter?: string | undefined;
  title?: string | undefined;
  toolName?: string | undefined;
  notificationId?: string | undefined;
  notificationCreatedAt?: Date | undefined;
}

export interface ActivityCreatedEvent {
  type: "activity_created";
  userId: string;
  activityId: string;
  sessionId?: string | undefined;
  projectId?: string | undefined;
  activityType: string;
  status: string;
  message: string;
  createdAt: Date;
}

/** A redacted, ordered Portfolio projection suitable for user-facing push. */
export interface PortfolioProjectionUpdatedEvent {
  type: "portfolio_projection_updated";
  userId: string;
  kind: "request" | "intake_decision" | "dossier" | "work_item" | "task_attempt" | "authorization" | "observation" | "risk" | "wakeup" | "heartbeat";
  recordId: string;
  projectId?: string | undefined;
  state?: string | undefined;
  projectionVersion?: number | undefined;
  correlationId?: string | undefined;
  summary?: string | undefined;
  occurredAt: Date;
}

export interface ErrorEvent {
  type: "error";
  userId: string;
  message: string;
  recoverable: boolean;
  notificationId?: string | undefined;
  notificationCreatedAt?: Date | undefined;
}

/** A redacted Copilot agent run update (streaming deltas + completion). */
export interface CopilotRunUpdatedEvent {
  type: "copilot_run_updated";
  userId: string;
  runId: string;
  conversationId: string;
  status: string;
  /** "user" = the owner typed a message; "reactive" = the proactive loop woke the agent. */
  source?: "user" | "reactive" | undefined;
  textDelta?: string | undefined;
  toolName?: string | undefined;
  pendingActionId?: string | undefined;
  message?: string | undefined;
  /** Set when the run triggered an auto-generated conversation title (first completed turn). */
  titleUpdated?: string | undefined;
  occurredAt: Date;
}

export type OpenForgeEvent =
  | SessionStatusChangedEvent
  | SessionCreatedEvent
  | SessionDeletedEvent
  | ClaudeNotificationEvent
  | ActivityCreatedEvent
  | PortfolioProjectionUpdatedEvent
  | CopilotRunUpdatedEvent
  | ErrorEvent;

export class OpenForgeEventBus extends EventEmitter {
  emitEvent(event: OpenForgeEvent): void {
    this.emit("event", event);
  }
}
