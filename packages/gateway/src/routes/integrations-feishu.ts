import { Router } from "express";

import { authenticate } from "../auth/middleware.js";
import {
  getFeishuCliStatus,
  type FeishuCliStatus
} from "../services/integrations/feishu-cli.js";

export interface FeishuIntegrationRoutesOptions {
  getStatus?: () => Promise<FeishuCliStatus>;
}

export function createFeishuIntegrationRoutes(
  options: FeishuIntegrationRoutesOptions = {}
): Router {
  const router = Router();
  const getStatus = options.getStatus ?? (() => getFeishuCliStatus({ env: process.env }));

  router.use(authenticate);

  router.get("/status", async (_req, res) => {
    try {
      const status = await getStatus();
      res.json({
        code: 0,
        data: { status },
        message: ""
      });
    } catch {
      res.status(500).json({
        code: 1,
        message: "Failed to check Feishu integration status"
      });
    }
  });

  return router;
}
