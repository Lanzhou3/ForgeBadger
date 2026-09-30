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
  nativeSessionId?: string | undefined;
  nativeTurnId?: string | undefined;
  nativeSubagent?: boolean | undefined;
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
  textStepId?: string;
  textFence?: number;
  textSequence?: number;
  thinkingDelta?: string | undefined;
  toolName?: string | undefined;
  pendingActionId?: string | undefined;
  message?: string | undefined;
  titleUpdated?: string | undefined;
  revision?: number;
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

/**
 * Persistent notification for a user-initiated app action (apply-provider,
 * provider model sync). `message` is human-readable detail and must never
 * contain credential material.
 */
export interface AppActionNotificationEvent {
  type: "app_action_notification";
  userId: string;
  action: "apply_provider" | "model_sync";
  status: "success" | "error";
  titleKey: string;
  message: string;
  adapter?: string | undefined;
  providerId?: string | undefined;
  providerName?: string | undefined;
  notificationId?: string | undefined;
  notificationCreatedAt?: Date | undefined;
}

export interface CopilotDevelopmentUpdatedEvent { type:"copilot_development_updated";userId:string;taskId:string;status:string;revision:number;eventId:string; }

/**
 * Redacted progress stream for a long-running terminal command executed by
 * Copilot (terminal_run). `outputTail` is a redacted, length-capped tail of
 * the command output — never raw scrollback. Emitted ~every 2s while the
 * command runs and once more with a terminal status.
 */
export interface TerminalCommandProgressEvent {
  type: "terminal_command_progress";
  userId: string;
  projectId: string;
  sessionId?: string | undefined;
  conversationId?: string | undefined;
  runId?: string | undefined;
  stepId?: string | undefined;
  commandPreview: string;
  outputTail: string;
  status: "running" | "completed" | "timed_out" | "user_took_over" | "error";
  occurredAt: Date;
  notificationId?: string | undefined;
  notificationCreatedAt?: Date | undefined;
}

export type ForgeBadgerEvent =
  | CopilotDevelopmentUpdatedEvent
  | SessionStatusChangedEvent
  | SessionCreatedEvent
  | SessionDeletedEvent
  | ClaudeNotificationEvent
  | AppActionNotificationEvent
  | ActivityCreatedEvent
  | CopilotRunUpdatedEvent
  | TerminalCommandProgressEvent
  | ErrorEvent;

export class ForgeBadgerEventBus extends EventEmitter {
  emitEvent(event: ForgeBadgerEvent): void {
    this.emit("event", event);
  }
}
