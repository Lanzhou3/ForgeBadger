/**
 * IPC Server — listens on a Unix Domain Socket / Named Pipe and dispatches
 * messages to the Session Server.
 *
 * Two connection types are supported:
 *   - Management: single long-lived connection for lifecycle commands
 *   - I/O stream: one per attached client, for terminal input/output
 *
 * Protocol: NDJSON (newline-delimited JSON) over a stream socket.
 */
import { createServer, type Server as NetServer, type Socket } from "node:net";
import { unlinkSync } from "node:fs";
import { once } from "node:events";

import { SessionServer } from "./session-server.js";
import type {
  ManagementRequest,
  ManagementResponse,
  IoStreamRequest,
  IoStreamResponse,
  LaunchPlanPayload
} from "./ipc-protocol.js";
import { createPlatformAdapter } from "./platform-adapter.js";

export interface IpcServerOptions {
  ipcPath: string;
  sessionServer: SessionServer;
}

export class IpcServer {
  private server: NetServer | undefined;
  private readonly ipcPath: string;
  private readonly sessionServer: SessionServer;
  private readonly clients = new Map<string, Socket>();

  constructor(options: IpcServerOptions) {
    this.ipcPath = options.ipcPath;
    this.sessionServer = options.sessionServer;
  }

  async start(): Promise<void> {
    // Clean up stale socket file on POSIX
    if (process.platform !== "win32") {
      try {
        unlinkSync(this.ipcPath);
      } catch {
        // Socket file doesn't exist, that's fine
      }
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

    // Clean up socket file on POSIX
    if (process.platform !== "win32") {
      try {
        unlinkSync(this.ipcPath);
      } catch {
        // Already cleaned up
      }
    }
  }

  get path(): string {
    return this.ipcPath;
  }

  // ------------------------------------------------------------------
  // Connection handling
  // ------------------------------------------------------------------

  private handleConnection(socket: Socket): void {
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        if (line.trim()) {
          this.handleMessage(socket, line).catch((error) => {
            console.error(`[ipc-server] error handling message:`, error);
          });
        }
      }
    });

    const cleanup = () => {
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
  const ipcServer = new IpcServer({ ipcPath, sessionServer });

  await ipcServer.start();

  const stop = async () => {
    await ipcServer.stop();
    await sessionServer.destroy();
  };

  return { ipcServer, sessionServer, stop };
}
