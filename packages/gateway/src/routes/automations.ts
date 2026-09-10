/**
 * Copilot automation routes — /api/v1/copilot/automations/*.
 *
 * CRUD for scheduled automations, their run history, and the consent-first
 * catalog suggestions the owner accepts to create one. All access is scoped by
 * user_id (repositories constructed with req.userId).
 */
import { Router, type Response } from "express";
import { z } from "zod";

import { authenticate, type AuthenticatedRequest } from "../auth/middleware.js";
import type { AgentStackDeps } from "../services/agent/agent-stack.js";
import { AutomationRepository } from "../services/automation/automation-repository.js";
import { nextFireAfter, slotKey, validateSchedule } from "../services/automation/schedule-parser.js";
import { runAutomationTurn } from "../services/automation/runner.js";
import { seedCatalogSuggestions } from "../services/automation/suggestions.js";

export type AutomationRouteDeps = AgentStackDeps;

const idSchema = z.string().trim().min(1).max(128);
const scheduleKindSchema = z.enum(["cron", "interval", "once"]);
const createAutomationSchema = z.object({
  name: z.string().trim().min(1).max(200),
  scopeType: z.enum(["global", "project"]),
  scopePolicy: z.record(z.unknown()).optional(),
  prompt: z.string().trim().min(1).max(32 * 1024),
  scheduleKind: scheduleKindSchema,
  scheduleExpression: z.string().trim().min(1).max(512),
  timezone: z.string().trim().min(1).max(64).optional(),
  delivery: z.object({ notify: z.boolean(), conversation: z.boolean() }).optional()
}).strict();

const scheduleInputSchema = z.object({
  scheduleKind: scheduleKindSchema,
  scheduleExpression: z.string().trim().min(1).max(512),
  timezone: z.string().trim().min(1).max(64).optional()
}).strict();

export function createAutomationRoutes(deps: AutomationRouteDeps): Router {
  const router = Router();
  router.use(authenticate);

  router.get("/automations", (req, res) => {
    const repo = new AutomationRepository(deps.db, userId(req), deps.masterKey);
    res.json(ok({ automations: repo.list() }));
  });

  router.post("/automations", (req, res) => {
    withBody(req.body, createAutomationSchema, res, (value) => {
      try {
        validateSchedule(value.scheduleKind, value.scheduleExpression, value.timezone ?? "UTC");
      } catch (error) {
        return invalid(res, error instanceof Error ? error.message : "Invalid schedule");
      }
      const repo = new AutomationRepository(deps.db, userId(req), deps.masterKey);
      const automation = repo.create({
        name: value.name,
        scopeType: value.scopeType,
        scopePolicy: value.scopePolicy ?? {},
        prompt: value.prompt,
        scheduleKind: value.scheduleKind,
        scheduleExpression: value.scheduleExpression,
        timezone: value.timezone ?? "UTC",
        deliveryPlan: value.delivery ?? { notify: true, conversation: true },
        authoritySnapshot: { readOnly: true, tools: [] }
      });
      res.status(201).json(ok({ automation }));
    });
  });

  router.get("/automations/suggestions", (req, res) => {
    const repo = new AutomationRepository(deps.db, userId(req), deps.masterKey);
    seedCatalogSuggestions(repo);
    res.json(ok({ suggestions: repo.listSuggestions() }));
  });

  router.post("/automations/suggestions/:id/accept", (req, res) => {
    const id = parseId(req.params.id, res); if (!id) return;
    const repo = new AutomationRepository(deps.db, userId(req), deps.masterKey);
    const suggestion = repo.decideSuggestion(id, "accepted");
    if (!suggestion) return notFound(res);
    const automation = createFromJobSpec(repo, suggestion.jobSpec);
    res.status(201).json(ok({ automation }));
  });

  router.post("/automations/suggestions/:id/dismiss", (req, res) => {
    const id = parseId(req.params.id, res); if (!id) return;
    const repo = new AutomationRepository(deps.db, userId(req), deps.masterKey);
    if (!repo.decideSuggestion(id, "dismissed")) return notFound(res);
    res.json(ok({ dismissed: true }));
  });

  router.get("/automations/:id", (req, res) => {
    const id = parseId(req.params.id, res); if (!id) return;
    const repo = new AutomationRepository(deps.db, userId(req), deps.masterKey);
    const automation = repo.get(id);
    if (!automation) return notFound(res);
    res.json(ok({ automation }));
  });

  router.patch("/automations/:id", (req, res) => {
    const id = parseId(req.params.id, res); if (!id) return;
    withBody(req.body, scheduleInputSchema, res, (value) => {
      const repo = new AutomationRepository(deps.db, userId(req), deps.masterKey);
      const automation = repo.get(id);
      if (!automation) return notFound(res);
      const timezone = value.timezone ?? automation.timezone;
      try {
        validateSchedule(value.scheduleKind, value.scheduleExpression, timezone);
      } catch (error) {
        return invalid(res, error instanceof Error ? error.message : "Invalid schedule");
      }
      // Schedule edits are applied through a fresh create-on-edit path; for the
      // MVP the patch scope is limited to re-scheduling an existing automation.
      const next = nextFireAfter(value.scheduleKind, value.scheduleExpression, timezone, new Date()) ?? null;
      repo.updateSchedule(id, value.scheduleKind, value.scheduleExpression, timezone, next);
      res.json(ok({ automation: repo.get(id) }));
    });
  });

  router.delete("/automations/:id", (req, res) => {
    const id = parseId(req.params.id, res); if (!id) return;
    const repo = new AutomationRepository(deps.db, userId(req), deps.masterKey);
    if (!repo.delete(id)) return notFound(res);
    res.json(ok({ deleted: true }));
  });

  router.post("/automations/:id/enable", (req, res) => {
    const id = parseId(req.params.id, res); if (!id) return;
    const repo = new AutomationRepository(deps.db, userId(req), deps.masterKey);
    const automation = repo.get(id);
    if (!automation) return notFound(res);
    const next = nextFireAfter(automation.scheduleKind, automation.scheduleExpression, automation.timezone, new Date()) ?? null;
    repo.updateSchedule(id, automation.scheduleKind, automation.scheduleExpression, automation.timezone, next);
    repo.setStatus(id, "enabled");
    res.json(ok({ automation: repo.get(id) }));
  });

  router.post("/automations/:id/pause", (req, res) => {
    const id = parseId(req.params.id, res); if (!id) return;
    const repo = new AutomationRepository(deps.db, userId(req), deps.masterKey);
    if (!repo.get(id)) return notFound(res);
    repo.setStatus(id, "paused");
    res.json(ok({ automation: repo.get(id) }));
  });

  router.post("/automations/:id/run", (req, res) => {
    const id = parseId(req.params.id, res); if (!id) return;
    const repo = new AutomationRepository(deps.db, userId(req), deps.masterKey);
    const automation = repo.get(id);
    if (!automation) return notFound(res);
    const now = new Date();
    const run = repo.claimSlot({
      automation,
      scheduledSlot: `manual:${slotKey(automation.scheduleKind, automation.scheduleExpression, now)}`,
      triggerKind: "manual",
      now,
      leaseMs: 10 * 60_000
    });
    if (!run) return res.status(409).json({ code: 1, message: "A run is already in progress", details: { code: "AUTOMATION_RUN_BUSY" } });
    void runAutomationTurn(deps, automation, run);
    res.status(202).json(ok({ runId: run.id }));
  });

  router.get("/automations/:id/runs", (req, res) => {
    const id = parseId(req.params.id, res); if (!id) return;
    const repo = new AutomationRepository(deps.db, userId(req), deps.masterKey);
    if (!repo.get(id)) return notFound(res);
    const limit = parseLimit(req.query.limit);
    res.json(ok({ runs: repo.listRuns(id, limit) }));
  });

  router.get("/automations/:id/runs/:runId", (req, res) => {
    const id = parseId(req.params.id, res); if (!id) return;
    const runId = parseId(req.params.runId, res); if (!runId) return;
    const repo = new AutomationRepository(deps.db, userId(req), deps.masterKey);
    const run = repo.getRun(runId);
    if (!run || run.automationId !== id) return notFound(res);
    res.json(ok({ run, content: repo.decryptContent(runId) }));
  });

  return router;
}

function createFromJobSpec(repo: AutomationRepository, jobSpec: string): ReturnType<AutomationRepository["create"]> {
  const spec = JSON.parse(jobSpec) as {
    name: string;
    scopeType: "global" | "project";
    scopePolicy: Record<string, unknown>;
    prompt: string;
    scheduleKind: "cron" | "interval" | "once";
    scheduleExpression: string;
    timezone: string;
    delivery: { notify: boolean; conversation: boolean };
  };
  return repo.create({
    name: spec.name,
    scopeType: spec.scopeType,
    scopePolicy: spec.scopePolicy,
    prompt: spec.prompt,
    scheduleKind: spec.scheduleKind,
    scheduleExpression: spec.scheduleExpression,
    timezone: spec.timezone,
    deliveryPlan: spec.delivery,
    authoritySnapshot: { readOnly: true, tools: [] }
  });
}

function userId(req: unknown): string { return (req as AuthenticatedRequest).userId; }
function ok(data: unknown) { return { code: 0, data, message: "" }; }
function parseId(value: string | undefined, res: Response): string | undefined {
  const parsed = idSchema.safeParse(value);
  if (!parsed.success) invalid(res);
  return parsed.success ? parsed.data : undefined;
}
function parseLimit(value: unknown): number {
  const parsed = z.coerce.number().int().min(1).max(100).safeParse(value ?? 50);
  return parsed.success ? parsed.data : 50;
}
function withBody<T>(body: unknown, schema: z.ZodType<T>, res: Response, callback: (value: T) => void): void {
  const parsed = schema.safeParse(body);
  if (!parsed.success) return invalid(res);
  callback(parsed.data);
}
function invalid(res: Response, message = "Invalid input"): void {
  res.status(400).json({ code: 1, message, details: { code: "AUTOMATION_INVALID_INPUT" } });
}
function notFound(res: Response): void {
  res.status(404).json({ code: 1, message: "Automation not found", details: { code: "AUTOMATION_NOT_FOUND" } });
}
