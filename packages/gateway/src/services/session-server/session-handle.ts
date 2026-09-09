/**
 * Per-session handle — manages a single CLI process via node-pty.
 *
 * Each SessionHandle owns:
 *   - The node-pty IPty instance (the actual CLI process)
 *   - An output ring buffer for scrollback
 *   - A set of attached client IDs (for multi-client relay)
 */
import type { IPty } from "node-pty";

import { OutputRingBuffer } from "./output-ring-buffer.js";
import type { PaneSnapshot } from "./ipc-protocol.js";

export interface SessionHandleOptions {
  sessionId: string;
  userId: string;
  attachToken: string;
  pty: IPty;
  ringBuffer: OutputRingBuffer;
}

export class SessionHandle {
  readonly sessionId: string;
  readonly userId: string;
  readonly attachToken: string;
  readonly pty: IPty;
  readonly ringBuffer: OutputRingBuffer;

  /** Client IDs currently attached to this session (for output relay). */
  private readonly clients = new Set<string>();
  private _status: "running" | "exited" | "error" = "running";
  private _exitCode: number | undefined;

  constructor(options: SessionHandleOptions) {
    this.sessionId = options.sessionId;
    this.userId = options.userId;
    this.attachToken = options.attachToken;
    this.pty = options.pty;
    this.ringBuffer = options.ringBuffer;
  }

  get status(): "running" | "exited" | "error" {
    return this._status;
  }

  get exitCode(): number | undefined {
    return this._exitCode;
  }

  get clientCount(): number {
    return this.clients.size;
  }

  addClient(clientId: string): void {
    this.clients.add(clientId);
  }

  removeClient(clientId: string): void {
    this.clients.delete(clientId);
  }

  hasClient(clientId: string): boolean {
    return this.clients.has(clientId);
  }

  getClients(): string[] {
    return [...this.clients];
  }

  /** Mark the session as exited (called when the CLI process exits). */
  markExited(exitCode: number): void {
    this._status = "exited";
    this._exitCode = exitCode;
  }

  /** Mark the session as error. */
  markError(): void {
    this._status = "error";
  }

  /** Write raw data to the pty (terminal input). */
  write(data: string): void {
    this.pty.write(data);
  }

  /** Resize the pty window. */
  resize(cols: number, rows: number): void {
    this.pty.resize(cols, rows);
  }

  /** Kill the underlying CLI process. No-op once exited — killing an
   *  already-dead ConPTY pty spawns a stray console-list agent fork. */
  kill(): void {
    if (this._status === "running") {
      this.pty.kill();
    }
  }

  /** Get the current pane snapshot (for programmatic input staging). */
  getPaneSnapshot(): PaneSnapshot {
    const tail = this.ringBuffer.getTail(50);
    const content = tail.output;
    return {
      content,
      dead: this._status !== "running",
      inMode: false
    };
  }

  /** Get scrollback content (for reconnection). */
  getScrollback(maxLines = 500): string {
    return this.ringBuffer.getTail(maxLines).output;
  }
}
