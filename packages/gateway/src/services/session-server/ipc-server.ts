/**
 * IPC Server — listens on a Unix Domain Socket / Named Pipe and dispatches
 * messages to the Session Server.
 *
 * Two connection types are supported:
 *   - Management: single long-lived connection for lifecycle commands
 *   - I/O stream: one per attached client, for terminal input/output
 *
 * Protocol: NDJSON (newline-delimited JSON) over a stream socket.
 *
 * Access control is layered:
 *   - Filesystem ACLs: socket directory 0700, socket file 0600 (POSIX)
 *   - Hello handshake: every connection must send a valid HelloMessage
 *     (token + protocol major version) as its first line within a short
 *     timeout; anything else destroys the socket.
 */
import { createServer, type Server as NetServer, type Socket } from "node:net";
import { chmodSync, lstatSync, mkdirSync, unlinkSync } from "node:fs";
import { timingSafeEqual } from "node:crypto";
import { dirname } from "node:path";

import { SessionServer } from "./session-server.js";
import { clientPauseSource } from "./session-handle.js";
import { startSocketSelfCheck } from "./socket-self-check.js";
import {
  PROTOCOL_VERSION,
  type HelloErrorResponse,
  type ManagementRequest,
  type ManagementResponse,
  type IoStreamRequest,
  type IoStreamResponse,
  type LaunchPlanPayload
} from "./ipc-protocol.js";
import { createPlatformAdapter } from "./platform-adapter.js";

/** Single NDJSON line limit (defends against unterminated-line memory abuse). */
const MAX_LINE_BYTES = 4 * 1024 * 1024;
/** Per-connection buffered-bytes limit while waiting for a newline. */
const MAX_BUFFER_BYTES = 8 * 1024 * 1024;
/**
 * Per-client outbound buffer hard cap (socket.writableLength). A slow
 * consumer past this point is disconnected so it cannot OOM the daemon; the
 * pty-level pause below it already gives honest clients flow control.
 */
const MAX_CLIENT_BUFFER_BYTES = 4 * 1024 * 1024;
const DEFAULT_HELLO_TIMEOUT_MS = 2000;

export interface IpcServerOptions {
  ipcPath: string;
  sessionServer: SessionServer;
  /** Shared handshake token every connection must present. */
  token: string;
  /** Test hook: how long a connection may take to complete hello. */
  helloTimeoutMs?: number;
  /**
   * Called after a shutdown_server request has been acknowledged and all
   * sessions destroyed. The host process decides how to exit; the Gateway's
   * normal shutdown path never sends this message.
   */
  onShutdownRequested?: () => void;
  /** Daemon start time reported in hello_ok (test hook for restart detection). */
  startedAt?: string;
  /** Per-client outbound buffer hard cap in bytes (test hook; default 4MiB). */
  maxClientBufferBytes?: number;
}

interface ConnectionState {
  authenticated: boolean;
  buffer: string;
  bufferedBytes: number;
}

export class IpcServer {
  private server: NetServer | undefined;
  private readonly ipcPath: string;
  private readonly sessionServer: SessionServer;
  private readonly token: string;
  private readonly helloTimeoutMs: number;
  private readonly startedAt: string;
  private readonly onShutdownRequested: (() => void) | undefined;
  private readonly maxClientBufferBytes: number;
  private readonly clients = new Map<string, Socket>();
  /** clientId -> sessionId, for targeted session_exit and socket cleanup. */
  private readonly clientSessions = new Map<string, string>();
  /** clientIds whose socket is currently applying backpressure. */
  private readonly slowClients = new Set<string>();
  /** Every live connection (management + I/O), so stop() can close them all. */
  private readonly connections = new Set<Socket>();

  constructor(options: IpcServerOptions) {
    this.ipcPath = options.ipcPath;
    this.sessionServer = options.sessionServer;
    this.token = options.token;
    this.helloTimeoutMs = options.helloTimeoutMs ?? DEFAULT_HELLO_TIMEOUT_MS;
    this.startedAt = options.startedAt ?? new Date().toISOString();
    this.onShutdownRequested = options.onShutdownRequested;
    this.maxClientBufferBytes = options.maxClientBufferBytes ?? MAX_CLIENT_BUFFER_BYTES;
  }

  async start(): Promise<void> {
    if (process.platform !== "win32") {
      const dir = dirname(this.ipcPath);
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      chmodSync(dir, 0o700);
      this.removeStaleSocket();
    }

    this.server = createServer((socket) => this.handleConnection(socket));

    // Set up session output relay
    this.sessionServer.onSessionOutput = (sessionId, clientId, data) => {
      const msg: IoStreamResponse = {
        type: "client_output",
        sessionId,
        clientId,
        data
      };
      this.sendToClient(sessionId, clientId, msg);
    };

    // Set up session exit relay — targeted: only clients attached to the
    // exiting session are notified (broadcasting would leak session names
    // across sessions sharing the daemon).
    this.sessionServer.onSessionExit = (sessionId, exitCode) => {
      const msg: IoStreamResponse = {
        type: "session_exit",
        sessionId,
        exitCode
      };
      const targets = this.sessionServer.getSession(sessionId)?.getClients() ?? [];
      for (const clientId of targets) {
        const socket = this.clients.get(clientId);
        if (socket?.writable) {
          this.writeSocket(socket, msg);
        }
      }
      // Drop the session after the exit event has been relayed so
      // has_session reports false once the CLI process is gone — matching
      // tmux has-session semantics, which session-manager's
      // reconcileSessionStatus and status-correction scan rely on.
      this.sessionServer.removeSession(sessionId);
    };

    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(this.ipcPath, () => {
        this.server!.off("error", reject);
        resolve();
      });
    });

    // Restrict the socket to the owner (POSIX). Windows named pipes cannot
    // be ACL'd through libuv — the hello token carries authentication there.
    if (process.platform !== "win32") {
      chmodSync(this.ipcPath, 0o600);
    }
  }

  async stop(): Promise<void> {
    if (!this.server) return;

    // Close every live connection — not just attached I/O clients:
    // server.close() waits for open connections, and management connections
    // are not in the clientId map.
    for (const socket of this.connections) {
      socket.destroy();
    }
    this.connections.clear();
    this.clients.clear();
    this.clientSessions.clear();
    this.slowClients.clear();

    await new Promise<void>((resolve) => {
      this.server!.close(() => resolve());
    });
    this.server = undefined;

    // Clean up socket file on POSIX (only if it is still our socket)
    if (process.platform !== "win32") {
      try {
        if (lstatSync(this.ipcPath).isSocket()) {
          unlinkSync(this.ipcPath);
        }
      } catch {
        // Already cleaned up
      }
    }
  }

  get path(): string {
    return this.ipcPath;
  }

  /**
   * Remove a stale socket file before listening. Refuse to start rather than
   * delete a path that is not a socket — the IPC path must never point at a
   * regular file the user owns.
   */
  private removeStaleSocket(): void {
    let stat;
    try {
      stat = lstatSync(this.ipcPath);
    } catch {
      return; // No stale file
    }
    if (!stat.isSocket()) {
      throw new Error(`Refusing to remove non-socket file at IPC path: ${this.ipcPath}`);
    }
    unlinkSync(this.ipcPath);
  }

  // ------------------------------------------------------------------
  // Connection handling
  // ------------------------------------------------------------------

  private handleConnection(socket: Socket): void {
    this.connections.add(socket);
    // Decode multibyte UTF-8 at the stream layer; raw chunk.toString() would
    // splice a replacement character when a character straddles two chunks.
    socket.setEncoding("utf8");
    const state: ConnectionState = { authenticated: false, buffer: "", bufferedBytes: 0 };
    const helloTimer = setTimeout(() => {
      if (!state.authenticated) {
        this.failHandshake(socket, "hello timeout");
      }
    }, this.helloTimeoutMs);

    socket.on("data", (chunk: string) => {
      if (!this.appendChunk(socket, state, chunk)) return;
      this.drainLines(socket, state, helloTimer);
    });

    socket.on("drain", () => {
      // A slow I/O client caught up: release its pty pause.
      for (const [clientId, s] of this.clients) {
        if (s !== socket || !this.slowClients.has(clientId)) continue;
        this.slowClients.delete(clientId);
        const sessionId = this.clientSessions.get(clientId);
        if (sessionId) {
          this.sessionServer.resumeSessionOutput(sessionId, clientPauseSource(clientId));
        }
      }
    });

    const cleanup = () => {
      clearTimeout(helloTimer);
      this.connections.delete(socket);
      // Remove every clientId entry that still points at this socket —
      // attach_client maps clientId → socket, and both must be reaped. The
      // detach also releases any backpressure pause the client was holding.
      for (const [clientId, s] of this.clients) {
        if (s !== socket) continue;
        this.clients.delete(clientId);
        this.slowClients.delete(clientId);
        const sessionId = this.clientSessions.get(clientId);
        this.clientSessions.delete(clientId);
        if (sessionId) {
          this.sessionServer.detachClient(sessionId, clientId);
        }
      }
    };

    socket.on("close", cleanup);
    socket.on("error", cleanup);
  }

  /** Append a chunk to the connection buffer; returns false when the socket
   *  was destroyed for exceeding an inbound limit. */
  private appendChunk(socket: Socket, state: ConnectionState, chunk: string): boolean {
    state.buffer += chunk;
    state.bufferedBytes += Buffer.byteLength(chunk, "utf8");
    if (state.bufferedBytes > MAX_BUFFER_BYTES && !state.buffer.includes("\n")) {
      console.error("[ipc-server] closing connection: buffered bytes exceeded limit");
      socket.destroy();
      return false;
    }
    return true;
  }

  private drainLines(socket: Socket, state: ConnectionState, helloTimer: ReturnType<typeof setTimeout>): void {
    let newlineIndex: number;
    while ((newlineIndex = state.buffer.indexOf("\n")) !== -1) {
      const line = state.buffer.slice(0, newlineIndex);
      const lineBytes = Buffer.byteLength(line, "utf8");
      state.buffer = state.buffer.slice(newlineIndex + 1);
      state.bufferedBytes -= lineBytes + 1;
      if (lineBytes > MAX_LINE_BYTES) {
        console.error("[ipc-server] closing connection: line length exceeded limit");
        socket.destroy();
        return;
      }
      if (!line.trim()) continue;
      if (!state.authenticated) {
        if (!this.handleHello(socket, state, line, helloTimer)) return;
        continue;
      }
      this.handleMessage(socket, line).catch((error) => {
        console.error(`[ipc-server] error handling message:`, error);
      });
    }
  }

  /** Validate the hello handshake. Returns false when the socket was destroyed. */
  private handleHello(
    socket: Socket,
    state: ConnectionState,
    line: string,
    helloTimer: ReturnType<typeof setTimeout>
  ): boolean {
    let msg: { type?: string; protocolVersion?: number; token?: string };
    try {
      msg = JSON.parse(line) as typeof msg;
    } catch {
      this.failHandshake(socket, "invalid hello message");
      return false;
    }
    if (msg.type !== "hello") {
      this.failHandshake(socket, "first message must be hello");
      return false;
    }
    if (typeof msg.protocolVersion !== "number" || Math.trunc(msg.protocolVersion) !== PROTOCOL_VERSION) {
      this.failHandshake(socket, `unsupported protocol version: ${String(msg.protocolVersion)}`);
      return false;
    }
    if (typeof msg.token !== "string" || !this.tokenMatches(msg.token)) {
      this.failHandshake(socket, "invalid token");
      return false;
    }
    state.authenticated = true;
    clearTimeout(helloTimer);
    this.writeSocket(socket, {
      type: "hello_ok",
      protocolVersion: PROTOCOL_VERSION,
      pid: process.pid,
      startedAt: this.startedAt
    });
    return true;
  }

  private tokenMatches(candidate: string): boolean {
    const expected = Buffer.from(this.token, "utf8");
    const actual = Buffer.from(candidate, "utf8");
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }

  private failHandshake(socket: Socket, message: string): void {
    const reply: HelloErrorResponse = { type: "hello_error", message, protocolVersion: PROTOCOL_VERSION };
    socket.write(`${JSON.stringify(reply)}\n`, () => socket.destroy());
  }

  // ------------------------------------------------------------------
  // Message dispatch
  // ------------------------------------------------------------------

  private async handleMessage(socket: Socket, line: string): Promise<void> {
    let msg: ManagementRequest | IoStreamRequest;
    try {
      msg = JSON.parse(line) as ManagementRequest | IoStreamRequest;
    } catch {
      this.writeSocket(socket, {
        id: "",
        type: "error",
        message: "Invalid JSON"
      });
      return;
    }

    try {
      const response = await this.dispatch(msg, socket);
      if (response) {
        this.writeSocket(socket, response);
      }
    } catch (error) {
      console.error(`[ipc-server] dispatch error for type=${(msg as {type?:string}).type}:`, error instanceof Error ? error.message : String(error));
      const id = "id" in msg && typeof msg.id === "string" ? msg.id : "";
      this.writeSocket(socket, {
        id,
        type: "error",
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async dispatch(msg: ManagementRequest | IoStreamRequest, socket: Socket): Promise<ManagementResponse | null> {
    switch (msg.type) {
      case "create_session":
        return this.handleCreateSession(msg);
      case "kill_session":
        return this.handleKillSession(msg);
      case "list_sessions":
        return this.handleListSessions(msg);
      case "has_session":
        return this.handleHasSession(msg);
      case "capture_pane":
        return this.handleCapturePane(msg);
      case "show_environment":
        return this.handleShowEnvironment(msg);
      case "resize_window":
        return this.handleResizeWindow(msg);
      case "send_input":
        return this.handleSendInput(msg);
      case "inspect_pane":
        return this.handleInspectPane(msg);
      case "stage_programmatic_input":
        return this.handleStageProgrammaticInput(msg);
      case "press_enter":
        return this.handlePressEnter(msg);
      case "shutdown_server":
        return this.handleShutdownServer(msg, socket);
      case "attach_client":
        return this.handleAttachClient(msg, socket);
      case "detach_client":
        return this.handleDetachClient(msg);
      case "client_input":
        return this.handleClientInput(msg);
      case "client_resize":
        return this.handleClientResize(msg);
      default:
        return {
          id: (msg as { id?: string }).id ?? "",
          type: "error",
          message: `Unknown message type: ${(msg as { type: string }).type}`
        };
    }
  }

  // ------------------------------------------------------------------
  // Management handlers
  // ------------------------------------------------------------------

  private async handleCreateSession(msg: import("./ipc-protocol.js").CreateSessionRequest): Promise<ManagementResponse> {
    await this.sessionServer.createSession({
      sessionId: msg.sessionId,
      userId: msg.userId,
      attachToken: msg.attachToken,
      launchPlan: msg.launchPlan
    });
    return { id: msg.id, type: "ok" };
  }

  private async handleKillSession(msg: import("./ipc-protocol.js").KillSessionRequest): Promise<ManagementResponse> {
    await this.sessionServer.killSession(msg.sessionId);
    return { id: msg.id, type: "ok" };
  }

  private async handleListSessions(msg: import("./ipc-protocol.js").ListSessionsRequest): Promise<ManagementResponse> {
    const sessions = this.sessionServer.listSessions();
    return { id: msg.id, type: "ok", data: sessions };
  }

  private async handleHasSession(msg: import("./ipc-protocol.js").HasSessionRequest): Promise<ManagementResponse> {
    const exists = this.sessionServer.hasSession(msg.sessionId);
    return { id: msg.id, type: "ok", data: { exists } };
  }

  private async handleCapturePane(msg: import("./ipc-protocol.js").CapturePaneRequest): Promise<ManagementResponse> {
    const content = await this.sessionServer.capturePane(msg.sessionId);
    return { id: msg.id, type: "ok", data: { content } };
  }

  private async handleShowEnvironment(msg: import("./ipc-protocol.js").ShowEnvironmentRequest): Promise<ManagementResponse> {
    const env = this.sessionServer.showEnvironment(msg.sessionId);
    return { id: msg.id, type: "ok", data: env };
  }

  private async handleResizeWindow(msg: import("./ipc-protocol.js").ResizeWindowRequest): Promise<ManagementResponse> {
    this.sessionServer.resizeWindow(msg.sessionId, msg.cols, msg.rows);
    return { id: msg.id, type: "ok" };
  }

  private async handleSendInput(msg: import("./ipc-protocol.js").SendInputRequest): Promise<ManagementResponse> {
    this.sessionServer.sendInput(msg.sessionId, msg.data);
    return { id: msg.id, type: "ok" };
  }

  private async handleInspectPane(msg: import("./ipc-protocol.js").InspectPaneRequest): Promise<ManagementResponse> {
    const snapshot = await this.sessionServer.inspectPane(msg.sessionId);
    return { id: msg.id, type: "ok", data: snapshot };
  }

  private async handleStageProgrammaticInput(msg: import("./ipc-protocol.js").StageProgrammaticInputRequest): Promise<ManagementResponse> {
    this.sessionServer.stageProgrammaticInput(msg.sessionId, msg.data);
    return { id: msg.id, type: "ok" };
  }

  private async handlePressEnter(msg: import("./ipc-protocol.js").PressEnterRequest): Promise<ManagementResponse> {
    this.sessionServer.pressEnter(msg.sessionId);
    return { id: msg.id, type: "ok" };
  }

  /**
   * Maintenance shutdown: acknowledge first (flushed via socket.end), then
   * destroy every session and hand over to the host process to exit.
   */
  private handleShutdownServer(
    msg: import("./ipc-protocol.js").ShutdownServerRequest,
    socket: Socket
  ): null {
    this.writeSocket(socket, { id: msg.id, type: "ok" });
    socket.end(() => {
      void this.sessionServer.destroy().finally(() => this.onShutdownRequested?.());
    });
    return null;
  }

  // ------------------------------------------------------------------
  // I/O stream handlers
  // ------------------------------------------------------------------

  /**
   * Attach is request/response: the ack carries the full rendered snapshot
   * (so the client can replay history with no separate capture round-trip),
   * then the server flushes output buffered during the attach window, then
   * streams live. A failed attach gets an explicit error — never a black
   * screen.
   */
  private async handleAttachClient(msg: import("./ipc-protocol.js").AttachClientMessage, socket: Socket): Promise<null> {
    let snapshot: string;
    try {
      ({ snapshot } = await this.sessionServer.attachClient(msg.sessionId, msg.clientId));
    } catch (error) {
      this.writeSocket(socket, {
        type: "attach_ack",
        sessionId: msg.sessionId,
        clientId: msg.clientId,
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }

    this.clients.set(msg.clientId, socket);
    this.clientSessions.set(msg.clientId, msg.sessionId);
    this.writeSocket(socket, {
      type: "attach_ack",
      sessionId: msg.sessionId,
      clientId: msg.clientId,
      ok: true,
      snapshot
    });
    // Flush the attach-window buffer, then the handle streams live.
    const buffered = this.sessionServer.endClientBuffering(msg.sessionId, msg.clientId);
    for (const data of buffered) {
      this.sendToClient(msg.sessionId, msg.clientId, {
        type: "client_output",
        sessionId: msg.sessionId,
        clientId: msg.clientId,
        data
      });
    }
    return null;
  }

  private async handleDetachClient(msg: import("./ipc-protocol.js").DetachClientMessage): Promise<null> {
    // Only drop the registry entry if it still points at this connection —
    // a re-attached client (new socket, same id) must not be clobbered.
    this.clients.delete(msg.clientId);
    this.clientSessions.delete(msg.clientId);
    this.slowClients.delete(msg.clientId);
    this.sessionServer.detachClient(msg.sessionId, msg.clientId);
    return null;
  }

  private async handleClientInput(msg: import("./ipc-protocol.js").ClientInputMessage): Promise<null> {
    this.sessionServer.sendInput(msg.sessionId, msg.data);
    return null;
  }

  private async handleClientResize(msg: import("./ipc-protocol.js").ClientResizeMessage): Promise<ManagementResponse | null> {
    this.sessionServer.resizeWindow(msg.sessionId, msg.cols, msg.rows);
    // Ack when the client asked for one — resize failures must surface.
    return msg.id ? { id: msg.id, type: "ok" } : null;
  }

  // ------------------------------------------------------------------
  // Socket utilities
  // ------------------------------------------------------------------

  /**
   * Data-plane backpressure: when a client's socket buffer fills, pause the
   * session's pty reads (multiple clients share one pty — the slowest wins);
   * when the per-client buffer exceeds the hard cap, disconnect that client
   * so a stuck consumer cannot exhaust daemon memory.
   */
  private sendToClient(sessionId: string, clientId: string, msg: IoStreamResponse): void {
    const socket = this.clients.get(clientId);
    if (!socket?.writable) return;
    const accepted = this.writeSocket(socket, msg);
    if (socket.writableLength > this.maxClientBufferBytes) {
      console.error(`[ipc-server] closing client ${clientId}: outbound buffer exceeded ${this.maxClientBufferBytes} bytes`);
      socket.destroy();
      return;
    }
    if (!accepted && !this.slowClients.has(clientId)) {
      this.slowClients.add(clientId);
      this.sessionServer.pauseSessionOutput(sessionId, clientPauseSource(clientId));
    }
  }

  private writeSocket<T>(socket: Socket, msg: T): boolean {
    return socket.write(`${JSON.stringify(msg)}\n`);
  }
}

/**
 * Create and start a standalone Session Server with IPC.
 * Used as the entry point for the Session Server process.
 */
export async function startSessionServer(options: {
  ipcPath: string;
  stateDir: string;
  token: string;
  /** Stolen-socket self-check interval in ms (POSIX). 0 disables; default 30s. */
  socketSelfCheckIntervalMs?: number;
  /** How the host process exits (test hook); defaults to process.exit. */
  onExit?: (code: number) => void;
}): Promise<{ ipcServer: IpcServer; sessionServer: SessionServer; stop: () => Promise<void> }> {
  const exit = options.onExit ?? ((code: number) => process.exit(code));
  const platformAdapter = createPlatformAdapter();
  const sessionServer = new SessionServer({
    platformAdapter,
    onSessionExit: (sessionId, exitCode) => {
      console.info(`[session-server] session exited: sessionId=${sessionId} exitCode=${exitCode}`);
    },
    onSessionOutput: (_sessionId, _clientId, _data) => {
      // Handled by IpcServer via relay
    }
  });

  const ipcPath = options.ipcPath ?? platformAdapter.getIpcPath(options.stateDir);

  let stopped = false;
  let stopSelfCheck: () => void = () => {};
  const shutdown = async (exitCode: number) => {
    if (stopped) return;
    stopped = true;
    stopSelfCheck();
    await ipcServer.stop();
    await sessionServer.destroy();
    exit(exitCode);
  };

  const ipcServer = new IpcServer({
    ipcPath,
    sessionServer,
    token: options.token,
    onShutdownRequested: () => void shutdown(0)
  });

  await ipcServer.start();

  // gpg-agent style self-test: exit (after destroying sessions) when our
  // socket file was stolen, so we never linger as an unreachable daemon.
  stopSelfCheck = startSocketSelfCheck({
    ipcPath,
    intervalMs: options.socketSelfCheckIntervalMs ?? 30_000,
    onStolen: () => {
      console.error("[session-server] IPC socket was unlinked or replaced; shutting down");
      void shutdown(1);
    }
  });

  const stop = async () => {
    if (stopped) return;
    stopped = true;
    stopSelfCheck();
    await ipcServer.stop();
    await sessionServer.destroy();
  };

  return { ipcServer, sessionServer, stop };
}
