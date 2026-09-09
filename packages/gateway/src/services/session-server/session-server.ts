/**
 * Core Session Server — manages pty sessions for ForgeBadger.
 *
 * Replaces tmux/psmux with direct node-pty management:
 *   - Spawns CLI processes via node-pty
 *   - Maintains in-memory scrollback (ring buffer)
 *   - Handles multi-client attach/detach
 *   - Provides session lifecycle (create/kill/list/inspect)
 *
 * The Session Server runs as a standalone Node.js process and communicates
 * with the Gateway via IPC (Unix Domain Socket / Named Pipe).
 */
import type { IPty } from "node-pty";

import { createPlatformAdapter, disposePty, type PlatformPtyAdapter } from "./platform-adapter.js";
import { SessionHandle } from "./session-handle.js";
import { OutputRingBuffer } from "./output-ring-buffer.js";
import { buildSanitizedEnv } from "./env-policy.js";
import type { LaunchPlanPayload, PaneSnapshot, SessionInfo } from "./ipc-protocol.js";

export interface SessionServerOptions {
  platformAdapter?: PlatformPtyAdapter;
  onSessionExit?: ((sessionId: string, exitCode: number) => void) | undefined;
  onSessionOutput?: ((sessionId: string, clientId: string, data: string) => void) | undefined;
}

export class SessionServer {
  private readonly sessions = new Map<string, SessionHandle>();
  /** Session IDs with a createSession call in flight (guards the await gap). */
  private readonly pendingCreates = new Set<string>();
  private readonly platformAdapter: PlatformPtyAdapter;
  /** Callback for session exit events — settable via setter for IpcServer wiring. */
  private _onSessionExit?: ((sessionId: string, exitCode: number) => void) | undefined;
  /** Callback for session output events — settable via setter for IpcServer wiring. */
  private _onSessionOutput?: ((sessionId: string, clientId: string, data: string) => void) | undefined;

  constructor(options: SessionServerOptions = {}) {
    this.platformAdapter = options.platformAdapter ?? createPlatformAdapter();
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

    const ringBuffer = new OutputRingBuffer();
    const handle = new SessionHandle({
      sessionId,
      userId,
      attachToken,
      pty,
      ringBuffer
    });

    // Forward pty output to ring buffer and attached clients
    pty.onData((data) => {
      ringBuffer.append(data);
      this.relayOutputToClients(sessionId, data);
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
    this.sessions.delete(sessionId);
  }

  /**
   * Remove a session from the registry without killing the pty (the pty is
   * expected to be dead already — this is the natural-exit cleanup path).
   */
  removeSession(sessionId: string): void {
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

  capturePane(sessionId: string): string {
    const handle = this.requireSession(sessionId);
    return handle.getScrollback(500);
  }

  showEnvironment(sessionId: string): Record<string, string> {
    // The session server doesn't track per-session env in the same way tmux does.
    // Return an empty object — the caller (session-manager) uses this for
    // attach-token validation, which is handled differently in the new architecture.
    return {};
  }

  resizeWindow(sessionId: string, cols: number, rows: number): void {
    const handle = this.requireSession(sessionId);
    handle.resize(cols, rows);
  }

  sendInput(sessionId: string, data: string): void {
    const handle = this.requireSession(sessionId);
    handle.write(data);
  }

  inspectPane(sessionId: string): PaneSnapshot {
    const handle = this.requireSession(sessionId);
    return handle.getPaneSnapshot();
  }

  stageProgrammaticInput(sessionId: string, data: string): void {
    // In the new architecture, programmatic input is a direct pty write.
    // No bracketed paste staging needed — we write the data directly.
    const handle = this.requireSession(sessionId);
    handle.write(data);
  }

  pressEnter(sessionId: string): void {
    const handle = this.requireSession(sessionId);
    handle.write("\r");
  }

  configureSession(_sessionId: string): void {
    // No-op in the new architecture. tmux session configuration
    // (mouse, history-limit, window-size, status) is not needed.
  }

  // ------------------------------------------------------------------
  // Client attach/detach
  // ------------------------------------------------------------------

  attachClient(sessionId: string, clientId: string): void {
    const handle = this.requireSession(sessionId);
    handle.addClient(clientId);
  }

  detachClient(sessionId: string, clientId: string): void {
    const handle = this.sessions.get(sessionId);
    if (handle) {
      handle.removeClient(clientId);
    }
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

  private relayOutputToClients(sessionId: string, data: string): void {
    const handle = this.sessions.get(sessionId);
    if (!handle) return;
    for (const clientId of handle.getClients()) {
      this.onSessionOutput?.(sessionId, clientId, data);
    }
  }

  /** Kill all sessions (called on shutdown). */
  async destroy(): Promise<void> {
    const promises = [...this.sessions.values()].map((handle) => {
      try {
        handle.kill();
      } catch {
        // Ignore errors during shutdown
      }
    });
    await Promise.all(promises);
    this.sessions.clear();
  }
}
