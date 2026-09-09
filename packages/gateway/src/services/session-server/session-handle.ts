/**
 * Per-session handle — manages a single CLI process via node-pty plus its
 * headless terminal screen.
 *
 * Each SessionHandle owns:
 *   - The node-pty IPty instance (the actual CLI process)
 *   - A TerminalScreen (headless VT emulator) that renders all pty output;
 *     capture/inspect/replay read from the rendered screen, never a raw
 *     byte ring buffer
 *   - A set of attached client IDs with per-client attach buffering
 *   - Pause sources (VT write-queue watermark, attach quiesce, slow client
 *     backpressure) that share the single pty pause/resume switch
 */
import type { IPty } from "node-pty";

import { assertSafeProgrammaticMessage } from "../programmatic-terminal-submit.js";
import { TerminalScreen } from "./terminal-screen.js";
import type { PaneSnapshot } from "./ipc-protocol.js";

export interface SessionHandleOptions {
  sessionId: string;
  userId: string;
  attachToken: string;
  /** Owning ForgeBadger session id (from launchPlan.env.FORGEBADGER_SESSION_ID). */
  ownerSessionId?: string | undefined;
  pty: IPty;
  /** Headless screen scrollback in lines (test hook; default 10000). */
  scrollback?: number | undefined;
  /** Write-queue watermark tuning (test hook; defaults in terminal-screen). */
  screenFlowControl?: { highWaterBytes: number; lowWaterBytes: number } | undefined;
}

/** Bracketed-paste framing for programmatic input: the bytes reach the pty
 *  directly (no tmux control-mode hex staging), so the CLI treats the staged
 *  task as a paste and never auto-submits mid-content. */
const BRACKETED_PASTE_START = "\x1b[200~";
const BRACKETED_PASTE_END = "\x1b[201~";

export function clientPauseSource(clientId: string): string {
  return `client:${clientId}`;
}

export class SessionHandle {
  readonly sessionId: string;
  readonly userId: string;
  readonly attachToken: string;
  readonly ownerSessionId: string | undefined;
  readonly pty: IPty;
  readonly screen: TerminalScreen;

  /** Attached clients; the value is a buffer while an attach is in flight. */
  private readonly clients = new Map<string, string[] | null>();
  private readonly pauseSources = new Set<string>();
  private _status: "running" | "exited" | "error" = "running";
  private _exitCode: number | undefined;
  private _pauseActivations = 0;

  constructor(options: SessionHandleOptions) {
    this.sessionId = options.sessionId;
    this.userId = options.userId;
    this.attachToken = options.attachToken;
    this.ownerSessionId = options.ownerSessionId;
    this.pty = options.pty;
    this.screen = new TerminalScreen({
      cols: options.pty.cols,
      rows: options.pty.rows,
      ...(options.scrollback !== undefined ? { scrollback: options.scrollback } : {}),
      ...(options.screenFlowControl !== undefined
        ? {
            highWaterBytes: options.screenFlowControl.highWaterBytes,
            lowWaterBytes: options.screenFlowControl.lowWaterBytes
          }
        : {}),
      onFlowPauseChange: (paused) => {
        if (paused) this.pauseSource("vt-flow");
        else this.resumeSource("vt-flow");
      }
    });
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

  get paused(): boolean {
    return this.pauseSources.size > 0;
  }

  /** Total pty pause engagements (flow control + holds) — observability hook. */
  get pauseActivations(): number {
    return this._pauseActivations;
  }

  addClientBuffering(clientId: string): void {
    this.clients.set(clientId, []);
  }

  /** End attach buffering; returns the output staged while attaching. */
  endClientBuffering(clientId: string): string[] {
    const buffer = this.clients.get(clientId) ?? [];
    if (this.clients.has(clientId)) {
      this.clients.set(clientId, null);
    }
    return buffer;
  }

  removeClient(clientId: string): void {
    this.clients.delete(clientId);
    // A departing slow client must not keep the pty paused for the rest.
    this.resumeSource(clientPauseSource(clientId));
  }

  hasClient(clientId: string): boolean {
    return this.clients.has(clientId);
  }

  getClients(): string[] {
    return [...this.clients.keys()];
  }

  /** Live output fan-out: buffers while a client attach is in flight. */
  fanOut(data: string, emit: (clientId: string, data: string) => void): void {
    for (const [clientId, buffer] of this.clients) {
      if (buffer) {
        buffer.push(data);
      } else {
        emit(clientId, data);
      }
    }
  }

  pauseSource(source: string): void {
    if (this._status !== "running") return;
    const wasPaused = this.pauseSources.size > 0;
    this.pauseSources.add(source);
    if (!wasPaused) {
      this._pauseActivations += 1;
      this.pty.pause();
    }
  }

  resumeSource(source: string): void {
    if (!this.pauseSources.delete(source)) return;
    if (this.pauseSources.size === 0 && this._status === "running") {
      this.pty.resume();
    }
  }

  /** Mark the session as exited (called when the CLI process exits). */
  markExited(exitCode: number): void {
    this._status = "exited";
    this._exitCode = exitCode;
    this.pauseSources.clear();
  }

  /** Mark the session as error. */
  markError(): void {
    this._status = "error";
  }

  /** Write raw data to the pty (terminal input). */
  write(data: string): void {
    this.pty.write(data);
  }

  /**
   * Stage a programmatic task into the composer as a bracketed paste.
   * The server re-validates the payload (never trusting the IPC client):
   * C0/C1 control characters are rejected, LF/TAB allowed.
   */
  stageProgrammaticInput(data: string): void {
    assertSafeProgrammaticMessage(data);
    this.pty.write(`${BRACKETED_PASTE_START}${data}${BRACKETED_PASTE_END}`);
  }

  /** Resize the pty window and the headless screen as one atomic pair. */
  resize(cols: number, rows: number): void {
    this.pty.resize(cols, rows);
    this.screen.resize(cols, rows);
  }

  /** Kill the underlying CLI process. No-op once exited — killing an
   *  already-dead ConPTY pty spawns a stray console-list agent fork. */
  kill(): void {
    if (this._status !== "running") {
      return;
    }
    // A paused pty (flow control / client backpressure) with a full read
    // backlog never observes the child's EOF, which strands node-pty's read
    // stream and leaks the process handle — resume before killing.
    this.pauseSources.clear();
    this.pty.resume();
    this.pty.kill();
  }

  /** Release the headless screen (registry removal / kill path). */
  disposeResources(): void {
    this.screen.dispose();
  }

  /** tmux `capture-pane -e -S -500` equivalent: rendered, ANSI preserved. */
  async captureSerialized(scrollbackLines = 500): Promise<string> {
    await this.screen.whenIdle();
    return this.screen.serializeCapture(scrollbackLines);
  }

  /** Rendered current-viewport text for programmatic composer detection. */
  async inspectRendered(): Promise<PaneSnapshot> {
    await this.screen.whenIdle();
    return {
      content: this.screen.renderViewport(),
      dead: this._status !== "running"
    };
  }
}
