import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { authenticate, type AuthenticatedRequest } from "../auth/middleware.js";
import { createClaudeLaunchPlan, type LaunchPlan } from "../adapters/claude.js";
import { getAdapterLaunchStatus } from "../services/adapter-discovery.js";
import type { CommandRunner } from "../lib/dependency-check.js";
import { validateProjectRoot } from "../lib/safe-resolve.js";
import { ProjectRepository } from "../db/repositories/project-repository.js";
import { SessionRepository, type Session } from "../db/repositories/session-repository.js";
import { ModelProviderRepository } from "../db/repositories/model-provider-repository.js";
import { ApiKeyRepository } from "../db/repositories/api-key-repository.js";
import type { Database } from "../db/types.js";
import type { InMemorySessionManager } from "../services/session-manager.js";
import { SessionConflictError } from "../services/session-manager.js";
import type { ForgeBadgerEventBus } from "../services/event-bus.js";
import type { CredentialMode } from "../config-generation/types.js";
import { recordActivity } from "../services/activity-events.js";
import { recordSessionSnapshot } from "../services/session-snapshots.js";
import {
  createClaudePortfolioWorkerLaunchConfiguration,
  createLaunchPlan,
  normalizeAdapter,
  prepareAdapterLaunchExtras,
  prepareClaudePortfolioWorkerLaunch,
  validateSelfManagedAdapterCredentialBoundary
} from "../services/session-launch-plan.js";
export {
  createClaudePortfolioWorkerLaunchConfiguration,
  createLaunchPlan,
  normalizeAdapter,
  prepareAdapterLaunchExtras,
  prepareClaudePortfolioWorkerLaunch,
  validateSelfManagedAdapterCredentialBoundary
};
export type {
  ClaudePortfolioWorkerLaunchConfiguration,
  LaunchPlanInput
} from "../services/session-launch-plan.js";

const createSessionSchema = z.object({
  projectId: z.string().min(1),
  credentialMode: z.enum(["host_environment", "stored_encrypted_key"]),
  aiTool: z.enum(["claude", "opencode", "codex", "kimi"]).optional(),
  apiKeyId: z.string().min(1).optional(),
  modelId: z.string().min(1).optional()
}).superRefine((value, ctx) => {
  if (value.credentialMode === "stored_encrypted_key" && !value.apiKeyId && !value.modelId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["apiKeyId"],
      message: "API key or provider-backed model is required for stored credentials"
    });
  }
});

const switchModelSchema = z.object({
  modelId: z.string().min(1)
});

const listSessionsQuerySchema = z.object({
  projectId: z.string().min(1).optional()
});

const sessionOutputQuerySchema = z.object({
  maxLines: z.coerce.number().int().min(1).max(10000).default(2000)
});

export function createSessionRoutes(
  db: Database,
  masterKey: string,
  sessionManager: InMemorySessionManager,
  eventBus?: ForgeBadgerEventBus,
  adapterCommandRunner?: CommandRunner
): Router {
  const router = Router();
  router.use(authenticate);

  router.get("/", (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const parseResult = listSessionsQuerySchema.safeParse(req.query ?? {});
    if (!parseResult.success) {
      res.status(400).json({ code: 1, message: "Invalid session query" });
      return;
    }
    const repo = new SessionRepository(db, userId);
    const sessions = (parseResult.data.projectId
      ? repo.listByProject(parseResult.data.projectId)
      : repo.list()
    ).map((session) => toSessionPayload(session));
    res.json({
      code: 0,
      data: { sessions },
      message: ""
    });
  });

  router.post("/", async (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const parseResult = createSessionSchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
      res.status(400).json({ code: 1, message: "Invalid input" });
      return;
    }

    const { projectId, credentialMode, aiTool, apiKeyId, modelId } = parseResult.data;
    const projectRepo = new ProjectRepository(db, userId);
    const project = projectRepo.getById(projectId);
    if (!project) {
      res.status(404).json({ code: 1, message: "Project not found" });
      return;
    }

    if (!aiTool && !project.aiTool) {
      res.status(400).json({
        code: 1,
        message: "Runtime CLI selection is required for CLI-agnostic projects"
      });
      return;
    }
    const adapter = normalizeAdapter(aiTool ?? project.aiTool);
    if (!adapter) {
      res.status(400).json({ code: 1, message: "Unsupported project adapter" });
      return;
    }
    const credentialBoundary = validateSelfManagedAdapterCredentialBoundary({
      adapter,
      credentialMode,
      apiKeyId,
      modelId
    });
    if (!credentialBoundary.ok) {
      res.status(400).json({ code: 1, message: credentialBoundary.message });
      return;
    }

    if (modelId) {
      const modelRepo = new ModelProviderRepository(db, userId, masterKey);
      if (!modelRepo.getModelProfile(modelId)) {
        res.status(404).json({ code: 1, message: "Model not found" });
        return;
      }
    }

    if (credentialMode === "stored_encrypted_key" && apiKeyId) {
      const apiKeyRepo = new ApiKeyRepository(db, userId, masterKey);
      if (!apiKeyRepo.getById(apiKeyId)) {
        res.status(404).json({ code: 1, message: "API key not found" });
        return;
      }
    }

    const launchStatus = await getAdapterLaunchStatus(adapter, adapterCommandRunner);
    if (!launchStatus.launchEnabled) {
      res.status(409).json({
        code: 1,
        message: `${launchStatus.label} is not available for launch`,
        details: {
          adapter: launchStatus.id,
          command: launchStatus.command,
          status: launchStatus.status,
          error: launchStatus.error
        }
      });
      return;
    }

    const sessionRepo = new SessionRepository(db, userId);
    const dbSession = sessionRepo.create({
      projectId: project.id,
      name: project.name,
      aiTool: adapter,
      workingDir: project.path,
      credentialMode,
      ...(apiKeyId ? { apiKeyId } : {}),
      ...(modelId ? { modelId } : {})
    });
    recordSessionActivity(db, eventBus, userId, dbSession, "session_created", "info", `Session ${dbSession.name} created`);

    eventBus?.emitEvent({
      type: "session_created",
      userId,
      sessionId: dbSession.id,
      projectId: project.id,
      name: dbSession.name
    });

    try {
      const pluginDirs = await prepareAdapterLaunchExtras(db, userId, adapter, project.path, dbSession.id);
      const launchPlan = createLaunchPlan({
        db,
        userId,
        masterKey,
        adapter,
        projectRoot: project.path,
        sessionId: dbSession.id,
        credentialMode,
        ...(apiKeyId ? { apiKeyId } : {}),
        ...(modelId ? { modelId } : {}),
        ...(pluginDirs.length > 0 ? { pluginDirs } : {})
      });
      const attachToken = randomUUID();
      sessionRepo.update(dbSession.id, { attachToken });

      const session = await sessionManager.createSession({
        userId,
        sessionId: dbSession.id,
        launchPlan,
        attachToken
      });

      const oldStatus = dbSession.status;
      const updated = sessionRepo.update(dbSession.id, {
        status: "running",
        attachToken: session.attachToken,
        tmuxSession: session.tmuxName,
        lastActive: new Date()
      });
      recordSessionActivity(db, eventBus, userId, updated ?? dbSession, "session_started", "success", `Session ${dbSession.name} started`);
      recordSessionSnapshot({
        db,
        userId,
        session: updated ?? dbSession,
        metadata: { reason: "session_started" }
      });

      eventBus?.emitEvent({
        type: "session_status_changed",
        userId,
        sessionId: dbSession.id,
        oldStatus,
        newStatus: "running"
      });

      res.status(201).json({
        code: 0,
        data: { session: toSessionPayload(updated ?? dbSession) },
        message: ""
      });
    } catch (error) {
      const oldStatus = dbSession.status;
      sessionRepo.update(dbSession.id, {
        status: "error",
        attachToken: "",
        errorMessage: error instanceof Error ? error.message : String(error)
      });
      recordSessionActivity(
        db,
        eventBus,
        userId,
        dbSession,
        "session_error",
        "error",
        error instanceof Error ? error.message : "Failed to create session"
      );
      eventBus?.emitEvent({
        type: "session_status_changed",
        userId,
        sessionId: dbSession.id,
        oldStatus,
        newStatus: "error"
      });
      res.status(400).json({
        code: 1,
        message: error instanceof Error ? error.message : "Failed to create session"
      });
    }
  });

  router.get("/:id", (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const repo = new SessionRepository(db, userId);
    const session = repo.getById(req.params.id);
    if (!session) {
      res.status(404).json({ code: 1, message: "Session not found" });
      return;
    }
    res.json({
      code: 0,
      data: { session: toSessionPayload(session) },
      message: ""
    });
  });

  /**
   * Read-only tail of the session's buffered terminal output (raw pty stream
   * including ANSI escapes). The buffer is in-memory only and accumulates while
   * a browser terminal is attached; it is cleared on Gateway restart and is
   * NOT populated for detached/never-attached sessions (returns empty output).
   */
  router.get("/:id/output", (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const parseResult = sessionOutputQuerySchema.safeParse(req.query ?? {});
    if (!parseResult.success) {
      res.status(400).json({ code: 1, message: "Invalid maxLines" });
      return;
    }
    const repo = new SessionRepository(db, userId);
    const session = repo.getById(req.params.id);
    if (!session) {
      res.status(404).json({ code: 1, message: "Session not found" });
      return;
    }
    const ring = sessionManager.getSessionOutput(req.params.id);
    if (!ring) {
      res.json({
        code: 0,
        data: { output: "", truncated: false, lineCount: 0 },
        message: ""
      });
      return;
    }
    res.json({
      code: 0,
      data: ring.getTail(parseResult.data.maxLines),
      message: ""
    });
  });

  router.post("/:id/connect", (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const repo = new SessionRepository(db, userId);
    const session = repo.getById(req.params.id);
    if (!session) {
      res.status(404).json({ code: 1, message: "Session not found" });
      return;
    }
    if (session.status !== "running") {
      res.status(409).json({ code: 1, message: "Session is not connectable" });
      return;
    }

    const liveSession = sessionManager.getSession(session.id);
    // Prefer the live in-memory attach token (plaintext). The DB column now
    // holds the token encrypted at rest, so never surface it directly.
    const attachToken = liveSession?.attachToken ?? "";
    const tmuxName = liveSession?.tmuxName ?? session.tmuxSession ?? undefined;
    if (!attachToken || !tmuxName) {
      res.status(409).json({ code: 1, message: "Session is not connectable" });
      return;
    }
    recordSessionActivity(db, eventBus, userId, session, "session_connected", "info", `Session ${session.name} connected`);

    res.json({
      code: 0,
      data: {
        session: toSessionPayload(
          session.tmuxSession === tmuxName ? session : { ...session, tmuxSession: tmuxName },
          attachToken
        )
      },
      message: ""
    });
  });

  router.post("/:id/start", async (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const sessionRepo = new SessionRepository(db, userId);
    const dbSession = sessionRepo.getById(req.params.id);
    if (!dbSession) {
      res.status(404).json({ code: 1, message: "Session not found" });
      return;
    }

    try {
      const updated = await sessionManager.runExclusive(req.params.id, async () => {
        // Re-check state inside the mutex (memory + DB), not just DB, to catch
        // concurrent starts. Conflict → 409 with a stable code.
        const live = sessionManager.getSession(req.params.id);
        const fresh = sessionRepo.getById(req.params.id);
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
        const launchStatus = await getAdapterLaunchStatus(adapter, adapterCommandRunner);
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

        const pluginDirs = await prepareAdapterLaunchExtras(db, userId, adapter, dbSession.workingDir, dbSession.id);
        const launchPlan = createLaunchPlan({
          db,
          userId,
          masterKey,
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
        const session = await sessionManager.createSession({
          userId,
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
        recordSessionActivity(db, eventBus, userId, updatedSession ?? dbSession, "session_started", "success", `Session ${dbSession.name} started`);
        recordSessionSnapshot({
          db,
          userId,
          session: updatedSession ?? dbSession,
          metadata: { reason: "session_started" }
        });
        return updatedSession ?? dbSession;
      });

      res.json({
        code: 0,
        data: { session: updated ? toSessionPayload(updated) : undefined },
        message: ""
      });
    } catch (error) {
      const oldStatus = dbSession.status;
      if (error instanceof SessionConflictError) {
        res.status(409).json({ code: 1, message: error.message });
        return;
      }
      const httpStatus = (error as Error & { httpStatus?: number }).httpStatus ?? 400;
      sessionRepo.update(dbSession.id, {
        status: "error",
        attachToken: "",
        errorMessage: error instanceof Error ? error.message : String(error)
      });
      recordSessionActivity(
        db,
        eventBus,
        userId,
        dbSession,
        "session_error",
        "error",
        error instanceof Error ? error.message : "Failed to start session"
      );
      eventBus?.emitEvent({
        type: "session_status_changed",
        userId,
        sessionId: dbSession.id,
        oldStatus,
        newStatus: "error"
      });
      res.status(httpStatus).json({
        code: 1,
        message: error instanceof Error ? error.message : "Failed to start session",
        ...((error as Error & { details?: unknown }).details
          ? { details: (error as Error & { details?: unknown }).details }
          : {})
      });
    }
  });

  router.post("/:id/stop", async (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const sessionRepo = new SessionRepository(db, userId);
    const dbSession = sessionRepo.getById(req.params.id);
    if (!dbSession) {
      res.status(404).json({ code: 1, message: "Session not found" });
      return;
    }

    try {
      const updated = await sessionManager.runExclusive(req.params.id, async () => {
        const live = sessionManager.getSession(req.params.id);
        const tmuxName = live?.tmuxName ?? dbSession.tmuxSession ?? undefined;
        if (!live && !tmuxName) {
          throw new SessionConflictError("Session is not running");
        }
        const oldStatus = live?.status ?? dbSession.status;
        await sessionManager.stopSession(req.params.id, tmuxName, userId);

        const updatedSession = sessionRepo.update(dbSession.id, {
          status: "exited",
          attachToken: "",
          tmuxSession: null,
          lastActive: new Date()
        });
        recordSessionActivity(db, eventBus, userId, updatedSession ?? dbSession, "session_stopped", "success", `Session ${dbSession.name} stopped`);
        return updatedSession ?? dbSession;
      });

      res.json({
        code: 0,
        data: { session: updated ? toSessionPayload(updated) : undefined },
        message: ""
      });
    } catch (error) {
      const oldStatus = dbSession.status;
      if (error instanceof SessionConflictError) {
        res.status(409).json({ code: 1, message: error.message });
        return;
      }
      sessionRepo.update(dbSession.id, {
        status: "error",
        errorMessage: error instanceof Error ? error.message : String(error)
      });
      recordSessionActivity(
        db,
        eventBus,
        userId,
        dbSession,
        "session_error",
        "error",
        error instanceof Error ? error.message : "Failed to stop session"
      );
      eventBus?.emitEvent({
        type: "session_status_changed",
        userId,
        sessionId: dbSession.id,
        oldStatus,
        newStatus: "error"
      });
      res.status(400).json({
        code: 1,
        message: error instanceof Error ? error.message : "Failed to stop session"
      });
    }
  });

  router.post("/:id/switch-model", (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const parseResult = switchModelSchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
      res.status(400).json({ code: 1, message: "Invalid input" });
      return;
    }

    const { modelId } = parseResult.data;
    const modelRepo = new ModelProviderRepository(db, userId, masterKey);
    const model = modelRepo.getModelProfile(modelId);
    if (!model) {
      res.status(404).json({ code: 1, message: "Model not found" });
      return;
    }

    const sessionRepo = new SessionRepository(db, userId);
    const dbSession = sessionRepo.getById(req.params.id);
    if (!dbSession) {
      res.status(404).json({ code: 1, message: "Session not found" });
      return;
    }
    if (dbSession.aiTool === "codex") {
      res.status(400).json({
        code: 1,
        message: "Codex sessions are subscription-managed; provider credentials and model overrides are not supported"
      });
      return;
    }

    const updated = sessionRepo.update(dbSession.id, { modelId });
    recordSessionActivity(db, eventBus, userId, updated ?? dbSession, "model_switched", "info", `Model switched for ${dbSession.name}`, {
      modelId
    });

    res.json({
      code: 0,
      data: { session: updated ? toSessionPayload(updated) : undefined },
      message: ""
    });
  });

  router.delete("/:id", async (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const sessionRepo = new SessionRepository(db, userId);
    const dbSession = sessionRepo.getById(req.params.id);
    if (!dbSession) {
      res.status(404).json({ code: 1, message: "Session not found" });
      return;
    }

    try {
      await sessionManager.runExclusive(req.params.id, async () => {
        // Stop any still-live tmux session regardless of DB status, so a
        // delete does not leave an orphan when the DB says idle/stopped but a
        // tmux session is actually alive.
        const live = sessionManager.getSession(req.params.id);
        const tmuxName = live?.tmuxName ?? dbSession.tmuxSession ?? undefined;
        if (live || tmuxName) {
          try {
            await sessionManager.stopSession(req.params.id, tmuxName, userId);
          } catch {
            // Deleting the row should still be possible if the tmux pane is gone.
          }
        }
      });
    } catch (error) {
      console.error(`[sessions] delete exclusive section failed for ${req.params.id}`, error);
    }

    recordSessionActivity(db, eventBus, userId, dbSession, "session_deleted", "warning", `Session ${dbSession.name} deleted`);
    sessionManager.removeSessionOutput(req.params.id);
    sessionRepo.delete(req.params.id);
    eventBus?.emitEvent({
      type: "session_deleted",
      userId,
      sessionId: req.params.id
    });

    res.json({
      code: 0,
      data: {},
      message: ""
    });
  });

  return router;
}

function recordSessionActivity(
  db: Database,
  eventBus: ForgeBadgerEventBus | undefined,
  userId: string,
  session: Session,
  type: string,
  status: "info" | "success" | "warning" | "error",
  message: string,
  metadata?: unknown
): void {
  recordActivity({
    db,
    eventBus,
    userId,
    sessionId: session.id,
    projectId: session.projectId,
    type,
    status,
    message,
    metadata
  });
}

function toSessionPayload(session: Session, attachToken?: string): Omit<Session, "attachToken"> & {
  attachToken?: string;
  tmuxName: string | null;
} {
  const { attachToken: _attachToken, ...safe } = session;
  return {
    ...safe,
    tmuxName: session.tmuxSession,
    ...(attachToken ? { attachToken } : {})
  };
}

export function createGateASessionRoutes(sessionManager: InMemorySessionManager): Router {
  const router = Router();
  router.use(authenticate);

  router.post("/", async (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const { cwd, command } = req.body ?? {};
    const sessionId = randomUUID();
    const resolvedCwd =
      typeof cwd === "string" ? validateProjectRoot(cwd) : process.cwd();

    const launchPlan =
      command === "claude"
        ? createClaudeLaunchPlan({
            projectRoot: resolvedCwd,
            credentialMode: "host_environment",
            env: { FORGEBADGER_SESSION_ID: sessionId }
          })
        : {
            command: "bash",
            args: [],
            cwd: resolvedCwd,
            env: { FORGEBADGER_SESSION_ID: sessionId },
            secretEnvNames: [],
            credentialMode: "host_environment" as CredentialMode
          };

    try {
      const session = await sessionManager.createSession({
        userId,
        sessionId,
        launchPlan
      });
      res.status(201).json({
        code: 0,
        data: { session },
        message: ""
      });
    } catch (error) {
      res.status(400).json({
        code: 1,
        message: error instanceof Error ? error.message : "Failed to create session"
      });
    }
  });

  return router;
}
