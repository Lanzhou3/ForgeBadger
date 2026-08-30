/**
 * Internal Copilot bridge API — consumed by the deepseek-harness
 * openforge-bridge plugin over loopback HTTP. Auth is a static service token
 * (OPENFORGE_COPILOT_BRIDGE_TOKEN); the acting user arrives via the
 * X-OpenForge-User-Id header, which is trusted only after the service token
 * passes. All data access goes through per-user repositories/facades, so
 * tenant isolation is identical to the user-facing API.
 *
 * The whole route group is a guarded feature: routes/index.ts mounts it only
 * when the token is configured.
 */
import { timingSafeEqual } from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";

import { extractBearerToken } from "../auth/middleware.js";
import type { Database } from "../db/types.js";
import { SessionRepository } from "../db/repositories/session-repository.js";
import { ProjectRepository } from "../db/repositories/project-repository.js";
import { ProjectManagerRepository } from "../db/repositories/project-manager-repository.js";
import {
  buildTaskPacket,
  createTaskPacketContext,
  createTaskPacketSessionName,
  resolveTaskPacketSession,
  withTaskPacketSessionLink
} from "../services/project-manager/task-packets.js";
import { getCopilotSkill, listCopilotSkillSummaries } from "../services/agent/skills/copilot-skills.js";
import { CopilotToolPreferenceRepository } from "../db/repositories/copilot-tool-preference-repository.js";
import { TokenUsageRepository } from "../db/repositories/token-usage-repository.js";
import { UsageRepository } from "../db/repositories/usage-repository.js";
import type { InMemorySessionManager } from "../services/session-manager.js";
import { isAdapterId } from "../services/adapter-discovery.js";
import type { PortfolioApiFacade } from "../services/portfolio/portfolio-api-service.js";
import { PORTFOLIO_WRITER_FENCE_REJECTED } from "../services/portfolio/session-input-gate.js";
import {
  advanceWorkItem,
  createProjectRecord,
  dispatchSessionInput,
  getProjectDetail,
  getProjectGraphAffectedPaths,
  getProjectGraphSymbol,
  getProjectGraphSymbolImpact,
  getSessionDetail,
  listMemoryEntries,
  listProjectSummaries,
  listSessionSummaries,
  searchMemoryEntries,
  searchProjectGraphSymbols,
  writeMemoryEntry
} from "../services/copilot-bridge/bridge-service.js";
import {
  DISPATCH_DELIVERY_UNCONFIRMED,
  type DispatchConfirmOptions
} from "../services/copilot-bridge/delivery-confirm.js";
import {
  PROGRAMMATIC_SUBMIT_ADAPTER_MISMATCH,
  PROGRAMMATIC_SUBMIT_NOT_READY,
  PROGRAMMATIC_SUBMIT_STAGING_FAILED,
  PROGRAMMATIC_SUBMIT_UNSAFE_INPUT
} from "../services/programmatic-terminal-submit.js";

const WORK_ITEM_STATES = ["todo", "in_progress", "blocked", "ready_for_review", "done", "cancelled"] as const;

const idSchema = z.string().trim().min(1).max(128);
const listWorkItemsQuery = z.object({
  projectId: idSchema.optional(),
  status: z.enum(WORK_ITEM_STATES).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional()
}).strict();
const listSessionsQuery = z.object({
  projectId: idSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).optional()
}).strict();
const advanceBody = z.object({
  note: z.string().trim().min(1).max(256).optional()
}).strict();
const pmStartBody = z.object({
  workItemId: idSchema,
  aiTool: z.enum(["claude", "opencode", "codex", "kimi"]).optional()
}).strict();
const dispatchBody = z.object({
  message: z.string().trim().min(1).max(4000)
}).strict();

// Project graph tool inputs (mirrors services/agent/tools/graph.ts).
const graphSymbolIdSchema = z.string().min(1).max(256);
const graphSearchQuery = z.object({
  q: z.string().trim().min(1).max(100),
  kind: z.string().trim().min(1).max(32).optional(),
  limit: z.coerce.number().int().min(1).max(20).optional()
}).strict();
const graphImpactQuery = z.object({
  depth: z.coerce.number().int().min(1).max(3).optional()
}).strict();
const graphAffectedBody = z.object({
  paths: z
    .array(
      z
        .string()
        .trim()
        .min(1)
        .max(256)
        .refine((value) => !value.startsWith("/") && !value.split("/").includes(".."), {
          message: "paths must be project-relative without traversal segments"
        })
    )
    .min(1)
    .max(50),
  depth: z.number().int().min(1).max(3).optional()
}).strict();

// Schemas mirror the Copilot harness tool inputs (services/agent/tools/*) so
// the dsh plugin surface behaves identically to the in-process tool surface.
const MEMORY_SCOPES = ["global", "project", "session"] as const;
const MEMORY_KINDS = ["fact", "preference", "decision", "project_note"] as const;
const listProjectsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional()
}).strict();
const createProjectBody = z.object({
  name: z.string().min(1).max(200),
  path: z.string().min(1).max(1024),
  description: z.string().max(2000).optional()
}).strict();
const listRequestsQuery = z.object({
  projectId: idSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).optional()
}).strict();
const listMemoryQuery = z.object({
  scope: z.enum(MEMORY_SCOPES).optional(),
  projectId: idSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).optional()
}).strict();
const searchMemoryQuery = z.object({
  q: z.string().trim().min(1).max(512),
  scope: z.enum(MEMORY_SCOPES).optional(),
  projectId: idSchema.optional(),
  limit: z.coerce.number().int().min(1).max(20).optional()
}).strict();
const writeMemoryBody = z.object({
  kind: z.enum(MEMORY_KINDS),
  scope: z.enum(MEMORY_SCOPES),
  text: z.string().min(1).max(8 * 1024),
  projectId: idSchema.optional(),
  metadata: z.record(z.unknown()).optional()
}).strict();

interface BridgeRequest extends Request {
  bridgeUserId: string;
}

export interface CopilotBridgeRouteDeps {
  db: Database;
  sessionManager: InMemorySessionManager;
  portfolioApi: PortfolioApiFacade;
  /** Service token; routes must only be mounted when this is set. */
  bridgeToken: string;
  /** Delivery read-back budget for the dispatch path (env-tunable; defaults apply when absent). */
  dispatchConfirm?: DispatchConfirmOptions | undefined;
  /**
   * Runtime launcher for the pm task-packet start flow. Gateway-wired so
   * the bridge never needs masterKey. Returns true when the session is live.
   */
  launchSessionRuntime?: ((userId: string, sessionId: string) => Promise<boolean>) | undefined;
}

export function createCopilotBridgeRoutes(deps: CopilotBridgeRouteDeps): Router {
  const router = Router();
  router.use(createBridgeAuthMiddleware(deps.bridgeToken));

  /**
   * Per-tool owner switches (copilot_tool_preferences). The dsh runtime
   * registers its tools independently, so this callback channel is the one
   * place every dsh tool execution can be refused uniformly.
   */
  const toolEnabled = (req: Request, res: Response, toolName: string): boolean => {
    if (new CopilotToolPreferenceRepository(deps.db, bridgeUserId(req)).isEnabled(toolName)) {
      return true;
    }
    res.status(403).json({
      code: 1,
      message: `Tool ${toolName} is disabled by the owner`,
      details: { code: "BRIDGE_TOOL_DISABLED" }
    });
    return false;
  };

  router.get("/work-items", (req, res) => withQuery(req.query, listWorkItemsQuery, res, (query) => {
    if (!toolEnabled(req, res, "list_work_items")) return;
    const workItems = deps.portfolioApi.forUser(bridgeUserId(req)).listWorkItems({
      ...(query.projectId !== undefined ? { projectId: query.projectId } : {}),
      ...(query.status !== undefined ? { status: query.status } : {}),
      ...(query.limit !== undefined ? { limit: query.limit } : {})
    });
    res.json(ok({ workItems, count: workItems.length }));
  }));

  router.get("/work-items/:id", (req, res) => {
    if (!toolEnabled(req, res, "get_work_item")) return;
    const workItemId = parseId(req.params.id, res);
    if (!workItemId) return;
    const workItem = deps.portfolioApi.forUser(bridgeUserId(req)).getWorkItem(workItemId);
    if (!workItem) return notFound(res, "Work item not found");
    res.json(ok({ workItem }));
  });

  router.post("/work-items/:id/advance", (req, res) => withBody(req.body, advanceBody, res, (body) => {
    if (!toolEnabled(req, res, "advance_work_item")) return;
    const workItemId = parseId(req.params.id, res);
    if (!workItemId) return;
    const userId = bridgeUserId(req);
    try {
      const result = advanceWorkItem(
        deps.db,
        userId,
        deps.portfolioApi.forUser(userId),
        workItemId,
        body.note
      );
      res.json(ok(result));
    } catch (error) {
      domainError(res, error, { userId, action: "work_item.advance", workItemId });
    }
  }));

  router.get("/portfolio/overview", (req, res) => {
    if (!toolEnabled(req, res, "portfolio_overview")) return;
    res.json(ok({ overview: deps.portfolioApi.forUser(bridgeUserId(req)).getOverview({}) }));
  });

  router.get("/portfolio/requests", (req, res) => withQuery(req.query, listRequestsQuery, res, (query) => {
    if (!toolEnabled(req, res, "list_portfolio_requests")) return;
    const requests = deps.portfolioApi.forUser(bridgeUserId(req)).listRequests({
      ...(query.projectId !== undefined ? { projectId: query.projectId } : {}),
      limit: query.limit ?? 50
    });
    res.json(ok({ requests, count: Array.isArray(requests) ? requests.length : 0 }));
  }));

  router.get("/portfolio/projects/:id/dossier", (req, res) => {
    if (!toolEnabled(req, res, "get_project_dossier")) return;
    const projectId = parseId(req.params.id, res);
    if (!projectId) return;
    res.json(ok({ dossier: deps.portfolioApi.forUser(bridgeUserId(req)).getDossier(projectId) }));
  });

  router.get("/projects", (req, res) => withQuery(req.query, listProjectsQuery, res, (query) => {
    if (!toolEnabled(req, res, "list_projects")) return;
    const projects = listProjectSummaries(deps.db, bridgeUserId(req), {
      ...(query.limit !== undefined ? { limit: query.limit } : {})
    });
    res.json(ok({ projects, count: projects.length }));
  }));

  // Mirrors the get_project tool: a missing or foreign project is a 200 with
  // found:false so the model can recover, not a transport-level 404.
  router.get("/projects/:id", (req, res) => {
    if (!toolEnabled(req, res, "get_project")) return;
    const projectId = parseId(req.params.id, res);
    if (!projectId) return;
    const project = getProjectDetail(deps.db, bridgeUserId(req), projectId);
    if (!project) return res.json(ok({ found: false, project: null }));
    res.json(ok({ found: true, project }));
  });

  // Operate surface: the dsh side gates this behind the approval bridge before
  // calling; the endpoint itself just performs the validated write.
  router.post("/projects", (req, res) => withBody(req.body, createProjectBody, res, (body) => {
    if (!toolEnabled(req, res, "create_project")) return;
    const created = createProjectRecord(deps.db, bridgeUserId(req), {
      name: body.name,
      path: body.path,
      ...(body.description !== undefined ? { description: body.description } : {})
    });
    res.status(201).json(ok({ created: true, ...created }));
  }));

  router.get("/memory/entries", (req, res) => withQuery(req.query, listMemoryQuery, res, (query) => {
    if (!toolEnabled(req, res, "list_memory")) return;
    const entries = listMemoryEntries(deps.db, bridgeUserId(req), {
      scope: query.scope ?? "global",
      ...(query.projectId !== undefined ? { projectId: query.projectId } : {}),
      ...(query.limit !== undefined ? { limit: query.limit } : {})
    });
    res.json(ok({ entries }));
  }));

  router.get("/memory/search", (req, res) => withQuery(req.query, searchMemoryQuery, res, (query) => {
    if (!toolEnabled(req, res, "search_memory")) return;
    const entries = searchMemoryEntries(deps.db, bridgeUserId(req), {
      query: query.q,
      scope: query.scope ?? "global",
      ...(query.projectId !== undefined ? { projectId: query.projectId } : {}),
      ...(query.limit !== undefined ? { limit: query.limit } : {})
    });
    res.json(ok({ entries }));
  }));

  // Operate surface (approval-gated on the dsh side), same payload as the
  // write_memory tool. Repository-level validation errors map to 400.
  router.post("/memory/entries", (req, res) => withBody(req.body, writeMemoryBody, res, (body) => {
    if (!toolEnabled(req, res, "write_memory")) return;
    try {
      const result = writeMemoryEntry(deps.db, bridgeUserId(req), {
        kind: body.kind,
        scope: body.scope,
        text: body.text,
        ...(body.projectId !== undefined ? { projectId: body.projectId } : {}),
        ...(body.metadata !== undefined ? { metadata: body.metadata } : {})
      });
      res.status(201).json(ok(result));
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      if (code.startsWith("AGENT_MEMORY_")) {
        res.status(400).json({ code: 1, message: "Invalid memory entry", details: { code } });
        return;
      }
      throw error;
    }
  }));

  router.get("/sessions", (req, res) => withQuery(req.query, listSessionsQuery, res, (query) => {
    if (!toolEnabled(req, res, "list_sessions")) return;
    const sessions = listSessionSummaries(deps.db, bridgeUserId(req), {
      ...(query.projectId !== undefined ? { projectId: query.projectId } : {}),
      ...(query.limit !== undefined ? { limit: query.limit } : {})
    });
    res.json(ok({ sessions, count: sessions.length }));
  }));

  // Usage statistics seam (read-only): mirrors the get_usage_summary tool.
  router.get("/usage/summary", (req, res) => {
    if (!toolEnabled(req, res, "get_usage_summary")) return;
    const userId = bridgeUserId(req);
    const days = parseDays(req.query.days);
    if (days === null) return invalid(res, "days must be an integer between 1 and 365");
    const to = new Date();
    const from = days !== undefined ? new Date(to.getTime() - days * 24 * 60 * 60 * 1000) : undefined;
    res.json(ok({
      ...(days !== undefined ? { tokenWindowDays: days } : {}),
      sessionUsage: new UsageRepository(deps.db, userId).getSummary(),
      tokenUsage: new TokenUsageRepository(deps.db, userId).getSummary(from, to)
    }));
  });

  // Session terminal output tail (read-only): mirrors the get_session_output tool.
  router.get("/sessions/:id/output", (req, res) => {
    if (!toolEnabled(req, res, "get_session_output")) return;
    const sessionId = parseId(req.params.id, res);
    if (!sessionId) return;
    const session = new SessionRepository(deps.db, bridgeUserId(req)).getById(sessionId);
    if (!session) return notFound(res, "Session not found");
    let maxLines = 80;
    if (req.query.maxLines !== undefined) {
      const parsed = z.coerce.number().int().min(1).max(500).safeParse(req.query.maxLines);
      if (!parsed.success) return invalid(res, "maxLines must be an integer between 1 and 500");
      maxLines = parsed.data;
    }
    const ring = deps.sessionManager.getSessionOutput(sessionId);
    if (!ring) {
      return res.json(ok({ found: true, live: false, output: "", truncated: false, lineCount: 0 }));
    }
    res.json(ok({ found: true, live: true, ...ring.getTail(maxLines) }));
  });

  router.get("/sessions/:id", (req, res) => {
    const sessionId = parseId(req.params.id, res);
    if (!sessionId) return;
    const session = getSessionDetail(deps.db, bridgeUserId(req), sessionId);
    if (!session) return notFound(res, "Session not found");
    res.json(ok({ session }));
  });

  router.post("/sessions/:id/dispatch", (req, res) => {
    void (async () => {
      const sessionId = parseId(req.params.id, res);
      if (!sessionId) return;
      const parsed = dispatchBody.safeParse(req.body);
      if (!parsed.success) return invalid(res, "message is required (1-4000 chars)");
      const userId = bridgeUserId(req);
      // Tenant check happens against the durable record before any runtime write.
      const session = new SessionRepository(deps.db, userId).getById(sessionId);
      if (!session) {
        return notFound(res, "Session not found");
      }
      try {
        if (!isAdapterId(session.aiTool)) {
          throw new Error("PROGRAMMATIC_SUBMIT_ADAPTER_MISMATCH");
        }
        const result = await dispatchSessionInput(
          deps.sessionManager,
          sessionId,
          session.aiTool,
          parsed.data.message,
          deps.dispatchConfirm
        );
        res.json(ok(result));
      } catch (error) {
        dispatchError(res, error, { userId, action: "session.dispatch", sessionId });
      }
    })().catch((error) => {
      console.error("[copilot-bridge] dispatch failed", { action: "session.dispatch" }, error);
      if (!res.headersSent) {
        res.status(500).json({ code: 1, message: "Dispatch failed", details: { code: "BRIDGE_DISPATCH_FAILED" } });
      }
    });
  });

  // ---- Copilot skills (progressive disclosure knowledge layer) ----

  router.get("/skills", (req, res) => {
    if (!toolEnabled(req, res, "list_skills")) return;
    const skills = listCopilotSkillSummaries();
    res.json(ok({ count: skills.length, skills }));
  });

  router.get("/skills/:name", (req, res) => {
    if (!toolEnabled(req, res, "load_skill")) return;
    const name = parseId(req.params.name, res);
    if (!name) return;
    const skill = getCopilotSkill(name);
    if (!skill) return notFound(res, "Skill not found");
    res.json(ok({ found: true, name: skill.name, description: skill.description, body: skill.body }));
  });

  // ---- Project Manager task packets (development-management seam) ----

  router.get("/pm/projects/:projectId/task-packets", (req, res) => {
    if (!toolEnabled(req, res, "pm_list_task_packets")) return;
    const projectId = parseId(req.params.projectId, res);
    if (!projectId) return;
    const project = new ProjectRepository(deps.db, bridgeUserId(req)).getById(projectId);
    if (!project) return notFound(res, "Project not found");
    const repo = new ProjectManagerRepository(deps.db, bridgeUserId(req));
    const sessionRepo = new SessionRepository(deps.db, bridgeUserId(req));
    const limitRaw = req.query.limit;
    const limit = limitRaw === undefined ? undefined : Number(limitRaw);
    const packets = [];
    for (const workItem of repo.listWorkItems(projectId)) {
      const session = resolveTaskPacketSession(deps.db, bridgeUserId(req), projectId, workItem);
      packets.push(buildTaskPacket({ project, workItem, session }));
      if (limit !== undefined && Number.isFinite(limit) && packets.length >= limit) break;
    }
    void sessionRepo;
    res.json(ok({ found: true, count: packets.length, taskPackets: packets }));
  });

  router.get("/pm/projects/:projectId/task-packet", (req, res) => {
    if (!toolEnabled(req, res, "pm_get_task_packet")) return;
    const projectId = parseId(req.params.projectId, res);
    if (!projectId) return;
    const workItemId = parseId(String(req.query.workItemId ?? ""), res);
    if (!workItemId) return;
    const project = new ProjectRepository(deps.db, bridgeUserId(req)).getById(projectId);
    if (!project) return notFound(res, "Project not found");
    const workItem = new ProjectManagerRepository(deps.db, bridgeUserId(req)).getWorkItem(projectId, workItemId);
    if (!workItem) return notFound(res, "Work item not found");
    const session = resolveTaskPacketSession(deps.db, bridgeUserId(req), projectId, workItem);
    res.json(ok({ found: true, taskPacket: buildTaskPacket({ project, workItem, session }) }));
  });

  // One-shot dispatch: ensure linked session exists, launch runtime when the
  // gateway can (deps.startSessionRuntime), bind the packet, and hand back the
  // packet for the runtime to deliver. Mirrors pm_start_task_packet.
  router.post("/pm/projects/:projectId/task-packet/start", (req, res) => withBody(req.body, pmStartBody, res, async (body) => {
    try {
    if (!toolEnabled(req, res, "pm_start_task_packet")) return;
    const userId = bridgeUserId(req);
    const projectId = parseId(req.params.projectId, res);
    if (!projectId) return;
    const project = new ProjectRepository(deps.db, userId).getById(projectId);
    if (!project) return notFound(res, "Project not found");
    const workItem = new ProjectManagerRepository(deps.db, userId).getWorkItem(projectId, body.workItemId);
    if (!workItem) return notFound(res, "Work item not found");
    let session = resolveTaskPacketSession(deps.db, userId, projectId, workItem);
    if (!session) {
      session = new SessionRepository(deps.db, userId).create({
        projectId: project.id,
        name: createTaskPacketSessionName(workItem.title),
        aiTool: body.aiTool ?? project.aiTool ?? "",
        workingDir: project.path,
        credentialMode: "host_environment"
      });
      new ProjectManagerRepository(deps.db, userId).updateWorkItem(project.id, workItem.id, {
        details: withTaskPacketSessionLink(workItem.details, session, project, createTaskPacketContext(workItem, project))
      });
    }
    let launched = false;
    if (session.status !== "running" && deps.launchSessionRuntime) {
      launched = await deps.launchSessionRuntime(userId, session.id);
      session = new SessionRepository(deps.db, userId).getById(session.id) ?? session;
    }
    const packet = buildTaskPacket({ project, workItem, session });
    res.json(ok({ started: true, sessionId: session.id, launched, taskPacket: packet }));
    } catch (error) {
      console.error("[copilot-bridge] pm start failed", { action: "pm.start" }, error);
      if (!res.headersSent) {
        res.status(500).json({ code: 1, message: "Task packet start failed", details: { code: "BRIDGE_PM_START_FAILED" } });
      }
    }
  }));

  // ---- Project graph (read-only CodeGraph index) ----
  // Degraded states (index absent / unsupported schema) come back as
  // `available:false` so the model can recover conversationally.
  router.get("/projects/:id/graph/search", (req, res) => withQuery(req.query, graphSearchQuery, res, (query) => {
    if (!toolEnabled(req, res, "project_graph_search")) return;
    const projectId = parseId(req.params.id, res);
    if (!projectId) return;
    res.json(ok({
      result: searchProjectGraphSymbols(deps.db, bridgeUserId(req), projectId, {
        q: query.q,
        ...(query.kind !== undefined ? { kind: query.kind } : {}),
        ...(query.limit !== undefined ? { limit: query.limit } : {})
      })
    }));
  }));

  router.get("/projects/:id/graph/symbols/:symbolId", (req, res) => {
    if (!toolEnabled(req, res, "project_graph_symbol_detail")) return;
    const projectId = parseId(req.params.id, res);
    if (!projectId) return;
    const symbolId = req.params.symbolId ?? "";
    if (!graphSymbolIdSchema.safeParse(symbolId).success) return invalid(res);
    res.json(ok({ result: getProjectGraphSymbol(deps.db, bridgeUserId(req), projectId, symbolId) }));
  });

  router.get("/projects/:id/graph/symbols/:symbolId/impact", (req, res) => withQuery(req.query, graphImpactQuery, res, (query) => {
    if (!toolEnabled(req, res, "project_graph_impact")) return;
    const projectId = parseId(req.params.id, res);
    if (!projectId) return;
    const symbolId = req.params.symbolId ?? "";
    if (!graphSymbolIdSchema.safeParse(symbolId).success) return invalid(res);
    const depth = query.depth ?? 2;
    res.json(ok({ result: getProjectGraphSymbolImpact(deps.db, bridgeUserId(req), projectId, symbolId, depth) }));
  }));

  router.post("/projects/:id/graph/affected", (req, res) => withBody(req.body, graphAffectedBody, res, (body) => {
    if (!toolEnabled(req, res, "project_graph_affected_paths")) return;
    const projectId = parseId(req.params.id, res);
    if (!projectId) return;
    const depth = body.depth ?? 2;
    res.json(ok({ result: getProjectGraphAffectedPaths(deps.db, bridgeUserId(req), projectId, body.paths, depth) }));
  }));

  return router;
}

function createBridgeAuthMiddleware(bridgeToken: string) {
  const expected = Buffer.from(bridgeToken, "utf8");
  return (req: Request, res: Response, next: NextFunction): void => {
    const presented = extractBearerToken(req.headers.authorization);
    if (!presented) {
      res.status(401).json({ code: 1, message: "Unauthorized", details: { code: "BRIDGE_TOKEN_REQUIRED" } });
      return;
    }
    const actual = Buffer.from(presented, "utf8");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      res.status(403).json({ code: 1, message: "Forbidden", details: { code: "BRIDGE_TOKEN_INVALID" } });
      return;
    }
    const userId = req.header("x-openforge-user-id")?.trim();
    if (!userId || userId.length > 128) {
      res.status(400).json({ code: 1, message: "X-OpenForge-User-Id header is required", details: { code: "BRIDGE_USER_ID_REQUIRED" } });
      return;
    }
    (req as BridgeRequest).bridgeUserId = userId;
    next();
  };
}

function bridgeUserId(req: Request): string {
  return (req as BridgeRequest).bridgeUserId;
}

function ok(data: unknown) {
  return { code: 0, data, message: "" };
}

function parseId(value: string | undefined, res: Response): string | undefined {
  const parsed = idSchema.safeParse(value);
  if (!parsed.success) invalid(res);
  return parsed.success ? parsed.data : undefined;
}

/** Optional ?days= window (1-365); undefined = all time; null = invalid input. */
function parseDays(value: unknown): number | undefined | null {
  if (value === undefined || value === "") return undefined;
  const parsed = z.coerce.number().int().min(1).max(365).safeParse(value);
  return parsed.success ? parsed.data : null;
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
  res.status(400).json({ code: 1, message, details: { code: "BRIDGE_INVALID_INPUT" } });
}

function notFound(res: Response, message: string): void {
  res.status(404).json({ code: 1, message, details: { code: "BRIDGE_NOT_FOUND" } });
}

function domainError(res: Response, error: unknown, context: Record<string, string>): void {
  const code = error instanceof Error ? error.message : "BRIDGE_OPERATION_FAILED";
  console.error("[copilot-bridge] operation rejected", { ...context, code });
  if (/NOT_FOUND/.test(code)) {
    res.status(404).json({ code: 1, message: "Portfolio record not found", details: { code } });
    return;
  }
  if (/CONFLICT|INVALID_TRANSITION|PRECONDITION|OWNER_REQUIRED|LEASE_MISMATCH/.test(code)) {
    res.status(409).json({ code: 1, message: "Portfolio operation rejected", details: { code } });
    return;
  }
  res.status(400).json({ code: 1, message: "Portfolio operation rejected", details: { code } });
}

function dispatchError(res: Response, error: unknown, context: Record<string, string>): void {
  const message = error instanceof Error ? error.message : "";
  console.error("[copilot-bridge] dispatch rejected", { ...context, code: message });
  if (message.startsWith("Unknown session")) {
    res.status(409).json({ code: 1, message: "Session is not active in this Gateway process", details: { code: "BRIDGE_SESSION_NOT_ACTIVE" } });
    return;
  }
  if (message.includes(PORTFOLIO_WRITER_FENCE_REJECTED)) {
    res.status(409).json({ code: 1, message: "Session is leased to a Portfolio worker", details: { code: PORTFOLIO_WRITER_FENCE_REJECTED } });
    return;
  }
  if (message === PROGRAMMATIC_SUBMIT_UNSAFE_INPUT) {
    res.status(400).json({
      code: 1,
      message: "Programmatic task text contains unsupported terminal control characters.",
      details: { code: message, reason: "programmatic_submit_rejected", retryable: false }
    });
    return;
  }
  if (
    message === PROGRAMMATIC_SUBMIT_ADAPTER_MISMATCH
    || message === PROGRAMMATIC_SUBMIT_NOT_READY
    || message === PROGRAMMATIC_SUBMIT_STAGING_FAILED
  ) {
    res.status(409).json({
      code: 1,
      message: "The target CLI is not ready for programmatic submission. Check the session terminal before trying again.",
      details: { code: message, reason: "programmatic_submit_rejected", retryable: false }
    });
    return;
  }
  if (message === DISPATCH_DELIVERY_UNCONFIRMED) {
    // Model-facing wording: the runtime surfaces this envelope message as the
    // tool result, so it must explain the likely cause and the next step.
    res.status(502).json({
      code: 1,
      message: "Dispatch may have reached the target CLI but consumption could not be confirmed. Check the session terminal; do not retry automatically because that could run the task twice.",
      details: { code: DISPATCH_DELIVERY_UNCONFIRMED, reason: "submission_indeterminate", retryable: false }
    });
    return;
  }
  res.status(500).json({ code: 1, message: "Dispatch failed", details: { code: "BRIDGE_DISPATCH_FAILED" } });
}
