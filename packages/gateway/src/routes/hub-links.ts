/**
 * Node side of team hub coordination (`/api/v1/hub-links`): the member's own
 * instance links one of their local projects to a hub project and relays
 * their explicit task actions. The stored node token is never returned.
 */
import { Router, type Request, type Response } from "express";
import { z } from "zod";

import { authenticate, userIsInstanceAdmin, type AuthenticatedRequest } from "../auth/middleware.js";
import type { Database } from "../db/types.js";
import { createRateLimiter } from "../middleware/rate-limit.js";
import { HubLinkError } from "../services/hub-link/client.js";
import { HubLinkService, type HubLinkIO } from "../services/hub-link/service.js";

const id = z.string().uuid();
const connectBody = z.object({
  hubUrl: z.string().min(1).max(512),
  token: z.string().min(1).max(256),
  localProjectId: id
}).strict();
const statusBody = z.object({ status: z.enum(["in_progress", "blocked"]) }).strict();
const submitBody = z.object({
  prUrl: z.string().max(2048).nullable().optional(),
  checksStatus: z.enum(["passed", "failed", "not_run"]),
  checksSummary: z.string().max(2000).optional()
}).strict();
const empty = z.object({}).strict();

export function createHubLinkRoutes(db: Database, masterKey: string, io: HubLinkIO = {}): Router {
  const router = Router();
  router.use(authenticate);
  // Linking makes this instance call an operator-chosen address on a private
  // network, so it is reserved for the instance admin. On a member's own
  // machine that is the member; on a shared hub it keeps ordinary members from
  // using the instance to probe its network.
  router.use((req, res, next) => {
    if (!userIsInstanceAdmin(db, (req as unknown as AuthenticatedRequest).userId)) {
      res.status(403).json({ code: 1, message: "HUB_LINK_ADMIN_REQUIRED", details: { code: "HUB_LINK_ADMIN_REQUIRED" } });
      return;
    }
    next();
  });
  const connectLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 10 });
  const service = (req: Request) => new HubLinkService(db, (req as unknown as AuthenticatedRequest).userId, masterKey, io);
  const link = (req: Request) => id.parse(req.params.linkId);
  const task = (req: Request) => id.parse(req.params.taskId);

  const handle = (fn: (req: Request) => unknown | Promise<unknown>, status = 200) => (req: Request, res: Response): void => {
    void Promise.resolve().then(() => fn(req)).then(data => res.status(status).json({ code: 0, data, message: "" })).catch((error: unknown) => {
      const invalid = error instanceof z.ZodError;
      const known = error instanceof HubLinkError;
      const code = known ? error.code : invalid ? "INVALID_INPUT" : "HUB_LINK_OPERATION_FAILED";
      if (!known && !invalid) console.error("[hub-link] request failed", { action: `${req.method} ${req.route?.path ?? ""}`, code, timestamp: Date.now() });
      res.status(known ? error.status : invalid ? 400 : 500).json({ code: 1, message: code, details: { code } });
    });
  };

  router.get("/", handle(req => ({ links: service(req).list() })));
  router.post("/", connectLimiter, handle(async req => ({ link: await service(req).connect(connectBody.parse(req.body)) }), 201));
  router.delete("/:linkId", handle(req => ({ removed: service(req).remove(link(req)) })));
  router.post("/:linkId/sync", handle(req => { empty.parse(req.body ?? {}); return service(req).sync(link(req)); }));
  router.get("/:linkId/tasks", handle(req => ({ tasks: service(req).tasks(link(req)) })));
  router.get("/:linkId/git", handle(async req => ({ git: await service(req).gitState(link(req)) })));
  router.post("/:linkId/tasks/:taskId/claim", handle(async req => { empty.parse(req.body ?? {}); return { task: await service(req).claim(link(req), task(req)) }; }));
  router.patch("/:linkId/tasks/:taskId/status", handle(async req => ({
    task: await service(req).setStatus(link(req), task(req), statusBody.parse(req.body).status)
  })));
  router.post("/:linkId/tasks/:taskId/submit", handle(async req => ({
    task: await service(req).submit(link(req), task(req), submitBody.parse(req.body))
  })));
  router.post("/:linkId/tasks/:taskId/local-task", handle(req => { empty.parse(req.body ?? {}); return service(req).createLocalTask(link(req), task(req)); }, 201));
  return router;
}
