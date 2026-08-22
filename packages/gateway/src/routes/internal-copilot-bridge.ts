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
import type { InMemorySessionManager } from "../services/session-manager.js";
import type { PortfolioApiFacade } from "../services/portfolio/portfolio-api-service.js";
import { PORTFOLIO_WRITER_FENCE_REJECTED } from "../services/portfolio/session-input-gate.js";
import {
  advanceWorkItem,
  dispatchSessionInput,
  getSessionDetail,
  listSessionSummaries
} from "../services/copilot-bridge/bridge-service.js";
import {
  DISPATCH_DELIVERY_UNCONFIRMED,
  type DispatchConfirmOptions
} from "../services/copilot-bridge/delivery-confirm.js";

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
const dispatchBody = z.object({
  message: z.string().trim().min(1).max(4000)
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
}

export function createCopilotBridgeRoutes(deps: CopilotBridgeRouteDeps): Router {
  const router = Router();
  router.use(createBridgeAuthMiddleware(deps.bridgeToken));

  router.get("/work-items", (req, res) => withQuery(req.query, listWorkItemsQuery, res, (query) => {
    const workItems = deps.portfolioApi.forUser(bridgeUserId(req)).listWorkItems({
      ...(query.projectId !== undefined ? { projectId: query.projectId } : {}),
      ...(query.status !== undefined ? { status: query.status } : {}),
      ...(query.limit !== undefined ? { limit: query.limit } : {})
    });
    res.json(ok({ workItems, count: workItems.length }));
  }));

  router.get("/work-items/:id", (req, res) => {
    const workItemId = parseId(req.params.id, res);
    if (!workItemId) return;
    const workItem = deps.portfolioApi.forUser(bridgeUserId(req)).getWorkItem(workItemId);
    if (!workItem) return notFound(res, "Work item not found");
    res.json(ok({ workItem }));
  });

  router.post("/work-items/:id/advance", (req, res) => withBody(req.body, advanceBody, res, (body) => {
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
    res.json(ok({ overview: deps.portfolioApi.forUser(bridgeUserId(req)).getOverview({}) }));
  });

  router.get("/sessions", (req, res) => withQuery(req.query, listSessionsQuery, res, (query) => {
    const sessions = listSessionSummaries(deps.db, bridgeUserId(req), {
      ...(query.projectId !== undefined ? { projectId: query.projectId } : {}),
      ...(query.limit !== undefined ? { limit: query.limit } : {})
    });
    res.json(ok({ sessions, count: sessions.length }));
  }));

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
      if (!new SessionRepository(deps.db, userId).getById(sessionId)) {
        return notFound(res, "Session not found");
      }
      try {
        const result = await dispatchSessionInput(deps.sessionManager, sessionId, parsed.data.message, deps.dispatchConfirm);
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
  if (message === DISPATCH_DELIVERY_UNCONFIRMED) {
    // Model-facing wording: the runtime surfaces this envelope message as the
    // tool result, so it must explain the likely cause and the next step.
    res.status(502).json({
      code: 1,
      message: "Dispatch could not be confirmed on the target terminal: the session's CLI may be showing a modal dialog and did not receive the input. Ask the user to check the session terminal, then retry.",
      details: { code: DISPATCH_DELIVERY_UNCONFIRMED, reason: "delivery_unconfirmed" }
    });
    return;
  }
  res.status(500).json({ code: 1, message: "Dispatch failed", details: { code: "BRIDGE_DISPATCH_FAILED" } });
}
