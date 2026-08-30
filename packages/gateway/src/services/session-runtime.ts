/**
 * Session runtime lifecycle — shared by the HTTP start route and the Copilot
 * tools so there is exactly one launch path (mutex, adapter validation,
 * launch-plan construction, recovery bookkeeping, activity/snapshot records).
 *
 * Errors surface typed for HTTP mapping:
 *   - SessionNotFoundError            → 404
 *   - SessionConflictError            → 409 (already running)
 *   - errors carrying `httpStatus`    → that status (400/409 from validation)
 */
import { randomUUID } from "node:crypto";

import { recordActivity } from "./activity-events.js";
import { recordSessionSnapshot } from "./session-snapshots.js";
import { SessionConflictError, type InMemorySessionManager } from "./session-manager.js";
import type { ForgeBadgerEventBus } from "./event-bus.js";
import {
  createLaunchPlan,
  normalizeAdapter,
  prepareAdapterLaunchExtras,
  validateSelfManagedAdapterCredentialBoundary
} from "./session-launch-plan.js";
import { getAdapterLaunchStatus } from "./adapter-discovery.js";
import type { CommandRunner } from "../lib/dependency-check.js";
import { SessionRepository, type Session } from "../db/repositories/session-repository.js";
import type { Database } from "../db/types.js";

export class SessionNotFoundError extends Error {
  constructor(sessionId: string) {
    super(`Session not found: ${sessionId}`);
    this.name = "SessionNotFoundError";
  }
}

export interface SessionRuntimeDeps {
  db: Database;
  userId: string;
  masterKey: string;
  sessionManager: InMemorySessionManager;
  eventBus?: ForgeBadgerEventBus | undefined;
  adapterCommandRunner?: CommandRunner | undefined;
}

/**
 * Launch a session's runtime through the session manager. Idempotent-hostile
 * by design: concurrent starts serialize on the per-session mutex and a
 * second start while running raises {@link SessionConflictError}.
 */
export async function startSessionRuntime(deps: SessionRuntimeDeps, sessionId: string): Promise<Session> {
  const sessionRepo = new SessionRepository(deps.db, deps.userId);
  const dbSession = sessionRepo.getById(sessionId);
  if (!dbSession) throw new SessionNotFoundError(sessionId);

  const updated = await deps.sessionManager.runExclusive(sessionId, async () => {
    // Re-check state inside the mutex (memory + DB), not just DB, to catch
    // concurrent starts.
    const live = deps.sessionManager.getSession(sessionId);
    const fresh = sessionRepo.getById(sessionId);
    if (live?.status === "running" || fresh?.status === "running") {
      throw new SessionConflictError("Session already running");
    }

    const adapter = normalizeAdapter(dbSession.aiTool);
    if (!adapter) {
      const err = new Error("Unsupported session adapter");
      (err as Error & { httpStatus?: number }).httpStatus = 400;
      throw err;
    }
    const credentialBoundary = validateSelfManagedAdapterCredentialBoundary({
      adapter,
      credentialMode: dbSession.credentialMode,
      ...(dbSession.apiKeyId ? { apiKeyId: dbSession.apiKeyId } : {}),
      ...(dbSession.modelId ? { modelId: dbSession.modelId } : {})
    });
    if (!credentialBoundary.ok) {
      const err = new Error(credentialBoundary.message);
      (err as Error & { httpStatus?: number }).httpStatus = 400;
      throw err;
    }
    const launchStatus = await getAdapterLaunchStatus(adapter, deps.adapterCommandRunner);
    if (!launchStatus.launchEnabled) {
      const err = new Error(`${launchStatus.label} is not available for launch`);
      (err as Error & { httpStatus?: number }).httpStatus = 409;
      (err as Error & { details?: unknown }).details = {
        adapter: launchStatus.id,
        command: launchStatus.command,
        status: launchStatus.status,
        error: launchStatus.error
      };
      throw err;
    }

    const pluginDirs = await prepareAdapterLaunchExtras(deps.db, deps.userId, adapter, dbSession.workingDir, dbSession.id);
    const launchPlan = createLaunchPlan({
      db: deps.db,
      userId: deps.userId,
      masterKey: deps.masterKey,
      adapter,
      projectRoot: dbSession.workingDir,
      sessionId: dbSession.id,
      credentialMode: dbSession.credentialMode,
      ...(dbSession.apiKeyId ? { apiKeyId: dbSession.apiKeyId } : {}),
      ...(dbSession.modelId ? { modelId: dbSession.modelId } : {}),
      ...(pluginDirs.length > 0 ? { pluginDirs } : {})
    });
    const attachToken = randomUUID();
    sessionRepo.update(dbSession.id, { attachToken });
    const session = await deps.sessionManager.createSession({
      userId: deps.userId,
      sessionId: dbSession.id,
      launchPlan,
      attachToken
    });

    const updatedSession = sessionRepo.update(dbSession.id, {
      status: "running",
      attachToken: session.attachToken,
      tmuxSession: session.tmuxName,
      lastActive: new Date()
    });
    recordSessionActivity(deps, updatedSession ?? dbSession, "session_started", "success", `Session ${dbSession.name} started`);
    recordSessionSnapshot({
      db: deps.db,
      userId: deps.userId,
      session: updatedSession ?? dbSession,
      metadata: { reason: "session_started" }
    });
    return updatedSession ?? dbSession;
  });

  return updated;
}

/** Mark a failed start on the durable record and surface the activity event. */
export function recordStartFailure(
  deps: SessionRuntimeDeps,
  session: Session,
  error: unknown
): void {
  const sessionRepo = new SessionRepository(deps.db, deps.userId);
  sessionRepo.update(session.id, {
    status: "error",
    attachToken: "",
    errorMessage: error instanceof Error ? error.message : String(error)
  });
  recordSessionActivity(
    deps,
    session,
    "session_error",
    "error",
    error instanceof Error ? error.message : "Failed to start session"
  );
}

function recordSessionActivity(
  deps: SessionRuntimeDeps,
  session: Session,
  type: string,
  status: "info" | "success" | "warning" | "error",
  message: string
): void {
  recordActivity({
    db: deps.db,
    eventBus: deps.eventBus,
    userId: deps.userId,
    sessionId: session.id,
    projectId: session.projectId,
    type,
    status,
    message
  });
}
