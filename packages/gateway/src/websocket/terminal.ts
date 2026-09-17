/**
 * WebSocket terminal handler — connects browser xterm.js to the Session Server.
 *
 * The browser connects to the Gateway via WebSocket, and the Gateway relays
 * I/O to the Session Server via IPC. The actual pty process lives in the
 * Session Server daemon, so Gateway restarts and browser reconnects do not
 * kill the CLI session; the daemon renders every session through a headless
 * screen that backs capture, composer inspection, and attach replay.
 */
import type { Server } from "node:http";
import { WebSocket, WebSocketServer, type RawData } from "ws";

import { resolveTokenUserId } from "../auth/resolve-token.js";
import type { Database } from "../db/types.js";
import { SessionRepository } from "../db/repositories/session-repository.js";
import type { InMemorySessionManager } from "../services/session-manager.js";
import { RuntimeAuthorizationInvalidator } from "../services/runtime-authorization-invalidation.js";
import { SessionServerPty } from "../services/session-server-pty.js";
import { TerminalOutputFlow } from "./terminal-output-flow.js";
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
// Mouse-event traffic (SGR sequences) is a separate, far more permissive
// budget: opencode enables any-motion tracking (?1003h), so holding the
// pointer over the pane or a single wheel flick legitimately produces far
// more events per second than a human can ever type.
const TERMINAL_MOUSE_INPUT_RATE_LIMIT = 500;
const TERMINAL_HEARTBEAT_INTERVAL_MS = 30_000;
const TERMINAL_HEARTBEAT_TIMEOUT_MS = 90_000;
const DEFAULT_TERMINAL_WS_MAX_CONNECTIONS = 100;
const DEFAULT_TERMINAL_WS_MAX_CONNECTIONS_PER_USER = 5;
const TERMINAL_WS_AUTH_PROTOCOLS = ["forgebadger-terminal"] as const;

/**
 * True when a terminal input chunk consists ONLY of SGR mouse reports
 * (CSI < Cb ; Cx ; Cy M/m, possibly several per chunk). The body after
 * "CSI <" is limited to digits and semicolons, so this can never match
 * arbitrary escape traffic — anything else falls through to the strict
 * keystroke rate limit.
 */
export function isTerminalMouseInput(data: string): boolean {
  return data.length > 0 && /^(?:\x1b\[<[0-9;]+[Mm])+$/.test(data);
}

export type TerminalMessage =
  | { type: "terminal_ack"; payload: { sequence: number } }
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
  private pendingBytes = 0;

  constructor(private readonly assertWritable: () => void = () => {}) {}

  writeOrStore(pty: TerminalWritable | undefined, data: string): void {
    this.assertWritable();
    if (pty) {
      pty.write(data);
      return;
    }
    const bytes = Buffer.byteLength(data, "utf8");
    if (this.pendingBytes + bytes > DEFAULT_MAX_MESSAGE_BYTES) {
      throw new Error("Terminal input buffer limit exceeded");
    }
    this.pendingInput.push(data);
    this.pendingBytes += bytes;
  }

  flush(pty: TerminalWritable): void {
    const pending = this.pendingInput.splice(0);
    this.pendingBytes = 0;
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
    this.pendingBytes = 0;
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
  if (value.type === "terminal_ack" && Number.isSafeInteger(value.payload.sequence) && Number(value.payload.sequence) > 0) {
    return { type: "terminal_ack", payload: { sequence: Number(value.payload.sequence) } };
  }
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
  /** IPC socket path for the Session Server (the single terminal backend). */
  sessionServerIpcPath: string;
  /**
   * Explicit IPC handshake token for the I/O stream (test seam). When unset,
   * SessionServerPty reads the state-dir token file, which tracks daemon
   * token rotation.
   */
  sessionServerToken?: string;
  sessionServerTokenPath?: string;
  runtimeAuthorizationInvalidator: RuntimeAuthorizationInvalidator;
  runtimeAuthorizationRegistry?: TerminalRuntimeAuthorizationRegistry;
}

export function attachTerminalWebSocket(options: TerminalWebSocketOptions): void {
  const sessionServerIpcPath = options.sessionServerIpcPath;
  if (!sessionServerIpcPath) {
    throw new Error("sessionServerIpcPath is required: the Session Server is the only terminal backend");
  }
  const registry = options.registry ?? new TerminalConnectionRegistry();
  const runtimeAuthorizationRegistry = options.runtimeAuthorizationRegistry
    ?? new TerminalRuntimeAuthorizationRegistry(options.runtimeAuthorizationInvalidator);
  const limits = new WebSocketConnectionLimits<WebSocket>({
    maxGlobalConnections: options.maxConnections ?? DEFAULT_TERMINAL_WS_MAX_CONNECTIONS,
    maxConnectionsPerUser: options.maxConnectionsPerUser ?? DEFAULT_TERMINAL_WS_MAX_CONNECTIONS_PER_USER
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: DEFAULT_MAX_MESSAGE_BYTES });

  options.server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "", "http://localhost");
    const match = /^\/ws\/terminal\/([^/]+)$/.exec(url.pathname);
    if (!match) return;

    // Whitelist the raw (still percent-encoded) sessionId segment BEFORE any
    // decoding. Rejects malformed percent-encoding (e.g. %zz, %E0%A4%A) and any
    // injected path characters, so decodeURIComponent can never throw on hostile
    // input (an uncaught URIError here would crash the whole Gateway process).
    const rawSessionId = match[1] ?? "";
    if (!/^[0-9a-zA-Z-]+$/.test(rawSessionId)) {
      socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
      socket.destroy();
      console.error(`[terminal-ws] rejected malformed terminal path segment: ${rawSessionId}`);
      return;
    }

    let sessionId: string;
    try {
      sessionId = decodeURIComponent(rawSessionId);
    } catch {
      // Defensive: whitelist above already excludes '%', but keep the process alive.
      socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
      socket.destroy();
      console.error(`[terminal-ws] failed to decode terminal session id: ${rawSessionId}`);
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

      // Only after the new connection has acquired its quota, release the
      // previous socket's quota (keeps the replacement window bounded and never
      // double-counts a live connection).
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
        options.sessionServerTokenPath,
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
  sessionServerIpcPath: string,
  sessionServerToken: string | undefined,
  sessionServerTokenPath: string | undefined,
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
  let released = false;
  const outputFlow = new TerminalOutputFlow({
    send: (frame) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      if (ws.bufferedAmount > 1024 * 1024) { ws.close(1011, "terminal consumer too slow"); return; }
      ws.send(JSON.stringify(frame));
    },
    pause: (paused) => pty?.setOutputPaused(paused),
    fail: () => { if (ws.readyState === WebSocket.OPEN) ws.close(1011, "terminal render acknowledgement timed out or overflowed"); }
  });

  const releaseResources = () => {
    released = true;
    outputFlow.dispose();
    inputBuffer.clear();
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
  ws.on("error", () => { releaseResources(); });

  const session = sessionManager.getSession(sessionId);
  if (!session) {
    ws.close(4404, "session not found");
    return;
  }
  if (!authenticateTerminalRequest(session, access)) {
    ws.close(4403, "session forbidden");
    return;
  }
  // The upgrade authorization and the backend attach are separated by an async
  // callback. Subscribe before the final database check so a revoke/role
  // change cannot fall between validation and the live authorization lease.
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
    // A dead pty must never receive input or resize: the client already got
    // terminal_exit (or a 1011 transport close), and writing to an exited
    // backend session can only produce misleading errors.
    try {
      const message = parseTerminalMessage(raw);
      if (message.type === "terminal_ack") {
        try { outputFlow.acknowledge(message.payload.sequence); }
        catch { ws.close(1008, "invalid terminal acknowledgement"); }
        return;
      }
      if (ptyExited) return;
      if (message.type === "terminal_input") {
        // SGR mouse reports (scroll/move) use their own permissive budget; a
        // wheel flick otherwise burns through the keystroke limit in one
        // gesture and the terminal floods with "rate limit exceeded".
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
    } catch (error) {
      ws.send(JSON.stringify({ type: "terminal_error", payload: { message: formatTerminalClientError(error) } }));
    }
  });

  let snapshot: string | undefined;
  try {
    if (!authorizationLease.isAuthorized()) return;
    // The session-server registry is keyed by the runtime session name
    // (session-manager's buildRuntimeSessionName, historical `fb-` shape), not
    // the raw database UUID — SessionServerClient.createSession registers
    // sessions under that name. Using the raw UUID here would cause
    // attach/input/resize to target a session that doesn't exist.
    const serverPty = new SessionServerPty({
      ipcPath: sessionServerIpcPath,
      sessionId: session.runtimeSessionName,
      ...(sessionServerTokenPath ? { tokenPath: sessionServerTokenPath } : {}),
      ...(sessionServerToken !== undefined ? { token: sessionServerToken } : {})
    });
    // connect() resolves on the attach ack; the server replays history via
    // the ack's rendered snapshot (scrollback + screen + cursor state), so
    // no separate captureHistory round-trip is needed — that would double
    // the replay. A rejected attach (unknown session) surfaces here instead
    // of leaving a black terminal.
    const attachResult = await serverPty.connect();
    if (released || ws.readyState !== WebSocket.OPEN || !authorizationLease.isAuthorized()
      || registry.getSocket(sessionId) !== ws || sessionManager.getSession(sessionId) !== session) {
      serverPty.kill();
      return;
    }
    snapshot = attachResult.snapshot;
    pty = serverPty;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`[terminal-ws] session server attach failed for session ${sessionId}: ${detail}`, error);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "terminal_error", payload: { message: `Terminal attach failed: ${detail}` } }));
      ws.close(1011, "session server attach failed");
    }
    return;
  }

  // Replay the rendered snapshot before going live. Output produced during
  // the attach window is buffered inside SessionServerPty and emitted right
  // after the onData listener registers below.
  if (snapshot && ws.readyState === WebSocket.OPEN) {
    outputFlow.enqueue("terminal_history", snapshot);
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
      outputFlow.enqueue("terminal_output", data);
    }
  });

  pty.onExit(({ exitCode }) => {
    ptyExited = true;
    outputFlow.finish(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "terminal_exit", payload: { exitCode } }));
      }
    });
    void sessionManager.reconcileSessionStatus(sessionId).catch((error) => {
      console.error(`[terminal-ws] reconcile failed for session ${sessionId}`, error);
    });
  });

  // Resize failures must surface instead of leaving pty and renderer at
  // different geometries (misaligned TUI output with no log trail).
  pty.onResizeError((error) => {
    console.error(`[terminal-ws] resize failed for session ${sessionId}`, error);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "terminal_error", payload: { message: `Terminal resize failed: ${error.message}` } }));
    }
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
