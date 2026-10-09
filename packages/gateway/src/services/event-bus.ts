import { EventEmitter } from "node:events";

export interface SessionWorkState {
  sessionId: string;
  state: "working" | "idle" | "unknown";
  updatedAt: number;
}

export interface SessionWorkStateChangedEvent extends SessionWorkState {
  type: "session_work_state_changed";
  userId: string;
}

interface TrackedSessionWork extends SessionWorkStateChangedEvent {
  nativeSessionId?: string | undefined;
  nativeTurnId?: string | undefined;
}

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

export interface SessionNotificationEvent {
  cliSummary?: import('./notifications/cli-observation.js').CliSummary | undefined;
  type: "session_notification";
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
  | SessionWorkStateChangedEvent
  | CopilotDevelopmentUpdatedEvent
  | SessionStatusChangedEvent
  | SessionCreatedEvent
  | SessionDeletedEvent
  | SessionNotificationEvent
  | AppActionNotificationEvent
  | ActivityCreatedEvent
  | CopilotRunUpdatedEvent
  | TerminalCommandProgressEvent
  | ErrorEvent;

export class ForgeBadgerEventBus extends EventEmitter {
  private readonly sessionWork = new Map<string, TrackedSessionWork>();

  getSessionWorkState(userId: string, sessionId: string): SessionWorkState | undefined {
    const work = this.sessionWork.get(sessionId);
    return work?.userId === userId
      ? { sessionId, state: work.state, updatedAt: work.updatedAt }
      : undefined;
  }

  setSessionWorkState(input: Omit<TrackedSessionWork, "type" | "updatedAt">): void {
    const previous = this.sessionWork.get(input.sessionId);
    // A late completion from an older native turn must not stop a new task.
    if (input.state === "idle" && previous?.state === "working" && (
      (input.nativeSessionId && previous.nativeSessionId && input.nativeSessionId !== previous.nativeSessionId)
      || (input.nativeTurnId && previous.nativeTurnId && input.nativeTurnId !== previous.nativeTurnId)
    )) return;
    const updatedAt = Math.max(Date.now(), (previous?.updatedAt ?? 0) + 1);
    const work: TrackedSessionWork = { ...input, type: "session_work_state_changed", updatedAt };
    this.sessionWork.set(input.sessionId, work);
    this.emit("event", {
      type: work.type, userId: work.userId, sessionId: work.sessionId,
      state: work.state, updatedAt,
    } satisfies SessionWorkStateChangedEvent);
  }

  emitEvent(event: ForgeBadgerEvent): void {
    this.emit("event", event);
    if (event.type === "session_deleted") this.sessionWork.delete(event.sessionId);
    if (event.type === "session_status_changed") {
      if (event.newStatus !== "running") {
        this.setSessionWorkState({ userId: event.userId, sessionId: event.sessionId, state: "idle" });
      } else if (event.oldStatus !== "running") {
        this.sessionWork.delete(event.sessionId);
      }
    }
    if (event.type === "session_notification" && !event.nativeSubagent
      && ["task_completed", "task_failed", "task_interrupted", "session_ended"].includes(event.notificationType)) {
      this.setSessionWorkState({
        userId: event.userId, sessionId: event.sessionId, state: "idle",
        nativeSessionId: event.nativeSessionId, nativeTurnId: event.nativeTurnId,
      });
    }
  }
}
