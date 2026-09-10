/**
 * SessionServerPty — an IPty-compatible wrapper that communicates with the
 * Session Server via IPC instead of managing a local node-pty process.
 *
 * This allows the WebSocket terminal handler to work unchanged: it still
 * receives an IPty-like object with onData/onExit/write/resize/kill, but
 * the actual pty process lives in the Session Server.
 *
 * Each SessionServerPty instance opens its own IPC connection to the
 * Session Server, identified by a unique clientId. Output from the session
 * is streamed over this connection.
 */
import { Socket } from "node:net";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";

import { performClientHello } from "./session-server/hello-handshake.js";
import {
  readSessionServerTokenFile,
  resolveSessionServerTokenPath
} from "./session-server/auth-token.js";

export interface SessionServerPtyOptions {
  ipcPath: string;
  sessionId: string;
  /** Handshake token; when omitted, read from the state-dir token file. */
  token?: string;
  tokenPath?: string;
  connectTimeoutMs?: number;
}

/** Result of a successful attach: the full rendered snapshot to replay. */
export interface SessionServerAttachResult {
  snapshot: string | undefined;
}

interface PtyEventMap {
  data: (data: string) => void;
  exit: (event: { exitCode: number; signal?: number }) => void;
  /**
   * The IPC transport dropped without a session_exit message (daemon crash,
   * socket failure). This is NOT a process exit — listeners must surface a
   * reconnect/unreachable path and must never report exit code 0.
   */
  transportClose: () => void;
  /** A client_resize the server rejected or never answered. */
  resizeError: (error: Error) => void;
}

export class SessionServerPty {
  private socket: Socket | undefined;
  private buffer = "";
  private readonly clientId = randomUUID();
  private readonly emitter = new EventEmitter();
  private readonly ipcPath: string;
  private readonly sessionId: string;
  private readonly token: string | undefined;
  private readonly tokenPath: string | undefined;
  private readonly connectTimeoutMs: number;
  private exited = false;
  private detached = false;
  private outputPaused = false;
  private attachWaiter: {
    resolve: (result: SessionServerAttachResult) => void;
    reject: (reason: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  } | undefined;
  /**
   * Output received before the attach ack is consumed is buffered and emitted
   * right after connect() resolves, so replay order stays
   * snapshot -> attach-window output -> live stream.
   */
  private preLiveData: string[] = [];
  private liveData = false;
  private pendingExit: { exitCode: number } | undefined;
  private readonly pendingResize = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(options: SessionServerPtyOptions) {
    this.ipcPath = options.ipcPath;
    this.sessionId = options.sessionId;
    this.token = options.token;
    this.tokenPath = options.tokenPath;
    this.connectTimeoutMs = options.connectTimeoutMs ?? 5000;
  }

  /**
   * Connect to the Session Server and attach to the session.
   * Resolves after the IPC connection is established, the hello handshake has
   * completed, and the server acknowledged the attach with a rendered
   * snapshot; rejects with the server's explicit error when the attach fails
   * (e.g. unknown session) instead of leaving the terminal black.
   */
  async connect(): Promise<SessionServerAttachResult> {
    if (this.socket) return { snapshot: undefined };

    const socket = new Socket();
    await this.waitConnected(socket);

    try {
      const token = this.token ?? readSessionServerTokenFile(this.tokenPath ?? resolveSessionServerTokenPath());
      const hello = await performClientHello(socket, token, this.connectTimeoutMs);
      this.buffer = hello.leftover;
    } catch (error) {
      socket.destroy();
      throw error;
    }

    this.socket = socket;
    this.setupSocket(socket);

    const result = await this.waitAttachAck(socket);
    // Flush after the caller's continuation has registered onData listeners
    // (promise microtasks run before this setImmediate macrotask).
    setImmediate(() => this.flushPreLiveData());
    return result;
  }

  private waitAttachAck(socket: Socket): Promise<SessionServerAttachResult> {
    return new Promise<SessionServerAttachResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.attachWaiter = undefined;
        socket.destroy();
        reject(new Error(`Session Server attach timed out after ${this.connectTimeoutMs}ms`));
      }, this.connectTimeoutMs);

      this.attachWaiter = {
        resolve: (result) => {
          clearTimeout(timer);
          this.attachWaiter = undefined;
          resolve(result);
        },
        reject: (reason) => {
          clearTimeout(timer);
          this.attachWaiter = undefined;
          socket.destroy();
          reject(reason);
        },
        timer
      };

      this.sendIpc({
        type: "attach_client",
        sessionId: this.sessionId,
        clientId: this.clientId
      });
    });
  }

  private flushPreLiveData(): void {
    this.liveData = true;
    while (this.preLiveData.length && !this.outputPaused && !this.detached) {
      const data = this.preLiveData.shift()!;
      this.emitter.emit("data", data);
    }
    if (!this.preLiveData.length && this.pendingExit && !this.detached) {
      const event = this.pendingExit;
      this.pendingExit = undefined;
      this.emitter.emit("exit", event);
    }
  }

  /** Pause IPC consumption until the browser acknowledges rendered output. */
  setOutputPaused(paused: boolean): void {
    this.outputPaused = paused;
    if (paused) this.socket?.pause();
    else {
      this.socket?.resume();
      if (this.liveData) setImmediate(() => this.flushPreLiveData());
    }
  }

  private waitConnected(socket: Socket): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error(`Session Server I/O connection timed out after ${this.connectTimeoutMs}ms`));
      }, this.connectTimeoutMs);

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

  /**
   * Write data to the session's pty (terminal input).
   */
  write(data: string): void {
    if (this.exited) return;
    this.sendIpc({
      type: "client_input",
      sessionId: this.sessionId,
      clientId: this.clientId,
      data
    });
  }

  /**
   * Resize the session's pty window. The server answers the request (the
   * message carries an id); failures surface via onResizeError instead of
   * being silently dropped.
   */
  resize(cols: number, rows: number): void {
    if (this.exited || !this.socket) return;
    const id = randomUUID();
    const timer = setTimeout(() => {
      this.pendingResize.delete(id);
      this.emitter.emit("resizeError", new Error(`resize ${cols}x${rows} timed out`));
    }, this.connectTimeoutMs);
    timer.unref?.();
    this.pendingResize.set(id, timer);
    this.sendIpc({
      type: "client_resize",
      id,
      sessionId: this.sessionId,
      clientId: this.clientId,
      cols,
      rows
    });
  }

  /**
   * Kill the underlying IPC connection (does not kill the session).
   */
  kill(): void {
    this.detach();
  }

  /**
   * Subscribe to terminal output.
   */
  onData(listener: PtyEventMap["data"]): { dispose: () => void } {
    this.emitter.on("data", listener);
    return { dispose: () => this.emitter.off("data", listener) };
  }

  /**
   * Subscribe to process exit.
   */
  onExit(listener: PtyEventMap["exit"]): { dispose: () => void } {
    this.emitter.on("exit", listener);
    return { dispose: () => this.emitter.off("exit", listener) };
  }

  /**
   * Subscribe to unexpected transport loss. A dropped IPC connection is
   * indistinguishable from a daemon crash, so this is an error/reconnect
   * signal — never a clean exit.
   */
  onTransportClose(listener: PtyEventMap["transportClose"]): { dispose: () => void } {
    this.emitter.on("transportClose", listener);
    return { dispose: () => this.emitter.off("transportClose", listener) };
  }

  /**
   * Subscribe to rejected/unanswered resize requests.
   */
  onResizeError(listener: PtyEventMap["resizeError"]): { dispose: () => void } {
    this.emitter.on("resizeError", listener);
    return { dispose: () => this.emitter.off("resizeError", listener) };
  }

  // ------------------------------------------------------------------
  // Internal
  // ------------------------------------------------------------------

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
      this.clearPendingResize();
      // A pending attach must reject, not hang until its own timeout.
      this.attachWaiter?.reject(new Error("Session Server connection closed during attach"));
      // A session_exit message marks a real CLI exit. A transport close
      // without one means the daemon (or the connection) died — surface it
      // as transport loss, never as exit code 0.
      if (this.exited || this.detached) return;
      this.emitter.emit("transportClose");
    });

    socket.on("error", () => {
      this.socket = undefined;
    });
  }

  private clearPendingResize(): void {
    for (const [, timer] of this.pendingResize) {
      clearTimeout(timer);
    }
    this.pendingResize.clear();
  }

  private handleMessage(line: string): void {
    let msg: {
      type: string;
      id?: string;
      sessionId?: string;
      clientId?: string;
      data?: string;
      exitCode?: number;
      ok?: boolean;
      snapshot?: string;
      error?: string;
      message?: string;
    };
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }

    if (msg.type === "attach_ack" && msg.clientId === this.clientId) {
      if (msg.ok) {
        this.attachWaiter?.resolve({ snapshot: msg.snapshot });
      } else {
        this.attachWaiter?.reject(new Error(msg.error ?? "attach rejected"));
      }
      return;
    }

    if (msg.type === "client_output" && msg.sessionId === this.sessionId && msg.clientId === this.clientId) {
      const data = msg.data ?? "";
      if (this.liveData && !this.outputPaused && this.preLiveData.length === 0) {
        this.emitter.emit("data", data);
      } else {
        this.preLiveData.push(data);
      }
      return;
    }

    if (msg.type === "session_exit" && msg.sessionId === this.sessionId) {
      this.exited = true;
      this.pendingExit = { exitCode: msg.exitCode ?? 0 };
      if (this.liveData) this.flushPreLiveData();
      return;
    }

    // Resize receipts (client_resize carries an id).
    if ((msg.type === "ok" || msg.type === "error") && msg.id && this.pendingResize.has(msg.id)) {
      const timer = this.pendingResize.get(msg.id);
      if (timer) clearTimeout(timer);
      this.pendingResize.delete(msg.id);
      if (msg.type === "error") {
        this.emitter.emit("resizeError", new Error(msg.message ?? "resize rejected"));
      }
      return;
    }

    // Remaining I/O-stream failures (input/write errors carry no id). Surface
    // them instead of silently dropping — a failed input write is otherwise
    // invisible (the terminal just goes unresponsive).
    if (msg.type === "error") {
      console.error(
        `[session-server-pty] error for session ${this.sessionId}: ${msg.message ?? "unknown"}`
      );
    }
  }

  private sendIpc(msg: Record<string, unknown>): void {
    if (!this.socket) return;
    this.socket.write(`${JSON.stringify(msg)}\n`);
  }

  private detach(): void {
    if (!this.socket) return;
    this.detached = true;
    this.sendIpc({
      type: "detach_client",
      sessionId: this.sessionId,
      clientId: this.clientId
    });
    // close cleanup in the daemon detaches this client. Destroy also releases
    // paused reads; end() alone can leave a paused half-open socket forever.
    this.socket.destroy();
    this.socket = undefined;
    this.preLiveData = [];
    this.clearPendingResize();
  }
}
