/**
 * Core Session Server — manages pty sessions for ForgeBadger.
 *
 * Replaces tmux/psmux with direct node-pty management:
 *   - Spawns CLI processes via node-pty
 *   - Renders every session through a headless terminal screen
 *     (capture/inspect/replay read the rendered screen)
 *   - Handles multi-client attach/detach with attach-window buffering
 *   - Provides session lifecycle (create/kill/list/inspect)
 *
 * The Session Server runs as a standalone Node.js process and communicates
 * with the Gateway via IPC (Unix Domain Socket / Named Pipe).
 */
import { setImmediate as setImmediateCb } from "node:timers";

import { createPlatformAdapter, disposePty, type PlatformPtyAdapter } from "./platform-adapter.js";
import { SessionHandle } from "./session-handle.js";
import { buildSanitizedEnv } from "./env-policy.js";
import type { LaunchPlanPayload, PaneSnapshot, SessionInfo } from "./ipc-protocol.js";

export interface SessionServerOptions {
  platformAdapter?: PlatformPtyAdapter;
  /** Headless screen scrollback per session (test hook; default 10000). */
  scrollback?: number;
  /** Write-queue watermark tuning per session (test hook; 2MiB/512KiB default). */
  screenFlowControl?: { highWaterBytes: number; lowWaterBytes: number };
  onSessionExit?: ((sessionId: string, exitCode: number) => void) | undefined;
  onSessionOutput?: ((sessionId: string, clientId: string, data: string) => void) | undefined;
}

export interface AttachResult {
  /** Full rendered snapshot (scrollback + screen + modes) for replay. */
  snapshot: string;
}

export class SessionServer {
  private readonly sessions = new Map<string, SessionHandle>();
  /** Session IDs with a createSession call in flight (guards the await gap). */
  private readonly pendingCreates = new Set<string>();
  private readonly platformAdapter: PlatformPtyAdapter;
  private readonly scrollback: number | undefined;
  private readonly screenFlowControl: { highWaterBytes: number; lowWaterBytes: number } | undefined;
  /** Callback for session exit events — settable via setter for IpcServer wiring. */
  private _onSessionExit?: ((sessionId: string, exitCode: number) => void) | undefined;
  /** Callback for session output events — settable via setter for IpcServer wiring. */
  private _onSessionOutput?: ((sessionId: string, clientId: string, data: string) => void) | undefined;

  constructor(options: SessionServerOptions = {}) {
    this.platformAdapter = options.platformAdapter ?? createPlatformAdapter();
    this.scrollback = options.scrollback;
    this.screenFlowControl = options.screenFlowControl;
    this._onSessionExit = options.onSessionExit;
    this._onSessionOutput = options.onSessionOutput;
  }

  get onSessionExit(): ((sessionId: string, exitCode: number) => void) | undefined {
    return this._onSessionExit;
  }

  set onSessionExit(value: ((sessionId: string, exitCode: number) => void) | undefined) {
    this._onSessionExit = value;
  }

  get onSessionOutput(): ((sessionId: string, clientId: string, data: string) => void) | undefined {
    return this._onSessionOutput;
  }

  set onSessionOutput(value: ((sessionId: string, clientId: string, data: string) => void) | undefined) {
    this._onSessionOutput = value;
  }

  // ------------------------------------------------------------------
  // Session lifecycle
  // ------------------------------------------------------------------

  async createSession(input: {
    sessionId: string;
    userId: string;
    attachToken: string;
    launchPlan: LaunchPlanPayload;
  }): Promise<SessionHandle> {
    const { sessionId, userId, attachToken, launchPlan } = input;

    // Claim the ID synchronously — the dynamic import below yields the event
    // loop, and without this placeholder two concurrent creates with the same
    // ID would both pass the existence check and double-spawn.
    if (this.sessions.has(sessionId) || this.pendingCreates.has(sessionId)) {
      throw new Error(`Session already exists: ${sessionId}`);
    }
    this.pendingCreates.add(sessionId);

    try {
      return await this.spawnSession(sessionId, userId, attachToken, launchPlan);
    } finally {
      this.pendingCreates.delete(sessionId);
    }
  }

  private async spawnSession(
    sessionId: string,
    userId: string,
    attachToken: string,
    launchPlan: LaunchPlanPayload
  ): Promise<SessionHandle> {
    // Resolve command (Windows shim handling)
    const resolved = this.platformAdapter.resolveCommand(
      launchPlan.command,
      process.env
    );

    // Build pty environment from a sanitized base: the server process env is
    // allowlist-filtered so Gateway secrets can never leak into a terminal.
    // The pty is configured as xterm-256color (see `name` below), so TERM
    // must match — otherwise CLIs like Kimi Code see the parent process's
    // TERM (often "dumb" on Windows or unset in service contexts) and
    // disable color output. launchPlan.env is the only trusted override
    // source (it carries session-manager's FORGEBADGER_ATTACH_TOKEN etc.).
    const env: Record<string, string> = {
      ...buildSanitizedEnv(process.env),
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      ...launchPlan.env
    };

    // Spawn via node-pty (dynamic import to avoid loading on server startup)
    const { spawn } = await import("node-pty");
    const pty = spawn(resolved.command, [...resolved.args, ...launchPlan.args], {
      name: "xterm-256color",
      cwd: launchPlan.cwd,
      cols: 120,
      rows: 40,
      env
    });

    const handle = new SessionHandle({
      sessionId,
      userId,
      attachToken,
      ownerSessionId: launchPlan.env.FORGEBADGER_SESSION_ID,
      pty,
      scrollback: this.scrollback,
      screenFlowControl: this.screenFlowControl
    });

    // Feed the headless screen and relay to attached clients in one pass.
    pty.onData((data) => {
      handle.screen.write(data);
      handle.fanOut(data, (clientId, chunk) => {
        this.onSessionOutput?.(sessionId, clientId, chunk);
      });
    });

    // Handle CLI process exit. disposePty tears down node-pty's leftover
    // ConPTY handles (socket worker + conin/conout sockets), which the
    // library never releases on its own and which would keep the event
    // loop alive after every session has exited.
    pty.onExit(({ exitCode }) => {
      handle.markExited(exitCode);
      disposePty(pty);
      this.onSessionExit?.(sessionId, exitCode);
    });

    this.sessions.set(sessionId, handle);
    return handle;
  }

  async killSession(sessionId: string): Promise<void> {
    const handle = this.requireSession(sessionId);
    handle.kill();
    handle.disposeResources();
    this.sessions.delete(sessionId);
  }

  /**
   * Remove a session from the registry without killing the pty (the pty is
   * expected to be dead already — this is the natural-exit cleanup path).
   */
  removeSession(sessionId: string): void {
    this.sessions.get(sessionId)?.disposeResources();
    this.sessions.delete(sessionId);
  }

  listSessions(): SessionInfo[] {
    return [...this.sessions.values()].map((h) => ({
      sessionId: h.sessionId,
      userId: h.userId,
      status: h.status
    }));
  }

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  getSession(sessionId: string): SessionHandle | undefined {
    return this.sessions.get(sessionId);
  }

  // ------------------------------------------------------------------
  // Terminal I/O
  // ------------------------------------------------------------------

  /** tmux `capture-pane -e -S -500` equivalent (rendered, ANSI preserved). */
  capturePane(sessionId: string): Promise<string> {
    const handle = this.requireSession(sessionId);
    return handle.captureSerialized(500);
  }

  showEnvironment(sessionId: string): Record<string, string> {
    // Mirror tmux show-environment semantics: expose the ForgeBadger
    // ownership markers so session-manager.attachExistingSession can verify
    // that a server-side session belongs to the requesting ForgeBadger
    // session (and carries the same attach token).
    const handle = this.requireSession(sessionId);
    const env: Record<string, string> = {
      FORGEBADGER_SESSION_ID: handle.ownerSessionId ?? handle.sessionId
    };
    if (handle.attachToken) {
      env.FORGEBADGER_ATTACH_TOKEN = handle.attachToken;
    }
    return env;
  }

  resizeWindow(sessionId: string, cols: number, rows: number): void {
    const handle = this.requireSession(sessionId);
    handle.resize(cols, rows);
  }

  sendInput(sessionId: string, data: string): void {
    const handle = this.requireSession(sessionId);
    handle.write(data);
  }

  /** Rendered current-viewport text (for programmatic composer detection). */
  inspectPane(sessionId: string): Promise<PaneSnapshot> {
    const handle = this.requireSession(sessionId);
    return handle.inspectRendered();
  }

  /** Bracketed-paste staging; the handle validates the payload itself. */
  stageProgrammaticInput(sessionId: string, data: string): void {
    const handle = this.requireSession(sessionId);
    handle.stageProgrammaticInput(data);
  }

  pressEnter(sessionId: string): void {
    const handle = this.requireSession(sessionId);
    handle.write("\r");
  }

  // ------------------------------------------------------------------
  // Client attach/detach
  // ------------------------------------------------------------------

  /**
   * Attach a client with ordered replay: pause the pty, let in-flight reads
   * land and the write queue drain, register the client in buffering mode,
   * take the snapshot, then release. Output produced after registration is
   * buffered per client; endClientBuffering flushes it after the ack, so the
   * wire order is snapshot -> buffered output -> live stream with no gap and
   * no duplication.
   */
  async attachClient(sessionId: string, clientId: string): Promise<AttachResult> {
    const handle = this.requireSession(sessionId);
    handle.pauseSource("attach");
    try {
      // pty.pause() stops future reads, but data already read by node-pty may
      // still be delivered; yield a macrotask so it lands in the screen, then
      // wait for the write queue to drain. Afterwards the client registration
      // and the snapshot must stay in one synchronous block: a pty data event
      // cannot interleave, so anything parsed so far is in the snapshot and
      // anything arriving later is buffered for the post-ack flush — no gap,
      // no duplication.
      await new Promise<void>((resolve) => setImmediateCb(resolve));
      await handle.screen.whenIdle();
      handle.addClientBuffering(clientId);
      return { snapshot: handle.screen.serializeSnapshot() };
    } finally {
      handle.resumeSource("attach");
    }
  }

  /**
   * Switch an attaching client to live streaming; returns the output buffered
   * since registration (to be flushed to the client right after the ack).
   */
  endClientBuffering(sessionId: string, clientId: string): string[] {
    const handle = this.sessions.get(sessionId);
    if (!handle) return [];
    return handle.endClientBuffering(clientId);
  }

  detachClient(sessionId: string, clientId: string): void {
    const handle = this.sessions.get(sessionId);
    if (handle) {
      handle.removeClient(clientId);
    }
  }

  // ------------------------------------------------------------------
  // Backpressure (data plane)
  // ------------------------------------------------------------------

  /** Pause a session's pty reads (slow-client backpressure etc.). */
  pauseSessionOutput(sessionId: string, source: string): void {
    this.sessions.get(sessionId)?.pauseSource(source);
  }

  /** Release a pause source; the pty resumes when every source has cleared. */
  resumeSessionOutput(sessionId: string, source: string): void {
    this.sessions.get(sessionId)?.resumeSource(source);
  }

  // ------------------------------------------------------------------
  // Internal
  // ------------------------------------------------------------------

  private requireSession(sessionId: string): SessionHandle {
    const handle = this.sessions.get(sessionId);
    if (!handle) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    return handle;
  }

  /** Kill all sessions (called on shutdown). */
  async destroy(): Promise<void> {
    const promises = [...this.sessions.values()].map((handle) => {
      try {
        handle.kill();
        handle.disposeResources();
      } catch {
        // Ignore errors during shutdown
      }
    });
    await Promise.all(promises);
    this.sessions.clear();
  }
}
