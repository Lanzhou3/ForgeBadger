import { randomUUID } from "node:crypto";

import type { LaunchPlan } from "../adapters/claude.js";
import type { TmuxClient } from "./tmux.js";
import type { OpenForgeEventBus } from "./event-bus.js";

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
}

class EmptyRecoveryStore implements SessionRecoveryStore {
  async listSessions(): Promise<StoredSession[]> {
    return [];
  }

  async upsertSession(): Promise<void> {}

  async removeSession(_id: string, _userId: string): Promise<void> {}
}

export class InMemorySessionManager {
  private readonly sessions = new Map<string, GateASession>();
  private readonly tmuxPrefix: string;
  private readonly sessionLocks = new Map<string, Promise<unknown>>();
  private correctionInterval: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly tmux: TmuxClient,
    private readonly recoveryStore: SessionRecoveryStore = new EmptyRecoveryStore(),
    private readonly eventBus?: OpenForgeEventBus,
    options: SessionManagerOptions = {}
  ) {
    this.tmuxPrefix = normalizeTmuxPrefix(options.tmuxPrefix);
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
          OPENFORGE_ATTACH_TOKEN: session.attachToken
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

  async sendInput(id: string, data: string): Promise<void> {
    const session = this.requireSession(id);
    if (!this.tmux.sendInput) {
      throw new Error("tmux input is not supported");
    }
    await this.tmux.sendInput(session.tmuxName, data);
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
