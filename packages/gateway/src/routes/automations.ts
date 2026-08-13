import { Router, type Request, type Response } from "express";
import { z } from "zod";

import { authenticate, type AuthenticatedRequest } from "../auth/middleware.js";
import { CopilotAutomationRepository } from "../db/repositories/copilot-automation-repository.js";
import type { Database } from "../db/types.js";
import {
  fromStoredAutomationSchedule,
  normalizeAutomationSchedule,
  toStoredAutomationSchedule
} from "../services/copilot/automation-types.js";

const scheduleSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("at"), at: z.string().min(1).max(64) }).strict(),
  z.object({ kind: z.literal("every"), intervalMs: z.number().int(), anchorAt: z.string().min(1).max(64).optional() }).strict(),
  z.object({ kind: z.literal("cron"), expression: z.string().min(1).max(128), timezone: z.string().min(1).max(128) }).strict()
]);
const scopeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("project"), projectIds: z.array(z.string().min(1).max(128)).min(1).max(100) }).strict(),
  z.object({ type: z.literal("workspace") }).strict()
]);
const deliverySchema = z.object({
  channel: z.literal("feishu"), accountId: z.string().min(1).max(128),
  chatId: z.string().min(1).max(128), threadId: z.string().min(1).max(128).optional()
}).strict();
const createSchema = z.object({
  name: z.string().min(1).max(256), prompt: z.string().min(1).max(16_000),
  scope: scopeSchema, schedule: scheduleSchema, delivery: deliverySchema,
  toolAuthority: z.array(z.string().min(1).max(128)).max(64).default(["project.read"]),
  maxUsageTokens: z.number().int().min(100).max(1_000_000).default(50_000),
  deadlineMs: z.number().int().min(1_000).max(1_800_000).default(120_000)
}).strict();
const updateSchema = createSchema.partial().extend({ expectedRevision: z.number().int().positive() }).strict();
const revisionSchema = z.object({ expectedRevision: z.number().int().positive() }).strict();

interface AutomationRouteOptions {
  scheduler?: {
    runNow(userId: string, automationId: string): Promise<unknown>;
    reconcile(userId: string): Promise<void>;
  };
}

export function createAutomationRoutes(
  db: Database,
  masterKey: string,
  options: AutomationRouteOptions = {}
): Router {
  const router = Router();
  router.use(authenticate);

  router.get("/", (request, response) => {
    const repo = repository(db, masterKey, request);
    response.json(ok({ automations: repo.list().map(publicAutomation) }));
  });

  router.post("/", async (request, response) => {
    const parsed = createSchema.safeParse(request.body ?? {});
    if (!parsed.success) return invalid(response);
    try {
      const schedule = normalizeAutomationSchedule(parsed.data.schedule);
      const stored = toStoredAutomationSchedule(schedule);
      const automation = repository(db, masterKey, request).create({
        name: parsed.data.name, status: "active", scopeType: parsed.data.scope.type,
        scopePolicy: parsed.data.scope, prompt: parsed.data.prompt, ...stored,
        deliveryPlan: parsed.data.delivery,
        authoritySnapshot: {
          mode: "user", tools: parsed.data.toolAuthority,
          maxUsageTokens: parsed.data.maxUsageTokens, deadlineMs: parsed.data.deadlineMs
        },
        nextRunAt: schedule.nextRunAt
      });
      await options.scheduler?.reconcile(userIdFor(request));
      response.status(201).json(ok({ automation: publicAutomation(automation) }));
    } catch (error) {
      routeError(response, error);
    }
  });

  router.get("/:automationId", (request, response) => {
    const automation = repository(db, masterKey, request).get(request.params.automationId);
    if (!automation) return notFound(response);
    response.json(ok({ automation: publicAutomation(automation) }));
  });

  router.patch("/:automationId", async (request, response) => {
    const parsed = updateSchema.safeParse(request.body ?? {});
    if (!parsed.success) return invalid(response);
    const repo = repository(db, masterKey, request);
    const current = repo.get(request.params.automationId);
    if (!current) return notFound(response);
    try {
      const schedule = parsed.data.schedule ? normalizeAutomationSchedule(parsed.data.schedule) : undefined;
      const stored = schedule ? toStoredAutomationSchedule(schedule) : undefined;
      const automation = repo.updateWithRevision(current.id, parsed.data.expectedRevision, {
        ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
        ...(parsed.data.prompt !== undefined ? { prompt: parsed.data.prompt } : {}),
        ...(parsed.data.scope !== undefined ? { scopeType: parsed.data.scope.type, scopePolicy: parsed.data.scope } : {}),
        ...(parsed.data.delivery !== undefined ? { deliveryPlan: parsed.data.delivery } : {}),
        ...(parsed.data.toolAuthority !== undefined || parsed.data.maxUsageTokens !== undefined || parsed.data.deadlineMs !== undefined
          ? { authoritySnapshot: {
            ...current.authoritySnapshot,
            ...(parsed.data.toolAuthority !== undefined ? { tools: parsed.data.toolAuthority } : {}),
            ...(parsed.data.maxUsageTokens !== undefined ? { maxUsageTokens: parsed.data.maxUsageTokens } : {}),
            ...(parsed.data.deadlineMs !== undefined ? { deadlineMs: parsed.data.deadlineMs } : {})
          } } : {}),
        ...(stored ?? {}), ...(schedule ? { nextRunAt: schedule.nextRunAt } : {})
      });
      await options.scheduler?.reconcile(userIdFor(request));
      response.json(ok({ automation: publicAutomation(automation) }));
    } catch (error) {
      routeError(response, error);
    }
  });

  router.post("/:automationId/pause", (request, response) => changeStatus(db, masterKey, request, response, "paused"));
  router.post("/:automationId/resume", (request, response) => {
    const parsed = revisionSchema.safeParse(request.body ?? {});
    if (!parsed.success) return invalid(response);
    const repo = repository(db, masterKey, request);
    const current = repo.get(request.params.automationId);
    if (!current) return notFound(response);
    try {
      const schedule = normalizeAutomationSchedule(fromStoredAutomationSchedule(current));
      const automation = repo.updateWithRevision(current.id, parsed.data.expectedRevision, { status: "active", nextRunAt: schedule.nextRunAt });
      response.json(ok({ automation: publicAutomation(automation) }));
    } catch (error) {
      routeError(response, error);
    }
  });

  router.delete("/:automationId", (request, response) => changeStatus(db, masterKey, request, response, "deleted"));

  router.post("/:automationId/run", async (request, response) => {
    const repo = repository(db, masterKey, request);
    if (!repo.get(request.params.automationId)) return notFound(response);
    try {
      const run = options.scheduler
        ? await options.scheduler.runNow(userIdFor(request), request.params.automationId)
        : repo.createOrGetRun(request.params.automationId, `manual:${new Date().toISOString()}`, "manual");
      response.status(202).json(ok({ run: publicRun(run) }));
    } catch (error) {
      routeError(response, error);
    }
  });

  router.get("/:automationId/runs", (request, response) => {
    const repo = repository(db, masterKey, request);
    if (!repo.get(request.params.automationId)) return notFound(response);
    const limit = Math.min(Math.max(Number(request.query.limit) || 20, 1), 50);
    response.json(ok({ runs: repo.listRuns(request.params.automationId).slice(-limit).map(publicRun) }));
  });

  router.post("/:automationId/runs/:runId/cancel", (request, response) => {
    const repo = repository(db, masterKey, request);
    if (!repo.get(request.params.automationId)) return notFound(response);
    try {
      const existing = repo.getRun(request.params.runId);
      if (!existing || existing.automationId !== request.params.automationId) return notFound(response);
      const run = repo.cancelRun(request.params.runId);
      response.json(ok({ run: publicRun(run) }));
    } catch (error) {
      routeError(response, error);
    }
  });

  return router;
}

function changeStatus(db: Database, masterKey: string, request: Request, response: Response, status: "paused" | "deleted") {
  const parsed = revisionSchema.safeParse(request.body ?? {});
  if (!parsed.success) return invalid(response);
  const repo = repository(db, masterKey, request);
  const automationId = request.params.automationId;
  if (!automationId) return notFound(response);
  const current = repo.get(automationId);
  if (!current) return notFound(response);
  try {
    const automation = repo.updateWithRevision(current.id, parsed.data.expectedRevision, { status, nextRunAt: null });
    response.json(ok({ automation: publicAutomation(automation) }));
  } catch (error) {
    routeError(response, error);
  }
}

function repository(db: Database, masterKey: string, request: unknown): CopilotAutomationRepository {
  const userId = userIdFor(request);
  return new CopilotAutomationRepository(db, userId, masterKey);
}

function userIdFor(request: unknown): string {
  return (request as AuthenticatedRequest).userId;
}

function publicAutomation(automation: ReturnType<CopilotAutomationRepository["create"]>) {
  return automation;
}

function publicRun(run: unknown): unknown {
  if (!run || typeof run !== "object") return run;
  const { claimToken: _claimToken, ...safe } = run as Record<string, unknown>;
  return safe;
}

function ok(data: Record<string, unknown>) { return { code: 0, data, message: "" }; }
function invalid(response: Response) { response.status(400).json({ code: 1, message: "Invalid input", details: {} }); }
function notFound(response: Response) { response.status(404).json({ code: 1, message: "Automation not found", details: {} }); }
function routeError(response: Response, error: unknown) {
  const message = error instanceof Error ? error.message : "Automation request failed";
  const status = message === "AUTOMATION_REVISION_CONFLICT" ? 409
    : message.includes("NOT_FOUND") ? 404
      : message.includes("NOT_CANCELLABLE") ? 409 : 400;
  response.status(status).json({ code: 1, message, details: {} });
}
