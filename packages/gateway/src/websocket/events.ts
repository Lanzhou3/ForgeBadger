import type { Server } from "node:http";
import { WebSocket, WebSocketServer } from "ws";

import { verifyJwt } from "../auth/jwt.js";
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
      const claims = verifyJwt(token, options.jwtSecret);
      userId = claims.userId;
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
        hook_event_name: event.hookEventName,
        notification_type: event.notificationType,
        message: event.message,
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
  if (event.type === "activity_created" || !event.notificationId) {
    return {};
  }
  return {
    notification_id: event.notificationId,
    created_at: event.notificationCreatedAt?.toISOString(),
    read: false
  };
}
