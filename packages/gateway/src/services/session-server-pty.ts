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

import type { IPty } from "node-pty";

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
  connectTimeoutMs?: number;
}

interface PtyEventMap {
  data: (data: string) => void;
  exit: (event: { exitCode: number; signal?: number }) => void;
}

export class SessionServerPty {
  private socket: Socket | undefined;
  private buffer = "";
  private readonly clientId = randomUUID();
  private readonly emitter = new EventEmitter();
  private readonly ipcPath: string;
  private readonly sessionId: string;
  private readonly token: string | undefined;
  private readonly connectTimeoutMs: number;
  private exited = false;

  constructor(options: SessionServerPtyOptions) {
    this.ipcPath = options.ipcPath;
    this.sessionId = options.sessionId;
    this.token = options.token;
    this.connectTimeoutMs = options.connectTimeoutMs ?? 5000;
  }

  /**
   * Connect to the Session Server and attach to the session.
   * Returns after the IPC connection is established, the hello handshake has
   * completed, and the attach message has been sent.
   */
  async connect(): Promise<void> {
    if (this.socket) return;

    const socket = new Socket();
    await this.waitConnected(socket);

    let leftover = "";
    try {
      const token = this.token ?? readSessionServerTokenFile(resolveSessionServerTokenPath());
      leftover = await performClientHello(socket, token, this.connectTimeoutMs);
    } catch (error) {
      socket.destroy();
      throw error;
    }

    this.socket = socket;
    this.buffer = leftover;
    this.setupSocket(socket);

    // Send attach message
    this.sendIpc({
      type: "attach_client",
      sessionId: this.sessionId,
      clientId: this.clientId
    });
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
   * Resize the session's pty window.
   */
  resize(cols: number, rows: number): void {
    if (this.exited) return;
    this.sendIpc({
      type: "client_resize",
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
      this.emitter.emit("exit", { exitCode: 0 });
    });

    socket.on("error", () => {
      this.socket = undefined;
    });
  }

  private handleMessage(line: string): void {
    let msg: { type: string; sessionId?: string; clientId?: string; data?: string; exitCode?: number };
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }

    if (msg.type === "client_output" && msg.sessionId === this.sessionId && msg.clientId === this.clientId) {
      this.emitter.emit("data", msg.data ?? "");
      return;
    }

    if (msg.type === "session_exit" && msg.sessionId === this.sessionId) {
      this.exited = true;
      this.emitter.emit("exit", { exitCode: msg.exitCode ?? 0 });
      return;
    }

    // I/O-stream messages (attach_client / client_input / client_resize)
    // carry no `id`, so the ipc-server replies with id:"" on failure. Surface
    // those instead of silently dropping them — a failed attach or input
    // write is otherwise invisible (the terminal just goes black/unresponsive).
    if (msg.type === "error") {
      console.error(
        `[session-server-pty] error for session ${this.sessionId}: ${(msg as { message?: string }).message ?? "unknown"}`
      );
    }
  }

  private sendIpc(msg: Record<string, unknown>): void {
    if (!this.socket) return;
    this.socket.write(`${JSON.stringify(msg)}\n`);
  }

  private detach(): void {
    if (!this.socket) return;
    this.sendIpc({
      type: "detach_client",
      sessionId: this.sessionId,
      clientId: this.clientId
    });
    this.socket.end();
    this.socket = undefined;
  }
}
