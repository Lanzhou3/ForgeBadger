import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { authenticate, type AuthenticatedRequest } from "../auth/middleware.js";
import { createClaudeLaunchPlan, type LaunchPlan } from "../adapters/claude.js";
import { createAdapterLaunchPlan, type AdapterModelSelection } from "../adapters/index.js";
import {
  getAdapterLaunchStatus,
  isAdapterId,
  type AdapterId
} from "../services/adapter-discovery.js";
import type { CommandRunner } from "../lib/dependency-check.js";
import { validateProjectRoot } from "../lib/safe-resolve.js";
import { ProjectRepository } from "../db/repositories/project-repository.js";
import { SessionRepository, type Session } from "../db/repositories/session-repository.js";
import { ModelRepository } from "../db/repositories/model-repository.js";
import { ModelProviderRepository } from "../db/repositories/model-provider-repository.js";
import { ApiKeyRepository } from "../db/repositories/api-key-repository.js";
import { PluginRepository } from "../db/repositories/plugin-repository.js";
import type { Database } from "../db/types.js";
import type { InMemorySessionManager } from "../services/session-manager.js";
import type { OpenForgeEventBus } from "../services/event-bus.js";
import type { CredentialMode } from "../config-generation/types.js";
import { recordActivity } from "../services/activity-events.js";
import { recordSessionSnapshot } from "../services/session-snapshots.js";
import { ensureClaudeNotificationSettings } from "../services/claude-notification-settings.js";
import { materializeClaudePluginPackages } from "../services/claude-plugin-packages.js";

const createSessionSchema = z.object({
  projectId: z.string().min(1),
  credentialMode: z.enum(["host_environment", "stored_encrypted_key"]),
  aiTool: z.enum(["claude", "opencode", "codex"]).optional(),
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

export function createSessionRoutes(
  db: Database,
  masterKey: string,
  sessionManager: InMemorySessionManager,
  eventBus?: OpenForgeEventBus,
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

    const adapter = normalizeAdapter(aiTool ?? project.aiTool);
    if (!adapter) {
      res.status(400).json({ code: 1, message: "Unsupported project adapter" });
      return;
    }
    const credentialBoundary = validateCodexTerminalCredentialBoundary({
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
      const modelRepo = new ModelRepository(db, userId);
      if (!modelRepo.getById(modelId)) {
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
      const pluginDirs = await prepareClaudeLaunchExtras(db, userId, adapter, project.path, dbSession.id);
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
    const attachToken = liveSession?.attachToken ?? session.attachToken;
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
    if (dbSession.status === "running") {
      res.status(409).json({ code: 1, message: "Session already running" });
      return;
    }

    const adapter = normalizeAdapter(dbSession.aiTool);
    if (!adapter) {
      res.status(400).json({ code: 1, message: "Unsupported session adapter" });
      return;
    }
    const credentialBoundary = validateCodexTerminalCredentialBoundary({
      adapter,
      credentialMode: dbSession.credentialMode,
      ...(dbSession.apiKeyId ? { apiKeyId: dbSession.apiKeyId } : {}),
      ...(dbSession.modelId ? { modelId: dbSession.modelId } : {})
    });
    if (!credentialBoundary.ok) {
      res.status(400).json({ code: 1, message: credentialBoundary.message });
      return;
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

    try {
      const pluginDirs = await prepareClaudeLaunchExtras(db, userId, adapter, dbSession.workingDir, dbSession.id);
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

      res.json({
        code: 0,
        data: { session: updated ? toSessionPayload(updated) : undefined },
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
        error instanceof Error ? error.message : "Failed to start session"
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
        message: error instanceof Error ? error.message : "Failed to start session"
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
    if (dbSession.status !== "running") {
      res.status(409).json({ code: 1, message: "Session is not running" });
      return;
    }

    try {
      await sessionManager.stopSession(dbSession.id, dbSession.tmuxSession ?? undefined, userId);

      const oldStatus = dbSession.status;
      const updated = sessionRepo.update(dbSession.id, {
        status: "stopped",
        attachToken: "",
        tmuxSession: null,
        lastActive: new Date()
      });
      recordSessionActivity(db, eventBus, userId, updated ?? dbSession, "session_stopped", "success", `Session ${dbSession.name} stopped`);

      eventBus?.emitEvent({
        type: "session_status_changed",
        userId,
        sessionId: dbSession.id,
        oldStatus,
        newStatus: "stopped"
      });

      res.json({
        code: 0,
        data: { session: updated ? toSessionPayload(updated) : undefined },
        message: ""
      });
    } catch (error) {
      const oldStatus = dbSession.status;
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
    const modelRepo = new ModelRepository(db, userId);
    const model = modelRepo.getById(modelId);
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

    if (dbSession.status === "running") {
      try {
        await sessionManager.stopSession(dbSession.id, dbSession.tmuxSession ?? undefined, userId);
      } catch {
        // Deleting the database row should still be possible if the tmux pane is already gone.
      }
    }

    recordSessionActivity(db, eventBus, userId, dbSession, "session_deleted", "warning", `Session ${dbSession.name} deleted`);
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
  eventBus: OpenForgeEventBus | undefined,
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

export interface LaunchPlanInput {
  db: Database;
  userId: string;
  masterKey: string;
  adapter: AdapterId;
  projectRoot: string;
  sessionId: string;
  credentialMode: CredentialMode;
  apiKeyId?: string;
  modelId?: string;
  pluginDirs?: string[];
}

export function createLaunchPlan(input: LaunchPlanInput): LaunchPlan {
  const credentialBoundary = validateCodexTerminalCredentialBoundary(input);
  if (!credentialBoundary.ok) {
    throw new Error(credentialBoundary.message);
  }

  const env: Record<string, string> = {
    OPENFORGE_SESSION_ID: input.sessionId,
    OPENFORGE_GATEWAY_URL: getGatewayUrl()
  };
  const secretEnvNames: string[] = [];
  let selectedModel: AdapterModelSelection | undefined;

  if (input.credentialMode === "stored_encrypted_key" && input.adapter !== "codex") {
    const credential = resolveStoredCredential(input);
    env[credential.envName] = credential.secret;
    secretEnvNames.push(credential.envName);
  }

  if (input.modelId && input.adapter !== "codex") {
    const model = new ModelRepository(input.db, input.userId).getById(input.modelId);
    if (!model) {
      throw new Error("Model not found");
    }
    selectedModel = { provider: model.provider, modelId: model.modelId };
    if (input.adapter === "claude") {
      env.ANTHROPIC_MODEL = model.modelId;
    } else if (input.adapter === "opencode") {
      env.OPENCODE_MODEL = model.modelId.includes("/") ? model.modelId : `${model.provider}/${model.modelId}`;
    }
  }

  return createAdapterLaunchPlan({
    adapter: input.adapter,
    projectRoot: input.projectRoot,
    credentialMode: input.credentialMode,
    env,
    secretEnvNames,
    model: selectedModel,
    pluginDirs: input.pluginDirs
  });
}

function resolveStoredCredential(input: LaunchPlanInput): { envName: string; secret: string } {
  if (input.apiKeyId) {
    const apiKeyRepo = new ApiKeyRepository(input.db, input.userId, input.masterKey);
    const record = apiKeyRepo.getById(input.apiKeyId);
    if (!record) {
      throw new Error("API key not found");
    }
    return {
      envName: apiKeyEnvName(record.provider),
      secret: apiKeyRepo.decryptForLaunch(input.apiKeyId)
    };
  }

  if (input.modelId) {
    const providerRepo = new ModelProviderRepository(input.db, input.userId, input.masterKey);
    const model = providerRepo.getModelProfile(input.modelId);
    if (model) {
      const credential = providerRepo.listCredentials(model.providerProfileId)[0];
      if (!credential) {
        throw new Error("Provider credential not found");
      }
      return {
        envName: apiKeyEnvName(model.providerKey),
        secret: providerRepo.decryptCredential(credential.id)
      };
    }
  }

  throw new Error("API key is required for stored credentials");
}

export async function prepareClaudeLaunchExtras(
  db: Database,
  userId: string,
  adapter: AdapterId,
  projectRoot: string,
  sessionId: string
): Promise<string[]> {
  if (adapter !== "claude") {
    return [];
  }

  await ensureClaudeNotificationSettings(projectRoot, getGatewayUrl(), sessionId);
  const enabledPlugins = new PluginRepository(db, userId)
    .list()
    .filter((plugin) => plugin.enabled);
  return (
    await materializeClaudePluginPackages(projectRoot, enabledPlugins)
  ).map((pluginPackage) => pluginPackage.directory);
}

export function normalizeAdapter(value: string): AdapterId | undefined {
  return isAdapterId(value) ? value : undefined;
}

function validateCodexTerminalCredentialBoundary(input: {
  adapter: AdapterId;
  credentialMode: CredentialMode;
  apiKeyId?: string | undefined;
  modelId?: string | undefined;
}): { ok: true } | { ok: false; message: string } {
  if (
    input.adapter === "codex" &&
    (input.credentialMode !== "host_environment" || input.apiKeyId || input.modelId)
  ) {
    return {
      ok: false,
      message: "Codex sessions are subscription-managed; provider credentials and model overrides are not supported"
    };
  }
  return { ok: true };
}

function apiKeyEnvName(provider: string): string {
  const normalized = provider.trim().toLowerCase();
  if (normalized === "anthropic") return "ANTHROPIC_API_KEY";
  if (normalized === "openai") return "OPENAI_API_KEY";
  return `${normalized.replace(/[^a-z0-9]+/g, "_").toUpperCase()}_API_KEY`;
}

function getGatewayUrl(): string {
  return (
    process.env.OPENFORGE_GATEWAY_URL ||
    process.env.NEXT_PUBLIC_GATEWAY_URL ||
    `http://${process.env.OPENFORGE_HOST || "127.0.0.1"}:${process.env.OPENFORGE_PORT || "3000"}`
  );
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
            env: { OPENFORGE_SESSION_ID: sessionId }
          })
        : {
            command: "bash",
            args: [],
            cwd: resolvedCwd,
            env: { OPENFORGE_SESSION_ID: sessionId },
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
