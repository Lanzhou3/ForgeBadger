import type { IPty } from "node-pty";
import type { Server } from "node:http";
import { WebSocket, WebSocketServer, type RawData } from "ws";

import { verifyJwt } from "../auth/index.js";
import type { InMemorySessionManager } from "../services/session-manager.js";
import { extractWsAuthToken } from "./auth.js";
import { WebSocketConnectionLimits } from "./connection-limits.js";

const DEFAULT_MAX_MESSAGE_BYTES = 1024 * 1024;
const TERMINAL_INPUT_RATE_LIMIT = 50;
const TERMINAL_RATE_WINDOW_MS = 1000;
const TERMINAL_HEARTBEAT_INTERVAL_MS = 30_000;
const TERMINAL_HEARTBEAT_TIMEOUT_MS = 90_000;
const DEFAULT_TERMINAL_WS_MAX_CONNECTIONS = 100;
const DEFAULT_TERMINAL_WS_MAX_CONNECTIONS_PER_USER = 5;
const TERMINAL_WS_AUTH_PROTOCOL = "openforge-terminal";

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

  writeOrStore(pty: TerminalWritable | undefined, data: string): void {
    if (pty) {
      pty.write(data);
      return;
    }
    this.pendingInput.push(data);
  }

  flush(pty: TerminalWritable): void {
    for (const data of this.pendingInput) {
      pty.write(data);
    }
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
    if (!this.latestSize) {
      return;
    }
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
    if (existing) {
      existing.close(4000, "terminal connection replaced");
    }
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
    return {
      type: "terminal_input",
      payload: { data: value.payload.data }
    };
  }

  const cols = value.payload.cols;
  const rows = value.payload.rows;
  if (
    value.type === "terminal_resize" &&
    typeof cols === "number" &&
    typeof rows === "number" &&
    isTerminalSize(cols, rows)
  ) {
    return {
      type: "terminal_resize",
      payload: {
        cols,
        rows
      }
    };
  }

  throw new Error("Malformed terminal message");
}

export interface TerminalWebSocketOptions {
  server: Server;
  sessionManager: InMemorySessionManager;
  jwtSecret: string;
  registry?: TerminalConnectionRegistry;
  maxConnections?: number;
  maxConnectionsPerUser?: number;
}

export function attachTerminalWebSocket(options: TerminalWebSocketOptions): void {
  const registry = options.registry ?? new TerminalConnectionRegistry();
  const limits = new WebSocketConnectionLimits<WebSocket>({
    maxGlobalConnections: options.maxConnections ?? DEFAULT_TERMINAL_WS_MAX_CONNECTIONS,
    maxConnectionsPerUser:
      options.maxConnectionsPerUser ?? DEFAULT_TERMINAL_WS_MAX_CONNECTIONS_PER_USER
  });
  const wss = new WebSocketServer({
    noServer: true
  });

  options.server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "", "http://localhost");
    const match = /^\/ws\/terminal\/([^/]+)$/.exec(url.pathname);
    if (!match) {
      return;
    }

    const sessionId = decodeURIComponent(match[1] ?? "");
    const authToken = extractWsAuthToken(request.headers, TERMINAL_WS_AUTH_PROTOCOL);
    if (!authToken) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    let userId: string;
    try {
      userId = verifyJwt(authToken, options.jwtSecret).userId;
    } catch {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    const attachToken = url.searchParams.get("attachToken") ?? "";
    const terminalAccessRequest: TerminalAccessRequest = {
      authTokenUserId: userId,
      attachToken
    };
    const sessionSocket = registry.getSocket(sessionId);
    if (sessionSocket) {
      limits.release(sessionSocket as unknown as WebSocket);
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      const acquire = limits.tryAcquire(ws, userId);
      if (!acquire.accepted) {
        ws.close(1008, `WebSocket connection limit exceeded: ${acquire.reason}`);
        return;
      }

      void handleTerminalSocket(
        ws,
        sessionId,
        terminalAccessRequest,
        options.sessionManager,
        registry,
        limits
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
  limits: WebSocketConnectionLimits<WebSocket>
): Promise<void> {
  let pty: IPty | undefined;
  const inputBuffer = new TerminalInputBuffer();
  const resizeBuffer = new TerminalResizeBuffer();
  let heartbeatInterval: ReturnType<typeof setInterval> | undefined;

  const releaseResources = () => {
    limits.release(ws);
    registry.unregister(sessionId, ws);
    clearInterval(heartbeatInterval);
    if (pty) {
      pty.kill();
      pty = undefined;
    }
  };

  ws.on("close", () => {
    releaseResources();
  });

  const session = sessionManager.getSession(sessionId);
  if (!session) {
    ws.close(4404, "session not found");
    return;
  }
  if (!authenticateTerminalRequest(session, access)) {
    ws.close(4403, "session forbidden");
    return;
  }

  registry.register(sessionId, ws);

  const inputRateLimiter = new TerminalInputRateLimiter({
    maxMessages: TERMINAL_INPUT_RATE_LIMIT,
    windowMs: TERMINAL_RATE_WINDOW_MS
  });

  ws.on("message", (raw) => {
    try {
      const message = parseTerminalMessage(raw);
      if (message.type === "terminal_input") {
        if (!inputRateLimiter.consume()) {
          ws.send(
            JSON.stringify({
              type: "terminal_error",
              payload: { message: "terminal input rate limit exceeded" }
            })
          );
          return;
        }
        inputBuffer.writeOrStore(pty, message.payload.data);
        return;
      }
      resizeBuffer.applyOrStore(pty, message.payload.cols, message.payload.rows);
      void sessionManager
        .resizeSession(sessionId, message.payload.cols, message.payload.rows)
        .catch(() => {});
    } catch (error) {
      ws.send(
        JSON.stringify({
          type: "terminal_error",
          payload: { message: formatTerminalClientError(error) }
        })
      );
    }
  });

  try {
    const { spawn } = await import("node-pty");
    pty = spawn("tmux", ["attach-session", "-t", session.tmuxName], {
      name: "xterm-256color",
      cwd: session.launchPlan.cwd,
      cols: 120,
      rows: 40,
      env: buildTmuxAttachEnv(process.env)
    });
  } catch (error) {
    ws.send(
      JSON.stringify({
        type: "terminal_error",
        payload: { message: "Terminal attach failed" }
      })
    );
    ws.close(1011, "pty attach failed");
    return;
  }
  const activePty = pty;
  inputBuffer.flush(activePty);
  resizeBuffer.flush(activePty);

  void sessionManager
    .captureHistory(sessionId)
    .then((history) => {
      if (history && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "terminal_output", payload: { data: history } }));
      }
    })
    .catch((error) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: "terminal_error",
            payload: {
              message: "Terminal history restore failed"
            }
          })
        );
      }
    });

  pty.onData((data) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "terminal_output", payload: { data } }));
    }
  });

  pty.onExit(({ exitCode }) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "terminal_exit", payload: { code: exitCode } }));
    }
  });

  const heartbeat = new TerminalHeartbeat({
    timeoutMs: TERMINAL_HEARTBEAT_TIMEOUT_MS
  });
  ws.on("pong", () => {
    heartbeat.recordPong();
  });
  heartbeatInterval = setInterval(() => {
    if (ws.readyState !== WebSocket.OPEN) {
      return;
    }
    if (heartbeat.isTimedOut()) {
      ws.close(4001, "heartbeat timeout");
      return;
    }
    ws.ping();
  }, TERMINAL_HEARTBEAT_INTERVAL_MS);

  ws.on("error", () => {
    releaseResources();
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function formatTerminalClientError(error: unknown): string {
  if (error instanceof Error) {
    if (error.message === "Malformed terminal message" || error.message === "Terminal message too large") {
      return error.message;
    }
  }
  return "Terminal request failed";
}

interface TerminalAccessSession {
  userId: string;
  attachToken: string;
}

interface TerminalAccessRequest {
  authTokenUserId: string;
  attachToken: string;
}

export function validateTerminalAccess(
  session: TerminalAccessSession,
  request: { userId: string; attachToken: string }
): boolean {
  return (
    session.userId === request.userId &&
    session.attachToken.length > 0 &&
    request.attachToken.length > 0 &&
    session.attachToken === request.attachToken
  );
}

export function authenticateTerminalRequest(
  session: TerminalAccessSession,
  request: TerminalAccessRequest
): boolean {
  return validateTerminalAccess(session, {
    userId: request.authTokenUserId,
    attachToken: request.attachToken
  });
}

export function buildTmuxAttachEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...env,
    TMUX: ""
  };
}

export class TerminalInputRateLimiter {
  private windowStartedAt = 0;
  private used = 0;

  constructor(private readonly options: { maxMessages: number; windowMs: number }) {}

  consume(now = Date.now()): boolean {
    if (now - this.windowStartedAt >= this.options.windowMs) {
      this.windowStartedAt = now;
      this.used = 0;
    }

    if (this.used >= this.options.maxMessages) {
      return false;
    }

    this.used += 1;
    return true;
  }
}

export class TerminalHeartbeat {
  private lastPongAt: number;

  constructor(private readonly options: { timeoutMs: number; now?: number }) {
    this.lastPongAt = options.now ?? Date.now();
  }

  recordPong(now = Date.now()): void {
    this.lastPongAt = now;
  }

  isTimedOut(now = Date.now()): boolean {
    return now - this.lastPongAt > this.options.timeoutMs;
  }
}

function isTerminalSize(cols: number, rows: number): boolean {
  return (
    Number.isInteger(cols) &&
    Number.isInteger(rows) &&
    cols > 0 &&
    rows > 0 &&
    cols <= 500 &&
    rows <= 200
  );
}

function rawToText(raw: string | Buffer | RawData): string {
  if (typeof raw === "string") {
    return raw;
  }

  if (Buffer.isBuffer(raw)) {
    return raw.toString("utf8");
  }

  if (Array.isArray(raw)) {
    return Buffer.concat(raw).toString("utf8");
  }

  return Buffer.from(raw).toString("utf8");
}
