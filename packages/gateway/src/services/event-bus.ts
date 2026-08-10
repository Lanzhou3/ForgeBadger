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

export interface CopilotRunUpdatedEvent {
  type: "copilot_run_updated";
  userId: string;
  runId: string;
  status: string;
  source: string;
  sourceRefId?: string | undefined;
  conversationId?: string | undefined;
  eventType: "started" | "completed" | "failed" | "cancelled" | "waiting_for_approval" | "event_appended" | "assistant_delta";
  runEventType?: string | undefined;
  runEventSequence?: number | undefined;
  deltaText?: string | undefined;
  errorCode?: string | undefined;
}

export interface ErrorEvent {
  type: "error";
  userId: string;
  message: string;
  recoverable: boolean;
  notificationId?: string | undefined;
  notificationCreatedAt?: Date | undefined;
}

export type OpenForgeEvent =
  | SessionStatusChangedEvent
  | SessionCreatedEvent
  | SessionDeletedEvent
  | ClaudeNotificationEvent
  | ActivityCreatedEvent
  | CopilotRunUpdatedEvent
  | ErrorEvent;

export class OpenForgeEventBus extends EventEmitter {
  emitEvent(event: OpenForgeEvent): void {
    this.emit("event", event);
  }
}
