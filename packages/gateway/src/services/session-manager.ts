import { randomUUID } from "node:crypto";
import { basename } from "node:path";

import type { LaunchPlan } from "../adapters/claude.js";
import { isAdapterId, type AdapterId } from "./adapter-discovery.js";
import type { TmuxClient } from "./tmux.js";
import type { OpenForgeEventBus } from "./event-bus.js";
import { SessionOutputRing } from "./session-output-buffer.js";
import type {
  PortfolioSessionInputGate,
  PortfolioWorkerInputCapability
} from "./portfolio/session-input-gate.js";
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

export type SessionStatus = "pending" | "running" | "detached" | "exited" | "error";

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
  tmuxName: string;
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
  tmuxName: string;
}

export interface RecoverSessionsInput {
  userId: string;
  cwd: string;
}

export interface StoredSession {
  id: string;
  userId: string;
  attachToken?: string;
  tmuxName: string;
  launchPlan: LaunchPlan;
  createdAt: string;
}

export interface SessionRecoveryStore {
  listSessions(): Promise<StoredSession[]>;
  upsertSession(session: StoredSession): Promise<void>;
  removeSession(id: string, userId: string): Promise<void>;
}

export interface RecoveryResult {
  recovered: GateASession[];
  killedOrphans: string[];
}

export interface SessionManagerOptions {
  tmuxPrefix?: string;
  sessionInputGate?: PortfolioSessionInputGate;
  programmaticSubmitSettleMs?: Partial<Record<AdapterId, number>>;
  sleep?: (ms: number) => Promise<void>;
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
  private readonly sessions = new Map<string, GateASession>();
  private readonly sessionOutputs = new Map<string, SessionOutputRing>();
  private readonly tmuxPrefix: string;
  private readonly sessionInputGate: PortfolioSessionInputGate | undefined;
  private readonly programmaticSubmitSettleMs: Readonly<Record<AdapterId, number>>;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly sessionLocks = new Map<string, Promise<unknown>>();
  private correctionInterval: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly tmux: TmuxClient,
    private readonly recoveryStore: SessionRecoveryStore = new EmptyRecoveryStore(),
    private readonly eventBus?: OpenForgeEventBus,
    options: SessionManagerOptions = {}
  ) {
    this.tmuxPrefix = normalizeTmuxPrefix(options.tmuxPrefix);
    this.sessionInputGate = options.sessionInputGate;
    this.programmaticSubmitSettleMs = {
      ...DEFAULT_PROGRAMMATIC_SETTLE_MS,
      ...options.programmaticSubmitSettleMs
    };
    this.sleep = options.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
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
    const tmuxName = buildTmuxName(input.userId, input.sessionId, this.tmuxPrefix);
    const session: GateASession = {
      id: input.sessionId,
      userId: input.userId,
      attachToken: input.attachToken ?? randomUUID(),
      tmuxName,
      launchPlan: input.launchPlan,
      status: "pending",
      createdAt: now,
      updatedAt: now
    };
    this.sessions.set(session.id, session);

    try {
      await this.tmux.createSession({
        name: tmuxName,
        cwd: input.launchPlan.cwd,
        command: input.launchPlan.command,
        args: input.launchPlan.args,
        env: {
          ...input.launchPlan.env,
          OPENFORGE_ATTACH_TOKEN: session.attachToken,
          // The Web terminal renders ANSI colors, so a NO_COLOR=1 leaked from
          // the host shell (inherited via the tmux server global environment)
          // must be overridden to empty — CLI TUIs (e.g. Claude Code) then
          // render in color instead of monochrome.
          NO_COLOR: ""
        }
      });
      await this.recoveryStore.upsertSession({
        id: session.id,
        userId: session.userId,
        attachToken: session.attachToken,
        tmuxName: session.tmuxName,
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
    const liveTmuxSessions = await this.tmux.listSessions();
    if (!liveTmuxSessions.includes(input.tmuxName)) {
      throw new Error(`tmux session not found: ${input.tmuxName}`);
    }

    // Verify the tmux session belongs to this OpenForge session before adopting
    // it, so snapshot/restore cannot attach to a session owned by another
    // session id or a stale attach token (hook auth break).
    if (this.tmux.showEnvironment) {
      const env = await this.tmux.showEnvironment(input.tmuxName);
      const storedSessionId = env.OPENFORGE_SESSION_ID;
      if (storedSessionId && storedSessionId !== input.sessionId) {
        throw new Error(`tmux session belongs to another OpenForge session: ${storedSessionId}`);
      }
      const storedToken = env.OPENFORGE_ATTACH_TOKEN;
      const requestedToken = input.attachToken ?? "";
      if (storedToken && requestedToken && storedToken !== requestedToken) {
        throw new Error("tmux session attach token mismatch");
      }
    }

    await this.tmux.configureSession?.(input.tmuxName);

    const now = new Date().toISOString();
    const session: GateASession = {
      id: input.sessionId,
      userId: input.userId,
      attachToken: input.attachToken ?? randomUUID(),
      tmuxName: input.tmuxName,
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
      tmuxName: session.tmuxName,
      launchPlan: session.launchPlan,
      createdAt: session.createdAt
    });
    return session;
  }

  listSessions(): GateASession[] {
    return [...this.sessions.values()];
  }

  async stopSession(id: string, tmuxName?: string, userId?: string): Promise<GateASession> {
    const session = this.sessions.get(id);
    if (!session && !tmuxName) {
      throw new Error(`Unknown session: ${id}`);
    }

    if (session) {
      let failure: unknown;
      try {
        await this.tmux.killSession(session.tmuxName);
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

    await this.tmux.killSession(tmuxName as string);
    if (userId) {
      await this.recoveryStore.removeSession(id, userId);
    }
    return fallbackStoppedSession(id, tmuxName as string, userId);
  }

  /**
   * Reconcile a single session's status against the live tmux state. If the
   * backing tmux session is gone, mark it exited and sync the DB; if it is
   * still alive (a detached terminal), mark it detached. Emits at most one
   * session_status_changed via updateSession.
   */
  async reconcileSessionStatus(id: string): Promise<GateASession | undefined> {
    const session = this.sessions.get(id);
    if (!session) {
      return undefined;
    }
    if (session.status === "exited" || session.status === "error") {
      return session;
    }

    const alive = await this.tmux.hasSession(session.tmuxName);
    if (!alive) {
      const exited = this.updateSession(id, { status: "exited" });
      try {
        await this.recoveryStore.removeSession(id, session.userId);
      } catch (error) {
        console.error(`[session-manager] reconcile DB sync failed for ${id}`, error);
      }
      // Drop the in-memory entry on death so subsequent operations see the
      // session as truly exited, matching stopSession semantics.
      this.sessions.delete(id);
      return exited;
    }

    if (session.status === "running") {
      return this.updateSession(id, { status: "detached" });
    }
    return session;
  }

  /**
   * Low-frequency correction scan (optional). Marks any in-memory session whose
   * backing tmux session has disappeared as exited, and syncs the DB. Returns a
   * teardown function to stop the timer.
   */
  startStatusCorrectionScan(intervalMs = 30_000): () => void {
    if (this.correctionInterval) {
      clearInterval(this.correctionInterval);
    }
    const run = () => {
      for (const session of this.sessions.values()) {
        if (session.status === "running" || session.status === "detached") {
          void this.reconcileSessionStatus(session.id).catch((error) => {
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

  async captureHistory(id: string): Promise<string> {
    const session = this.requireSession(id);
    return this.tmux.capturePane(session.tmuxName);
  }

  async resizeSession(id: string, cols: number, rows: number): Promise<void> {
    const session = this.requireSession(id);
    await this.tmux.resizeWindow?.(session.tmuxName, cols, rows);
  }

  /**
   * Direct callers may write only when the session has no active Portfolio
   * assignment. A worker must present the gate-issued, one-use capability.
   */
  async sendInput(
    id: string,
    data: string,
    capability?: PortfolioWorkerInputCapability
  ): Promise<void> {
    const session = this.requireSession(id);
    if (capability) {
      this.sessionInputGate?.assertWorkerInputAllowed(session, capability);
    } else {
      this.sessionInputGate?.assertDirectInputAllowed(session);
    }
    if (!this.tmux.sendInput) {
      throw new Error("tmux input is not supported");
    }
    await this.tmux.sendInput(session.tmuxName, data);
  }

  async submitProgrammaticTask(
    id: string,
    input: ProgrammaticTaskInput
  ): Promise<ProgrammaticTaskStageReceipt> {
    assertSafeProgrammaticMessage(input.message);
    return this.runExclusive(id, async () => {
      const session = this.requireSession(id);
      this.sessionInputGate?.assertDirectInputAllowed(session);
      const launchAdapter = adapterFromLaunchCommand(session.launchPlan.command);
      if (launchAdapter !== input.adapter) {
        throw new Error(PROGRAMMATIC_SUBMIT_ADAPTER_MISMATCH);
      }
      if (session.status !== "running" && session.status !== "detached") {
        throw new Error(PROGRAMMATIC_SUBMIT_NOT_READY);
      }
      if (!this.tmux.inspectPane || !this.tmux.stageProgrammaticInput || !this.tmux.pressEnter) {
        throw new Error("tmux programmatic input is not supported");
      }

      const before = await this.tmux.inspectPane(session.tmuxName);
      if (before.dead || before.inMode || !isProgrammaticComposerReady(input.adapter, before.content)) {
        throw new Error(PROGRAMMATIC_SUBMIT_NOT_READY);
      }

      const needle = programmaticDeliveryNeedle(input.message);
      if (needle === "") {
        throw new Error(PROGRAMMATIC_SUBMIT_STAGING_FAILED);
      }
      // Once staging starts, tmux may already have received some or all bytes.
      // Any later failure is therefore indeterminate and must never be exposed
      // as a safe-to-retry pre-write rejection.
      try {
        await this.tmux.stageProgrammaticInput(session.tmuxName, input.message);
        await this.sleep(this.programmaticSubmitSettleMs[input.adapter]);

        const staged = await this.tmux.inspectPane(session.tmuxName);
        if (
          staged.dead
          || staged.inMode
          || !composerContainsStagedTask(input.adapter, staged.content, input.message, needle)
        ) {
          throw new Error(PROGRAMMATIC_SUBMIT_INDETERMINATE);
        }

        await this.tmux.pressEnter(session.tmuxName);
        return { adapter: input.adapter, needle, stagedPane: staged.content };
      } catch {
        throw new Error(PROGRAMMATIC_SUBMIT_INDETERMINATE);
      }
    });
  }

  assertBrowserInputAllowed(id: string): void {
    const session = this.requireSession(id);
    this.sessionInputGate?.assertBrowserInputAllowed(session);
  }

  async recoverOpenForgeSessions(input: RecoverSessionsInput): Promise<RecoveryResult> {
    const names = await this.tmux.listSessions();
    const indexed = await this.recoveryStore.listSessions();
    const indexedByTmuxName = new Map(indexed.map((session) => [session.tmuxName, session]));
    const recovered: GateASession[] = [];
    const killedOrphans: string[] = [];

    for (const tmuxName of names) {
      if (!isOpenForgeTmuxName(tmuxName, this.tmuxPrefix)) {
        continue;
      }

      const indexedSession = indexedByTmuxName.get(tmuxName);
      if (!indexedSession) {
        await this.tmux.killSession(tmuxName);
        killedOrphans.push(tmuxName);
        continue;
      }

      if (this.sessions.has(indexedSession.id)) {
        continue;
      }

      // tmux outlives Gateway restarts, so bring recovered sessions up to the
      // current scrolling and history defaults before exposing them again.
      await this.tmux.configureSession?.(tmuxName);

      const now = new Date().toISOString();
      const attachToken = indexedSession.attachToken ?? randomUUID();
      const session: GateASession = {
        id: indexedSession.id,
        userId: indexedSession.userId || input.userId,
        attachToken,
        tmuxName,
        launchPlan: indexedSession.launchPlan || fallbackLaunchPlan(input.cwd, indexedSession.id),
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

export function buildTmuxName(userId: string, sessionId: string, tmuxPrefix = "of-"): string {
  return `${normalizeTmuxPrefix(tmuxPrefix)}${shortId(userId)}-${sanitizeId(sessionId)}`;
}

function shortId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 8);
}

function sanitizeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "");
}

function isOpenForgeTmuxName(tmuxName: string, tmuxPrefix: string): boolean {
  return tmuxName.startsWith(tmuxPrefix);
}

function normalizeTmuxPrefix(value = "of-"): string {
  const sanitized = value.replace(/[^a-zA-Z0-9_-]/g, "");
  return sanitized || "of-";
}

function fallbackLaunchPlan(cwd: string, sessionId: string): LaunchPlan {
  return {
    command: "bash",
    args: [],
    cwd,
    env: { OPENFORGE_SESSION_ID: sessionId },
    secretEnvNames: [],
    credentialMode: "host_environment"
  };
}

function fallbackStoppedSession(id: string, tmuxName: string, userId = ""): GateASession {
  const now = new Date().toISOString();
  return {
    id,
    userId,
    attachToken: "",
    tmuxName,
    launchPlan: fallbackLaunchPlan(process.cwd(), id),
    status: "exited",
    createdAt: now,
    updatedAt: now
  };
}
