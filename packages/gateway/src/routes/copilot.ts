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
import { AgentError } from "../services/agent/types.js";
import type { DshCopilotBff } from "../services/dsh-copilot/bff-service.js";
import { dshToolSurface } from "../services/dsh-copilot/dsh-tool-surface.js";
import {
  DSH_AVAILABLE_PLUGINS,
  getEffectiveDshConfig,
  unknownPluginKeys
} from "../services/dsh-copilot/dsh-config.js";
import { CopilotDshConfigRepository } from "../db/repositories/copilot-dsh-config-repository.js";
import { CopilotToolPreferenceRepository } from "../db/repositories/copilot-tool-preference-repository.js";
import { ModelProviderRepository } from "../db/repositories/model-provider-repository.js";

const idSchema = z.string().trim().min(1).max(128);
const titleSchema = z.string().trim().min(1).max(200).optional();
const renameConversationSchema = z.object({ title: z.string().trim().min(1).max(200) }).strict();
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
const toolEnabledSchema = z.object({ enabled: z.boolean() }).strict();

export type CopilotRouteDeps = AgentStackDeps & {
  /**
   * M2/M3 dsh kernel BFF. Present only when FORGEBADGER_DSH_COPILOT_ENABLED=1;
   * the message/cancel/decide endpoints then delegate to it while every other
   * endpoint (conversations CRUD, memory) keeps the in-process stack.
   * edit-message is explicitly unsupported (501) on the dsh path.
   */
  dshBff?: DshCopilotBff | undefined;
};

export function createCopilotRoutes(deps: CopilotRouteDeps): Router {
  const router = Router();
  router.use(authenticate);

  // Known tool names across both execution paths — the whitelist for toggles.
  const KNOWN_TOOL_NAMES = new Set<string>([
    ...dshToolSurface().map((t) => t.name),
    ...createPlatformTools().map((t) => t.name)
  ]);

  router.get("/capabilities", (req, res) => {
    const actingUser = userId(req);
    const preferences = new CopilotToolPreferenceRepository(deps.db, actingUser);
    // dsh path (M2+): the runtime's tool surface comes from the forgebadger-bridge
    // plugin, not the in-process registry — report the dsh manifest instead.
    const tools = deps.dshBff
      ? dshToolSurface()
      : Array.from(buildAgentStack(deps, actingUser).toolRegistry.tools.values()).map((t) => ({
        name: t.name,
        description: t.description,
        risk: t.risk,
        requiresApproval: t.requiresApproval
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
    const conversation = log.createConversation(value.title);
    res.status(201).json(ok({ conversation }));
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
    if (!log.deleteConversation(id)) return notFound(res);
    res.json(ok({ deleted: true }));
  });

  // Edit a user message: rewrite it in place, drop everything after it, then
  // run a fresh turn against the new prompt. The orchestrator is told to skip
  // its own user-message append so the edited row remains the only one with
  // the new content. Streaming deltas arrive over /ws/events.
  // dsh path (M3): the kernel session log cannot be truncated/forked through
  // the SDK surface yet, so editing is explicitly unsupported instead of
  // silently diverging the projection from the kernel log (known limitation).
  const editMessageSchema = z.object({ messageId: idSchema, content: z.string().trim().min(1).max(32 * 1024) }).strict();
  router.post("/conversations/:id/edit-message", (req, res) => {
    const id = parseId(req.params.id, res); if (!id) return;
    withBody(req.body, editMessageSchema, res, async (value) => {
      if (deps.dshBff) {
        res.status(501).json({
          code: 1,
          message: "Editing messages is not supported yet on the dsh copilot path",
          details: { code: "DSH_EDIT_MESSAGE_UNSUPPORTED" }
        });
        return;
      }
      const { log, orchestrator } = buildAgentStack(deps, userId(req));
      if (!log.getConversation(id)) return notFound(res);
      const truncated = log.truncateAfterMessage(value.messageId, value.content);
      if (!truncated) return notFound(res);
      try {
        const runId = await orchestrator.runTurn({
          userId: userId(req),
          conversationId: id,
          userText: value.content,
          source: "user",
          skipUserMessage: true
        });
        res.status(201).json(ok({ runId }));
      } catch (error) {
        domainError(res, error);
      }
    });
  });

  // Run a turn: appends the user message, runs the step loop, and returns the
  // run id. Streaming deltas arrive over /ws/events (copilot_run_updated).
  // When the dsh BFF is wired (FORGEBADGER_DSH_COPILOT_ENABLED=1) the turn runs
  // on the per-user dsh kernel process with an identical response contract.
  router.post("/conversations/:id/messages", (req, res) => {
    const id = parseId(req.params.id, res); if (!id) return;
    const { log, orchestrator } = buildAgentStack(deps, userId(req));
    if (!log.getConversation(id)) return notFound(res);
    withBody(req.body, sendMessageSchema, res, async (value) => {
      try {
        const runId = deps.dshBff
          ? await deps.dshBff.sendMessage({
            userId: userId(req),
            conversationId: id,
            content: value.content,
            ...(value.modelId !== undefined ? { modelId: value.modelId } : {})
          })
          : await orchestrator.runTurn({
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
    const { log } = buildAgentStack(deps, userId(req));
    const run = log.getRun(id);
    if (!run) return notFound(res);
    res.json(ok({ run, pendingActions: log.listPendingActions(id) }));
  });

  router.post("/runs/:id/cancel", (req, res) => {
    const id = parseId(req.params.id, res); if (!id) return;
    if (deps.dshBff) {
      // dsh path: cancel = kill the user's runtime process (the SDK has no
      // mid-turn cancel; kill-and-resume is the verified substitute).
      void deps.dshBff.cancelRun({ userId: userId(req), runId: id })
        .then((result) => res.json(ok(result)))
        .catch((error) => domainError(res, error));
      return;
    }
    const { orchestrator } = buildAgentStack(deps, userId(req));
    const result = orchestrator.cancelRun({ userId: userId(req), runId: id });
    res.json(ok(result));
  });

  const approveSchema = z.object({ approved: z.boolean() }).strict();
  router.post("/runs/:id/pending-actions/:actionId/decide", (req, res) => {
    const runId = parseId(req.params.id, res); if (!runId) return;
    const actionId = parseId(req.params.actionId, res); if (!actionId) return;
    withBody(req.body, approveSchema, res, async (value) => {
      try {
        // Identical contract on both paths: the dsh BFF bridges the decision
        // back into the kernel's suspended tool call (or executes gateway-side
        // when the runtime died while pending).
        const result = deps.dshBff
          ? await deps.dshBff.decidePendingAction({ userId: userId(req), runId, actionId, approved: value.approved })
          : await buildAgentStack(deps, userId(req)).orchestrator.resumeAfterApproval({
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
    const { memory } = buildAgentStack(deps, userId(req));
    const scope = { scope: value.scope ?? "global", ...(value.projectId !== undefined ? { projectId: value.projectId } : {}) };
    res.json(ok({ entries: memory.list(scope, value.limit ?? 50) }));
  }));

  router.post("/memory/entries", (req, res) => withBody(req.body, writeMemorySchema, res, (value) => {
    const { memory } = buildAgentStack(deps, userId(req));
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
    const { memory } = buildAgentStack(deps, userId(req));
    const scope = { scope: value.scope ?? "global", ...(value.projectId !== undefined ? { projectId: value.projectId } : {}) };
    res.json(ok({ entries: memory.search(value.q, scope, value.limit ?? 10) }));
  }));

  router.delete("/memory/entries/:id", (req, res) => {
    const id = parseId(req.params.id, res); if (!id) return;
    const { memory } = buildAgentStack(deps, userId(req));
    if (!memory.delete(id)) return notFound(res);
    res.json(ok({ deleted: true }));
  });

  // M4: visual configuration of the per-user dsh kernel (rendered into a
  // per-user cordis.yml at spawn). dsh-path only: with the flag off there is
  // no kernel to configure, so both endpoints 404.
  const dshConfigUpdateSchema = z.object({
    defaultModelId: z.string().trim().min(1).max(128).nullable().optional(),
    plugins: z.record(z.boolean()).optional()
  }).strict();

  const dshConfigPayload = (uid: string) => {
    const effective = getEffectiveDshConfig(deps.db, uid);
    return {
      defaultModelId: effective.defaultModelId,
      plugins: effective.plugins,
      availablePlugins: DSH_AVAILABLE_PLUGINS,
      runtime: { status: deps.dshBff ? deps.dshBff.getRuntimeStatus({ userId: uid }) : "off" }
    };
  };

  router.get("/dsh-config", (req, res) => {
    if (!deps.dshBff) return notFound(res);
    res.json(ok(dshConfigPayload(userId(req))));
  });

  router.put("/dsh-config", (req, res) => {
    if (!deps.dshBff) return notFound(res);
    withBody(req.body, dshConfigUpdateSchema, res, (value) => {
      const uid = userId(req);
      if (value.plugins) {
        const unknown = unknownPluginKeys(value.plugins);
        if (unknown.length > 0) {
          res.status(400).json({
            code: 1,
            message: `Unknown dsh plugin(s): ${unknown.join(", ")}`,
            details: { code: "COPILOT_DSH_CONFIG_UNKNOWN_PLUGIN" }
          });
          return;
        }
      }
      if (value.defaultModelId !== undefined && value.defaultModelId !== null) {
        const profile = new ModelProviderRepository(deps.db, uid, deps.masterKey).getModelProfile(value.defaultModelId);
        if (!profile || profile.status !== "active") {
          res.status(400).json({
            code: 1,
            message: "defaultModelId must reference one of your active model profiles",
            details: { code: "COPILOT_DSH_CONFIG_INVALID_MODEL" }
          });
          return;
        }
      }
      const stored = new CopilotDshConfigRepository(deps.db, uid).upsert({
        ...(value.defaultModelId !== undefined ? { defaultModelId: value.defaultModelId } : {}),
        ...(value.plugins !== undefined ? { plugins: value.plugins } : {})
      });
      // The config applies on the next spawn; restart the idling runtime now
      // when no run is active so the change takes effect on the next message.
      void deps.dshBff!.applyConfigChanged({ userId: uid })
        .then(({ runtimeRestarted }) => {
          res.json(ok({ ...dshConfigPayload(uid), updatedAt: stored.updatedAt, runtimeRestarted }));
        })
        .catch((error) => domainError(res, error));
    });
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
  // One active run per user on the dsh path: concurrent messages are a
  // conflict, not a bad request. Only the dsh BFF raises this code, so the
  // flag-off path is untouched.
  if (error instanceof AgentError && error.code === "COPILOT_RUN_BUSY") {
    res.status(409).json({ code: 1, message: error.message, details: { code: error.code } });
    return;
  }
  const code = error instanceof Error ? error.message : "COPILOT_OPERATION_FAILED";
  res.status(400).json({ code: 1, message: "Copilot operation rejected", details: { code } });
}
