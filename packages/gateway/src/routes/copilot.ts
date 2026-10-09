import { CopilotFollowups } from "../services/agent/followups.js";
import { createCopilotMeteringRoutes } from './copilot-metering.js';
import { RunGovernance } from "../services/agent/run-governance.js";
import { publicModelResponse } from "../db/repositories/copilot-model-response-repository.js";
import { createCopilotDevelopmentRoutes } from './copilot-development.js';
import { provisionalText, clearProvisionalText } from '../services/agent/provisional-text.js';
import { createCopilotSkillRoutes } from "./copilot-skills.js";
import { createCopilotConnectionRoutes } from "./copilot-connections.js";
import { createCopilotPlaybookRoutes } from "./copilot-playbooks.js";
import { visibleToolSchemas, toolUnavailableReason } from "../services/agent/tool-availability.js";
import { randomUUID } from "node:crypto";
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
import { listRunTrace } from "../services/agent/run-trace.js";
import { AgentError } from "../services/agent/types.js";
import { CopilotToolPreferenceRepository } from "../db/repositories/copilot-tool-preference-repository.js";
import { CopilotPreferencesRepository } from "../db/repositories/copilot-preferences-repository.js";

const idSchema = z.string().trim().min(1).max(128);
const titleSchema = z.string().trim().min(1).max(200).optional();
const renameConversationSchema = z.object({ title: z.string().trim().min(1).max(200) }).strict();
const modelIdSchema = z.string().trim().min(1).max(128).optional();
const preferencesSchema = z.object({ modelId: z.string().trim().min(1).max(128).nullish(), thinkingEffort: z.enum(["off", "low", "medium", "high"]).optional() }).strict();
const createConversationSchema = z.object({ title: titleSchema }).strict();
const sendMessageSchema = z.object({
  content: z.string().trim().min(1).max(32 * 1024),
  modelId: modelIdSchema,
  projectId: idSchema.optional(),
  clientRequestId: idSchema.optional(),
  reviewTaskResults: z.boolean().optional(),
  repairFailedChecks: z.boolean().optional(),
  toolDiscovery: z.boolean().optional()
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
const searchMemorySchema = z.object({ q: z.string().trim().min(1).max(512), scope: memoryScopeSchema.default("global"), projectId: z.string().max(128).optional(), conversationId: idSchema.optional(), limit: z.coerce.number().int().min(1).max(20).optional() }).strict();
const toolEnabledSchema = z.object({ enabled: z.boolean() }).strict();

export type CopilotRouteDeps = AgentStackDeps;

export function createCopilotRoutes(deps: CopilotRouteDeps): Router {
  const router = Router();
  router.use(authenticate);
  router.use(createCopilotMeteringRoutes(deps.db));
  router.use(createCopilotDevelopmentRoutes(deps.db));
  router.use(createCopilotConnectionRoutes(deps.db, deps.masterKey));

  const KNOWN_TOOL_NAMES = new Set<string>(createPlatformTools().map((tool) => tool.name));
  router.use(createCopilotPlaybookRoutes(deps.db, {
    availableToolNames: (actingUser) => visibleToolSchemas(buildAgentStack(deps, actingUser).toolRegistry, {
      hasSessionManager: !!deps.sessionManager,
      isToolDisabled: name => !new CopilotToolPreferenceRepository(deps.db, actingUser).isEnabled(name)
    }).map(tool => tool.name)
  }));
  router.use(createCopilotSkillRoutes(deps.db, {
    availableToolNames: (actingUser) => visibleToolSchemas(buildAgentStack(deps, actingUser).toolRegistry, {
      hasSessionManager: !!deps.sessionManager,
      isToolDisabled: name => !new CopilotToolPreferenceRepository(deps.db, actingUser).isEnabled(name)
    }).map(tool => tool.name)
  }));

  router.get("/capabilities", (req, res) => {
    const actingUser = userId(req);
    const preferences = new CopilotToolPreferenceRepository(deps.db, actingUser);
    const tools = createPlatformTools().map((tool) => {
      const unavailableReason = toolUnavailableReason(tool.name, !!deps.sessionManager);
      const enabled = preferences.isEnabled(tool.name);
      return {
        name: tool.name, description: tool.description, risk: tool.risk,
        requiresApproval: tool.requiresApproval, enabled,
        available: unavailableReason === null, unavailableReason,
        effectiveEnabled: enabled && unavailableReason === null,
        authorization: tool.risk === "read" ? "read" : "owner_action"
      };
    });
    res.json(ok({ tools }));
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
  // Server-side Copilot model + thinking-strength preferences: every
  // entry point (web console, chat bots, automations) resolves the same
  // model the user picked instead of the browser's localStorage.
  router.get("/preferences", (req, res) => {
    res.json(ok(new CopilotPreferencesRepository(deps.db, userId(req), deps.masterKey).get()));
  });

  router.put("/preferences", (req, res) => withBody(req.body, preferencesSchema, res, (value) => {
    const repository = new CopilotPreferencesRepository(deps.db, userId(req), deps.masterKey);
    res.json(ok(repository.set({
      ...(value.modelId !== undefined ? { modelId: value.modelId } : {}),
      ...(value.thinkingEffort !== undefined ? { thinkingEffort: value.thinkingEffort } : {})
    })));
  }));

  router.post("/conversations", (req, res) => withBody(req.body, createConversationSchema, res, (value) => {
    const { log } = buildAgentStack(deps, userId(req));
    try {
      const conversation = log.createConversation(value.title);
      res.status(201).json(ok({ conversation }));
    } catch(error) { domainError(res,error); }
  }));

  router.get("/conversations", (_req, res) => {
    const { log } = buildAgentStack(deps, userId(_req));
    res.json(ok({ conversations: log.listConversations() }));
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
  const editMessageSchema = sendMessageSchema.extend({ messageId: idSchema });
  router.post("/conversations/:id/edit-message", (req, res) => {
    const id = parseId(req.params.id, res); if (!id) return;
    withBody(req.body, editMessageSchema, res, async (value) => {
      const { log, orchestrator } = buildAgentStack(deps, userId(req));
      if (!log.getConversation(id)) return notFound(res);
      try {
        const input = {
          userId: userId(req), conversationId: id, userText: value.content,
          source: "user" as const, skipUserMessage: true, editMessageId: value.messageId,
          ...(value.clientRequestId ? { clientRequestId: value.clientRequestId } : {}),
          ...(value.projectId ? { projectId: value.projectId } : {}),
          ...(value.modelId ? { modelId: value.modelId } : {}),
          ...(value.repairFailedChecks !== undefined ? {repairFailedChecks:value.repairFailedChecks}:{}),
          ...(value.reviewTaskResults !== undefined ? { reviewTaskResults: value.reviewTaskResults } : {}),
          ...(value.toolDiscovery !== undefined ? { toolDiscovery: value.toolDiscovery } : {}),
        };
        const runId = deps.db.transaction(() => {
          const existing = new CopilotRunLedger(deps.db, userId(req)).findRequest(input);
          if (existing) return existing;
          if (!log.truncateAfterMessage(value.messageId,value.content,id)) throw new AgentError("COPILOT_NOT_FOUND","Message not found");
          return orchestrator.enqueue(input);
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
          ...(value.clientRequestId ? { clientRequestId: value.clientRequestId } : {}),
          ...(value.repairFailedChecks !== undefined ? {repairFailedChecks:value.repairFailedChecks}:{}),
          ...(value.reviewTaskResults !== undefined ? { reviewTaskResults: value.reviewTaskResults } : {}),
          ...(value.toolDiscovery !== undefined ? { toolDiscovery: value.toolDiscovery } : {})
        });
        res.status(201).json(ok({ runId }));
      } catch (error) {
        domainError(res, error);
      }
    });
  });

  router.post('/conversations/:id/followups', (req, res) => {
    const id = parseId(req.params.id, res); if (!id) return;
    withBody(req.body, sendMessageSchema.extend({ clientRequestId: idSchema }), res, value => {
      const queue = new CopilotFollowups(deps.db, userId(req));
      const item = queue.enqueue({ userId: userId(req), conversationId: id, userText: value.content,
        clientRequestId: value.clientRequestId, ...(value.modelId ? { modelId: value.modelId } : {}),
        ...(value.projectId ? { projectId: value.projectId } : {}),
        ...(value.repairFailedChecks !== undefined ? {repairFailedChecks:value.repairFailedChecks}:{}),
          ...(value.reviewTaskResults !== undefined ? { reviewTaskResults: value.reviewTaskResults } : {}),
          ...(value.toolDiscovery !== undefined ? { toolDiscovery: value.toolDiscovery } : {}) });
      res.status(201).json(ok({ followup: { id: item.id, status: item.status, runId: item.run_id } }));
    });
  });
  router.get('/conversations/:id/followups', (req, res) => {
    const id = parseId(req.params.id, res); if (!id) return;
    if (!buildAgentStack(deps, userId(req)).log.getConversation(id)) return notFound(res);
    const followups = new CopilotFollowups(deps.db, userId(req)).list(id).map(row => ({
      id: row.id, status: row.status, runId: row.run_id, content: (JSON.parse(row.input_json) as { userText: string }).userText,
      error: row.error, createdAt: row.created_at,
    }));
    res.json(ok({ followups }));
  });
  router.delete('/followups/:id', (req, res) => {
    const id = parseId(req.params.id, res); if (!id) return;
    res.json(ok({ cancelled: new CopilotFollowups(deps.db, userId(req)).cancel(id) }));
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
    if (!['pending', 'running', 'awaiting_approval'].includes(run.status)) clearProvisionalText(deps.db, id);
    res.json(ok({ provisionalText: provisionalText(deps.db, userId(req), id), run: { ...run, usage: new RunGovernance(deps.db, userId(req), id).usage() }, pendingActions: log.listPendingActions(id).map(a=>({...a,platformIntentId:a.stepId?new PlatformActionRepository(deps.db,userId(req)).byKey(a.stepId)?.id??null:null,platformIntent:a.stepId?new PlatformActionRepository(deps.db,userId(req)).byKey(a.stepId)??null:null})), steps: new CopilotRunLedger(deps.db,userId(req)).steps(id).map(step => step.kind === 'model' ? { ...step, result_json: publicModelResponse(step.result_json) } : step) }));
  });

  router.get("/runs/:id/trace", (req, res) => {
    const id = parseId(req.params.id, res); if (!id) return;
    if (!new CopilotRunLedger(deps.db, userId(req)).get(id)) return notFound(res);
    res.json(ok({ events: listRunTrace(deps.db, userId(req), id) }));
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
          decisionOrigin: 'web',
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
  if (error instanceof AgentError && error.code === "AGENT_MEMORY_INDEX_BUILDING") {
    res.setHeader("Retry-After", "5");
    res.status(503).json({ code: 1, message: error.message, details: { code: error.code } });
    return;
  }
  if (error instanceof AgentError && error.code === "AGENT_MEMORY_QUERY_TOO_LONG") {
    res.status(400).json({ code: 1, message: error.message, details: { code: error.code } });
    return;
  }
  if (error instanceof AgentError && ["COPILOT_RUN_BUSY","COPILOT_CONVERSATION_BUSY","COPILOT_REQUEST_CONFLICT"].includes(error.code)) {
    res.status(409).json({ code: 1, message: error.message, details: { code: error.code } });
    return;
  }
  if(error instanceof AgentError && error.code === "COPILOT_NOT_FOUND")return notFound(res);
  const message = error instanceof Error ? error.message : '';
  const code = error instanceof AgentError ? error.code
    : /^(?:COPILOT_|DEVELOPMENT_|SHELL_|SESSION_|PLATFORM_)[A-Z0-9_]+/.exec(message)?.[0]
      ?? (/expired/i.test(message) ? 'COPILOT_APPROVAL_EXPIRED'
        : /stale|revision|mismatch/i.test(message) ? 'COPILOT_APPROVAL_CHANGED'
          : /not approved|denied|disabled|authority|not active/i.test(message) ? 'COPILOT_APPROVAL_DENIED' : 'COPILOT_OPERATION_FAILED');
  res.status(400).json({ code: 1, message: "Copilot operation rejected", details: { code } });
}
