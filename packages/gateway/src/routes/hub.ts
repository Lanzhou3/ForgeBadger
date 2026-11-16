/**
 * Team hub coordination API.
 *
 * Two routers share the same task operations:
 *  - `/api/v1/hub` authenticates a member's node token (`fbnode_…`). The token
 *    is pinned to one project and reaches nothing outside this router.
 *  - `/api/v1/hub-console` authenticates the browser session and additionally
 *    owns token management, project settings and confirmations.
 *
 * Confirmations are deliberately session-only: a node token is held by
 * software on the member's machine, so it must not be able to act as the
 * human reviewer.
 */
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";

import { authenticate, extractBearerToken, type AuthenticatedRequest } from "../auth/middleware.js";
import { HubNodeTokenRepository, type HubNodeToken } from "../db/repositories/hub-node-token-repository.js";
import type { Database } from "../db/types.js";
import { createRateLimiter } from "../middleware/rate-limit.js";
import { CollaborationError } from "../services/collaboration/types.js";
import { HubCoordination } from "../services/hub/coordination.js";

interface NodeRequest extends Request {
  hubNode?: { userId: string; tokenId: string; projectId: string; name: string; expiresAt: number };
}

const DAY_MS = 24 * 60 * 60 * 1000;
const id = z.string().uuid();
const revision = z.number().int().min(1);
const branch = z.string().regex(/^(?!.*\.\.)[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/);
const commit = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i);
const httpsUrl = z.string().max(2048).refine(value => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}, "HTTPS URL without credentials required");
const remoteUrl = z.string().max(512).refine(
  value => httpsUrl.safeParse(value).success || /^git@[A-Za-z0-9.-]+:[A-Za-z0-9._/-]+$/.test(value),
  "HTTPS or SSH Git remote required"
);

const statusBody = z.object({ expectedRevision: revision, status: z.enum(["in_progress", "blocked"]) }).strict();
const claimBody = z.object({ expectedRevision: revision }).strict();
const commentBody = z.object({ text: z.string().trim().min(1).max(5000) }).strict();
const submissionBody = z.object({
  expectedRevision: revision,
  branch,
  commitSha: commit,
  prUrl: httpsUrl.nullable().optional(),
  checksStatus: z.enum(["passed", "failed", "not_run"]),
  checksSummary: z.string().max(2000).optional()
}).strict();
const confirmationBody = z.object({
  expectedRevision: revision,
  submissionId: id,
  decision: z.enum(["accepted", "changes_requested"]),
  note: z.string().trim().min(1).max(5000)
}).strict();
const settingsBody = z.object({
  expectedRevision: z.number().int().min(0),
  provider: z.enum(["github", "gitee"]),
  remoteUrl,
  defaultBranch: branch,
  confirmationPolicy: z.string().min(1).max(64).optional()
}).strict();
const tokenBody = z.object({
  projectId: id,
  name: z.string().trim().min(1).max(64),
  expiresInDays: z.number().int().min(1).max(90).default(30)
}).strict();

type Handler = (req: Request) => unknown;

function handle(fn: Handler, status = 200) {
  return (req: Request, res: Response): void => {
    try {
      res.status(status).json({ code: 0, data: fn(req), message: "" });
    } catch (error) {
      sendError(req, res, error);
    }
  };
}

function sendError(req: Request, res: Response, error: unknown): void {
  const invalid = error instanceof z.ZodError;
  const known = error instanceof CollaborationError;
  const code = known ? error.code : invalid ? "INVALID_INPUT" : "HUB_OPERATION_FAILED";
  if (!known && !invalid) {
    console.error("[hub] request failed", { action: `${req.method} ${req.route?.path ?? ""}`, code, timestamp: Date.now() });
  }
  res.status(known ? error.status : invalid ? 400 : 500).json({ code: 1, message: code, details: { code } });
}

function tokenDto(token: HubNodeToken) {
  const { id: tokenId, projectId, name, createdAt, expiresAt, lastUsedAt, revokedAt } = token;
  return { id: tokenId, projectId, name, createdAt, expiresAt, lastUsedAt, revokedAt };
}

/** Task operations available to both a node token and a browser session. */
function mountTaskRoutes(router: Router, db: Database, actorOf: (req: Request) => string): void {
  const hub = (req: Request) => new HubCoordination(db, actorOf(req));
  const project = (req: Request) => id.parse(req.params.projectId);
  const task = (req: Request) => id.parse(req.params.taskId);

  router.get("/projects/:projectId", handle(req => hub(req).project(project(req))));
  router.get("/projects/:projectId/tasks", handle(req => {
    const scope = z.enum(["me", "all"]).default("me").parse(req.query.assignee);
    return { tasks: hub(req).listTasks(project(req), scope === "me" ? "mine" : "all") };
  }));
  router.get("/projects/:projectId/tasks/:taskId", handle(req => hub(req).task(project(req), task(req))));
  router.post("/projects/:projectId/tasks/:taskId/claim", handle(req => ({
    task: hub(req).claim(project(req), task(req), claimBody.parse(req.body).expectedRevision)
  })));
  router.patch("/projects/:projectId/tasks/:taskId/status", handle(req => ({
    task: hub(req).setStatus(project(req), task(req), statusBody.parse(req.body))
  })));
  router.post("/projects/:projectId/tasks/:taskId/submissions", handle(
    req => hub(req).submit(project(req), task(req), submissionBody.parse(req.body)), 201
  ));
  router.post("/projects/:projectId/tasks/:taskId/comments", handle(req => ({
    comment: hub(req).comment(project(req), task(req), commentBody.parse(req.body).text)
  }), 201));
}

export function createHubNodeAuthenticator(db: Database) {
  const tokens = new HubNodeTokenRepository(db);
  return (req: NodeRequest, res: Response, next: NextFunction): void => {
    const presented = extractBearerToken(req.headers.authorization);
    const token = presented ? tokens.findActiveByToken(presented) : undefined;
    if (!token) {
      res.status(401).json({ code: 1, message: "Unauthorized" });
      return;
    }
    tokens.touch(token.id);
    req.hubNode = { userId: token.userId, tokenId: token.id, projectId: token.projectId, name: token.name, expiresAt: token.expiresAt };
    next();
  };
}

export function createHubNodeRoutes(db: Database): Router {
  const router = Router();
  router.use(createHubNodeAuthenticator(db));
  router.use(createRateLimiter({
    windowMs: 60_000,
    maxRequests: 240,
    keyFn: req => `hub-node:${(req as NodeRequest).hubNode?.tokenId ?? "unknown"}`
  }));
  // A token is pinned to one project; any other id is indistinguishable from
  // a project that does not exist.
  router.use("/projects/:projectId", (req: NodeRequest, res, next) => {
    if (req.params.projectId !== req.hubNode?.projectId) {
      res.status(404).json({ code: 1, message: "PROJECT_NOT_FOUND", details: { code: "PROJECT_NOT_FOUND" } });
      return;
    }
    next();
  });
  // Lets a node discover which project its token is pinned to, so the member
  // only has to paste the hub address and the token.
  router.get("/self", handle(req => {
    const node = (req as NodeRequest).hubNode!;
    return { userId: node.userId, projectId: node.projectId, tokenName: node.name, expiresAt: node.expiresAt };
  }));
  mountTaskRoutes(router, db, req => (req as NodeRequest).hubNode!.userId);
  return router;
}

export function createHubConsoleRoutes(db: Database): Router {
  const router = Router();
  router.use(authenticate);
  const actor = (req: Request) => (req as unknown as AuthenticatedRequest).userId;
  const hub = (req: Request) => new HubCoordination(db, actor(req));
  const tokens = new HubNodeTokenRepository(db);

  router.get("/tokens", handle(req => ({ tokens: tokens.listForUser(actor(req)).map(tokenDto) })));
  router.post("/tokens", handle(req => {
    const input = tokenBody.parse(req.body);
    hub(req).access(input.projectId);
    const created = tokens.create({
      userId: actor(req),
      projectId: input.projectId,
      name: input.name,
      expiresAt: Date.now() + input.expiresInDays * DAY_MS
    });
    // The plaintext token is returned exactly once and never stored.
    return { token: created.token, record: tokenDto(created.record) };
  }, 201));
  router.delete("/tokens/:tokenId", handle(req => ({ revoked: tokens.revoke(actor(req), id.parse(req.params.tokenId)) })));

  router.put("/projects/:projectId/settings", handle(req => ({
    settings: hub(req).putSettings(id.parse(req.params.projectId), settingsBody.parse(req.body))
  })));
  router.post("/projects/:projectId/tasks/:taskId/confirmations", handle(
    req => hub(req).confirm(id.parse(req.params.projectId), id.parse(req.params.taskId), confirmationBody.parse(req.body), "human"), 201
  ));
  mountTaskRoutes(router, db, actor);
  return router;
}
