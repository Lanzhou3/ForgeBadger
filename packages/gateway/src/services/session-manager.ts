import { randomUUID } from "node:crypto";
import { basename } from "node:path";

import type { LaunchPlan } from "../adapters/claude.js";
import { isAdapterId, type AdapterId } from "./adapter-discovery.js";
import type { TerminalBackendClient } from "./terminal-backend.js";
import type { ForgeBadgerEventBus } from "./event-bus.js";
import { SessionOutputRing } from "./session-output-buffer.js";
import { SessionWriterLeases } from "./session-writer-leases.js";
import type { Database } from "../db/types.js";
import {
  assertSafeProgrammaticMessage,
  composerContainsStagedTask,
  isProgrammaticComposerReady,
  PROGRAMMATIC_SUBMIT_ADAPTER_MISMATCH,
  PROGRAMMATIC_SUBMIT_INDETERMINATE,
  PROGRAMMATIC_SUBMIT_NOT_READY,
  PROGRAMMATIC_SUBMIT_STAGING_FAILED,
  programmaticDeliveryNeedle
} from "./programmatic-terminal-submit.js";

export type SessionStatus = "pending" | "running" | "detached" | "exited" | "lost" | "error";

export class SessionConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionConflictError";
  }
}

export interface GateASession {
  id: string;
  userId: string;
  attachToken: string;
  /** Session Server identifier, persisted as runtime_session_name. */
  runtimeSessionName: string;
  launchPlan: LaunchPlan;
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;
  error?: string;
}

export interface CreateSessionInput {
  userId: string;
  sessionId: string;
  launchPlan: LaunchPlan;
  attachToken?: string | undefined;
}

export interface AttachExistingSessionInput extends CreateSessionInput {
  /** Runtime session name; see GateASession.runtimeSessionName. */
  runtimeSessionName: string;
}

export interface RecoverSessionsInput {
  userId: string;
  cwd: string;
}

export interface StoredSession {
  id: string;
  userId: string;
  attachToken?: string;
  /** Runtime session name; see GateASession.runtimeSessionName. */
  runtimeSessionName: string;
  launchPlan: LaunchPlan;
  createdAt: string;
}

export interface SessionRecoveryStore {
  listSessions(): Promise<StoredSession[]>;
  upsertSession(session: StoredSession): Promise<void>;
  removeSession(id: string, userId: string): Promise<void>;
  /**
   * Mark a session as lost: the backing terminal daemon restarted and its
   * registry no longer contains the session. Unlike removeSession this keeps
   * the runtime session name (DB `runtime_session_name` column) so
   * a future revive flow can reference it.
   */
  markSessionLost?(id: string, userId: string): Promise<void>;
}

export interface RecoveryResult {
  recovered: GateASession[];
  killedOrphans: string[];
}

export interface SessionManagerOptions {
  db?: Database;
  /** Runtime session name prefix (FORGEBADGER_SESSION_PREFIX; default fb-). */
  sessionPrefix?: string;
  runtimeInputAuthorizer?: (session: Readonly<GateASession>) => void;
  programmaticSubmitSettleMs?: Partial<Record<AdapterId, number>>;
  sleep?: (ms: number) => Promise<void>;
  /**
   * One-shot probe consumed once per status-correction scan: returns true
   * when the terminal backend daemon was restarted since the last scan
   * (detected via the IPC hello pid/startedAt identity). Orphaned sessions
   * are then marked `lost` instead of `exited`.
   */
  detectBackendRestart?: () => boolean;
}

export interface ProgrammaticTaskInput {
  adapter: AdapterId;
  message: string;
}

export interface ProgrammaticTaskStageReceipt {
  adapter: AdapterId;
  needle: string;
  stagedPane: string;
}

const DEFAULT_PROGRAMMATIC_SETTLE_MS: Readonly<Record<AdapterId, number>> = Object.freeze({
  claude: 150,
  opencode: 150,
  codex: 350,
  kimi: 150
});

/**
 * Upper bound on the number of sessions whose terminal output is buffered at
 * once. New sessions evict the oldest buffered session (Map insertion order)
 * once the limit is reached. Worst-case memory ≈ 200 × 1 MiB = 200 MiB (see
 * session-output-buffer.ts).
 */
export const MAX_BUFFERED_SESSIONS = 200;

class EmptyRecoveryStore implements SessionRecoveryStore {
  async listSessions(): Promise<StoredSession[]> {
    return [];
  }

  async upsertSession(): Promise<void> {}

  async removeSession(_id: string, _userId: string): Promise<void> {}
}

export class InMemorySessionManager {
  private readonly writerLeases: SessionWriterLeases;
  private readonly writerGenerations = new Map<string, number>();
  private readonly sessions = new Map<string, GateASession>();
  private readonly sessionOutputs = new Map<string, SessionOutputRing>();
  private readonly sessionPrefix: string;
  private readonly runtimeInputAuthorizer: ((session: Readonly<GateASession>) => void) | undefined;
  private readonly programmaticSubmitSettleMs: Readonly<Record<AdapterId, number>>;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly detectBackendRestart: (() => boolean) | undefined;
  private readonly sessionLocks = new Map<string, Promise<unknown>>();
  private correctionInterval: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly backend: TerminalBackendClient,
    private readonly recoveryStore: SessionRecoveryStore = new EmptyRecoveryStore(),
    private readonly eventBus?: ForgeBadgerEventBus,
    options: SessionManagerOptions = {}
  ) {
    this.writerLeases = new SessionWriterLeases(options.db ? {db:options.db} : {});
    this.sessionPrefix = normalizeSessionPrefix(options.sessionPrefix);
    this.runtimeInputAuthorizer = options.runtimeInputAuthorizer;
    this.programmaticSubmitSettleMs = {
      ...DEFAULT_PROGRAMMATIC_SETTLE_MS,
      ...options.programmaticSubmitSettleMs
    };
    this.sleep = options.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    this.detectBackendRestart = options.detectBackendRestart;
  }

  /**
   * Serialize per-session lifecycle operations (create/start/stop/delete) using
   * a promise chain. Concurrent calls for the same sessionId run in arrival
   * order; conflicting operations detect the conflict inside `fn` and throw.
   */
  async runExclusive<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.sessionLocks.get(sessionId) ?? Promise.resolve();
    const run = previous
      .catch(() => undefined)
      .then(() => fn());
    // Keep a never-rejecting tail in the map so the chain continues across errors.
    const tail = run.then(
      () => undefined,
      () => undefined
    );
    this.sessionLocks.set(sessionId, tail);
    try {
      return await run;
    } finally {
      if (this.sessionLocks.get(sessionId) === tail) {
        this.sessionLocks.delete(sessionId);
      }
    }
  }

  async createSession(input: CreateSessionInput): Promise<GateASession> {
    const now = new Date().toISOString();
    const runtimeSessionName = buildRuntimeSessionName(input.userId, input.sessionId, this.sessionPrefix);
    const session: GateASession = {
      id: input.sessionId,
      userId: input.userId,
      attachToken: input.attachToken ?? randomUUID(),
      runtimeSessionName,
      launchPlan: input.launchPlan,
      status: "pending",
      createdAt: now,
      updatedAt: now
    };
    this.sessions.set(session.id, session);

    try {
      await this.backend.createSession({
        name: runtimeSessionName,
        cwd: input.launchPlan.cwd,
        command: input.launchPlan.command,
        args: input.launchPlan.args,
        env: {
          ...input.launchPlan.env,
          FORGEBADGER_SESSION_ID: session.id,
          FORGEBADGER_USER_ID: input.userId,
          FORGEBADGER_ATTACH_TOKEN: session.attachToken,
          // The Web terminal renders ANSI colors, so a NO_COLOR=1 leaked from
          // the host shell must be overridden to empty — CLI TUIs (e.g.
          // Claude Code) then render in color instead of monochrome.
          NO_COLOR: ""
        }
      });
      await this.recoveryStore.upsertSession({
        id: session.id,
        userId: session.userId,
        attachToken: session.attachToken,
        runtimeSessionName: session.runtimeSessionName,
        launchPlan: session.launchPlan,
        createdAt: session.createdAt
      });
      return this.updateSession(session.id, { status: "running" });
    } catch (error) {
      this.updateSession(session.id, {
        status: "error",
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  getSession(id: string): GateASession | undefined {
    return this.sessions.get(id);
  }

  /**
   * Append raw pty output to a session's ring buffer. No-op when the session
   * does not exist in memory (buffer only tracks live sessions, matching the
   * documented "attached-duration output" scope). Evicts the oldest buffered
   * session once MAX_BUFFERED_SESSIONS is reached.
   */
  appendSessionOutput(sessionId: string, data: string): void {
    if (!this.getSession(sessionId)) {
      return;
    }
    let ring = this.sessionOutputs.get(sessionId);
    if (!ring) {
      if (this.sessionOutputs.size >= MAX_BUFFERED_SESSIONS) {
        const oldest = this.sessionOutputs.keys().next().value;
        if (oldest !== undefined) {
          this.sessionOutputs.delete(oldest);
        }
      }
      ring = new SessionOutputRing();
      this.sessionOutputs.set(sessionId, ring);
    }
    ring.append(data);
  }

  getSessionOutput(sessionId: string): SessionOutputRing | undefined {
    return this.sessionOutputs.get(sessionId);
  }

  removeSessionOutput(sessionId: string): void {
    this.sessionOutputs.delete(sessionId);
  }

  async attachExistingSession(input: AttachExistingSessionInput): Promise<GateASession> {
    const liveBackendSessions = await this.backend.listSessions();
    if (!liveBackendSessions.includes(input.runtimeSessionName)) {
      throw new Error(`runtime session not found: ${input.runtimeSessionName}`);
    }

    // Verify the runtime session belongs to this ForgeBadger session before
    // adopting it, so snapshot/restore cannot attach to a session owned by
    // another session id or a stale attach token (hook auth break).
    if (this.backend.showEnvironment) {
      const env = await this.backend.showEnvironment(input.runtimeSessionName);
      const storedSessionId = env.FORGEBADGER_SESSION_ID;
      if (storedSessionId && storedSessionId !== input.sessionId) {
        throw new Error(`runtime session belongs to another ForgeBadger session: ${storedSessionId}`);
      }
      const storedToken = env.FORGEBADGER_ATTACH_TOKEN;
      const requestedToken = input.attachToken ?? "";
      if (storedToken && requestedToken && storedToken !== requestedToken) {
        throw new Error("runtime session attach token mismatch");
      }
    }

    const now = new Date().toISOString();
    const session: GateASession = {
      id: input.sessionId,
      userId: input.userId,
      attachToken: input.attachToken ?? randomUUID(),
      runtimeSessionName: input.runtimeSessionName,
      launchPlan: input.launchPlan,
      status: "running",
      createdAt: now,
      updatedAt: now
    };
    this.sessions.set(session.id, session);
    await this.recoveryStore.upsertSession({
      id: session.id,
      userId: session.userId,
      attachToken: session.attachToken,
      runtimeSessionName: session.runtimeSessionName,
      launchPlan: session.launchPlan,
      createdAt: session.createdAt
    });
    return session;
  }

  listSessions(): GateASession[] {
    return [...this.sessions.values()];
  }

  /**
   * Terminal backend health for launch gating (adapter discovery) and the
   * dependencies report. A backend without a health signal (tests, mocks) is
   * assumed available.
   */
  terminalBackendHealth(): { available: boolean; message?: string } {
    if (this.backend.isAvailable?.() === false) {
      return { available: false, message: "Session Server connection is unavailable" };
    }
    return { available: true };
  }

  async stopSession(id: string, runtimeSessionName?: string, userId?: string): Promise<GateASession> {
    const session = this.sessions.get(id);
    if (!session && !runtimeSessionName) {
      throw new Error(`Unknown session: ${id}`);
    }

    if (session) {
      this.invalidateWriter(session);
      let failure: unknown;
      try {
        await this.backend.killSession(session.runtimeSessionName);
        await this.recoveryStore.removeSession(id, session.userId);
      } catch (error) {
        failure = error;
      }
      // Always drop the in-memory entry (finally semantics) even if DB cleanup
      // failed, so a DB failure cannot leave a memory zombie.
      const stopped = this.updateSession(id, { status: "exited" });
      this.sessions.delete(id);
      if (failure) {
        console.error(`[session-manager] stopSession cleanup failed for ${id}`, failure);
        throw failure;
      }
      return stopped;
    }

    await this.backend.killSession(runtimeSessionName as string);
    if (userId) {
      await this.recoveryStore.removeSession(id, userId);
    }
    return fallbackStoppedSession(id, runtimeSessionName as string, userId);
  }

  /**
   * Reconcile a single session's status against the live backend state. If
   * the backing runtime session is gone, mark it exited and sync the DB; if
   * it is still alive (a detached terminal), mark it detached. Emits at most
   * one session_status_changed via updateSession.
   *
   * When `opts.backendRestarted` is true (the terminal daemon restarted and
   * its registry was rebuilt empty), a previously live session that is now
   * missing is marked `lost` instead of `exited` — the CLI process was
   * killed with the daemon, it did not exit on its own (VS Code
   * reconnect/revive model: never silently show a dead session as running,
   * never report a daemon kill as a clean exit).
   */
  async reconcileSessionStatus(
    id: string,
    opts: { backendRestarted?: boolean } = {}
  ): Promise<GateASession | undefined> {
    const session = this.sessions.get(id);
    if (!session) {
      return undefined;
    }
    if (session.status === "exited" || session.status === "error" || session.status === "lost") {
      return session;
    }

    const alive = await this.backend.hasSession(session.runtimeSessionName);
    // hasSession may await long enough for a concurrent stopSession or another
    // reconcile to remove the session. Re-check synchronously before mutating
    // so a stale caller never throws "Unknown session" (an unhandled rejection
    // would otherwise crash the Gateway).
    const current = this.sessions.get(id);
    if (!current) {
      return undefined;
    }
    if (!alive) {
      const wasLive = current.status === "running" || current.status === "detached";
      if (opts.backendRestarted && wasLive) {
        const lost = this.updateSession(id, { status: "lost" });
        try {
          await this.recoveryStore.markSessionLost?.(id, current.userId);
        } catch (error) {
          console.error(`[session-manager] lost DB sync failed for ${id}`, error);
        }
        this.sessions.delete(id);
        return lost;
      }
      const exited = this.updateSession(id, { status: "exited" });
      try {
        await this.recoveryStore.removeSession(id, current.userId);
      } catch (error) {
        console.error(`[session-manager] reconcile DB sync failed for ${id}`, error);
      }
      // Drop the in-memory entry on death so subsequent operations see the
      // session as truly exited, matching stopSession semantics.
      this.sessions.delete(id);
      return exited;
    }

    if (current.status === "running") {
      return this.updateSession(id, { status: "detached" });
    }
    return current;
  }

  /**
   * Low-frequency correction scan (optional). Marks any in-memory session whose
   * backing runtime session has disappeared as exited (or `lost` when the
   * backend daemon restarted), and syncs the DB. Returns a teardown function to stop
   * the timer. The backend-restart probe is consumed once per scan so every
   * orphaned session of the same restart is marked consistently.
   */
  startStatusCorrectionScan(intervalMs = 30_000): () => void {
    if (this.correctionInterval) {
      clearInterval(this.correctionInterval);
    }
    const run = () => {
      const backendRestarted = this.detectBackendRestart?.() ?? false;
      for (const session of this.sessions.values()) {
        if (session.status === "running" || session.status === "detached") {
          void this.reconcileSessionStatus(session.id, { backendRestarted }).catch((error) => {
            console.error(`[session-manager] status correction failed for ${session.id}`, error);
          });
        }
      }
    };
    this.correctionInterval = setInterval(run, intervalMs);
    this.correctionInterval.unref?.();
    return () => {
      if (this.correctionInterval) {
        clearInterval(this.correctionInterval);
        this.correctionInterval = undefined;
      }
    };
  }

  /**
   * Rendered scrollback + current screen for the session (serialize capture
   * from the Session Server headless screen). Note: the WebSocket attach path
   * does not use this — the attach ack already carries the snapshot.
   */
  async captureHistory(id: string): Promise<string> {
    const session = this.requireSession(id);
    return this.backend.capturePane(session.runtimeSessionName);
  }

  async resizeSession(id: string, cols: number, rows: number): Promise<void> {
    const session = this.requireSession(id);
    await this.backend.resizeWindow?.(session.runtimeSessionName, cols, rows);
  }

  async sendInput(id: string, data: string): Promise<void> {
    const session = this.requireSession(id);
    this.assertManualInputAllowed(session.userId, id);
    if (!this.backend.sendInput) {
      throw new Error("terminal backend input is not supported");
    }
    this.assertRuntimeInputAuthorized(session);
    await this.backend.sendInput(session.runtimeSessionName, data);
  }

  async submitProgrammaticTask(
    id: string,
    input: ProgrammaticTaskInput
  ): Promise<ProgrammaticTaskStageReceipt> {
    assertSafeProgrammaticMessage(input.message);
    const generation = this.writerGenerations.get(id) ?? 0;
    return this.runExclusive(id, async () => {
      const session = this.requireSession(id);
      if ((this.writerGenerations.get(id) ?? 0) !== generation) throw new Error("SESSION_WRITER_FENCE_STALE");
      const launchAdapter = adapterFromLaunchCommand(session.launchPlan.command);
      if (launchAdapter !== input.adapter) {
        throw new Error(PROGRAMMATIC_SUBMIT_ADAPTER_MISMATCH);
      }
      if (session.status !== "running" && session.status !== "detached") {
        throw new Error(PROGRAMMATIC_SUBMIT_NOT_READY);
      }
      if (!this.backend.inspectPane || !this.backend.stageProgrammaticInput || !this.backend.pressEnter) {
        throw new Error("terminal backend programmatic input is not supported");
      }

      const lease = this.writerLeases.acquire({ userId: session.userId, sessionId: id, workspace: session.launchPlan.cwd });
      try {
        const before = await this.backend.inspectPane(session.runtimeSessionName);
        if (before.dead || !isProgrammaticComposerReady(input.adapter, before.content)) {
          throw new Error(PROGRAMMATIC_SUBMIT_NOT_READY);
        }

        const needle = programmaticDeliveryNeedle(input.message);
        if (needle === "") {
          throw new Error(PROGRAMMATIC_SUBMIT_STAGING_FAILED);
        }
        // Pane inspection may await long enough for the binding to be revoked or
        // host privilege to change. This is the final synchronous gate before
        // the first terminal write, so pre-write rejection remains retry-safe.
        this.assertRuntimeInputAuthorized(session);
        this.writerLeases.assertCurrent(lease);
        // Once staging starts, the backend may already have received some or
        // all bytes. Any later failure is therefore indeterminate and must
        // never be exposed as a safe-to-retry pre-write rejection.
        try {
          await this.backend.stageProgrammaticInput(session.runtimeSessionName, input.message);
          await this.sleep(this.programmaticSubmitSettleMs[input.adapter]);

          const staged = await this.backend.inspectPane(session.runtimeSessionName);
          if (
            staged.dead
            || !composerContainsStagedTask(input.adapter, staged.content, input.message, needle)
          ) {
            throw new Error(PROGRAMMATIC_SUBMIT_INDETERMINATE);
          }

          this.assertRuntimeInputAuthorized(session);
          this.writerLeases.assertCurrent(lease);
          await this.backend.pressEnter(session.runtimeSessionName);
          return { adapter: input.adapter, needle, stagedPane: staged.content };
        } catch {
          throw new Error(PROGRAMMATIC_SUBMIT_INDETERMINATE);
        }
      } finally {
        this.writerLeases.release(lease);
      }
    });
  }

  assertManualInputAllowed(userId: string, id: string): void {
    const session = this.requireOwnedSession(userId, id);
    this.writerLeases.assertManualInputAllowed({ userId, sessionId: id, workspace: session.launchPlan.cwd });
  }

  takeoverSession(userId: string, id: string): void {
    const session = this.requireOwnedSession(userId, id);
    this.writerLeases.takeover({ userId, sessionId: id, workspace: session.launchPlan.cwd });
    this.invalidateWriter(session);
  }

  cancelProgrammaticInput(userId: string, id: string): void {
    this.invalidateWriter(this.requireOwnedSession(userId, id));
  }

  private invalidateWriter(session: GateASession): void {
    this.writerGenerations.set(session.id, (this.writerGenerations.get(session.id) ?? 0) + 1);
    this.writerLeases.revokeSession(session.userId, session.id);
  }

  private requireOwnedSession(userId: string, id: string): GateASession {
    const session = this.requireSession(id);
    if (session.userId !== userId) throw new Error("SESSION_NOT_FOUND");
    return session;
  }

  private assertRuntimeInputAuthorized(session: GateASession): void {
    this.runtimeInputAuthorizer?.(session);
  }

  async recoverForgeBadgerSessions(input: RecoverSessionsInput): Promise<RecoveryResult> {
    const names = await this.backend.listSessions();
    const indexed = await this.recoveryStore.listSessions();
    const indexedByRuntimeSessionName = new Map(indexed.map((session) => [session.runtimeSessionName, session]));
    const recovered: GateASession[] = [];
    const killedOrphans: string[] = [];
    // Inventory succeeded: absent durable runtime records cannot be recovered.
    // This also handles pre-Session-Server records without touching old host processes.
    const liveNames = new Set(names);
    for (const stored of indexed) {
      if (!liveNames.has(stored.runtimeSessionName)) {
        await this.recoveryStore.markSessionLost?.(stored.id, stored.userId);
      }
    }

    for (const runtimeSessionName of names) {
      if (!isForgeBadgerSessionName(runtimeSessionName, this.sessionPrefix)) {
        continue;
      }

      const indexedSession = indexedByRuntimeSessionName.get(runtimeSessionName);
      if (!indexedSession) {
        await this.backend.killSession(runtimeSessionName);
        killedOrphans.push(runtimeSessionName);
        continue;
      }

      if (this.sessions.has(indexedSession.id)) {
        continue;
      }

      const now = new Date().toISOString();
      const attachToken = indexedSession.attachToken ?? randomUUID();
      const session: GateASession = {
        id: indexedSession.id,
        userId: indexedSession.userId || input.userId,
        attachToken,
        runtimeSessionName,
        launchPlan: indexedSession.launchPlan || createFallbackLaunchPlan(input.cwd, indexedSession.id),
        status: "detached",
        createdAt: indexedSession.createdAt || now,
        updatedAt: now
      };
      this.sessions.set(session.id, session);
      if (!indexedSession.attachToken) {
        await this.recoveryStore.upsertSession({
          ...indexedSession,
          attachToken
        });
      }
      recovered.push(session);
    }

    return { recovered, killedOrphans };
  }

  private requireSession(id: string): GateASession {
    const session = this.sessions.get(id);
    if (!session) {
      throw new Error(`Unknown session: ${id}`);
    }
    return session;
  }

  private updateSession(
    id: string,
    patch: Partial<Pick<GateASession, "status" | "error">>
  ): GateASession {
    const session = this.requireSession(id);
    const oldStatus = session.status;
    const next = {
      ...session,
      ...patch,
      updatedAt: new Date().toISOString()
    };
    this.sessions.set(id, next);
    if (patch.status && patch.status !== oldStatus && this.eventBus) {
      this.eventBus.emitEvent({
        type: "session_status_changed",
        userId: session.userId,
        sessionId: id,
        oldStatus,
        newStatus: patch.status
      });
    }
    return next;
  }
}

function adapterFromLaunchCommand(command: string): AdapterId | undefined {
  const executable = basename(command);
  return isAdapterId(executable) ? executable : undefined;
}

/**
 * Runtime session name: `fb-{user8}-{sessionId}` (prefix configurable via
 * FORGEBADGER_SESSION_PREFIX), persisted in runtime_session_name.
 */
export function buildRuntimeSessionName(userId: string, sessionId: string, sessionPrefix = "fb-"): string {
  return `${normalizeSessionPrefix(sessionPrefix)}${shortId(userId)}-${sanitizeId(sessionId)}`;
}

function shortId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 8);
}

function sanitizeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "");
}

function isForgeBadgerSessionName(sessionName: string, sessionPrefix: string): boolean {
  return sessionName.startsWith(sessionPrefix);
}

function normalizeSessionPrefix(value = "fb-"): string {
  const sanitized = value.replace(/[^a-zA-Z0-9_-]/g, "");
  return sanitized || "fb-";
}

export function createFallbackLaunchPlan(
  cwd: string,
  sessionId: string,
  options: {
    platform?: NodeJS.Platform;
    env?: NodeJS.ProcessEnv;
  } = {}
): LaunchPlan {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const command = platform === "win32"
    ? env.ComSpec?.trim() || env.COMSPEC?.trim() || "cmd.exe"
    : env.SHELL?.trim() || "sh";
  return {
    command,
    args: [],
    cwd,
    env: { FORGEBADGER_SESSION_ID: sessionId },
    secretEnvNames: [],
    credentialMode: "host_environment"
  };
}

function fallbackStoppedSession(id: string, runtimeSessionName: string, userId = ""): GateASession {
  const now = new Date().toISOString();
  return {
    id,
    userId,
    attachToken: "",
    runtimeSessionName,
    launchPlan: createFallbackLaunchPlan(process.cwd(), id),
    status: "exited",
    createdAt: now,
    updatedAt: now
  };
}
