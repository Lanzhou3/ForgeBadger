import type { IPty } from "node-pty";
import type { Server } from "node:http";
import { WebSocket, WebSocketServer, type RawData } from "ws";

import { extractBearerToken, verifyJwt } from "../auth/index.js";
import type { InMemorySessionManager } from "../services/session-manager.js";

const DEFAULT_MAX_MESSAGE_BYTES = 1024 * 1024;
const TERMINAL_INPUT_RATE_LIMIT = 50;
const TERMINAL_RATE_WINDOW_MS = 1000;
const TERMINAL_HEARTBEAT_INTERVAL_MS = 30_000;
const TERMINAL_HEARTBEAT_TIMEOUT_MS = 90_000;

export type TerminalMessage =
  | { type: "terminal_input"; payload: { data: string } }
  | { type: "terminal_resize"; payload: { cols: number; rows: number } };

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
}

function extractAuthToken(request: { headers: Record<string, string | string[] | undefined> }, url: URL): string | undefined {
  // 1. Query param (backward compat)
  const fromQuery = url.searchParams.get("authToken");
  if (fromQuery) return fromQuery;

  // 2. Authorization header (non-browser clients)
  const fromBearer = extractBearerToken(request.headers.authorization);
  if (fromBearer) return fromBearer;

  // 3. Sec-WebSocket-Protocol header (browser clients)
  const protocolHeader = request.headers["sec-websocket-protocol"];
  if (typeof protocolHeader === "string") {
    const parts = protocolHeader.split(",").map((p) => p.trim());
    if (parts[0] === "openforge-terminal" && parts.length > 1) {
      return parts[1];
    }
  }

  return undefined;
}

export function attachTerminalWebSocket(options: TerminalWebSocketOptions): void {
  const registry = options.registry ?? new TerminalConnectionRegistry();
  const wss = new WebSocketServer({
    noServer: true,
    handleProtocols(protocols) {
      if (protocols.has("openforge-terminal")) {
        return "openforge-terminal";
      }
      return false;
    }
  });

  options.server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "", "http://localhost");
    const match = /^\/ws\/terminal\/([^/]+)$/.exec(url.pathname);
    if (!match) {
      return;
    }

    const sessionId = decodeURIComponent(match[1] ?? "");
    const authToken = extractAuthToken(request, url);
    const attachToken = url.searchParams.get("attachToken") ?? "";
    const terminalAccessRequest: TerminalAccessRequest = {
      attachToken,
      jwtSecret: options.jwtSecret
    };
    if (authToken !== undefined) {
      terminalAccessRequest.authToken = authToken;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      void handleTerminalSocket(
        ws,
        sessionId,
        terminalAccessRequest,
        options.sessionManager,
        registry
      );
    });
  });
}

async function handleTerminalSocket(
  ws: WebSocket,
  sessionId: string,
  access: TerminalAccessRequest,
  sessionManager: InMemorySessionManager,
  registry: TerminalConnectionRegistry
): Promise<void> {
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

  let pty: IPty | undefined;
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
        payload: { message: error instanceof Error ? error.message : String(error) }
      })
    );
    ws.close(1011, "pty attach failed");
    return;
  }

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
              message: `history restore failed: ${
                error instanceof Error ? error.message : String(error)
              }`
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

  const inputRateLimiter = new TerminalInputRateLimiter({
    maxMessages: TERMINAL_INPUT_RATE_LIMIT,
    windowMs: TERMINAL_RATE_WINDOW_MS
  });
  const heartbeat = new TerminalHeartbeat({
    timeoutMs: TERMINAL_HEARTBEAT_TIMEOUT_MS
  });
  ws.on("pong", () => {
    heartbeat.recordPong();
  });
  const heartbeatInterval = setInterval(() => {
    if (ws.readyState !== WebSocket.OPEN) {
      return;
    }
    if (heartbeat.isTimedOut()) {
      ws.close(4001, "heartbeat timeout");
      return;
    }
    ws.ping();
  }, TERMINAL_HEARTBEAT_INTERVAL_MS);

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
        pty.write(message.payload.data);
        return;
      }
      pty.resize(message.payload.cols, message.payload.rows);
    } catch (error) {
      ws.send(
        JSON.stringify({
          type: "terminal_error",
          payload: { message: error instanceof Error ? error.message : String(error) }
        })
      );
    }
  });

  ws.on("close", () => {
    clearInterval(heartbeatInterval);
    registry.unregister(sessionId, ws);
    pty?.kill();
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

interface TerminalAccessSession {
  userId: string;
  attachToken: string;
}

interface TerminalAccessRequest {
  authToken?: string;
  attachToken: string;
  jwtSecret: string;
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
  if (!request.authToken) {
    return false;
  }

  try {
    const claims = verifyJwt(request.authToken, request.jwtSecret);
    return validateTerminalAccess(session, {
      userId: claims.userId,
      attachToken: request.attachToken
    });
  } catch {
    return false;
  }
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
