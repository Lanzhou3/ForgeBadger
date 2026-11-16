/**
 * Remote (Git host) status for the team hub: write-only API token and a manual
 * pull-request / CI refresh. Session-authenticated; mounted at `/api/v1/hub-console`.
 */
import { Router, type Request, type Response } from "express";
import { z } from "zod";

import { authenticate, type AuthenticatedRequest } from "../auth/middleware.js";
import type { Database } from "../db/types.js";
import { createRateLimiter } from "../middleware/rate-limit.js";
import { isDirectLoopbackRequest } from "../lib/request-origin.js";
import { CollaborationError } from "../services/collaboration/types.js";
import type { RemoteProviderIO } from "../services/hub/remote-providers.js";
import { HubRemoteStatus, type RemoteStatusOptions } from "../services/hub/remote-status.js";

const id = z.string().uuid();
const credentialBody = z.object({ token: z.string().min(1).max(512).regex(/^\S+$/) }).strict();
const emptyBody = z.object({}).strict();

function sendError(req: Request, res: Response, error: unknown): void {
  const invalid = error instanceof z.ZodError;
  const known = error instanceof CollaborationError;
  const code = known ? error.code : invalid ? "INVALID_INPUT" : "HUB_OPERATION_FAILED";
  if (!known && !invalid) {
    console.error("[hub-remote] request failed", { action: `${req.method} ${req.route?.path ?? ""}`, code, timestamp: Date.now() });
  }
  res.status(known ? error.status : invalid ? 400 : 500).json({ code: 1, message: code, details: { code } });
}

function handle(fn: (req: Request) => unknown) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      res.status(200).json({ code: 0, data: await fn(req), message: "" });
    } catch (error) {
      sendError(req, res, error);
    }
  };
}

export function createHubRemoteRoutes(db: Database, masterKey: string, io: RemoteProviderIO = {}, options: RemoteStatusOptions = {}): Router {
  const router = Router();
  router.use(authenticate);
  const service = (req: Request) => new HubRemoteStatus(db, (req as unknown as AuthenticatedRequest).userId, masterKey, io, options);
  const limit = (name: string, maxRequests: number) => createRateLimiter({
    windowMs: 60_000,
    maxRequests,
    keyFn: req => `hub-remote-${name}:${(req as unknown as AuthenticatedRequest).userId}`
  });
  const project = (req: Request) => id.parse(req.params.projectId);

  router.put("/projects/:projectId/remote-credential", limit("credential", 10), handle(req => {
    // A proxied request must have arrived over TLS; only a direct loopback call may use plain HTTP.
    if (!req.secure && !isDirectLoopbackRequest(req)) throw new CollaborationError(403, "SECURE_CREDENTIAL_TRANSPORT_REQUIRED");
    return service(req).setCredential(project(req), credentialBody.parse(req.body).token);
  }));
  router.delete("/projects/:projectId/remote-credential", handle(req => service(req).clearCredential(project(req))));
  router.post("/projects/:projectId/remote/refresh", limit("refresh", 6), handle(req => {
    emptyBody.parse(req.body ?? {});
    return service(req).refresh(project(req));
  }));
  return router;
}
