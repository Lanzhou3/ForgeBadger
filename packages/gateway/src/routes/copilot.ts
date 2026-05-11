import { Router } from "express";
import { z } from "zod";

import { authenticate, type AuthenticatedRequest } from "../auth/middleware.js";
import type { CopilotRun, CopilotRunEvent } from "../db/repositories/copilot-repository.js";
import { CopilotRepository } from "../db/repositories/copilot-repository.js";
import type { Database } from "../db/types.js";
import { CopilotOrchestrator, type CopilotOrchestratorOptions } from "../services/copilot/orchestrator.js";

const createRunSchema = z.object({
  prompt: z.string().trim().min(1).max(32 * 1024),
  providerProfileId: z.string().min(1).optional(),
  modelProfileId: z.string().min(1).optional(),
  source: z.enum(["dashboard", "project", "session", "settings", "copilot"]).default("copilot"),
  sourceRefId: z.string().min(1).optional()
});

const listRunsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional()
});

export interface CopilotRoutesOptions extends CopilotOrchestratorOptions {
  db: Database;
  masterKey: string;
}

export function createCopilotRoutes(options: CopilotRoutesOptions): Router {
  const router = Router();
  router.use(authenticate);

  router.get("/capabilities", (_req, res) => {
    res.json({
      code: 0,
      data: {
        supportedProviderFormats: ["openai", "openai-compatible", "anthropic"],
        toolExecutionEnabled: false,
        pendingActionApprovalEnabled: false
      },
      message: ""
    });
  });

  router.get("/runs", (req, res) => {
    const parseResult = listRunsSchema.safeParse(req.query);
    if (!parseResult.success) return sendInvalid(res, "Invalid copilot run query");
    const repo = repoFor(options.db, req);
    res.json({ code: 0, data: { runs: repo.listRuns(parseResult.data.limit) }, message: "" });
  });

  router.post("/runs", async (req, res) => {
    const parseResult = createRunSchema.safeParse(req.body ?? {});
    if (!parseResult.success) return sendInvalid(res, "Invalid copilot run payload");
    try {
      const result = await new CopilotOrchestrator(options).runText({
        userId: userIdFor(req),
        prompt: parseResult.data.prompt,
        source: parseResult.data.source,
        ...(parseResult.data.providerProfileId ? { providerProfileId: parseResult.data.providerProfileId } : {}),
        ...(parseResult.data.modelProfileId ? { modelProfileId: parseResult.data.modelProfileId } : {}),
        ...(parseResult.data.sourceRefId ? { sourceRefId: parseResult.data.sourceRefId } : {})
      });
      if (!result.ok) {
        res.status(result.status).json(errorEnvelope(result.error.message, result.error.code, result.run, result.events));
        return;
      }
      res.status(201).json(successEnvelope(result.run, result.events));
    } catch {
      res.status(500).json({ code: 1, message: "Failed to create copilot run" });
    }
  });

  router.get("/runs/:id", (req, res) => {
    const repo = repoFor(options.db, req);
    const run = repo.getRun(req.params.id);
    if (!run) return res.status(404).json({ code: 1, message: "Copilot run not found" });
    res.json(successEnvelope(run, repo.listEvents(run.id)));
  });

  router.post("/runs/:id/cancel", (req, res) => {
    const repo = repoFor(options.db, req);
    const run = repo.updateRun(req.params.id, { status: "cancelled", completedAt: Date.now() });
    if (!run) return res.status(404).json({ code: 1, message: "Copilot run not found" });
    res.json(successEnvelope(run, repo.listEvents(run.id)));
  });

  return router;
}

function repoFor(db: Database, req: unknown): CopilotRepository {
  return new CopilotRepository(db, userIdFor(req));
}

function userIdFor(req: unknown): string {
  return (req as AuthenticatedRequest).userId;
}

function successEnvelope(run: CopilotRun, events: CopilotRunEvent[]) {
  return {
    code: 0,
    data: { run, events },
    message: ""
  };
}

function errorEnvelope(message: string, code: string, run: CopilotRun, events: CopilotRunEvent[]) {
  return {
    code: 1,
    message,
    details: { code, run, events }
  };
}

function sendInvalid(res: { status: (code: number) => { json: (body: unknown) => void } }, message: string): void {
  res.status(400).json({ code: 1, message });
}
