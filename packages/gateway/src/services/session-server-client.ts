/**
 * Gateway-side IPC client for the Session Server.
 *
 * Implements the TmuxClient interface so the SessionManager and WebSocket
 * handler can use it as a drop-in replacement. Internally, it translates
 * calls to IPC messages sent to the Session Server.
 *
 * The IPC connection is a single long-lived TCP/Unix socket connection.
 * Management commands use request/response (correlated by `id`).
 * I/O streaming uses a separate socket per attached client.
 */
import { Socket } from "node:net";
import { randomUUID } from "node:crypto";

import type { TmuxClient, TmuxCreateOptions, TmuxPaneSnapshot } from "./tmux.js";
import type {
  ManagementResponse,
  LaunchPlanPayload,
  PaneSnapshot
} from "./session-server/index.js";

export interface SessionServerClientOptions {
  ipcPath: string;
  connectTimeoutMs?: number;
  requestTimeoutMs?: number;
}

export class SessionServerClient implements TmuxClient {
  private socket: Socket | undefined;
  private buffer = "";
  private readonly pending = new Map<string, {
    resolve: (value: ManagementResponse) => void;
    reject: (reason: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  private readonly ipcPath: string;
  private readonly connectTimeoutMs: number;
  private readonly requestTimeoutMs: number;

  /** Maps tmuxName → sessionId for TmuxClient interface compatibility. */
  private readonly nameToSessionId = new Map<string, string>();

  constructor(options: SessionServerClientOptions) {
    this.ipcPath = options.ipcPath;
    this.connectTimeoutMs = options.connectTimeoutMs ?? 5000;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 10_000;
  }

  // ------------------------------------------------------------------
  // Connection management
  // ------------------------------------------------------------------

  async connect(): Promise<void> {
    if (this.socket) return;

    return new Promise<void>((resolve, reject) => {
      const socket = new Socket();
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error(`Session Server connection timed out after ${this.connectTimeoutMs}ms`));
      }, this.connectTimeoutMs);

      socket.connect(this.ipcPath, () => {
        clearTimeout(timer);
        this.socket = socket;
        this.setupSocket(socket);
        resolve();
      });

      socket.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  async disconnect(): Promise<void> {
    if (!this.socket) return;
    const socket = this.socket;
    this.socket = undefined;

    // Reject all pending requests
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Client disconnected"));
    }
    this.pending.clear();

    return new Promise<void>((resolve) => {
      socket.end(() => resolve());
    });
  }

  private setupSocket(socket: Socket): void {
    socket.setEncoding("utf8");

    socket.on("data", (chunk) => {
      this.buffer += chunk;
      let newlineIndex: number;
      while ((newlineIndex = this.buffer.indexOf("\n")) !== -1) {
        const line = this.buffer.slice(0, newlineIndex);
        this.buffer = this.buffer.slice(newlineIndex + 1);
        if (line.trim()) {
          this.handleMessage(line);
        }
      }
    });

    socket.on("close", () => {
      this.socket = undefined;
    });

    socket.on("error", () => {
      this.socket = undefined;
    });
  }

  private handleMessage(line: string): void {
    let msg: ManagementResponse;
    try {
      msg = JSON.parse(line) as ManagementResponse;
    } catch {
      return;
    }

    if (msg.type === "ok" || msg.type === "error") {
      const pending = this.pending.get(msg.id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(msg.id);
        pending.resolve(msg);
      }
    }
    // I/O streaming messages (client_output, session_exit) are handled
    // separately via the onOutput/onExit callbacks
  }

  private async sendRequest<T>(msg: { id: string; type: string; [key: string]: unknown }): Promise<T> {
    if (!this.socket) {
      await this.connect();
    }

    const id = msg.id;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`IPC request timed out: ${msg.type}`));
      }, this.requestTimeoutMs);

      this.pending.set(id, {
        resolve: (response) => {
          if (response.type === "error") {
            reject(new Error(response.message));
          } else {
            resolve(response.data as T);
          }
        },
        reject,
        timer
      });

      this.socket!.write(`${JSON.stringify(msg)}\n`, (error) => {
        if (error) {
          clearTimeout(timer);
          this.pending.delete(id);
          reject(error);
        }
      });
    });
  }

  // ------------------------------------------------------------------
  // TmuxClient interface implementation
  // ------------------------------------------------------------------

  async createSession(options: TmuxCreateOptions): Promise<void> {
    // Extract sessionId from the tmuxName
    const sessionId = this.nameToSessionId.get(options.name) ?? options.name;
    this.nameToSessionId.set(options.name, sessionId);

    await this.sendRequest({
      id: randomUUID(),
      type: "create_session",
      sessionId,
      userId: "",
      attachToken: "",
      launchPlan: {
        command: options.command,
        args: options.args,
        cwd: options.cwd,
        env: options.env,
        secretEnvNames: [],
        credentialMode: "host_environment"
      } satisfies LaunchPlanPayload
    });
  }

  async configureSession(name: string): Promise<void> {
    // No-op in the new architecture — tmux session configuration is not needed.
    // The IPC call exists for interface compatibility.
    const sessionId = this.nameToSessionId.get(name) ?? name;
    await this.sendRequest({
      id: randomUUID(),
      type: "configure_session",
      sessionId
    });
  }

  async killSession(name: string): Promise<void> {
    const sessionId = this.nameToSessionId.get(name) ?? name;
    this.nameToSessionId.delete(name);
    await this.sendRequest({
      id: randomUUID(),
      type: "kill_session",
      sessionId
    });
  }

  async capturePane(name: string): Promise<string> {
    const sessionId = this.nameToSessionId.get(name) ?? name;
    const result = await this.sendRequest<{ content: string }>({
      id: randomUUID(),
      type: "capture_pane",
      sessionId
    });
    return result.content;
  }

  async listSessions(): Promise<string[]> {
    const result = await this.sendRequest<Array<{ sessionId: string }>>({
      id: randomUUID(),
      type: "list_sessions"
    });
    // Return sessionIds (the new architecture doesn't use tmuxNames)
    return result.map((s) => s.sessionId);
  }

  async hasSession(name: string): Promise<boolean> {
    const sessionId = this.nameToSessionId.get(name) ?? name;
    const result = await this.sendRequest<{ exists: boolean }>({
      id: randomUUID(),
      type: "has_session",
      sessionId
    });
    return result.exists;
  }

  async showEnvironment(name: string): Promise<Record<string, string>> {
    const sessionId = this.nameToSessionId.get(name) ?? name;
    return this.sendRequest<Record<string, string>>({
      id: randomUUID(),
      type: "show_environment",
      sessionId
    });
  }

  async resizeWindow(name: string, cols: number, rows: number): Promise<void> {
    const sessionId = this.nameToSessionId.get(name) ?? name;
    await this.sendRequest({
      id: randomUUID(),
      type: "resize_window",
      sessionId,
      cols,
      rows
    });
  }

  async sendInput(name: string, data: string): Promise<void> {
    const sessionId = this.nameToSessionId.get(name) ?? name;
    await this.sendRequest({
      id: randomUUID(),
      type: "send_input",
      sessionId,
      data
    });
  }

  async inspectPane(name: string): Promise<TmuxPaneSnapshot> {
    const sessionId = this.nameToSessionId.get(name) ?? name;
    const result = await this.sendRequest<PaneSnapshot>({
      id: randomUUID(),
      type: "inspect_pane",
      sessionId
    });
    return {
      content: result.content,
      dead: result.dead,
      inMode: result.inMode
    };
  }

  async stageProgrammaticInput(name: string, data: string): Promise<void> {
    const sessionId = this.nameToSessionId.get(name) ?? name;
    await this.sendRequest({
      id: randomUUID(),
      type: "stage_programmatic_input",
      sessionId,
      data
    });
  }

  async pressEnter(name: string): Promise<void> {
    const sessionId = this.nameToSessionId.get(name) ?? name;
    await this.sendRequest({
      id: randomUUID(),
      type: "press_enter",
      sessionId
    });
  }
}
