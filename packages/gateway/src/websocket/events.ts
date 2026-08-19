import type { Server } from "node:http";
import { WebSocket, WebSocketServer } from "ws";

import { resolveTokenUserId } from "../auth/resolve-token.js";
import type { Database } from "../db/types.js";
import type { OpenForgeEventBus, OpenForgeEvent } from "../services/event-bus.js";
import { extractWsAuthToken } from "./auth.js";
import { WebSocketConnectionLimits } from "./connection-limits.js";

const EVENTS_HEARTBEAT_INTERVAL_MS = 30_000;
const EVENTS_HEARTBEAT_TIMEOUT_MS = 90_000;
const DEFAULT_EVENTS_WS_MAX_CONNECTIONS = 300;
const DEFAULT_EVENTS_WS_MAX_CONNECTIONS_PER_USER = 10;
const EVENTS_WS_AUTH_PROTOCOL = "openforge-events";

export interface EventsWebSocketOptions {
  server: Server;
  eventBus: OpenForgeEventBus;
  jwtSecret: string;
  db: Database;
  maxConnections?: number;
  maxConnectionsPerUser?: number;
}

interface EventsClient {
  ws: WebSocket;
  userId: string;
  lastPongAt: number;
}

export function attachEventsWebSocket(options: EventsWebSocketOptions): void {
  const wss = new WebSocketServer({
    noServer: true
  });
  const limits = new WebSocketConnectionLimits<WebSocket>({
    maxGlobalConnections: options.maxConnections ?? DEFAULT_EVENTS_WS_MAX_CONNECTIONS,
    maxConnectionsPerUser:
      options.maxConnectionsPerUser ?? DEFAULT_EVENTS_WS_MAX_CONNECTIONS_PER_USER
  });
  const clients = new Map<WebSocket, EventsClient>();

  options.server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "", "http://localhost");
    if (url.pathname !== "/ws/events") {
      return;
    }

    const token = extractWsAuthToken(request.headers, EVENTS_WS_AUTH_PROTOCOL);
    if (!token) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    let userId: string;
    try {
      const resolved = resolveTokenUserId(options.db, token, options.jwtSecret);
      if (!resolved) {
        throw new Error("unauthorized");
      }
      userId = resolved;
    } catch {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      const acquire = limits.tryAcquire(ws, userId);
      if (!acquire.accepted) {
        ws.close(1008, `WebSocket connection limit exceeded: ${acquire.reason}`);
        return;
      }

      const client: EventsClient = {
        ws,
        userId,
        lastPongAt: Date.now()
      };
      clients.set(ws, client);

      ws.on("close", () => {
        clients.delete(ws);
        limits.release(ws);
      });

      ws.on("error", () => {
        clients.delete(ws);
        limits.release(ws);
      });

      ws.on("pong", () => {
        client.lastPongAt = Date.now();
      });
    });
  });

  const heartbeatInterval = setInterval(() => {
    const now = Date.now();
    for (const [ws, client] of clients) {
      if (ws.readyState !== WebSocket.OPEN) {
        clients.delete(ws);
        continue;
      }
      if (now - client.lastPongAt > EVENTS_HEARTBEAT_TIMEOUT_MS) {
        ws.close(4001, "heartbeat timeout");
        clients.delete(ws);
        limits.release(ws);
        continue;
      }
      ws.ping();
    }
  }, EVENTS_HEARTBEAT_INTERVAL_MS);
  heartbeatInterval.unref?.();

  // Clean up interval when server closes
  options.server.on("close", () => {
    clearInterval(heartbeatInterval);
  });

  options.eventBus.on("event", (event: OpenForgeEvent) => {
    const payload = JSON.stringify({ type: event.type, payload: buildPayload(event) });
    for (const [ws, client] of clients) {
      if (ws.readyState === WebSocket.OPEN && client.userId === event.userId) {
        ws.send(payload);
      }
    }
  });
}

function buildPayload(event: OpenForgeEvent): Record<string, unknown> {
  const notificationMeta = buildNotificationMeta(event);
  switch (event.type) {
    case "session_status_changed":
      return {
        session_id: event.sessionId,
        old_status: event.oldStatus,
        new_status: event.newStatus,
        ...notificationMeta
      };
    case "session_created":
      return {
        session_id: event.sessionId,
        project_id: event.projectId,
        name: event.name,
        ...notificationMeta
      };
    case "session_deleted":
      return {
        session_id: event.sessionId,
        ...notificationMeta
      };
    case "claude_notification":
      return {
        session_id: event.sessionId,
        ...(event.projectId ? { project_id: event.projectId } : {}),
        ...(event.projectName ? { project_name: event.projectName } : {}),
        ...(event.sessionName ? { session_name: event.sessionName } : {}),
        hook_event_name: event.hookEventName,
        notification_type: event.notificationType,
        message: event.message,
        adapter: event.adapter ?? "claude",
        ...(event.title ? { title: event.title } : {}),
        ...(event.toolName ? { tool_name: event.toolName } : {}),
        ...notificationMeta
      };
    case "activity_created":
      return {
        activity_id: event.activityId,
        ...(event.sessionId ? { session_id: event.sessionId } : {}),
        ...(event.projectId ? { project_id: event.projectId } : {}),
        activity_type: event.activityType,
        status: event.status,
        message: event.message,
        created_at: event.createdAt.toISOString()
      };
    case "portfolio_projection_updated":
      // Portfolio publishes only this projection allowlist; raw requests,
      // terminal content, credentials, and worker material never reach ws.
      return {
        kind: event.kind,
        record_id: event.recordId,
        ...(event.projectId ? { project_id: event.projectId } : {}),
        ...(event.state ? { state: event.state } : {}),
        ...(event.projectionVersion !== undefined ? { projection_version: event.projectionVersion } : {}),
        ...(event.correlationId ? { correlation_id: event.correlationId } : {}),
        ...(event.summary ? { summary: event.summary } : {}),
        occurred_at: event.occurredAt.toISOString()
      };
    case "copilot_run_updated":
      return {
        run_id: event.runId,
        conversation_id: event.conversationId,
        status: event.status,
        ...(event.source !== undefined ? { source: event.source } : {}),
        ...(event.textDelta !== undefined ? { text_delta: event.textDelta } : {}),
        ...(event.thinkingDelta !== undefined ? { thinking_delta: event.thinkingDelta } : {}),
        ...(event.toolName ? { tool_name: event.toolName } : {}),
        ...(event.pendingActionId ? { pending_action_id: event.pendingActionId } : {}),
        ...(event.message !== undefined ? { message: event.message } : {}),
        ...(event.titleUpdated !== undefined ? { title_updated: event.titleUpdated } : {})
      };
    case "error":
      return {
        message: event.message,
        recoverable: event.recoverable
      };
    default:
      return {};
  }
}

function buildNotificationMeta(event: OpenForgeEvent): Record<string, unknown> {
  if (event.type === "activity_created" || event.type === "portfolio_projection_updated" || event.type === "copilot_run_updated" || !event.notificationId) {
    return {};
  }
  return {
    notification_id: event.notificationId,
    created_at: event.notificationCreatedAt?.toISOString(),
    read: false
  };
}
