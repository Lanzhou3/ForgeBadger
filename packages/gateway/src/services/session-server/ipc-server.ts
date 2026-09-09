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
const DEFAULT_HELLO_TIMEOUT_MS = 2000;

export interface IpcServerOptions {
  ipcPath: string;
  sessionServer: SessionServer;
  /** Shared handshake token every connection must present. */
  token: string;
  /** Test hook: how long a connection may take to complete hello. */
  helloTimeoutMs?: number;
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
  private readonly clients = new Map<string, Socket>();

  constructor(options: IpcServerOptions) {
    this.ipcPath = options.ipcPath;
    this.sessionServer = options.sessionServer;
    this.token = options.token;
    this.helloTimeoutMs = options.helloTimeoutMs ?? DEFAULT_HELLO_TIMEOUT_MS;
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
      this.sendToClient(clientId, msg);
    };

    // Set up session exit relay
    this.sessionServer.onSessionExit = (sessionId, exitCode) => {
      const msg: IoStreamResponse = {
        type: "session_exit",
        sessionId,
        exitCode
      };
      // Broadcast to all clients of this session
      for (const [clientId, socket] of this.clients) {
        if (socket.writable) {
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

    // Close all client connections
    for (const socket of this.clients.values()) {
      socket.destroy();
    }
    this.clients.clear();

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
    const state: ConnectionState = { authenticated: false, buffer: "", bufferedBytes: 0 };
    const helloTimer = setTimeout(() => {
      if (!state.authenticated) {
        this.failHandshake(socket, "hello timeout");
      }
    }, this.helloTimeoutMs);

    socket.on("data", (chunk: Buffer) => {
      if (!this.appendChunk(socket, state, chunk)) return;
      this.drainLines(socket, state, helloTimer);
    });

    const cleanup = () => {
      clearTimeout(helloTimer);
      // Remove every clientId entry that still points at this socket —
      // attach_client maps clientId → socket, and both must be reaped.
      for (const [clientId, s] of this.clients) {
        if (s === socket) {
          this.clients.delete(clientId);
        }
      }
    };

    socket.on("close", cleanup);
    socket.on("error", cleanup);
  }

  /** Append a chunk to the connection buffer; returns false when the socket
   *  was destroyed for exceeding an inbound limit. */
  private appendChunk(socket: Socket, state: ConnectionState, chunk: Buffer): boolean {
    state.buffer += chunk.toString("utf8");
    state.bufferedBytes += chunk.length;
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
    this.writeSocket(socket, { type: "hello_ok", protocolVersion: PROTOCOL_VERSION });
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
      case "configure_session":
        return this.handleConfigureSession(msg);
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
    const content = this.sessionServer.capturePane(msg.sessionId);
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
    const snapshot = this.sessionServer.inspectPane(msg.sessionId);
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

  private async handleConfigureSession(msg: import("./ipc-protocol.js").ConfigureSessionRequest): Promise<ManagementResponse> {
    this.sessionServer.configureSession(msg.sessionId);
    return { id: msg.id, type: "ok" };
  }

  // ------------------------------------------------------------------
  // I/O stream handlers
  // ------------------------------------------------------------------

  private async handleAttachClient(msg: import("./ipc-protocol.js").AttachClientMessage, socket: Socket): Promise<null> {
    this.clients.set(msg.clientId, socket);
    this.sessionServer.attachClient(msg.sessionId, msg.clientId);
    return null; // No response — output comes via streaming
  }

  private async handleDetachClient(msg: import("./ipc-protocol.js").DetachClientMessage): Promise<null> {
    // Only drop the registry entry if it still points at this connection —
    // a re-attached client (new socket, same id) must not be clobbered.
    this.clients.delete(msg.clientId);
    this.sessionServer.detachClient(msg.sessionId, msg.clientId);
    return null;
  }

  private async handleClientInput(msg: import("./ipc-protocol.js").ClientInputMessage): Promise<null> {
    this.sessionServer.sendInput(msg.sessionId, msg.data);
    return null;
  }

  private async handleClientResize(msg: import("./ipc-protocol.js").ClientResizeMessage): Promise<null> {
    this.sessionServer.resizeWindow(msg.sessionId, msg.cols, msg.rows);
    return null;
  }

  // ------------------------------------------------------------------
  // Socket utilities
  // ------------------------------------------------------------------

  private sendToClient(clientId: string, msg: IoStreamResponse): void {
    const socket = this.clients.get(clientId);
    if (socket?.writable) {
      this.writeSocket(socket, msg);
    }
  }

  private writeSocket<T>(socket: Socket, msg: T): void {
    socket.write(`${JSON.stringify(msg)}\n`);
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
}): Promise<{ ipcServer: IpcServer; sessionServer: SessionServer; stop: () => Promise<void> }> {
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
  const ipcServer = new IpcServer({ ipcPath, sessionServer, token: options.token });

  await ipcServer.start();

  const stop = async () => {
    await ipcServer.stop();
    await sessionServer.destroy();
  };

  return { ipcServer, sessionServer, stop };
}
