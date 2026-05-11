import { Router } from "express";
import { z } from "zod";

import { authenticate, type AuthenticatedRequest } from "../auth/middleware.js";
import type { CopilotPendingAction, CopilotRun, CopilotRunEvent } from "../db/repositories/copilot-repository.js";
import { CopilotRepository } from "../db/repositories/copilot-repository.js";
import type { Database } from "../db/types.js";
import { buildLocalDiagnosticsExport } from "../services/diagnostics.js";
import { approveCopilotMemoryWrite } from "../services/copilot/memory.js";
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
    const current = repo.getRun(req.params.id);
    if (!current) return res.status(404).json({ code: 1, message: "Copilot run not found" });
    if (!isCancellableRunStatus(current.status)) {
      return res.status(409).json({
        code: 1,
        message: "Copilot run cannot be cancelled from its current status",
        details: { code: "copilot_run_not_cancellable", status: current.status }
      });
    }
    rejectPendingActions(repo, current.id);
    const run = repo.updateRun(current.id, { status: "cancelled", completedAt: Date.now() }) ?? current;
    res.json(successEnvelope(run, repo.listEvents(run.id), repo.listPendingActions(run.id)));
  });

  router.post("/runs/:id/pending-actions/:actionId/approve", (req, res) => {
    const repo = repoFor(options.db, req);
    const target = findPendingActionTarget(repo, req.params.id, req.params.actionId);
    if (!target) return res.status(404).json({ code: 1, message: "Pending action not found" });
    if (!isApprovalRunStatus(target.run.status)) {
      return res.status(409).json({
        code: 1,
        message: "Copilot run is not waiting for approval",
        details: { code: "copilot_run_not_approvable", status: target.run.status }
      });
    }
    const action = target.action;
    if (action.status !== "pending") return res.status(400).json({ code: 1, message: "Pending action is not approvable" });
    const result = approvePendingAction(action, options, userIdFor(req));
    if (isApprovalError(result)) {
      res.status(400).json({ code: 1, message: result.error.message, details: { code: result.error.code } });
      return;
    }
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
    const target = findPendingActionTarget(repo, req.params.id, req.params.actionId);
    if (!target) return res.status(404).json({ code: 1, message: "Pending action not found" });
    if (!isApprovalRunStatus(target.run.status)) {
      return res.status(409).json({
        code: 1,
        message: "Copilot run is not waiting for approval",
        details: { code: "copilot_run_not_approvable", status: target.run.status }
      });
    }
    const updated = repo.updatePendingAction(target.action.id, { status: "rejected" });
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

function isCancellableRunStatus(status: string): boolean {
  return status === "queued" || status === "running" || status === "waiting_for_approval";
}

function isApprovalRunStatus(status: string): boolean {
  return status === "waiting_for_approval";
}

function rejectPendingActions(repo: CopilotRepository, runId: string): void {
  for (const action of repo.listPendingActions(runId)) {
    if (action.status === "pending") {
      repo.updatePendingAction(action.id, {
        status: "rejected",
        result: { reason: "run_cancelled" }
      });
    }
  }
}

function findPendingActionTarget(
  repo: CopilotRepository,
  runId: string,
  actionId: string
): { run: CopilotRun; action: CopilotPendingAction } | undefined {
  const run = repo.getRun(runId);
  if (!run) return undefined;
  const action = repo.getPendingAction(actionId);
  return action?.runId === runId ? { run, action } : undefined;
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
  if (action.type === "openforge.propose_memory_write") {
    return approveCopilotMemoryWrite(action, { db: options.db, userId });
  }
  return { steps: action.input, executed: false };
}

function isApprovalError(result: Record<string, unknown>): result is { error: { code: string; message: string } } {
  const error = result.error;
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      "message" in error &&
      typeof (error as { code?: unknown }).code === "string" &&
      typeof (error as { message?: unknown }).message === "string"
  );
}
