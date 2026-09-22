import { hasDeliveryHistory } from '../db/repositories/managed-project-access.js';
import { PlatformActions } from "../services/platform-commands/actions.js";
import { createPlatformCommands } from "../services/platform-commands/catalog.js";
import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { authenticate, type AuthenticatedRequest } from "../auth/middleware.js";
import { createClaudeLaunchPlan, type LaunchPlan } from "../adapters/claude.js";
import { getAdapterLaunchStatus } from "../services/adapter-discovery.js";
import { getAdapterAutonomy } from "../services/adapter-autonomy.js";
import type { CommandRunner } from "../lib/dependency-check.js";
import { validateProjectRoot } from "../lib/safe-resolve.js";
import { ProjectRepository } from "../db/repositories/project-repository.js";
import { SessionRepository, type Session } from "../db/repositories/session-repository.js";
import type { Database } from "../db/types.js";
import type { InMemorySessionManager } from "../services/session-manager.js";
import {
  createFallbackLaunchPlan,
  SessionConflictError
} from "../services/session-manager.js";
import type { ForgeBadgerEventBus } from "../services/event-bus.js";
import type { RuntimeAuthorizationInvalidator } from "../services/runtime-authorization-invalidation.js";
import { recordActivity } from "../services/activity-events.js";
import { recordSessionSnapshot } from "../services/session-snapshots.js";
import { buildSessionBoard } from "../services/session-board.js";
import {
  createLaunchPlan,
  normalizeAdapter,
  prepareAdapterLaunchExtras
} from "../services/session-launch-plan.js";
export {
  createLaunchPlan,
  normalizeAdapter,
  prepareAdapterLaunchExtras
};
export type { LaunchPlanInput } from "../services/session-launch-plan.js";

const createSessionSchema = z.object({
  projectId: z.string().min(1),
  aiTool: z.enum(["claude", "opencode", "codex", "kimi", "pi"]).optional()
}).strict();

const listSessionsQuerySchema = z.object({
  projectId: z.string().min(1).optional()
});

const sessionOutputQuerySchema = z.object({
  maxLines: z.coerce.number().int().min(1).max(10000).default(2000)
});

const updateLastPromptSchema = z.object({
  prompt: z.string()
}).strict();

const LAST_PROMPT_MAX_LENGTH = 500;

export function createSessionRoutes(
  db: Database,
  masterKey: string,
  sessionManager: InMemorySessionManager,
  runtimeAuthorizationInvalidator: RuntimeAuthorizationInvalidator,
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

  router.get("/board", (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const board = buildSessionBoard(db, userId);
    res.json({
      code: 0,
      data: { board: { ...board, sessions: board.sessions.map((session) => toSessionPayload(session)) } },
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

    const { projectId, aiTool } = parseResult.data;
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

    const launchStatus = await getAdapterLaunchStatus(adapter, adapterCommandRunner, sessionManager.terminalBackendHealth());
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
      credentialMode: "host_environment"
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
      const pluginDirs = await prepareAdapterLaunchExtras(db, userId, adapter, project.path);
      const launchPlan = createLaunchPlan({
        adapter,
        projectRoot: project.path,
        sessionId: dbSession.id,
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
        runtimeSessionName: session.runtimeSessionName,
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

  router.put("/:id/last-prompt", (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const parseResult = updateLastPromptSchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
      res.status(400).json({ code: 1, message: "Invalid last prompt payload" });
      return;
    }
    const prompt = parseResult.data.prompt.trim();
    if (prompt.length === 0) {
      res.status(400).json({ code: 1, message: "Prompt must not be empty" });
      return;
    }

    const repo = new SessionRepository(db, userId);
    const session = repo.getById(req.params.id);
    if (!session) {
      res.status(404).json({ code: 1, message: "Session not found" });
      return;
    }
    const lastPrompt = prompt.slice(0, LAST_PROMPT_MAX_LENGTH);
    const updated = repo.update(req.params.id, { lastPrompt }) ?? { ...session, lastPrompt };
    res.json({
      code: 0,
      data: { session: toSessionPayload(updated) },
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
    const runtimeSessionName = liveSession?.runtimeSessionName ?? session.runtimeSessionName ?? undefined;
    if (!attachToken || !runtimeSessionName) {
      res.status(409).json({ code: 1, message: "Session is not connectable" });
      return;
    }
    recordSessionActivity(db, eventBus, userId, session, "session_connected", "info", `Session ${session.name} connected`);

    res.json({
      code: 0,
      data: {
        session: toSessionPayload(
          session.runtimeSessionName === runtimeSessionName ? session : { ...session, runtimeSessionName: runtimeSessionName },
          attachToken
        )
      },
      message: ""
    });
  });

  router.get("/:id/writer", (req, res) => {
    const userId=(req as unknown as AuthenticatedRequest).userId;
    const session = new SessionRepository(db,userId).getById(req.params.id);
    if(!session) return res.status(404).json({code:1,message:"Session not found"});
    let mode: "manual" | "automated" = "manual";
    if(sessionManager.getSession(req.params.id)) {
      try { sessionManager.assertManualInputAllowed(userId,req.params.id); }
      catch(error) { if(error instanceof Error&&error.message==="SESSION_WRITER_BUSY")mode="automated";else return res.status(409).json({code:1,message:error instanceof Error?error.message:"Writer unavailable"}); }
    }
    const adapter = normalizeAdapter(session.aiTool);
    return res.json({code:0,data:{sessionId:req.params.id,mode,autonomy:adapter?getAdapterAutonomy(adapter).mode:"manual_only"},message:""});
  });

  for (const action of ["start", "stop", "takeover"] as const) {
    router.post(`/:id/${action}`, async (req, res) => {
      const userId = (req as unknown as AuthenticatedRequest).userId;
      if (!new SessionRepository(db, userId).getById(req.params.id)) {
        res.status(404).json({ code: 1, message: "Session not found" });
        return;
      }
      try {
        const actions = new PlatformActions({ db, userId, masterKey, sessionManager, eventBus, adapterCommandRunner }, createPlatformCommands());
        const result = await actions.executeOwner(`session.${action}`, { sessionId: req.params.id }, randomUUID());
        res.json({code:0,data:action === "takeover" ? result : {session:result},message:""});
      } catch(error) {
        const detail = error as Error & {httpStatus?:number;details?:unknown};
        const status = error instanceof SessionConflictError ? 409 : detail.httpStatus ?? 400;
        res.status(status).json({code:1,message:error instanceof Error ? error.message : "Session operation failed",
          ...(detail.details ? {details:detail.details} : {})});
      }
    });
  }

  router.delete("/:id", async (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const sessionRepo = new SessionRepository(db, userId);
    const dbSession = sessionRepo.getById(req.params.id);
    if (!dbSession) {
      res.status(404).json({ code: 1, message: "Session not found" });
      return;
    }

    if (hasDeliveryHistory(db,"session",dbSession.id)) {
      res.status(409).json({code:1,message:"Session has delivery history; close its task workspace",details:{code:"DELIVERY_HISTORY_REQUIRES_ARCHIVE"}}); return;
    }
    try {
      await sessionManager.runExclusive(req.params.id, async () => {
        // Stop any still-live runtime session regardless of DB status, so a
        // delete does not leave an orphan when the DB says idle/stopped but the
        // backend session is actually alive.
        const live = sessionManager.getSession(req.params.id);
        const runtimeSessionName = live?.runtimeSessionName ?? dbSession.runtimeSessionName ?? undefined;
        if (live || runtimeSessionName) {
          await sessionManager.stopSession(req.params.id, runtimeSessionName, userId);
        }
        // Keep the row and its durable stop proof on every uncertain outcome.
        db.transaction(() => {
          recordSessionActivity(db, undefined, userId, dbSession, "session_deleted", "warning", `Session ${dbSession.name} deleted`);
          sessionRepo.delete(req.params.id);
        })();
        sessionManager.removeSessionOutput(req.params.id);
      });
    } catch {
      res.status(409).json({ code: 1, message: "Session stop has not been confirmed; retry after the runtime is available", details: { code: "SESSION_RUNTIME_STOP_UNCONFIRMED" } });
      return;
    }

    runtimeAuthorizationInvalidator.invalidate({
      scope: "session",
      userId,
      sessionId: req.params.id
    });
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

type SessionPayload = Omit<Session,
  | "attachToken"
  | "modelId"
  | "apiKeyId"
  | "credentialMode"
> & {
  attachToken?: string;
};

function toSessionPayload(session: Session, attachToken?: string): SessionPayload {
  const {
    attachToken: _attachToken,
    modelId: _modelId,
    apiKeyId: _apiKeyId,
    credentialMode: _credentialMode,
    ...safe
  } = session;
  return {
    ...safe,
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
        : createFallbackLaunchPlan(resolvedCwd, sessionId);

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
