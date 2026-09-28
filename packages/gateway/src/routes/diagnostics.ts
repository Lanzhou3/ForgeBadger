import { Router } from "express";

import { authenticate, type AuthenticatedRequest } from "../auth/middleware.js";
import type { Database } from "../db/types.js";
import { buildLocalDiagnosticsExport } from "../services/diagnostics.js";
import { getFeishuCliStatus } from "../services/integrations/feishu-cli.js";

export interface DiagnosticsRoutesOptions {
  db: Database;
  masterKey: string;
  appVersion: string;
}

export function createDiagnosticsRoutes(options: DiagnosticsRoutesOptions): Router {
  const router = Router();
  router.use(authenticate);

  router.get("/export", async (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const feishuStatus = await getFeishuCliStatus({ env: process.env });
    const report = buildLocalDiagnosticsExport({
      db: options.db,
      userId,
      masterKey: options.masterKey,
      appVersion: options.appVersion,
      feishuStatus
    });
    res.json({
      code: 0,
      data: { report },
      message: ""
    });
  });

  return router;
}
