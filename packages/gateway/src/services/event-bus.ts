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

/** A redacted Copilot run update for the authenticated user's event stream. */
export interface CopilotRunUpdatedEvent {
  type: "copilot_run_updated";
  userId: string;
  runId: string;
  conversationId: string;
  status: string;
  source?: "user" | "reactive" | "scheduled" | undefined;
  textDelta?: string | undefined;
  thinkingDelta?: string | undefined;
  toolName?: string | undefined;
  pendingActionId?: string | undefined;
  message?: string | undefined;
  titleUpdated?: string | undefined;
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

export type ForgeBadgerEvent =
  | SessionStatusChangedEvent
  | SessionCreatedEvent
  | SessionDeletedEvent
  | ClaudeNotificationEvent
  | ActivityCreatedEvent
  | CopilotRunUpdatedEvent
  | ErrorEvent;

export class ForgeBadgerEventBus extends EventEmitter {
  emitEvent(event: ForgeBadgerEvent): void {
    this.emit("event", event);
  }
}
