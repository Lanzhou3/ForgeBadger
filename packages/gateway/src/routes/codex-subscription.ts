import { Router } from "express";
import { z } from "zod";

import { authenticate } from "../auth/middleware.js";

const connectSchema = z.object({
  accountLabel: z.string().min(1).optional()
});

export function createCodexSubscriptionRoutes(): Router {
  const router = Router();
  router.use(authenticate);

  router.get("/status", (_req, res) => {
    res.json({
      code: 0,
      data: {
        status: buildCodexSubscriptionStatus()
      },
      message: ""
    });
  });

  router.post("/connect", (req, res) => {
    const parseResult = connectSchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
      res.status(400).json({ code: 1, message: "Invalid Codex subscription payload" });
      return;
    }
    res.status(202).json({
      code: 0,
      data: {
        status: {
          ...buildCodexSubscriptionStatus(),
          connectionState: "pending_sdk_connection",
          accountLabel: parseResult.data.accountLabel ?? null
        }
      },
      message: ""
    });
  });

  return router;
}

function buildCodexSubscriptionStatus() {
  const connected = process.env.OPENFORGE_CODEX_SUBSCRIPTION_STATUS === "connected";
  return {
    providerApplyEnabled: false,
    identitySource: "chatgpt_subscription_sdk",
    connectionState: connected ? "connected" : "not_connected",
    accountLabel: process.env.OPENFORGE_CODEX_ACCOUNT_LABEL ?? null,
    canUseAppServerIdentity: connected
  };
}
