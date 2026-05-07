import { Router, type Response } from "express";
import { z } from "zod";

import { authenticate, type AuthenticatedRequest } from "../auth/middleware.js";
import { ApiKeyRepository } from "../db/repositories/api-key-repository.js";
import { ModelRepository } from "../db/repositories/model-repository.js";
import { ProjectRepository } from "../db/repositories/project-repository.js";
import type { Database } from "../db/types.js";
import type { CredentialMode } from "../adapters/claude.js";
import {
  CodexAppServerManager,
  type CodexAppServerRuntimeMode,
  type CodexAppServerSession
} from "../services/codex-app-server-manager.js";
import { recordActivity } from "../services/activity-events.js";
import type { OpenForgeEventBus } from "../services/event-bus.js";

const startAppServerSchema = z.object({
  projectId: z.string().min(1),
  runtimeMode: z.enum(["app-server-stdio", "app-server-websocket"]).default("app-server-stdio"),
  credentialMode: z.enum(["host_environment", "stored_encrypted_key"]).default("host_environment"),
  apiKeyId: z.string().min(1).optional(),
  modelId: z.string().min(1).optional()
});

const threadStartSchema = z.object({
  cwd: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  approvalPolicy: z.string().min(1).optional(),
  sandbox: z.string().min(1).optional()
});

const turnStartSchema = z.object({
  threadId: z.string().min(1),
  text: z.string().min(1).max(32 * 1024)
});

export interface CodexAppServerRoutesOptions {
  db: Database;
  manager: CodexAppServerManager;
  masterKey?: string | undefined;
  eventBus?: OpenForgeEventBus | undefined;
}

export function createCodexAppServerRoutes(options: CodexAppServerRoutesOptions): Router {
  const router = Router();
  router.use(authenticate);

  router.get("/", (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    res.json({
      code: 0,
      data: { sessions: options.manager.list(userId).map(toSafeSessionPayload) },
      message: ""
    });
  });

  router.post("/", async (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const parseResult = startAppServerSchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
      res.status(400).json({ code: 1, message: "Invalid Codex app-server payload" });
      return;
    }

    const project = new ProjectRepository(options.db, userId).getById(parseResult.data.projectId);
    if (!project || project.aiTool !== "codex") {
      res.status(404).json({ code: 1, message: "Codex project not found" });
      return;
    }

    const launchEnvResult = buildLaunchEnv(options, userId, parseResult.data);
    if (!launchEnvResult.ok) {
      res.status(launchEnvResult.status).json({ code: 1, message: launchEnvResult.message });
      return;
    }

    try {
      const session = await options.manager.start({
        userId,
        projectId: project.id,
        projectRoot: project.path,
        credentialMode: parseResult.data.credentialMode,
        runtimeMode: parseResult.data.runtimeMode,
        env: launchEnvResult.env,
        secretEnvNames: launchEnvResult.secretEnvNames
      });
      recordAppServerActivity(options, userId, session, "codex_app_server_started", "info");
      res.status(201).json({
        code: 0,
        data: { session: toSafeSessionPayload(session) },
        message: ""
      });
    } catch (error) {
      res.status(409).json({
        code: 1,
        message: error instanceof Error ? error.message : "Failed to start Codex app-server"
      });
    }
  });

  router.post("/:id/stop", (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    try {
      const session = options.manager.stop(req.params.id, userId);
      recordAppServerActivity(options, userId, session, "codex_app_server_stopped", "info");
      res.json({
        code: 0,
        data: { session: toSafeSessionPayload(session) },
        message: ""
      });
    } catch {
      res.status(404).json({ code: 1, message: "Codex app-server session not found" });
    }
  });

  router.post("/:id/initialize", async (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    try {
      const result = await options.manager.initialize(req.params.id, userId);
      res.json({ code: 0, data: { result }, message: "" });
    } catch (error) {
      sendRpcError(res, error);
    }
  });

  router.post("/:id/thread", async (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const session = getOwnedSession(options, req.params.id, userId);
    if (!session) {
      res.status(404).json({ code: 1, message: "Codex app-server session not found" });
      return;
    }

    const parseResult = threadStartSchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
      res.status(400).json({ code: 1, message: "Invalid Codex thread payload" });
      return;
    }

    try {
      const result = await options.manager.startThread(req.params.id, userId, {
        cwd: parseResult.data.cwd ?? session.projectRoot,
        ...(parseResult.data.model ? { model: parseResult.data.model } : {}),
        ...(parseResult.data.approvalPolicy ? { approvalPolicy: parseResult.data.approvalPolicy } : {}),
        ...(parseResult.data.sandbox ? { sandbox: parseResult.data.sandbox } : {})
      });
      res.json({ code: 0, data: { result }, message: "" });
    } catch (error) {
      sendRpcError(res, error);
    }
  });

  router.post("/:id/turn", async (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const parseResult = turnStartSchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
      res.status(400).json({ code: 1, message: "Invalid Codex turn payload" });
      return;
    }

    try {
      const result = await options.manager.startTurn(req.params.id, userId, parseResult.data);
      res.json({ code: 0, data: { result }, message: "" });
    } catch (error) {
      sendRpcError(res, error);
    }
  });

  return router;
}

type StartAppServerInput = z.infer<typeof startAppServerSchema>;

type LaunchEnvResult =
  | { ok: true; env: Record<string, string>; secretEnvNames: string[] }
  | { ok: false; status: number; message: string };

function buildLaunchEnv(
  options: CodexAppServerRoutesOptions,
  userId: string,
  input: StartAppServerInput
): LaunchEnvResult {
  const env: Record<string, string> = {};
  const secretEnvNames: string[] = [];

  if (input.credentialMode === "stored_encrypted_key") {
    if (!options.masterKey) {
      return { ok: false, status: 400, message: "Stored credential mode is not configured" };
    }
    if (!input.apiKeyId) {
      return { ok: false, status: 404, message: "API key not found" };
    }

    const apiKeyRepo = new ApiKeyRepository(options.db, userId, options.masterKey);
    const record = apiKeyRepo.getById(input.apiKeyId);
    if (!record) {
      return { ok: false, status: 404, message: "API key not found" };
    }
    const secretName = apiKeyEnvName(record.provider);
    env[secretName] = apiKeyRepo.decryptForLaunch(input.apiKeyId);
    secretEnvNames.push(secretName);
  }

  if (input.modelId) {
    const model = new ModelRepository(options.db, userId).getById(input.modelId);
    if (!model) {
      return { ok: false, status: 404, message: "Model not found" };
    }
    env.CODEX_MODEL = model.modelId;
  }

  return { ok: true, env, secretEnvNames };
}

function recordAppServerActivity(
  options: CodexAppServerRoutesOptions,
  userId: string,
  session: CodexAppServerSession,
  type: string,
  status: "info" | "warning" | "error"
): void {
  recordActivity({
    db: options.db,
    eventBus: options.eventBus,
    userId,
    projectId: session.projectId,
    type,
    status,
    message: `Codex app-server ${session.status}`,
    metadata: JSON.stringify({
      appServerSessionId: session.id,
      runtimeMode: session.runtimeMode,
      listen: session.listen,
      pid: session.pid
    })
  });
}

function toSafeSessionPayload(session: CodexAppServerSession): Omit<
  CodexAppServerSession,
  "token" | "tokenFile"
> {
  const { token: _token, tokenFile: _tokenFile, ...safe } = session;
  return safe;
}

function getOwnedSession(
  options: CodexAppServerRoutesOptions,
  id: string,
  userId: string
): CodexAppServerSession | null {
  try {
    return options.manager.get(id, userId);
  } catch {
    return null;
  }
}

function sendRpcError(res: Response, error: unknown): void {
  const message = error instanceof Error ? error.message : "Codex app-server request failed";
  if (message.includes("not found")) {
    res.status(404).json({ code: 1, message: "Codex app-server session not found" });
    return;
  }
  res.status(409).json({ code: 1, message });
}

function apiKeyEnvName(provider: string): string {
  const normalized = provider.trim().toLowerCase();
  if (normalized === "anthropic") return "ANTHROPIC_API_KEY";
  if (normalized === "openai") return "OPENAI_API_KEY";
  return `${normalized.replace(/[^a-z0-9]+/g, "_").toUpperCase()}_API_KEY`;
}

export type { CodexAppServerRuntimeMode, CredentialMode };
