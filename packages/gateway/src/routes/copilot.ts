import { Router } from "express";
import { z } from "zod";

import { authenticate, type AuthenticatedRequest } from "../auth/middleware.js";
import type { CopilotPendingAction, CopilotRun, CopilotRunEvent } from "../db/repositories/copilot-repository.js";
import { CopilotRepository } from "../db/repositories/copilot-repository.js";
import type { Database } from "../db/types.js";
import { buildLocalDiagnosticsExport } from "../services/diagnostics.js";
import { CopilotOrchestrator, type CopilotOrchestratorOptions } from "../services/copilot/orchestrator.js";
import { createCopilotReadTools } from "../services/copilot/read-tools.js";

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
  appVersion?: string;
}

export function createCopilotRoutes(options: CopilotRoutesOptions): Router {
  const router = Router();
  router.use(authenticate);

  router.get("/capabilities", (_req, res) => {
    res.json({
      code: 0,
      data: {
        supportedProviderFormats: ["openai", "openai-compatible", "anthropic"],
        toolExecutionEnabled: true,
        readTools: createCopilotReadTools().filter((tool) => tool.risk === "read").map((tool) => tool.name),
        approvalRequiredForWrites: true,
        pendingActionApprovalEnabled: true
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
      const repo = new CopilotRepository(options.db, userIdFor(req));
      res.status(201).json(successEnvelope(result.run, result.events, repo.listPendingActions(result.run.id)));
    } catch {
      res.status(500).json({ code: 1, message: "Failed to create copilot run" });
    }
  });

  router.get("/runs/:id", (req, res) => {
    const repo = repoFor(options.db, req);
    const run = repo.getRun(req.params.id);
    if (!run) return res.status(404).json({ code: 1, message: "Copilot run not found" });
    res.json(successEnvelope(run, repo.listEvents(run.id), repo.listPendingActions(run.id)));
  });

  router.post("/runs/:id/cancel", (req, res) => {
    const repo = repoFor(options.db, req);
    const run = repo.updateRun(req.params.id, { status: "cancelled", completedAt: Date.now() });
    if (!run) return res.status(404).json({ code: 1, message: "Copilot run not found" });
    res.json(successEnvelope(run, repo.listEvents(run.id), repo.listPendingActions(run.id)));
  });

  router.post("/runs/:id/pending-actions/:actionId/approve", (req, res) => {
    const repo = repoFor(options.db, req);
    const action = findPendingAction(repo, req.params.id, req.params.actionId);
    if (!action) return res.status(404).json({ code: 1, message: "Pending action not found" });
    if (action.status !== "pending") return res.status(400).json({ code: 1, message: "Pending action is not approvable" });
    const result = approvePendingAction(action, options, userIdFor(req));
    const updated = repo.updatePendingAction(action.id, {
      status: "approved",
      result,
      approvedBy: userIdFor(req),
      approvedAt: Date.now()
    });
    res.json({ code: 0, data: { action: updated }, message: "" });
  });

  router.post("/runs/:id/pending-actions/:actionId/reject", (req, res) => {
    const repo = repoFor(options.db, req);
    const action = findPendingAction(repo, req.params.id, req.params.actionId);
    if (!action) return res.status(404).json({ code: 1, message: "Pending action not found" });
    const updated = repo.updatePendingAction(action.id, { status: "rejected" });
    res.json({ code: 0, data: { action: updated }, message: "" });
  });

  return router;
}

function repoFor(db: Database, req: unknown): CopilotRepository {
  return new CopilotRepository(db, userIdFor(req));
}

function userIdFor(req: unknown): string {
  return (req as AuthenticatedRequest).userId;
}

function successEnvelope(
  run: CopilotRun,
  events: CopilotRunEvent[],
  pendingActions: CopilotPendingAction[] = []
) {
  return {
    code: 0,
    data: { run, events, pendingActions },
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

function findPendingAction(
  repo: CopilotRepository,
  runId: string,
  actionId: string
): CopilotPendingAction | undefined {
  if (!repo.getRun(runId)) return undefined;
  const action = repo.getPendingAction(actionId);
  return action?.runId === runId ? action : undefined;
}

function approvePendingAction(
  action: CopilotPendingAction,
  options: CopilotRoutesOptions,
  userId: string
): Record<string, unknown> {
  if (action.type === "openforge.propose_diagnostics_export") {
    return {
      report: buildLocalDiagnosticsExport({
        db: options.db,
        userId,
        masterKey: options.masterKey,
        appVersion: options.appVersion ?? "0.0.0"
      })
    };
  }
  if (action.type === "openforge.propose_session_create") {
    return { draft: action.input, executed: false };
  }
  return { steps: action.input, executed: false };
}
