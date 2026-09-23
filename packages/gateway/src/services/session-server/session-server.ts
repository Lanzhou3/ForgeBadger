import {SessionNotStartedError,ProcessClaims} from './confirmed-stop.js';
import {randomUUID} from 'node:crypto';
import {readBirth,groupIsAbsent,confirmHandleStopped,type ProcessBirth} from './confirmed-stop.js';
/**
 * Core Session Server — manages pty sessions for ForgeBadger.
 *
 * The single terminal backend, with direct node-pty management:
 *   - Spawns CLI processes via node-pty
 *   - Renders every session through a headless terminal screen
 *     (capture/inspect/replay read the rendered screen)
 *   - Handles multi-client attach/detach with attach-window buffering
 *   - Provides session lifecycle (create/kill/list/inspect)
 *
 * The Session Server runs as a standalone Node.js process and communicates
 * with the Gateway via IPC (Unix Domain Socket / Named Pipe).
 */
import { createRequire } from "node:module";
import { setImmediate as setImmediateCb } from "node:timers";

import { createPlatformAdapter, disposePty, type PlatformPtyAdapter } from "./platform-adapter.js";
import { SessionHandle } from "./session-handle.js";
import { buildSanitizedEnv } from "./env-policy.js";
import type { LaunchPlanPayload, PaneSnapshot, SessionInfo } from "./ipc-protocol.js";
import type { TerminalNotification } from "./terminal-notification-scanner.js";

const require = createRequire(import.meta.url);

export interface SessionServerOptions {
  platformAdapter?: PlatformPtyAdapter;
  /** Headless screen scrollback per session (test hook; default 10000). */
  scrollback?: number;
  /** Write-queue watermark tuning per session (test hook; 2MiB/512KiB default). */
  screenFlowControl?: { highWaterBytes: number; lowWaterBytes: number };
  onSessionExit?: ((sessionId: string, exitCode: number) => void) | undefined;
  onSessionOutput?: ((sessionId: string, clientId: string, data: string) => void) | undefined;
  onSessionNotification?: ((sessionId: string, notification: TerminalNotification) => void) | undefined;
}

export interface AttachResult {
  /** Full rendered snapshot (scrollback + screen + modes) for replay. */
  snapshot: string;
}

export class SessionServer {
  private readonly sessions = new Map<string, SessionHandle>();
  private readonly generations=new Map<string,{nonce:string;birth:ProcessBirth|undefined}>();
  private readonly stopPromises=new Map<string,Promise<boolean>>();
  private readonly stopReceipts=new Set<string>();
  private readonly usedGenerations=new Set<string>();
  private readonly processClaims=new ProcessClaims();
  /** Session IDs with a createSession call in flight (guards the await gap). */
  private readonly pendingCreates = new Set<string>();
  private readonly platformAdapter: PlatformPtyAdapter;
  private readonly scrollback: number | undefined;
  private readonly screenFlowControl: { highWaterBytes: number; lowWaterBytes: number } | undefined;
  /** Callback for session exit events — settable via setter for IpcServer wiring. */
  private _onSessionExit?: ((sessionId: string, exitCode: number) => void) | undefined;
  /** Callback for session output events — settable via setter for IpcServer wiring. */
  private _onSessionOutput?: ((sessionId: string, clientId: string, data: string) => void) | undefined;
  /** Callback for terminal notifications — settable via setter for IpcServer wiring. */
  private _onSessionNotification?: ((sessionId: string, notification: TerminalNotification) => void) | undefined;

  constructor(options: SessionServerOptions = {}) {
    this.platformAdapter = options.platformAdapter ?? createPlatformAdapter();
    this.scrollback = options.scrollback;
    this.screenFlowControl = options.screenFlowControl;
    this._onSessionExit = options.onSessionExit;
    this._onSessionOutput = options.onSessionOutput;
    this._onSessionNotification = options.onSessionNotification;
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

  get onSessionNotification(): ((sessionId: string, notification: TerminalNotification) => void) | undefined {
    return this._onSessionNotification;
  }

  set onSessionNotification(value: ((sessionId: string, notification: TerminalNotification) => void) | undefined) {
    this._onSessionNotification = value;
  }

  // ------------------------------------------------------------------
  // Session lifecycle
  // ------------------------------------------------------------------

  async createSession(input: {
    sessionId: string;
    launchNonce?:string|undefined;
    userId: string;
    attachToken: string;
    launchPlan: LaunchPlanPayload;
  }): Promise<SessionHandle> {
    const { sessionId, userId, attachToken, launchPlan } = input;

    const nonce=input.launchNonce??randomUUID(),generation=sessionId+'\0'+nonce;
    // Used generations never become admissible again, including after receipt eviction.
    if(this.usedGenerations.has(generation))throw new Error('SESSION_RUNTIME_GENERATION_REUSED');
    if(this.usedGenerations.size>=10000)throw new SessionNotStartedError(sessionId,nonce);
    this.usedGenerations.add(generation);
    let spawned=false,claimed=false;
    try {
      const existing=this.sessions.get(sessionId);
      if(existing && (existing.status!=='exited'||!this.removeSession(sessionId)))throw new Error(`Session already exists: ${sessionId}`);
      if(this.pendingCreates.has(sessionId))throw new Error(`Session already exists: ${sessionId}`);
      this.pendingCreates.add(sessionId);claimed=true;
      return await this.spawnSession(sessionId,userId,attachToken,launchPlan,nonce,()=>{spawned=true;});
    } catch(error) {
      if(!spawned){this.stopReceipts.add(generation);if(input.launchNonce)throw new SessionNotStartedError(sessionId,nonce);}
      throw error;
    } finally {if(claimed)this.pendingCreates.delete(sessionId);}
  }

  private async spawnSession(
    sessionId: string,
    userId: string,
    attachToken: string,
    launchPlan: LaunchPlanPayload,
    launchNonce:string,
    onSpawn:()=>void
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
      ...launchPlan.env,
      FORGEBADGER_RUNTIME_NONCE:launchNonce
    };

    // Load this native CommonJS module lazily through its own exports. In the
    // daemon path, ESM namespace snapshots can be empty even when the CJS
    // cache is fully initialized; createRequire avoids that loader boundary.
    const nodePty = require("node-pty") as typeof import("node-pty");
    const pty = nodePty.spawn(resolved.command, [...resolved.args, ...launchPlan.args], {
      name: "xterm-256color",
      cwd: launchPlan.cwd,
      cols: 120,
      rows: 40,
      env
    });

    onSpawn();
    const handle = new SessionHandle({
      sessionId,
      userId,
      attachToken,
      ownerSessionId: launchPlan.env.FORGEBADGER_SESSION_ID,
      pty,
      scrollback: this.scrollback,
      screenFlowControl: this.screenFlowControl,
      onNotification: (notification) => {
        this.onSessionNotification?.(sessionId, notification);
      }
    });

    this.processClaims.register(handle,launchNonce);

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

    const generation:{nonce:string;birth:ProcessBirth|undefined}={nonce:launchNonce,birth:undefined};
    this.generations.set(sessionId,generation);
    this.sessions.set(sessionId, handle);
    for(let attempt=0;attempt<8&&handle.status==='running'&&this.processClaims.owns(handle,launchNonce);attempt++){
      const candidate=readBirth(pty.pid,launchNonce);
      if(candidate&&candidate.ppid===process.pid&&candidate.pgid===pty.pid){generation.birth=candidate;break;}
      await new Promise(resolve=>setTimeout(resolve,25));
    }
    return handle;
  }

  async killSession(sessionId: string): Promise<void> {
    const handle=this.requireSession(sessionId);
    if(process.platform==='win32'){handle.kill();handle.disposeResources();this.sessions.delete(sessionId);return;}
    const generation=this.generations.get(sessionId);
    if(!generation||!await this.confirmedStop(sessionId,generation.nonce,true))throw new Error('SESSION_STOP_UNCONFIRMED');
  }

  async confirmedStop(sessionId:string,nonce:string,signal:boolean):Promise<boolean>{
    if(process.platform==='win32')return false;
    const key=sessionId+'\0'+nonce;if(this.stopReceipts.has(key))return true;
    const handle=this.sessions.get(sessionId),generation=this.generations.get(sessionId);
    if(!handle||!generation||generation.nonce!==nonce)return false;
    const existing=this.stopPromises.get(key);if(existing)return existing;
    const operation=(async()=>{const stopped=await confirmHandleStopped(handle,generation.birth,signal,()=>this.processClaims.owns(handle,nonce));if(stopped)this.retire(sessionId,handle,nonce);return stopped;})();
    this.stopPromises.set(key,operation);
    // The exit reaper may retire the session while confirmHandleStopped is
    // still polling; the recorded receipt is the authoritative proof.
    try{return await operation||this.stopReceipts.has(key);}finally{this.stopPromises.delete(key);}
  }
  private retire(sessionId:string,handle:SessionHandle,nonce:string):void{
    if(this.sessions.get(sessionId)!==handle)return;
    this.processClaims.release(handle,nonce);
    this.stopReceipts.add(sessionId+'\0'+nonce);
    if(this.stopReceipts.size>10000)this.stopReceipts.delete(this.stopReceipts.values().next().value!);
    handle.disposeResources();this.sessions.delete(sessionId);this.generations.delete(sessionId);
  }
  /** Natural exit is only retirement proof when the original process group is gone. */
  removeSession(sessionId: string): boolean {
    const handle=this.sessions.get(sessionId),generation=this.generations.get(sessionId);
    if(!handle)return true;
    if(process.platform==='win32'){handle.disposeResources();this.sessions.delete(sessionId);return true;}
    if(handle.status!=='exited'||!groupIsAbsent(handle.pty.pid)||!generation)return false;
    this.retire(sessionId,handle,generation.nonce);return true;
  }

  /**
   * Retries retirement of exited sessions whose process group still had
   * survivors when onExit fired (e.g. a background child the CLI left behind).
   * Without this, retirement — and with it the stop receipt — depended on a
   * later confirmedStop call racing the group's death. Only retires once the
   * group is fully gone; running handles are never touched.
   */
  startExitReaper(intervalMs = 5_000): () => void {
    const timer = setInterval(() => {
      for (const [sessionId, handle] of [...this.sessions]) {
        if (handle.status !== 'exited') continue;
        try {
          this.removeSession(sessionId);
        } catch (error) {
          console.error(`[session-server] exit reaper failed for ${sessionId}`, error);
        }
      }
    }, intervalMs);
    timer.unref?.();
    return () => clearInterval(timer);
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

  /** Rendered scrollback (500 lines) + current screen, ANSI preserved. */
  capturePane(sessionId: string): Promise<string> {
    const handle = this.requireSession(sessionId);
    return handle.captureSerialized(500);
  }

  showEnvironment(sessionId: string): Record<string, string> {
    // Expose the ForgeBadger ownership markers so
    // session-manager.attachExistingSession can verify that a server-side
    // session belongs to the requesting ForgeBadger session (and carries the
    // same attach token).
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
