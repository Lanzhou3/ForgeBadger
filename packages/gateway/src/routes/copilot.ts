import { randomUUID } from "node:crypto";
import { CopilotGrantRepository } from "../db/repositories/copilot-grant-repository.js";
import { PlatformActions } from "../services/platform-commands/actions.js";
import { createPlatformCommands } from "../services/platform-commands/catalog.js";
import { PlatformActionRepository } from "../db/repositories/platform-action-repository.js";
/**
 * Copilot agent routes — /api/v1/copilot/*.
 *
 * Exposes the self-hosted agent harness (conversations, runs, messages,
 * pending-action approval, and scoped memory). The whole ForgeBadger platform is
 * the copilot's tool surface; operate tools are approval-gated and surfaced as
 * pending actions. Streaming text/tool deltas are published over /ws/events via
 * copilot_run_updated; these routes are request/response only.
 *
 * All access is user-scoped (repos constructed with req.userId from auth).
 */
import { Router, type Response } from "express";
import { z } from "zod";

import { authenticate, type AuthenticatedRequest } from "../auth/middleware.js";
import { buildAgentStack, type AgentStackDeps } from "../services/agent/agent-stack.js";
import { createPlatformTools } from "../services/agent/tools/index.js";
import { CopilotRunLedger } from "../services/agent/run-ledger.js";
import { AgentError } from "../services/agent/types.js";
import { CopilotToolPreferenceRepository } from "../db/repositories/copilot-tool-preference-repository.js";

const idSchema = z.string().trim().min(1).max(128);
const titleSchema = z.string().trim().min(1).max(200).optional();
const renameConversationSchema = z.object({ title: z.string().trim().min(1).max(200) }).strict();
const modelIdSchema = z.string().trim().min(1).max(128).optional();
const createConversationSchema = z.object({ title: titleSchema, grantId: idSchema.optional() }).strict();
const sendMessageSchema = z.object({
  content: z.string().trim().min(1).max(32 * 1024),
  modelId: modelIdSchema,
  projectId: idSchema.optional(),
  grantId: idSchema.optional()
}).strict();
const memoryScopeSchema = z.enum(["global", "project", "session"]);
const writeMemorySchema = z.object({
  kind: z.enum(["fact", "preference", "decision", "project_note"]),
  scope: memoryScopeSchema,
  text: z.string().trim().min(1).max(8 * 1024),
  projectId: z.string().max(128).optional(),
  conversationId: idSchema.optional(),
  metadata: z.record(z.unknown()).optional()
}).strict();
const listMemorySchema = z.object({ scope: memoryScopeSchema.default("global"), projectId: z.string().max(128).optional(), conversationId: idSchema.optional(), limit: z.coerce.number().int().min(1).max(100).optional() }).strict();
const searchMemorySchema = z.object({ q: z.string().trim().min(1).max(512), scope: memoryScopeSchema.default("global"), projectId: z.string().max(128).optional(), conversationId: idSchema.optional(), limit: z.coerce.number().int().min(1).max(50).optional() }).strict();
const toolEnabledSchema = z.object({ enabled: z.boolean() }).strict();

export type CopilotRouteDeps = AgentStackDeps;

export function createCopilotRoutes(deps: CopilotRouteDeps): Router {
  const router = Router();
  router.use(authenticate);

  const KNOWN_TOOL_NAMES = new Set<string>(createPlatformTools().map((tool) => tool.name));

  router.get("/capabilities", (req, res) => {
    const actingUser = userId(req);
    const preferences = new CopilotToolPreferenceRepository(deps.db, actingUser);
    const tools = Array.from(buildAgentStack(deps, actingUser).toolRegistry.tools.values()).map((tool) => ({
      name: tool.name,
      description: tool.description,
      risk: tool.risk,
      requiresApproval: tool.requiresApproval
    }));
    res.json(ok({
      tools: tools.map((t) => ({ ...t, enabled: preferences.isEnabled(t.name) }))
    }));
  });

  router.put("/capabilities/:toolName/enabled", (req, res) => withBody(req.body, toolEnabledSchema, res, (value) => {
    const toolName = req.params.toolName ?? "";
    if (!KNOWN_TOOL_NAMES.has(toolName)) {
      res.status(404).json({ code: 1, message: `Unknown tool: ${toolName}`, details: { code: "COPILOT_TOOL_UNKNOWN" } });
      return;
    }
    new CopilotToolPreferenceRepository(deps.db, userId(req)).setEnabled(toolName, value.enabled);
    res.json(ok({ toolName, enabled: value.enabled }));
  }));

  router.post("/conversations", (req, res) => withBody(req.body, createConversationSchema, res, (value) => {
    const { log } = buildAgentStack(deps, userId(req));
    try {
      const conversation = deps.db.transaction(() => {
        if(value.grantId) new PlatformActions({db:deps.db,userId:userId(req)},createPlatformCommands()).assertGrant(value.grantId);
        const created = log.createConversation(value.title);
        if(value.grantId) new CopilotGrantRepository(deps.db,userId(req)).bind(created.id,value.grantId);
        return {...created,grantId:value.grantId??null};
      }).immediate();
      res.status(201).json(ok({ conversation }));
    } catch(error) { domainError(res,error); }
  }));

  router.get("/conversations", (_req, res) => {
    const { log } = buildAgentStack(deps, userId(_req));
    res.json(ok({ conversations: log.listConversations().map(c=>({...c,grantId:new CopilotGrantRepository(deps.db,userId(_req)).binding(c.id)??null})) }));
  });

  router.get("/conversations/:id/messages", (req, res) => {
    const id = parseId(req.params.id, res); if (!id) return;
    const { log } = buildAgentStack(deps, userId(req));
    const conversation = log.getConversation(id);
    if (!conversation) return notFound(res);
    res.json(ok({ messages: log.listMessages(id) }));
  });

  router.patch("/conversations/:id", (req, res) => {
    const id = parseId(req.params.id, res); if (!id) return;
    withBody(req.body, renameConversationSchema, res, (value) => {
      const { log } = buildAgentStack(deps, userId(req));
      if (!log.renameConversation(id, value.title)) return notFound(res);
      res.json(ok({ conversation: log.getConversation(id) }));
    });
  });

  // Idempotent delete: conversations owned by other users 404, and a repeat
  // delete of an already-removed conversation also 404s (no leak, no error).
  router.delete("/conversations/:id", (req, res) => {
    const id = parseId(req.params.id, res); if (!id) return;
    const { log } = buildAgentStack(deps, userId(req));
    try {
      if (!log.deleteConversation(id)) return notFound(res);
      res.json(ok({ deleted: true }));
    } catch(error) { domainError(res,error); }
  });

  // Edit a user message: rewrite it in place, drop everything after it, then
  // run a fresh turn against the new prompt. The orchestrator is told to skip
  // its own user-message append so the edited row remains the only one with
  // the new content. Streaming deltas arrive over /ws/events.
  const editMessageSchema = z.object({ messageId: idSchema, content: z.string().trim().min(1).max(32 * 1024) }).strict();
  router.post("/conversations/:id/edit-message", (req, res) => {
    const id = parseId(req.params.id, res); if (!id) return;
    withBody(req.body, editMessageSchema, res, async (value) => {
      const { log, orchestrator } = buildAgentStack(deps, userId(req));
      if (!log.getConversation(id)) return notFound(res);
      try {
        const runId = deps.db.transaction(() => {
          if (!log.truncateAfterMessage(value.messageId,value.content,id)) throw new AgentError("COPILOT_NOT_FOUND","Message not found");
          return orchestrator.enqueue({
          userId: userId(req),
          conversationId: id,
          userText: value.content,
          source: "user",
          skipUserMessage: true
          });
        }).immediate();
        res.status(201).json(ok({ runId }));
      } catch (error) {
        domainError(res, error);
      }
    });
  });

  // Run a turn: appends the user message, runs the step loop, and returns the
  // run id. Streaming deltas arrive over /ws/events (copilot_run_updated).
  router.post("/conversations/:id/messages", (req, res) => {
    const id = parseId(req.params.id, res); if (!id) return;
    const { log, orchestrator } = buildAgentStack(deps, userId(req));
    if (!log.getConversation(id)) return notFound(res);
    withBody(req.body, sendMessageSchema, res, async (value) => {
      try {
        const runId = orchestrator.enqueue({
          userId: userId(req),
          conversationId: id,
          userText: value.content,
          ...(value.modelId !== undefined ? { modelId: value.modelId } : {}),
          ...(value.projectId ? {projectId:value.projectId}: {}),
          ...(value.grantId ? {grantId:value.grantId}: {})
        });
        res.status(201).json(ok({ runId }));
      } catch (error) {
        domainError(res, error);
      }
    });
  });

  router.get("/conversations/:id/runs", (req,res)=>{
    const id=parseId(req.params.id,res);if(!id)return;
    const {log}=buildAgentStack(deps,userId(req));if(!log.getConversation(id))return notFound(res);
    const runs=log.listRuns(id);
    res.json(ok({runs:runs.slice(0,50),activeRun:runs.find(r=>["pending","running","awaiting_approval"].includes(r.status)) ?? null}));
  });

  router.get("/runs/:id", (req, res) => {
    const id = parseId(req.params.id, res); if (!id) return;
    const { log } = buildAgentStack(deps, userId(req));
    const run = log.getRun(id);
    if (!run) return notFound(res);
    res.json(ok({ run, pendingActions: log.listPendingActions(id).map(a=>({...a,platformIntentId:a.stepId?new PlatformActionRepository(deps.db,userId(req)).byKey(a.stepId)?.id??null:null,platformIntent:a.stepId?new PlatformActionRepository(deps.db,userId(req)).byKey(a.stepId)??null:null})), steps: new CopilotRunLedger(deps.db,userId(req)).steps(id) }));
  });

  router.post("/runs/:id/cancel", async (req, res) => {
    const id = parseId(req.params.id, res); if (!id) return;
    const { orchestrator } = buildAgentStack(deps, userId(req));
    const result = await orchestrator.cancelRun({ userId: userId(req), runId: id });
    res.json(ok(result));
  });

  const approveSchema = z.object({ approved: z.boolean() }).strict();
  router.post("/runs/:id/pending-actions/:actionId/decide", (req, res) => {
    const runId = parseId(req.params.id, res); if (!runId) return;
    const actionId = parseId(req.params.actionId, res); if (!actionId) return;
    withBody(req.body, approveSchema, res, async (value) => {
      try {
        const result = await buildAgentStack(deps, userId(req)).orchestrator.resumeAfterApproval({
          userId: userId(req),
          runId,
          actionId,
          approved: value.approved,
          async: true
        });
        res.json(ok(result));
      } catch (error) {
        domainError(res, error);
      }
    });
  });

  router.get("/memory/entries", (req, res) => withQuery(req.query, listMemorySchema, res, (value) => {
    const { memory } = buildAgentStack(deps, userId(req));
    const scope = { scope: value.scope ?? "global", ...(value.projectId !== undefined ? { projectId: value.projectId } : {}), ...(value.conversationId ? {conversationId:value.conversationId} : {}) };
    res.json(ok({ entries: memory.list(scope, value.limit ?? 50) }));
  }));

  router.post("/memory/entries", (req, res) => withBody(req.body, writeMemorySchema, res, async (value) => {
    try {
      const entry=await new PlatformActions({db:deps.db,userId:userId(req)},createPlatformCommands()).executeOwner("memory.write",value,randomUUID());
      res.status(201).json(ok({entry}));
    }catch(error){domainError(res,error);}
  }));

  router.get("/memory/search", (req, res) => withQuery(req.query, searchMemorySchema, res, (value) => {
    const { memory } = buildAgentStack(deps, userId(req));
    const scope = { scope: value.scope ?? "global", ...(value.projectId !== undefined ? { projectId: value.projectId } : {}), ...(value.conversationId ? {conversationId:value.conversationId} : {}) };
    res.json(ok({ entries: memory.search(value.q, scope, value.limit ?? 10) }));
  }));

  router.delete("/memory/entries/:id", (req, res) => {
    const id = parseId(req.params.id, res); if (!id) return;
    const { memory } = buildAgentStack(deps, userId(req));
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
  try { Promise.resolve(callback(parsed.data)).catch(error=>domainError(res,error)); }
  catch(error) { domainError(res,error); }
}
function withQuery<T>(query: unknown, schema: z.ZodType<T>, res: Response, callback: (value: T) => void): void {
  const parsed = schema.safeParse(query);
  if (!parsed.success) return invalid(res);
  try { Promise.resolve(callback(parsed.data)).catch(error=>domainError(res,error)); }
  catch(error) { domainError(res,error); }
}
function invalid(res: Response, message = "Invalid input"): void {
  res.status(400).json({ code: 1, message, details: { code: "COPILOT_INVALID_INPUT" } });
}
function notFound(res: Response): void {
  res.status(404).json({ code: 1, message: "Copilot record not found", details: { code: "COPILOT_NOT_FOUND" } });
}
function domainError(res: Response, error: unknown): void {
  if (error instanceof AgentError && ["COPILOT_RUN_BUSY","COPILOT_CONVERSATION_BUSY"].includes(error.code)) {
    res.status(409).json({ code: 1, message: error.message, details: { code: error.code } });
    return;
  }
  if(error instanceof AgentError && error.code === "COPILOT_NOT_FOUND")return notFound(res);
  const code = error instanceof Error ? error.message : "COPILOT_OPERATION_FAILED";
  res.status(400).json({ code: 1, message: "Copilot operation rejected", details: { code } });
}
