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
import { performClientHello } from "./session-server/hello-handshake.js";
import {
  readSessionServerTokenFile,
  resolveSessionServerTokenPath
} from "./session-server/auth-token.js";

export interface SessionServerClientOptions {
  ipcPath: string;
  /** Handshake token; when omitted, read from the state-dir token file. */
  token?: string;
  /**
   * Token file path re-read on every (re)connect. Preferred over `token`
   * whenever the daemon may be respawned, because each spawn rotates it.
   */
  tokenPath?: string;
  connectTimeoutMs?: number;
  requestTimeoutMs?: number;
}

/** Identity of the daemon the client is currently connected to. */
export interface SessionServerIdentity {
  pid: number;
  startedAt: string;
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
  private readonly token: string | undefined;
  private readonly tokenPath: string | undefined;
  private readonly connectTimeoutMs: number;
  private readonly requestTimeoutMs: number;
  private intentionalClose = false;
  private serverIdentity: SessionServerIdentity | undefined;
  private restartPending = false;

  /**
   * Fired when the management socket closes unexpectedly (daemon crash or
   * network failure). Not fired for an intentional disconnect().
   */
  onDisconnect: (() => void) | undefined;
  /** Fired when a connect attempt fails — drives circuit-breaker re-arm. */
  onConnectError: ((error: Error) => void) | undefined;

  /** Maps tmuxName → sessionId for TmuxClient interface compatibility. */
  private readonly nameToSessionId = new Map<string, string>();

  constructor(options: SessionServerClientOptions) {
    this.ipcPath = options.ipcPath;
    this.token = options.token;
    this.tokenPath = options.tokenPath;
    this.connectTimeoutMs = options.connectTimeoutMs ?? 5000;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 10_000;
  }

  // ------------------------------------------------------------------
  // Connection management
  // ------------------------------------------------------------------

  async connect(timeoutOverrideMs?: number): Promise<void> {
    if (this.socket) return;
    const timeoutMs = timeoutOverrideMs ?? this.connectTimeoutMs;

    const socket = new Socket();
    try {
      await this.waitConnected(socket, timeoutMs);
    } catch (error) {
      this.onConnectError?.(error as Error);
      throw error;
    }

    let hello;
    try {
      hello = await performClientHello(socket, this.resolveToken(), timeoutMs);
    } catch (error) {
      socket.destroy();
      this.onConnectError?.(error as Error);
      throw error;
    }

    // A changed pid/startedAt means the daemon was restarted behind us; its
    // registry is empty and previously running sessions are gone (lost).
    const nextIdentity: SessionServerIdentity = {
      pid: hello.pid ?? 0,
      startedAt: hello.startedAt ?? ""
    };
    if (
      this.serverIdentity
      && (this.serverIdentity.pid !== nextIdentity.pid
        || this.serverIdentity.startedAt !== nextIdentity.startedAt)
    ) {
      this.restartPending = true;
    }
    this.serverIdentity = nextIdentity;

    this.intentionalClose = false;
    this.socket = socket;
    this.buffer = hello.leftover;
    this.setupSocket(socket);
    await this.syncSessionRegistry();
  }

  /** Identity of the connected daemon (from hello_ok), for diagnostics. */
  getServerIdentity(): SessionServerIdentity | undefined {
    return this.serverIdentity;
  }

  /**
   * One-shot restart signal: returns true once after a reconnect observed a
   * different daemon instance. session-manager consumes this per correction
   * scan and marks orphaned sessions `lost` instead of `exited`.
   */
  consumeServerRestarted(): boolean {
    const restarted = this.restartPending;
    this.restartPending = false;
    return restarted;
  }

  /** Rebuild the name→sessionId map from the daemon's registry. The current
   *  convention is "sessionId is the tmux-style name", so the mapping is
   *  identity; this keeps it authoritative across Gateway restarts. Best
   *  effort with a short timeout — connect must not stall on a daemon that
   *  accepts the handshake but stalls management answers. */
  private async syncSessionRegistry(): Promise<void> {
    try {
      const sessions = await this.sendRequest<Array<{ sessionId: string }>>({
        id: randomUUID(),
        type: "list_sessions"
      }, 3000);
      for (const session of sessions) {
        if (!this.nameToSessionId.has(session.sessionId)) {
          this.nameToSessionId.set(session.sessionId, session.sessionId);
        }
      }
    } catch {
      // Registry sync is best-effort; lookups fall back to the raw name.
    }
  }

  private waitConnected(socket: Socket, timeoutMs: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error(`Session Server connection timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      socket.connect(this.ipcPath, () => {
        clearTimeout(timer);
        resolve();
      });

      socket.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  private resolveToken(): string {
    if (this.token) return this.token;
    return readSessionServerTokenFile(this.tokenPath ?? resolveSessionServerTokenPath());
  }

  async disconnect(): Promise<void> {
    if (!this.socket) return;
    const socket = this.socket;
    this.socket = undefined;
    this.intentionalClose = true;

    this.rejectAllPending(new Error("Client disconnected"));

    return new Promise<void>((resolve) => {
      socket.end(() => resolve());
    });
  }

  private rejectAllPending(reason: Error): void {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(reason);
    }
    this.pending.clear();
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
      if (this.socket === socket) {
        this.socket = undefined;
      }
      // A closed transport must reject in-flight requests immediately —
      // they can never complete, and waiting out the request timeout would
      // stall session operations for seconds after a daemon crash.
      this.rejectAllPending(new Error("Session Server connection closed"));
      if (!this.intentionalClose) {
        this.onDisconnect?.();
      }
    });

    socket.on("error", () => {
      // The close event always follows; rejection happens there.
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

  private async sendRequest<T>(
    msg: { id: string; type: string; [key: string]: unknown },
    timeoutMs = this.requestTimeoutMs
  ): Promise<T> {
    if (!this.socket) {
      await this.connect();
    }

    const id = msg.id;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`IPC request timed out: ${msg.type}`));
      }, timeoutMs);

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

    // Ownership metadata rides the launch env (session-manager injects
    // FORGEBADGER_SESSION_ID / FORGEBADGER_ATTACH_TOKEN / FORGEBADGER_USER_ID);
    // the server stores it on the handle so show_environment can prove
    // ownership to a future attachExistingSession call.
    await this.sendRequest({
      id: randomUUID(),
      type: "create_session",
      sessionId,
      userId: options.env.FORGEBADGER_USER_ID ?? "",
      attachToken: options.env.FORGEBADGER_ATTACH_TOKEN ?? "",
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

  /** Maintenance path: ask the daemon to destroy all sessions and exit. */
  async shutdownServer(): Promise<void> {
    await this.sendRequest({
      id: randomUUID(),
      type: "shutdown_server"
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
      // The session-server backend has no copy-mode concept; the legacy
      // TmuxPaneSnapshot interface still requires the field until P4.
      inMode: false
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
