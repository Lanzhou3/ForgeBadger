/**
 * WebSocket terminal handler — connects browser xterm.js to the Session Server.
 *
 * In the custom session-server architecture, the browser connects to the
 * Gateway via WebSocket, and the Gateway relays I/O to the Session Server
 * via IPC. The actual pty process lives in the Session Server.
 *
 * This replaces the previous tmux/psmux-based approach where the Gateway
 * spawned a node-pty to attach to a multiplexer session.
 */
import type { Server } from "node:http";
import { WebSocket, WebSocketServer, type RawData } from "ws";

import { resolveTokenUserId } from "../auth/resolve-token.js";
import type { Database } from "../db/types.js";
import { SessionRepository } from "../db/repositories/session-repository.js";
import type { InMemorySessionManager } from "../services/session-manager.js";
import { RuntimeAuthorizationInvalidator } from "../services/runtime-authorization-invalidation.js";
import { SessionServerPty } from "../services/session-server-pty.js";
import {
  TerminalRuntimeAuthorizationRegistry,
  validateTerminalRuntimeAuthorization,
  type TerminalRuntimeAuthorizationLease
} from "./terminal-runtime-authorization.js";
import { extractWsAuthToken, extractWsAttachToken } from "./auth.js";
import { WebSocketConnectionLimits } from "./connection-limits.js";

const DEFAULT_MAX_MESSAGE_BYTES = 1024 * 1024;
const TERMINAL_INPUT_RATE_LIMIT = 50;
const TERMINAL_RATE_WINDOW_MS = 1000;
const TERMINAL_MOUSE_INPUT_RATE_LIMIT = 500;
const TERMINAL_HEARTBEAT_INTERVAL_MS = 30_000;
const TERMINAL_HEARTBEAT_TIMEOUT_MS = 90_000;
const DEFAULT_TERMINAL_WS_MAX_CONNECTIONS = 100;
const DEFAULT_TERMINAL_WS_MAX_CONNECTIONS_PER_USER = 5;
const TERMINAL_WS_AUTH_PROTOCOLS = ["forgebadger-terminal"] as const;

export function isTerminalMouseInput(data: string): boolean {
  return data.length > 0 && /^(?:\x1b\[<[0-9;]+[Mm])+$/.test(data);
}

export type TerminalMessage =
  | { type: "terminal_input"; payload: { data: string } }
  | { type: "terminal_resize"; payload: { cols: number; rows: number } };

export interface TerminalResizable {
  resize(cols: number, rows: number): void;
}

export interface TerminalWritable {
  write(data: string): void;
}

export class TerminalInputBuffer {
  private readonly pendingInput: string[] = [];

  constructor(private readonly assertWritable: () => void = () => {}) {}

  writeOrStore(pty: TerminalWritable | undefined, data: string): void {
    this.assertWritable();
    if (pty) {
      pty.write(data);
      return;
    }
    this.pendingInput.push(data);
  }

  flush(pty: TerminalWritable): void {
    const pending = this.pendingInput.splice(0);
    for (const data of pending) {
      this.assertWritable();
      pty.write(data);
    }
    this.pendingInput.length = 0;
  }

  hasPendingInput(): boolean {
    return this.pendingInput.length > 0;
  }

  clear(): void {
    this.pendingInput.length = 0;
  }
}

export class TerminalResizeBuffer {
  private latestSize: { cols: number; rows: number } | undefined;

  applyOrStore(pty: TerminalResizable | undefined, cols: number, rows: number): void {
    if (pty) {
      pty.resize(cols, rows);
      this.latestSize = undefined;
      return;
    }
    this.latestSize = { cols, rows };
  }

  flush(pty: TerminalResizable): void {
    if (!this.latestSize) return;
    pty.resize(this.latestSize.cols, this.latestSize.rows);
    this.latestSize = undefined;
  }
}

export interface ClosableSocket {
  close(code?: number, reason?: string): void;
}

export class TerminalConnectionRegistry {
  private readonly sockets = new Map<string, ClosableSocket>();

  register(sessionId: string, socket: ClosableSocket): void {
    const existing = this.sockets.get(sessionId);
    if (existing) existing.close(4000, "terminal connection replaced");
    this.sockets.set(sessionId, socket);
  }

  unregister(sessionId: string, socket: ClosableSocket): void {
    if (this.sockets.get(sessionId) === socket) {
      this.sockets.delete(sessionId);
    }
  }

  getSocket(sessionId: string): ClosableSocket | undefined {
    return this.sockets.get(sessionId);
  }
}

export function parseTerminalMessage(
  raw: string | Buffer | RawData,
  maxBytes = DEFAULT_MAX_MESSAGE_BYTES
): TerminalMessage {
  const text = rawToText(raw);
  if (Buffer.byteLength(text, "utf8") > maxBytes) {
    throw new Error("Terminal message too large");
  }

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("Malformed terminal message");
  }

  if (!isRecord(value) || typeof value.type !== "string" || !isRecord(value.payload)) {
    throw new Error("Malformed terminal message");
  }

  if (value.type === "terminal_input" && typeof value.payload.data === "string") {
    return { type: "terminal_input", payload: { data: value.payload.data } };
  }

  const cols = value.payload.cols;
  const rows = value.payload.rows;
  if (
    value.type === "terminal_resize" &&
    typeof cols === "number" &&
    typeof rows === "number" &&
    isTerminalSize(cols, rows)
  ) {
    return { type: "terminal_resize", payload: { cols, rows } };
  }

  throw new Error("Malformed terminal message");
}

export interface TerminalWebSocketOptions {
  server: Server;
  sessionManager: InMemorySessionManager;
  jwtSecret: string;
  db: Database;
  registry?: TerminalConnectionRegistry;
  maxConnections?: number;
  maxConnectionsPerUser?: number;
  /** IPC socket path for the Session Server. Required for the custom architecture. */
  sessionServerIpcPath?: string;
  /**
   * Explicit IPC handshake token for the I/O stream (test seam). When unset,
   * SessionServerPty reads the state-dir token file, which tracks daemon
   * token rotation.
   */
  sessionServerToken?: string;
  runtimeAuthorizationInvalidator: RuntimeAuthorizationInvalidator;
  runtimeAuthorizationRegistry?: TerminalRuntimeAuthorizationRegistry;
}

export function attachTerminalWebSocket(options: TerminalWebSocketOptions): void {
  const sessionServerIpcPath = options.sessionServerIpcPath;
  const registry = options.registry ?? new TerminalConnectionRegistry();
  const runtimeAuthorizationRegistry = options.runtimeAuthorizationRegistry
    ?? new TerminalRuntimeAuthorizationRegistry(options.runtimeAuthorizationInvalidator);
  const limits = new WebSocketConnectionLimits<WebSocket>({
    maxGlobalConnections: options.maxConnections ?? DEFAULT_TERMINAL_WS_MAX_CONNECTIONS,
    maxConnectionsPerUser: options.maxConnectionsPerUser ?? DEFAULT_TERMINAL_WS_MAX_CONNECTIONS_PER_USER
  });
  const wss = new WebSocketServer({ noServer: true });

  options.server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "", "http://localhost");
    const match = /^\/ws\/terminal\/([^/]+)$/.exec(url.pathname);
    if (!match) return;

    const rawSessionId = match[1] ?? "";
    if (!/^[0-9a-zA-Z-]+$/.test(rawSessionId)) {
      socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
      socket.destroy();
      return;
    }

    let sessionId: string;
    try {
      sessionId = decodeURIComponent(rawSessionId);
    } catch {
      socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
      socket.destroy();
      return;
    }

    const authToken = extractWsAuthToken(request.headers, TERMINAL_WS_AUTH_PROTOCOLS);
    if (!authToken) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    let userId: string;
    try {
      const resolved = resolveTokenUserId(options.db, authToken, options.jwtSecret);
      if (!resolved) throw new Error("unauthorized");
      userId = resolved;
    } catch {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    const dbSession = new SessionRepository(options.db, userId).getById(sessionId);
    if (!dbSession) {
      wss.handleUpgrade(request, socket, head, (ws) => ws.close(4404, "session not found"));
      return;
    }

    const attachToken = extractWsAttachToken(request.headers, TERMINAL_WS_AUTH_PROTOCOLS) ?? "";
    const terminalAccessRequest: TerminalAccessRequest = { authTokenUserId: userId, attachToken };
    const previousSocket = registry.getSocket(sessionId);

    wss.handleUpgrade(request, socket, head, (ws) => {
      const acquire = limits.tryAcquire(ws, userId);
      if (!acquire.accepted) {
        ws.close(1008, `WebSocket connection limit exceeded: ${acquire.reason}`);
        return;
      }
      if (previousSocket) {
        limits.release(previousSocket as unknown as WebSocket);
      }
      void handleTerminalSocket(
        ws,
        sessionId,
        terminalAccessRequest,
        options.sessionManager,
        registry,
        limits,
        sessionServerIpcPath,
        options.sessionServerToken,
        options.db,
        userId,
        dbSession.projectId,
        runtimeAuthorizationRegistry
      );
    });
  });
}

async function handleTerminalSocket(
  ws: WebSocket,
  sessionId: string,
  access: TerminalAccessRequest,
  sessionManager: InMemorySessionManager,
  registry: TerminalConnectionRegistry,
  limits: WebSocketConnectionLimits<WebSocket>,
  sessionServerIpcPath: string | undefined,
  sessionServerToken: string | undefined,
  db: Database,
  userId: string,
  projectId: string,
  runtimeAuthorizationRegistry: TerminalRuntimeAuthorizationRegistry
): Promise<void> {
  let pty: SessionServerPty | undefined;
  let ptyExited = false;
  const inputBuffer = new TerminalInputBuffer(() => sessionManager.assertManualInputAllowed(userId, sessionId));
  const resizeBuffer = new TerminalResizeBuffer();
  let heartbeatInterval: ReturnType<typeof setInterval> | undefined;
  let authorizationLease: TerminalRuntimeAuthorizationLease | undefined;

  const releaseResources = () => {
    authorizationLease?.dispose();
    limits.release(ws);
    registry.unregister(sessionId, ws);
    clearInterval(heartbeatInterval);
    if (pty) {
      pty.kill();
      pty = undefined;
    }
  };

  const revokeRuntime = () => {
    inputBuffer.clear();
    if (pty) {
      pty.kill();
      pty = undefined;
    }
    if (ws.readyState === WebSocket.OPEN) ws.close(4403, "session forbidden");
  };

  ws.on("close", () => { releaseResources(); });

  const session = sessionManager.getSession(sessionId);
  if (!session) {
    ws.close(4404, "session not found");
    return;
  }
  if (!authenticateTerminalRequest(session, access)) {
    ws.close(4403, "session forbidden");
    return;
  }

  authorizationLease = runtimeAuthorizationRegistry.open({
    userId,
    sessionId,
    projectId,
    revalidate: () => validateTerminalRuntimeAuthorization(db, userId, sessionId),
    onInvalidated: revokeRuntime
  });
  if (!authorizationLease.isAuthorized()) return;

  registry.register(sessionId, ws);

  const inputRateLimiter = new TerminalInputRateLimiter({ maxMessages: TERMINAL_INPUT_RATE_LIMIT, windowMs: TERMINAL_RATE_WINDOW_MS });
  const mouseRateLimiter = new TerminalInputRateLimiter({ maxMessages: TERMINAL_MOUSE_INPUT_RATE_LIMIT, windowMs: TERMINAL_RATE_WINDOW_MS });

  ws.on("message", (raw) => {
    if (!authorizationLease?.isAuthorized()) return;
    if (ptyExited) return;
    try {
      const message = parseTerminalMessage(raw);
      if (message.type === "terminal_input") {
        const isMouse = isTerminalMouseInput(message.payload.data);
        const allowed = isMouse ? mouseRateLimiter.consume() : inputRateLimiter.consume();
        if (!allowed) {
          ws.send(JSON.stringify({ type: "terminal_error", payload: { message: "terminal input rate limit exceeded" } }));
          return;
        }
        inputBuffer.writeOrStore(pty, message.payload.data);
        return;
      }
      resizeBuffer.applyOrStore(pty, message.payload.cols, message.payload.rows);
      void sessionManager.resizeSession(sessionId, message.payload.cols, message.payload.rows).catch((error) => {
        console.error(`[terminal-ws] resize-window failed for session ${sessionId}`, error);
      });
    } catch (error) {
      ws.send(JSON.stringify({ type: "terminal_error", payload: { message: formatTerminalClientError(error) } }));
    }
  });

  // Restore scrollback history before connecting to the Session Server.
  try {
    const history = await sessionManager.captureHistory(sessionId);
    if (!authorizationLease.isAuthorized()) return;
    if (ws.readyState !== WebSocket.OPEN) return;
    if (history) {
      ws.send(JSON.stringify({ type: "terminal_history", payload: { data: history } }));
    }
  } catch {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "terminal_error", payload: { message: "Terminal history restore failed" } }));
    }
  }

  // Connect to the Session Server via IPC
  if (!sessionServerIpcPath) {
    ws.send(JSON.stringify({ type: "terminal_error", payload: { message: "Session Server is not configured" } }));
    ws.close(1011, "session server not available");
    return;
  }

  try {
    if (!authorizationLease.isAuthorized()) return;
    // The session-server registry is keyed by the tmux-style name
    // (session-manager's buildTmuxName), not the raw database UUID —
    // SessionServerClient.createSession registers sessions under that name.
    // Using the raw UUID here would cause attach/input/resize to target a
    // session that doesn't exist, silently (the session-server responds with
    // an error message that SessionServerPty.handleMessage ignores).
    const serverPty = new SessionServerPty({
      ipcPath: sessionServerIpcPath,
      sessionId: session.tmuxName,
      ...(sessionServerToken !== undefined ? { token: sessionServerToken } : {})
    });
    await serverPty.connect();
    pty = serverPty;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`[terminal-ws] session server attach failed for session ${sessionId}: ${detail}`, error);
    ws.send(JSON.stringify({ type: "terminal_error", payload: { message: `Terminal attach failed: ${detail}` } }));
    ws.close(1011, "session server attach failed");
    return;
  }

  const activePty = pty;
  if (inputBuffer.hasPendingInput()) {
    try {
      inputBuffer.flush(activePty);
    } catch (error) {
      inputBuffer.clear();
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "terminal_error", payload: { message: formatTerminalClientError(error) } }));
      }
    }
  }
  resizeBuffer.flush(activePty);

  pty.onData((data) => {
    if (!authorizationLease?.isAuthorized()) return;
    sessionManager.appendSessionOutput(sessionId, data);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "terminal_output", payload: { data } }));
    }
  });

  pty.onExit(({ exitCode }) => {
    ptyExited = true;
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "terminal_exit", payload: { code: exitCode } }));
    }
    void sessionManager.reconcileSessionStatus(sessionId).catch((error) => {
      console.error(`[terminal-ws] reconcile failed for session ${sessionId}`, error);
    });
  });

  // Transport loss (daemon crash / IPC failure) is not a process exit:
  // close with 1011 so the browser reconnects, and leave status correction
  // to the periodic scan — which marks the session `lost` when the daemon
  // actually restarted. Never send terminal_exit here.
  pty.onTransportClose(() => {
    ptyExited = true;
    console.error(`[terminal-ws] session server transport lost for session ${sessionId}`);
    if (ws.readyState === WebSocket.OPEN) {
      ws.close(1011, "session server unreachable");
    }
  });

  const heartbeat = new TerminalHeartbeat({ timeoutMs: TERMINAL_HEARTBEAT_TIMEOUT_MS });
  ws.on("pong", () => { heartbeat.recordPong(); });
  heartbeatInterval = setInterval(() => {
    if (ws.readyState !== WebSocket.OPEN) return;
    if (heartbeat.isTimedOut()) { ws.close(4001, "heartbeat timeout"); return; }
    if (!authorizationLease?.isAuthorized()) return;
    ws.ping();
  }, TERMINAL_HEARTBEAT_INTERVAL_MS);
  heartbeatInterval.unref?.();

  ws.on("error", () => { releaseResources(); });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function formatTerminalClientError(error: unknown): string {
  if (error instanceof Error) {
    if (error.message === "SESSION_WRITER_BUSY") return "Copilot is writing to this workspace. Take over the active session before typing.";
    if (error.message === "Malformed terminal message" || error.message === "Terminal message too large") return error.message;
  }
  return "Terminal request failed";
}

interface TerminalAccessSession { userId: string; attachToken: string }
interface TerminalAccessRequest { authTokenUserId: string; attachToken: string }

export function validateTerminalAccess(session: TerminalAccessSession, request: { userId: string; attachToken: string }): boolean {
  return session.userId === request.userId && session.attachToken.length > 0 && request.attachToken.length > 0 && session.attachToken === request.attachToken;
}

export function authenticateTerminalRequest(session: TerminalAccessSession, request: TerminalAccessRequest): boolean {
  return validateTerminalAccess(session, { userId: request.authTokenUserId, attachToken: request.attachToken });
}

export class TerminalInputRateLimiter {
  private windowStartedAt = 0;
  private used = 0;
  constructor(private readonly options: { maxMessages: number; windowMs: number }) {}
  consume(now = Date.now()): boolean {
    if (now - this.windowStartedAt >= this.options.windowMs) { this.windowStartedAt = now; this.used = 0; }
    if (this.used >= this.options.maxMessages) return false;
    this.used += 1;
    return true;
  }
}

export class TerminalHeartbeat {
  private lastPongAt: number;
  constructor(private readonly options: { timeoutMs: number; now?: number }) { this.lastPongAt = options.now ?? Date.now(); }
  recordPong(now = Date.now()): void { this.lastPongAt = now; }
  isTimedOut(now = Date.now()): boolean { return now - this.lastPongAt > this.options.timeoutMs; }
}

function isTerminalSize(cols: number, rows: number): boolean {
  return Number.isInteger(cols) && Number.isInteger(rows) && cols > 0 && rows > 0 && cols <= 500 && rows <= 200;
}

function rawToText(raw: string | Buffer | RawData): string {
  if (typeof raw === "string") return raw;
  if (Buffer.isBuffer(raw)) return raw.toString("utf8");
  if (Array.isArray(raw)) return Buffer.concat(raw).toString("utf8");
  return Buffer.from(raw).toString("utf8");
}
