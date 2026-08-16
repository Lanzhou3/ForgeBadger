/**
 * Copilot agent routes — /api/v1/copilot/*.
 *
 * Exposes the self-hosted agent harness (conversations, runs, messages,
 * pending-action approval, and scoped memory). The whole OpenForge platform is
 * the copilot's tool surface; operate tools are approval-gated and surfaced as
 * pending actions. Streaming text/tool deltas are published over /ws/events via
 * copilot_run_updated; these routes are request/response only.
 *
 * All access is user-scoped (repos constructed with req.userId from auth).
 */
import { Router, type Response } from "express";
import { z } from "zod";

import { authenticate, type AuthenticatedRequest } from "../auth/middleware.js";
import type { Database } from "../db/types.js";
import type { OpenForgeEventBus } from "../services/event-bus.js";
import { ModelProviderRepository } from "../db/repositories/model-provider-repository.js";
import { CopilotConversationLog } from "../services/agent/conversation-log.js";
import { AgentMemoryRepository } from "../services/agent/memory.js";
import { createAgentLlmClient } from "../services/agent/llm-client.js";
import { createAgentToolRegistry } from "../services/agent/tool-registry.js";
import { createPlatformTools } from "../services/agent/tools/index.js";
import { createCopilotOrchestrator } from "../services/agent/orchestrator.js";
import type { PortfolioApiFacade } from "../services/portfolio/portfolio-api-service.js";

const idSchema = z.string().trim().min(1).max(128);
const titleSchema = z.string().trim().min(1).max(200).optional();
const modelIdSchema = z.string().trim().min(1).max(128).optional();
const createConversationSchema = z.object({ title: titleSchema }).strict();
const sendMessageSchema = z.object({
  content: z.string().trim().min(1).max(32 * 1024),
  modelId: modelIdSchema
}).strict();
const memoryScopeSchema = z.enum(["global", "project", "session"]);
const writeMemorySchema = z.object({
  kind: z.enum(["fact", "preference", "decision", "project_note"]),
  scope: memoryScopeSchema,
  text: z.string().trim().min(1).max(8 * 1024),
  projectId: z.string().max(128).optional(),
  metadata: z.record(z.unknown()).optional()
}).strict();
const listMemorySchema = z.object({ scope: memoryScopeSchema.default("global"), projectId: z.string().max(128).optional(), limit: z.coerce.number().int().min(1).max(100).optional() }).strict();
const searchMemorySchema = z.object({ q: z.string().trim().min(1).max(512), scope: memoryScopeSchema.default("global"), projectId: z.string().max(128).optional(), limit: z.coerce.number().int().min(1).max(50).optional() }).strict();

export interface CopilotRouteDeps {
  db: Database;
  masterKey: string;
  eventBus: OpenForgeEventBus;
  portfolioApi?: PortfolioApiFacade | undefined;
}

/** Build a per-user agent stack (log, memory, orchestrator). */
function agentForUser(deps: CopilotRouteDeps, userId: string) {
  const log = new CopilotConversationLog(deps.db, userId);
  const memory = new AgentMemoryRepository(deps.db, userId);
  const modelRepo = new ModelProviderRepository(deps.db, userId, deps.masterKey);
  const llm = createAgentLlmClient({ modelProviderRepository: modelRepo });
  const toolRegistry = createAgentToolRegistry(createPlatformTools());
  const orchestrator = createCopilotOrchestrator({
    db: deps.db,
    masterKey: deps.masterKey,
    toolRegistry,
    llm,
    eventBus: deps.eventBus,
    ...(deps.portfolioApi !== undefined ? { portfolioApi: deps.portfolioApi } : {})
  });
  return { log, memory, orchestrator, toolRegistry };
}

export function createCopilotRoutes(deps: CopilotRouteDeps): Router {
  const router = Router();
  router.use(authenticate);

  router.get("/capabilities", (req, res) => {
    const { toolRegistry } = agentForUser(deps, userId(req));
    const tools = Array.from(toolRegistry.tools.values()).map((t) => ({
      name: t.name,
      description: t.description,
      risk: t.risk,
      requiresApproval: t.requiresApproval
    }));
    res.json(ok({ tools }));
  });

  router.post("/conversations", (req, res) => withBody(req.body, createConversationSchema, res, (value) => {
    const { log } = agentForUser(deps, userId(req));
    const conversation = log.createConversation(value.title);
    res.status(201).json(ok({ conversation }));
  }));

  router.get("/conversations", (_req, res) => {
    const { log } = agentForUser(deps, userId(_req));
    res.json(ok({ conversations: log.listConversations() }));
  });

  router.get("/conversations/:id/messages", (req, res) => {
    const id = parseId(req.params.id, res); if (!id) return;
    const { log } = agentForUser(deps, userId(req));
    const conversation = log.getConversation(id);
    if (!conversation) return notFound(res);
    res.json(ok({ messages: log.listMessages(id) }));
  });

  // Run a turn: appends the user message, runs the step loop, and returns the
  // run id. Streaming deltas arrive over /ws/events (copilot_run_updated).
  router.post("/conversations/:id/messages", (req, res) => {
    const id = parseId(req.params.id, res); if (!id) return;
    const { log, orchestrator } = agentForUser(deps, userId(req));
    if (!log.getConversation(id)) return notFound(res);
    withBody(req.body, sendMessageSchema, res, async (value) => {
      try {
        const runId = await orchestrator.runTurn({
          userId: userId(req),
          conversationId: id,
          userText: value.content,
          ...(value.modelId !== undefined ? { modelId: value.modelId } : {})
        });
        res.status(201).json(ok({ runId }));
      } catch (error) {
        domainError(res, error);
      }
    });
  });

  router.get("/runs/:id", (req, res) => {
    const id = parseId(req.params.id, res); if (!id) return;
    const { log } = agentForUser(deps, userId(req));
    const run = log.getRun(id);
    if (!run) return notFound(res);
    res.json(ok({ run, pendingActions: log.listPendingActions(id) }));
  });

  router.post("/runs/:id/cancel", (req, res) => {
    const id = parseId(req.params.id, res); if (!id) return;
    const { orchestrator } = agentForUser(deps, userId(req));
    const result = orchestrator.cancelRun({ userId: userId(req), runId: id });
    res.json(ok(result));
  });

  const approveSchema = z.object({ approved: z.boolean() }).strict();
  router.post("/runs/:id/pending-actions/:actionId/decide", (req, res) => {
    const runId = parseId(req.params.id, res); if (!runId) return;
    const actionId = parseId(req.params.actionId, res); if (!actionId) return;
    const { orchestrator } = agentForUser(deps, userId(req));
    withBody(req.body, approveSchema, res, async (value) => {
      try {
        const result = await orchestrator.resumeAfterApproval({
          userId: userId(req),
          runId,
          actionId,
          approved: value.approved
        });
        res.json(ok(result));
      } catch (error) {
        domainError(res, error);
      }
    });
  });

  router.get("/memory/entries", (req, res) => withQuery(req.query, listMemorySchema, res, (value) => {
    const { memory } = agentForUser(deps, userId(req));
    const scope = { scope: value.scope ?? "global", ...(value.projectId !== undefined ? { projectId: value.projectId } : {}) };
    res.json(ok({ entries: memory.list(scope, value.limit ?? 50) }));
  }));

  router.post("/memory/entries", (req, res) => withBody(req.body, writeMemorySchema, res, (value) => {
    const { memory } = agentForUser(deps, userId(req));
    const entry = memory.create({
      kind: value.kind,
      scope: value.scope,
      text: value.text,
      ...(value.projectId !== undefined ? { projectId: value.projectId } : {}),
      ...(value.metadata !== undefined ? { metadata: value.metadata } : {})
    });
    res.status(201).json(ok({ entry }));
  }));

  router.get("/memory/search", (req, res) => withQuery(req.query, searchMemorySchema, res, (value) => {
    const { memory } = agentForUser(deps, userId(req));
    const scope = { scope: value.scope ?? "global", ...(value.projectId !== undefined ? { projectId: value.projectId } : {}) };
    res.json(ok({ entries: memory.search(value.q, scope, value.limit ?? 10) }));
  }));

  router.delete("/memory/entries/:id", (req, res) => {
    const id = parseId(req.params.id, res); if (!id) return;
    const { memory } = agentForUser(deps, userId(req));
    if (!memory.delete(id)) return notFound(res);
    res.json(ok({ deleted: true }));
  });

  return router;
}

function userId(req: unknown): string { return (req as AuthenticatedRequest).userId; }
function ok(data: unknown) { return { code: 0, data, message: "" }; }
function parseId(value: string | undefined, res: Response): string | undefined {
  const parsed = idSchema.safeParse(value);
  if (!parsed.success) invalid(res);
  return parsed.success ? parsed.data : undefined;
}
function withBody<T>(body: unknown, schema: z.ZodType<T>, res: Response, callback: (value: T) => void): void {
  const parsed = schema.safeParse(body);
  if (!parsed.success) return invalid(res);
  callback(parsed.data);
}
function withQuery<T>(query: unknown, schema: z.ZodType<T>, res: Response, callback: (value: T) => void): void {
  const parsed = schema.safeParse(query);
  if (!parsed.success) return invalid(res);
  callback(parsed.data);
}
function invalid(res: Response, message = "Invalid input"): void {
  res.status(400).json({ code: 1, message, details: { code: "COPILOT_INVALID_INPUT" } });
}
function notFound(res: Response): void {
  res.status(404).json({ code: 1, message: "Copilot record not found", details: { code: "COPILOT_NOT_FOUND" } });
}
function domainError(res: Response, error: unknown): void {
  const code = error instanceof Error ? error.message : "COPILOT_OPERATION_FAILED";
  res.status(400).json({ code: 1, message: "Copilot operation rejected", details: { code } });
}
