import { randomUUID } from "node:crypto";

import type { LaunchPlan } from "../adapters/claude.js";
import type { TmuxClient } from "./tmux.js";
import type { OpenForgeEventBus } from "./event-bus.js";

export type SessionStatus = "pending" | "running" | "detached" | "exited" | "error";

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
  removeSession(id: string): Promise<void>;
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

  async removeSession(): Promise<void> {}
}

export class InMemorySessionManager {
  private readonly sessions = new Map<string, GateASession>();
  private readonly tmuxPrefix: string;

  constructor(
    private readonly tmux: TmuxClient,
    private readonly recoveryStore: SessionRecoveryStore = new EmptyRecoveryStore(),
    private readonly eventBus?: OpenForgeEventBus,
    options: SessionManagerOptions = {}
  ) {
    this.tmuxPrefix = normalizeTmuxPrefix(options.tmuxPrefix);
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

  async stopSession(id: string, tmuxName?: string): Promise<GateASession> {
    const session = this.sessions.get(id);
    if (!session && !tmuxName) {
      throw new Error(`Unknown session: ${id}`);
    }

    if (session) {
      await this.tmux.killSession(session.tmuxName);
      await this.recoveryStore.removeSession(id);
      const stopped = this.updateSession(id, { status: "exited" });
      this.sessions.delete(id);
      return stopped;
    }

    await this.tmux.killSession(tmuxName as string);
    await this.recoveryStore.removeSession(id);
    return fallbackStoppedSession(id, tmuxName as string);
  }

  async captureHistory(id: string): Promise<string> {
    const session = this.requireSession(id);
    return this.tmux.capturePane(session.tmuxName);
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

function fallbackStoppedSession(id: string, tmuxName: string): GateASession {
  const now = new Date().toISOString();
  return {
    id,
    userId: "",
    attachToken: "",
    tmuxName,
    launchPlan: fallbackLaunchPlan(process.cwd(), id),
    status: "exited",
    createdAt: now,
    updatedAt: now
  };
}
